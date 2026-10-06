import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { HubMessage } from "../src/index.ts"
import { HERALD_HEADER, startHub } from "../src/index.ts"

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
