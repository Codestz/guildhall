import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Dispatch, hubBuild, startHub } from "@guildhall/hub"
import { createCourier, setHubEntry } from "../src/courier.ts"

// Without Bun on PATH the courier runs the hub with this process's own binary (Bun here): either
// way, no test may start a real hub on the default port. Every start runs a script that exits.
const noHub = join(mkdtempSync(join(tmpdir(), "guildhall-nohub-")), "no-hub.js")
writeFileSync(noHub, "")
setHubEntry(noHub)

const change = { type: "status", id: "ses_1", status: "busy", at: 1 } as const

/** Bun.which("bun") would start a real hub on the default port: point PATH away while `run` goes. */
async function withoutBun<T>(run: () => Promise<T>): Promise<T> {
  const path = process.env.PATH
  process.env.PATH = ""
  try {
    return await run()
  } finally {
    process.env.PATH = path
  }
}

/**
 * A stand-in hub that answers the n-th POST (from 0) with `answer(n, body)` and keeps what it
 * accepted; `sizes` has every POST's body length, accepted or not. `/health` answers `health`: by
 * default a hub of the current build.
 */
function fakeHub(
  answer: (n: number, body: Dispatch, text: string) => Response | Promise<Response>,
  health: unknown = { ok: true, build: hubBuild() },
) {
  const accepted: Dispatch[] = []
  const sizes: number[] = []
  let n = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 64 * 1024 * 1024,
    async fetch(request) {
      if (new URL(request.url).pathname === "/health") return Response.json(health)
      const text = await request.text()
      sizes.push(Buffer.byteLength(text))
      const body = JSON.parse(text) as Dispatch
      const response = await answer(n++, body, text)
      if (response.ok) accepted.push(body)
      return response
    },
  })
  return { server, accepted, sizes, port: server.port as number }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

async function until(check: () => boolean, ms: number): Promise<void> {
  // performance.now: Date.now is frozen while a test sets the system time.
  const end = performance.now() + ms
  while (!check() && performance.now() < end) await wait(25)
}

