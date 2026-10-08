import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type GuildEvent, WIRE_VERSION } from "@guildhall/core"
import { RAW_KEEP_MS } from "../src/chronicles.ts"
import { HELLO_EVENTS, HELLO_GUILDS, helloEvents, serially } from "../src/hub.ts"
import type { HubMessage } from "../src/index.ts"
import { HERALD_HEADER, type Health, hubBuild, startHub } from "../src/index.ts"
import { MAX_RAW, MAX_RAW_TOTAL } from "../src/validate.ts"

const home = mkdtempSync(join(tmpdir(), "guildhall-hub-"))
const hub = startHub({ port: 0, home })
const base = `http://127.0.0.1:${hub.port}`
afterAll(() => hub.stop(true))

const dispatch = {
  guild: "demo",
  opencode: 2,
  changes: [{ type: "session", id: "ses_1", agent: "guild-master", title: "t", at: 1 }],
  raw: [{ type: "session.created" }],
}

describe("hub", () => {
  test("/health names the build it runs and when it started, so a stale hub can be told apart", async () => {
    const health = (await (await fetch(`${base}/health`)).json()) as Health
    expect(health.build).toBe(hubBuild())
    expect(health.build).toMatch(/^[0-9a-f]{12}$/)
    expect(Date.parse(health.started)).toBeLessThanOrEqual(Date.now())
    expect(health.pid).toBe(process.pid)
  })

  test("the build changes when the hub's source does", () => {
    const dir = mkdtempSync(join(tmpdir(), "guildhall-build-"))
    writeFileSync(join(dir, "hub.ts"), "a")
    const before = hubBuild(dir)
    writeFileSync(join(dir, "hub.ts"), "b")
    expect(hubBuild(dir)).not.toBe(before)
  })

  test("refuses a POST without the herald header (a web page can't forge events)", async () => {
    const response = await fetch(`${base}/events`, { method: "POST", body: JSON.stringify(dispatch) })
    expect(response.status).toBe(403)
  })

  test("numbers events, records a chronicle and the raw log", async () => {
    const response = await fetch(`${base}/events`, {
      method: "POST",
      headers: { [HERALD_HEADER]: "1" },
      body: JSON.stringify(dispatch),
    })
    expect(await response.json()).toEqual({ ok: true, count: 1 })
    const dir = join(home, "chronicles", "demo")
    const files = readdirSync(dir)
    const chronicle = files.find((f) => !f.includes(".raw."))
    expect(chronicle).toBeDefined()
    expect(JSON.parse(readFileSync(join(dir, chronicle ?? ""), "utf8").trim()).seq).toBe(1)
    expect(files.some((f) => f.endsWith(".raw.jsonl"))).toBe(true)
  })

  test("a hall that connects late gets everything so far, then live events", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`)
    const messages: HubMessage[] = []
    socket.onmessage = (m) => messages.push(JSON.parse(String(m.data)))
    await new Promise((r) => socket.addEventListener("open", r))
    await fetch(`${base}/events`, {
      method: "POST",
      headers: { [HERALD_HEADER]: "1" },
      body: JSON.stringify(dispatch),
    })
    await new Promise((r) => setTimeout(r, 100))
    socket.close()
    expect(messages[0]?.type).toBe("hello")
    expect(messages[0]?.type === "hello" && messages[0].events.length).toBe(1)
    expect(messages[1]?.type === "events" && messages[1].events[0]?.seq).toBe(2)
  })

  test("refuses a hall from a foreign origin", async () => {
    const response = await fetch(`${base}/ws`, { headers: { origin: "https://evil.example" } })
    expect(response.status).toBe(403)
  })
})

const post = (to: string, body: unknown) =>
  fetch(`${to}/events`, {
    method: "POST",
    headers: { [HERALD_HEADER]: "1" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

/** A hall on `port` that keeps every message; `ready` once the hello is in. */
function hall(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  const messages: HubMessage[] = []
  const ready = new Promise<void>((done) => {
    socket.onmessage = (m) => {
      messages.push(JSON.parse(String(m.data)))
      done()
    }
  })
  return { socket, messages, ready }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
const status = (at: number) => ({ type: "status", id: "ses_1", status: "busy", at })

describe("hub boundary", () => {
  test("drops bad changes one by one and keeps the good ones", async () => {
    const response = await post(base, {
      guild: "checked",
      opencode: 2,
      changes: [status(1), { type: "explode", id: "x", at: 1 }, { ...status(2), at: -5 }, status(3)],
    })
    expect(await response.json()).toEqual({ ok: true, count: 2, rejected: 2 })
  })

  test("a body that isn't JSON, or has no guild, is a 400", async () => {
    expect((await post(base, "{nope")).status).toBe(400)
    expect((await post(base, { guild: 7, changes: [] })).status).toBe(400)
    expect((await post(base, { guild: "g", changes: "all" })).status).toBe(400)
  })

  test("a body over the cap is refused", async () => {
    const big = "x".repeat(17 * 1024 * 1024)
    const response = await post(base, { guild: "big", opencode: 2, changes: [], raw: [big] })
    expect(response.status).toBe(413)
  })
})

describe("hub ordering", () => {
  test("concurrent dispatches for a guild reach a hall in seq order", async () => {
    const watcher = hall(hub.port as number)
    await watcher.ready
    const text = (n: number) => "t".repeat((n % 7) * 40_000)
    await Promise.all(
      Array.from({ length: 40 }, (_, n) =>
        post(base, {
          guild: "ordered",
          opencode: 2,
          changes: [{ type: "prompt", id: "s", key: `k${n}`, text: text(n), at: n + 1 }],
          raw: [{ pad: text(n + 3) }],
        }),
      ),
    )
    await wait(300)
    watcher.socket.close()
    const seqs = watcher.messages.flatMap((m) =>
      m.type === "events" ? m.events.filter((e) => e.guild === "ordered").map((e) => e.seq) : [],
    )
    expect(seqs).toEqual(Array.from({ length: 40 }, (_, n) => n + 1))
  })
})

describe("hub halls", () => {
  test("a hall that stops reading is dropped; the others get every event", async () => {
    const local = startHub({
      port: 0,
      home: mkdtempSync(join(tmpdir(), "guildhall-slow-")),
      maxBuffered: 1024 * 1024,
    })
    const to = `http://127.0.0.1:${local.port}`
    // A raw client that upgrades, then never reads again.
    const { connect } = await import("node:net")
    const slow = connect(local.port as number, "127.0.0.1")
    await new Promise((done) => slow.once("connect", done))
    slow.write(
      `GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    )
    await new Promise((done) => slow.once("data", done))
    slow.pause()
    const fast = hall(local.port as number)
    await fast.ready
    const halls = async () => ((await (await fetch(`${to}/health`)).json()) as { halls: number }).halls
    expect(await halls()).toBe(2)
    const sent = 100
    for (let n = 0; n < sent; n++)
      await post(to, {
        guild: "busy",
        opencode: 2,
        changes: [{ type: "prompt", id: "s", key: `k${n}`, text: "p".repeat(200_000), at: n + 1 }],
      })
    await wait(500)
    expect(await halls()).toBe(1)
    const got = fast.messages.flatMap((m) => (m.type === "events" ? m.events.map((e) => e.seq) : []))
    expect(got).toEqual(Array.from({ length: sent }, (_, n) => n + 1))
    fast.socket.close()
    slow.destroy()
    local.stop(true)
  }, 20_000)
})

describe("hub restart", () => {
  test("a hub started on the same home serves the last boot's events and continues their seq", async () => {
    const shared = mkdtempSync(join(tmpdir(), "guildhall-restart-"))
    const first = startHub({ port: 0, home: shared })
    await post(`http://127.0.0.1:${first.port}`, {
      guild: "kept",
      opencode: 2,
      changes: [status(1), status(2)],
    })
    first.stop(true)
    const second = startHub({ port: 0, home: shared })
    const watcher = hall(second.port as number)
    await watcher.ready
    await post(`http://127.0.0.1:${second.port}`, { guild: "kept", opencode: 2, changes: [status(3)] })
    await wait(100)
    watcher.socket.close()
    second.stop(true)
    const hello = watcher.messages[0]
    expect(hello?.type === "hello" && hello.events.map((e) => e.seq)).toEqual([1, 2])
    const live = watcher.messages[1]
    expect(live?.type === "events" && live.events.map((e) => e.seq)).toEqual([3])
  })
})

