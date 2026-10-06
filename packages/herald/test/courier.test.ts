import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Dispatch, startHub } from "@guildhall/hub"
import { createCourier } from "../src/courier.ts"

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

/** A stand-in hub that answers the n-th POST (from 0) with `answer(n)` and keeps what it accepted. */
function fakeHub(answer: (n: number) => Response | Promise<Response>) {
  const accepted: Dispatch[] = []
  let n = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Dispatch
      const response = await answer(n++)
      if (response.ok) accepted.push(body)
      return response
    },
  })
  return { server, accepted, port: server.port as number }
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
    await courier.flush()
  })

  test("a non-2xx reply keeps the batch and retries it, logging the outage once", async () => {
    const fake = fakeHub((n) => new Response("no", { status: n < 2 ? 503 : 200 }))
    const logs: string[] = []
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: fake.port })
    await withoutBun(async () => {
      courier.send([change], { raw: 1 })
      await until(() => fake.accepted.length > 0, 6000)
    })
    fake.server.stop(true)
    expect(fake.accepted[0]?.changes).toEqual([change])
    expect(logs.filter((m) => m.includes("503"))).toHaveLength(1)
    expect(logs.some((m) => m.includes("starting"))).toBe(false)
    await courier.flush()
  }, 10_000)

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
    // Nothing listens on this port; with no bun on PATH each start attempt logs that it can't.
    const logs: string[] = []
    const dead = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
    const free = dead.port as number
    dead.stop(true)
    const courier = createCourier({ guild: "t", opencode: 2, log: (m) => logs.push(m), port: free })
    const attempts = () => logs.filter((m) => m.includes("start the hub")).length
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
    await withoutBun(() => courier.flush())
  }, 10_000)
})