describe("courier", () => {
  const port = 4900 + Math.floor(Math.random() * 90)
  let hub: ReturnType<typeof startHub> | undefined
  afterAll(() => hub?.stop(true))
  afterEach(() => setSystemTime())

  test("a batch sent while the hub is down is kept and delivered once it is up", async () => {
    const logs: string[] = []
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port })
    await withoutBun(async () => {
      courier.send([change], { raw: 1 })
      await wait(300)
    })
    hub = startHub({ port, home: mkdtempSync(join(tmpdir(), "guildhall-courier-")) })
    await wait(1500)
    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { guilds: string[] }
    expect(health.guilds).toEqual(["t"])
    expect(logs.some((m) => m.includes("reachable again"))).toBe(true)
    expect(logs.some((m) => m.includes("WARNING"))).toBe(false)
    await courier.flush()
  })

  test("a hub running older code is logged as stale, with its pid and start, and still used", async () => {
    const fake = fakeHub(() => Response.json({ ok: true }), {
      ok: true,
      build: "0123456789ab",
      started: "2026-10-06T00:13:00.000Z",
      pid: 92027,
    })
    const logs: string[] = []
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: fake.port })
    await withoutBun(async () => {
      courier.send([change], { raw: 1 })
      await until(() => logs.some((m) => m.includes("stale hub")), 3000)
      await courier.flush()
    })
    fake.server.stop(true)
    const warning = logs.find((m) => m.includes("stale hub")) ?? ""
    expect(warning).toContain("0123456789ab")
    expect(warning).toContain("92027")
    expect(warning).toContain("2026-10-06T00:13:00.000Z")
    expect(warning).toContain(hubBuild())
    expect(fake.accepted[0]?.changes).toEqual([change])
  })

  test("a hub from before builds were reported, or a stranger on the port, is called out", async () => {
    for (const health of [{ ok: true, guilds: [], halls: 0 }, { hello: "not a hub" }]) {
      const fake = fakeHub(() => Response.json({ ok: true }), health)
      const logs: string[] = []
      const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: fake.port })
      await withoutBun(async () => {
        courier.send([change], { raw: 1 })
        await until(() => logs.some((m) => m.includes("WARNING")), 3000)
        await courier.flush()
      })
      fake.server.stop(true)
      expect(logs.filter((m) => m.includes("WARNING"))).toHaveLength(1)
    }
  })

  test("a 5xx or 429 reply keeps the batch and retries it, logging the outage once", async () => {
    const fake = fakeHub((n) => new Response("no", { status: n === 0 ? 503 : n === 1 ? 429 : 200 }))
    const logs: string[] = []
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: fake.port })
    await withoutBun(async () => {
      courier.send([change], { raw: 1 })
      await until(() => fake.accepted.length > 0, 6000)
    })
    fake.server.stop(true)
    expect(fake.accepted[0]?.changes).toEqual([change])
    expect(logs.filter((m) => m.includes("503"))).toHaveLength(1)
    expect(logs.some((m) => m.includes("429"))).toBe(false)
    expect(logs.some((m) => m.includes("starting"))).toBe(false)
    await courier.flush()
  }, 10_000)

  test("a 413 splits the batch: what fits goes, a single change too big is dropped, the rest flows", async () => {
    // Takes bodies up to 100 KB, like a hub with a smaller cap.
    const fake = fakeHub((_n, _body, text) =>
      Buffer.byteLength(text) > 100_000
        ? new Response("too big", { status: 413 })
        : Response.json({ ok: true }),
    )
    const logs: string[] = []
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: fake.port })
    const huge = { ...change, type: "prompt", key: "k", text: "x".repeat(200_000), at: 2 } as const
    await withoutBun(async () => {
      courier.send([change], { pad: "p".repeat(200_000) })
      courier.send([huge], { small: true })
      courier.send([{ ...change, at: 3 }], { small: true })
      await until(() => fake.accepted.flatMap((d) => d.changes).some((c) => c.at === 3), 3000)
    })
    fake.server.stop(true)
    expect(fake.accepted.flatMap((d) => d.changes.map((c) => c.at))).toEqual([1, 3])
    expect(fake.accepted.flatMap((d) => d.raw)).toEqual([{ small: true }, { small: true }])
    expect(logs.filter((m) => m.includes("too large")).length).toBe(2)
    expect(logs.some((m) => m.includes("retrying"))).toBe(false)
    await courier.flush()
  }, 10_000)

  test("a 400 drops the batch (it can never succeed) and later events still flow", async () => {
    const fake = fakeHub((n) =>
      n === 0 ? new Response("bad dispatch", { status: 400 }) : Response.json({ ok: true }),
    )
    const logs: string[] = []
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: fake.port })
    await withoutBun(async () => {
      courier.send([change], { raw: 1 })
      await until(() => fake.sizes.length > 0, 2000)
      await wait(50)
      courier.send([{ ...change, at: 2 }], { raw: 2 })
      await until(() => fake.accepted.length > 0, 3000)
      await wait(300)
    })
    fake.server.stop(true)
    expect(fake.accepted.flatMap((d) => d.changes.map((c) => c.at))).toEqual([2])
    expect(fake.sizes).toHaveLength(2)
    expect(logs.some((m) => m.includes("400") && m.includes("dropped"))).toBe(true)
    await courier.flush()
  }, 10_000)

  test("a backlog goes out in POSTs of at most 500 changes and the byte budget", async () => {
    const fake = fakeHub(() => Response.json({ ok: true }))
    const courier = createCourier({ guild: "t", opencode: 2, log: () => {}, port: fake.port })
    await withoutBun(async () => {
      for (let i = 0; i < 1200; i++) courier.send([{ ...change, at: i + 1 }], { i })
      // 4 × 3 MB of raw events: more than one POST may carry.
      for (let i = 0; i < 4; i++) courier.send([], { pad: "p".repeat(3 * 1024 * 1024) })
      await courier.flush()
    })
    fake.server.stop(true)
    const counts = fake.accepted.map((d) => d.changes.length)
    expect(Math.max(...counts)).toBeLessThanOrEqual(500)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1200)
    expect(fake.accepted.flatMap((d) => d.changes.map((c) => c.at))).toEqual(
      Array.from({ length: 1200 }, (_, i) => i + 1),
    )
    expect(fake.accepted.flatMap((d) => d.raw ?? []).length).toBe(1204)
    expect(Math.max(...fake.sizes)).toBeLessThanOrEqual(8 * 1024 * 1024)
  }, 20_000)

  test("a hub that accepts but never answers can't hang flush; the batch is retried after", async () => {
    const fake = fakeHub((n) => (n === 0 ? new Promise<Response>(() => {}) : Response.json({ ok: true })))
    const logs: string[] = []
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: fake.port })
    await withoutBun(async () => {
      courier.send([change], { raw: 1 })
      await wait(200)
      await until(() => fake.accepted.length > 0, 8000)
    })
    fake.server.stop(true)
    expect(fake.accepted[0]?.changes).toEqual([change])
    expect(logs.some((m) => m.includes("starting"))).toBe(false)
    await courier.flush()
  }, 12_000)

  test("flush on dispose returns in bounded time when the hub hangs", async () => {
    const fake = fakeHub(() => new Promise<Response>(() => {}))
    const courier = createCourier({ guild: "t", opencode: 2, log: () => {}, port: fake.port })
    courier.send([change], { raw: 1 })
    const started = performance.now()
    await withoutBun(() => courier.flush())
    expect(performance.now() - started).toBeLessThan(4500)
    fake.server.stop(true)
  }, 10_000)

  test("an unserializable raw event is dropped, its changes still go, and no hub is started", async () => {
    const fake = fakeHub(() => Response.json({ ok: true }))
    const logs: string[] = []
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: fake.port })
    const circular: Record<string, unknown> = { type: "loop" }
    circular.self = circular
    await withoutBun(async () => {
      courier.send([change], { big: 1n })
      courier.send([{ ...change, at: 2 }], circular)
      courier.send([{ ...change, at: 3 }], { fine: true })
      await courier.flush()
    })
    fake.server.stop(true)
    expect(fake.accepted.flatMap((d) => d.changes.map((c) => c.at))).toEqual([1, 2, 3])
    expect(fake.accepted.flatMap((d) => d.raw)).toEqual([{ fine: true }])
    expect(logs.some((m) => m.includes("unreachable") || m.includes("starting"))).toBe(false)
  })

  test("after a failed start, a later outage may start a hub again (at most every 30 s)", async () => {
    // Nothing listens on this port; with no bun on PATH each start runs the hub entry with this
    // process's own Bun (OpenCode's binary, in OpenCode), which here exits at once.
    const logs: string[] = []
    const dead = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
    const free = dead.port as number
    dead.stop(true)
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: free })
    const attempts = () => logs.filter((m) => m.includes("started hub")).length
    // Clear of any start an earlier test made; the clock stays frozen at each time set.
    setSystemTime(new Date(Date.now() + 31_000))
    await withoutBun(async () => {
      courier.send([change], { raw: 1 })
      await until(() => attempts() > 0, 2000)
      await wait(800) // a retry inside the interval: no second attempt
      expect(attempts()).toBe(1)
      setSystemTime(new Date(Date.now() + 31_000))
      await until(() => attempts() > 1, 4000)
    })
    expect(attempts()).toBe(2)
    expect(logs.find((m) => m.includes("started hub"))).toContain(`with ${process.execPath} as Bun`)
    await withoutBun(() => courier.flush())
  }, 10_000)
})