describe("hub guild names", () => {
  test("a guild name that could leave chronicles/ is refused, and nothing is written outside", async () => {
    const root = mkdtempSync(join(tmpdir(), "guildhall-escape-"))
    const home = join(root, "home")
    const local = startHub({ port: 0, home })
    const to = `http://127.0.0.1:${local.port}`
    for (const guild of ["..", ".", ".hidden", "a/b", "../up", "a\\b", "x\u0000y", "tab\there"]) {
      const response = await post(to, { guild, opencode: 2, changes: [status(1)], raw: [{ x: 1 }] })
      expect(response.status).toBe(400)
    }
    local.stop(true)
    const entries = (dir: string) => (existsSync(dir) ? readdirSync(dir) : [])
    expect(entries(root).filter((f) => f !== "home")).toEqual([])
    expect(entries(home).filter((f) => f !== "chronicles")).toEqual([])
    expect(entries(join(home, "chronicles"))).toEqual([])
  })

  test("ordinary project names still work, dots inside included", async () => {
    const response = await post(base, { guild: "my.app-2_x", opencode: 2, changes: [status(1)] })
    expect(response.status).toBe(200)
    expect(readdirSync(join(home, "chronicles"))).toContain("my.app-2_x")
  })
})

describe("hub request checks", () => {
  test("a POST carrying an Origin is refused (heralds never send one)", async () => {
    const response = await fetch(`${base}/events`, {
      method: "POST",
      headers: { [HERALD_HEADER]: "1", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify(dispatch),
    })
    expect(response.status).toBe(403)
  })

  test("a POST whose Host isn't this hub's loopback address is refused (DNS rebinding)", async () => {
    const { connect } = await import("node:net")
    const raw = (host: string) =>
      new Promise<string>((done) => {
        const socket = connect(hub.port as number, "127.0.0.1")
        const body = JSON.stringify(dispatch)
        let reply = ""
        socket.on("data", (chunk) => {
          reply += String(chunk)
          socket.end()
        })
        socket.on("close", () => done(reply))
        socket.write(
          `POST /events HTTP/1.1\r\nHost: ${host}\r\n${HERALD_HEADER}: 1\r\nContent-Type: application/json\r\n` +
            `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        )
      })
    expect(await raw(`evil.example:${hub.port}`)).toStartWith("HTTP/1.1 403")
    expect(await raw("127.0.0.1:1")).toStartWith("HTTP/1.1 403")
    expect(await raw(`localhost:${hub.port}`)).toStartWith("HTTP/1.1 200")
    expect(await raw(`127.0.0.1:${hub.port}`)).toStartWith("HTTP/1.1 200")
  })

  test("a batch of more than 500 changes is a 400 that says so", async () => {
    const response = await post(base, {
      guild: "many",
      opencode: 2,
      changes: Array.from({ length: 501 }, (_, n) => status(n + 1)),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain("500")
    const ok = await post(base, {
      guild: "many",
      opencode: 2,
      changes: Array.from({ length: 500 }, (_, n) => status(n + 1)),
    })
    expect(ok.status).toBe(200)
  })

  test("a raw event over its cap is dropped; raw events over the total cap are a 413", async () => {
    const one = await post(base, {
      guild: "raws",
      opencode: 2,
      changes: [status(1)],
      raw: [{ pad: "r".repeat(MAX_RAW + 1) }, { small: true }],
    })
    expect(one.status).toBe(200)
    const lines = readFileSync(
      join(
        home,
        "chronicles",
        "raws",
        readdirSync(join(home, "chronicles", "raws")).find((f) => f.endsWith(".raw.jsonl")) ?? "",
      ),
      "utf8",
    )
      .trim()
      .split("\n")
    expect(lines.map((line) => JSON.parse(line).raw)).toEqual([{ small: true }])
    const piece = { pad: "r".repeat(MAX_RAW - 100) }
    const total = Math.ceil(MAX_RAW_TOTAL / MAX_RAW) + 1
    const all = await post(base, {
      guild: "raws",
      opencode: 2,
      changes: [],
      raw: Array.from({ length: total }, () => piece),
    })
    expect(all.status).toBe(413)
  })

  test("a change dated at or before 0 is dropped", async () => {
    const response = await post(base, {
      guild: "zero",
      opencode: 2,
      changes: [status(0), status(-1), status(1)],
    })
    expect(await response.json()).toEqual({ ok: true, count: 1, rejected: 2 })
  })
})

/** A raw log in `home` for guild "g", last modified past RAW_KEEP_MS. */
function staleRaw(home: string): string {
  const dir = join(home, "chronicles", "g")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "old.raw.jsonl")
  writeFileSync(path, "{}\n")
  const when = (Date.now() - RAW_KEEP_MS - 60_000) / 1000
  utimesSync(path, when, when)
  return path
}

describe("hub retention", () => {
  test("a hub applies retention to its chronicles when it starts", () => {
    const shared = mkdtempSync(join(tmpdir(), "guildhall-retain-"))
    const path = staleRaw(shared)
    const local = startHub({ port: 0, home: shared })
    local.stop(true)
    expect(existsSync(path)).toBe(false)
  })

  test("a running hub applies it again once `pruneEvery` has passed", async () => {
    const shared = mkdtempSync(join(tmpdir(), "guildhall-retain-"))
    const local = startHub({ port: 0, home: shared, pruneEvery: 0 })
    const path = staleRaw(shared)
    await post(`http://127.0.0.1:${local.port}`, { guild: "other", opencode: 2, changes: [status(1)] })
    local.stop(true)
    expect(existsSync(path)).toBe(false)
  })
})

describe("hub queues", () => {
  test("a guild's queue is forgotten once its work settles, failed work included", async () => {
    const inOrder = serially()
    const order: number[] = []
    const first = inOrder("a", async () => {
      await wait(20)
      order.push(1)
    })
    const second = inOrder("a", async () => {
      order.push(2)
      throw new Error("boom")
    })
    const third = inOrder("b", async () => order.push(3))
    expect(inOrder.size()).toBe(2)
    await Promise.allSettled([first, second, third])
    await wait(0)
    expect(order).toEqual([3, 1, 2])
    expect(inOrder.size()).toBe(0)
  })
})

describe("hub hello", () => {
  test("a hall gets the most recently active guilds only, the most recent last", async () => {
    const local = startHub({ port: 0, home: mkdtempSync(join(tmpdir(), "guildhall-hello-")) })
    const to = `http://127.0.0.1:${local.port}`
    const count = HELLO_GUILDS + 2
    // Guild g0 is the most recently active: its last change is dated latest.
    for (let n = count - 1; n >= 0; n--)
      await post(to, { guild: `g${n}`, opencode: 2, changes: [status(1000 - n)] })
    const watcher = hall(local.port as number)
    await watcher.ready
    watcher.socket.close()
    local.stop(true)
    const hello = watcher.messages[0]
    const guilds = hello?.type === "hello" ? hello.events.map((e) => e.guild) : []
    expect(guilds).toEqual(Array.from({ length: HELLO_GUILDS }, (_, n) => `g${HELLO_GUILDS - 1 - n}`))
  })

  test("the hello holds HELLO_EVENTS in all, each guild a run of its newest events", () => {
    const run = (guild: string, length: number, at: number) =>
      Array.from(
        { length },
        (_, n): GuildEvent => ({
          v: WIRE_VERSION,
          guild,
          seq: n + 1,
          change: { ...status(at), type: "step" },
        }),
      )
    const half = HELLO_EVENTS / 2
    const events = new Map([
      ["old", run("old", half, 1)],
      ["mid", run("mid", half, 2)],
      ["new", run("new", half + 10, 3)],
    ])
    const hello = helloEvents(events)
    expect(hello.length).toBe(HELLO_EVENTS)
    expect(hello[0]?.guild).toBe("mid")
    expect(hello.filter((e) => e.guild === "mid").map((e) => e.seq)[0]).toBe(11)
    expect(hello.at(-1)).toMatchObject({ guild: "new", seq: half + 10 })
    expect(hello.some((e) => e.guild === "old")).toBe(false)
  })
})

describe("hub health", () => {
  test("a chronicle that can't be written is counted in /health, and the events still go out", async () => {
    const shared = mkdtempSync(join(tmpdir(), "guildhall-unwritable-"))
    writeFileSync(join(shared, "chronicles"), "not a directory")
    const local = startHub({ port: 0, home: shared })
    const to = `http://127.0.0.1:${local.port}`
    const response = await post(to, { guild: "lost", opencode: 2, changes: [status(1)] })
    const health = (await (await fetch(`${to}/health`)).json()) as Health
    local.stop(true)
    expect(await response.json()).toEqual({ ok: true, count: 1 })
    expect(health.writeFailures).toBe(1)
    expect(health.lastWriteError?.guild).toBe("lost")
  })

  test("a hub that wrote everything reports no failures", async () => {
    const health = (await (await fetch(`${base}/health`)).json()) as Health
    expect(health.writeFailures).toBe(0)
    expect(health.lastWriteError).toBeUndefined()
  })
})
