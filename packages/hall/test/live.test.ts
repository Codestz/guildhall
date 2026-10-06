import { afterAll, describe, expect, test } from "bun:test"
import type { Change, GuildEvent } from "@guildhall/core"
import { GuildStore, liveUrlOf } from "../src/guild/store.ts"

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
const session = (seq: number, title: string): GuildEvent => ({
  v: 1,
  guild: "g",
  seq,
  change: { type: "session", id: "ses_1", title, at: 1000 + seq },
})

/** A stand-in hub: sends `script` to each hall as it connects; counts the halls connected now. */
function fakeHub(script: unknown[]) {
  let open = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, srv) => (srv.upgrade(request, { data: undefined }) ? undefined : new Response("no")),
    websocket: {
      open(ws) {
        open++
        for (const message of script) ws.send(JSON.stringify(message))
      },
      close() {
        open--
      },
      message() {},
    },
  })
  return { server, url: `ws://127.0.0.1:${server.port}/ws`, open: () => open }
}

describe("live mode", () => {
  const stores: GuildStore[] = []
  afterAll(() => {
    for (const store of stores) store.load("party")
  })

  test("calling live() again closes the socket it had", async () => {
    const hub = fakeHub([{ type: "hello", version: 1, events: [] }])
    const store = new GuildStore()
    stores.push(store)
    store.live(hub.url)
    await wait(150)
    store.live(hub.url)
    await wait(300)
    expect(hub.open()).toBe(1)
    store.load("party")
    await wait(100)
    expect(hub.open()).toBe(0)
    hub.server.stop(true)
  })

  test("events at or below the last seq seen for their guild are ignored", async () => {
    const hub = fakeHub([
      { type: "hello", version: 1, events: [session(1, "first")] },
      { type: "events", events: [session(1, "duplicate")] },
    ])
    const store = new GuildStore()
    stores.push(store)
    store.live(hub.url)
    await wait(300)
    expect(store.sessionOf("ses_1")?.title).toBe("first")
    store.load("party")
    hub.server.stop(true)
  })

  test("a newer seq still applies, and a fresh hello starts the count over", async () => {
    const hub = fakeHub([
      { type: "hello", version: 1, events: [session(5, "first")] },
      { type: "events", events: [session(6, "second")] },
      { type: "hello", version: 1, events: [] },
      { type: "events", events: [session(1, "after restart")] },
    ])
    const store = new GuildStore()
    stores.push(store)
    store.live(hub.url)
    await wait(300)
    expect(store.sessionOf("ses_1")?.title).toBe("after restart")
    store.load("party")
    hub.server.stop(true)
  })

  test("weather, yard and traces follow the followed party, not every guild's backlog", async () => {
    const now = Date.now()
    let seq = 0
    const event = (guild: string, change: Change): GuildEvent => ({ v: 1, guild, seq: ++seq, change })
    // Guild "old": an implementer that built the yard, then a session that failed a moment ago.
    const old: Change[] = [
      { type: "session", id: "a", agent: "guild-master", title: "old", at: now - 60_000 },
      { type: "session", id: "a1", parentID: "a", agent: "guild-implementer", title: "x", at: now - 59_000 },
      ...[1, 2, 3].map(
        (n): Change => ({
          type: "tool",
          id: "a1",
          call: `e${n}`,
          name: "edit",
          state: "completed",
          at: now - 58_000 + n,
        }),
      ),
      { type: "session", id: "a2", parentID: "a", agent: "guild-explorer", title: "y", at: now - 50_000 },
      { type: "tool", id: "a2", call: "g", name: "grep", state: "completed", at: now - 49_000 },
      { type: "status", id: "a2", status: "failed", error: "boom", at: now - 5000 },
    ]
    // Guild "new": a quiet, healthy party heard from just now — the one the hall follows.
    const fresh: Change[] = [
      { type: "session", id: "b", agent: "guild-master", title: "new", at: now - 2000 },
      { type: "status", id: "b", status: "busy", at: now - 1000 },
    ]
    const hub = fakeHub([
      {
        type: "hello",
        version: 1,
        events: [...old.map((c) => event("old", c)), ...fresh.map((c) => event("new", c))],
      },
    ])
    const store = new GuildStore()
    stores.push(store)
    store.live(hub.url)
    await wait(300)
    expect(store.views.map((v) => v.id)).toEqual(["b"])
    expect(store.environment.weather).not.toBe("storm")
    expect(store.environment.health).toBe(1)
    expect(store.progress).toBe(0)
    expect(store.traces.logs).toBe(0)
    store.load("party")
    hub.server.stop(true)
  })

  test("a reconnect's hello replaces the markers and the log instead of adding to them", async () => {
    const plea: GuildEvent = {
      v: 1,
      guild: "g",
      seq: 2,
      change: { type: "status", id: "ses_1", status: "waiting", at: Date.now() },
    }
    // Every hall gets the same hello, then the hub drops it: the store reconnects (new socket).
    let hellos = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, srv) => (srv.upgrade(request, { data: undefined }) ? undefined : new Response("no")),
      websocket: {
        open(ws) {
          hellos++
          ws.send(JSON.stringify({ type: "hello", version: 1, events: [session(1, "first"), plea] }))
          if (hellos < 3) setTimeout(() => ws.close(), 50)
        },
        message() {},
      },
    })
    const store = new GuildStore()
    stores.push(store)
    store.live(`ws://127.0.0.1:${server.port}/ws`)
    await wait(200)
    const markers = store.markers.length
    const log = store.log.length
    expect(markers).toBe(1)
    const until = performance.now() + 6000
    while (hellos < 3 && performance.now() < until) await wait(50)
    await wait(200)
    expect(hellos).toBe(3)
    expect(store.markers).toHaveLength(markers)
    expect(store.log).toHaveLength(log)
    store.load("party")
    server.stop(true)
  }, 10_000)

  test("junk from the socket is ignored; good events around it still apply", async () => {
    const hub = fakeHub([
      { type: "hello", version: 1, events: [session(1, "first")] },
      "not json at all",
      { type: "events" },
      { type: "events", events: [null, { guild: "g", seq: 2 }, { v: 1, guild: "g", seq: 3, change: "x" }] },
      { type: "events", events: [session(4, "fourth")] },
    ])
    const store = new GuildStore()
    stores.push(store)
    store.live(hub.url)
    await wait(300)
    expect(store.connected).toBe(true)
    expect(store.sessionOf("ses_1")?.title).toBe("fourth")
    store.load("party")
    hub.server.stop(true)
  })
})

describe("?live", () => {
  const DEFAULT = "ws://127.0.0.1:4747/ws"
  test("absent: not live", () => {
    expect(liveUrlOf("")).toBeNull()
    expect(liveUrlOf("?scenario=rush")).toBeNull()
  })

  test("bare: the default hub", () => {
    expect(liveUrlOf("?live")).toBe(DEFAULT)
    expect(liveUrlOf("?live=")).toBe(DEFAULT)
  })

  test("a hub on this machine, any port", () => {
    expect(liveUrlOf("?live=ws://localhost:5000/ws")).toBe("ws://localhost:5000/ws")
    expect(liveUrlOf("?live=ws://127.0.0.1:4800/ws")).toBe("ws://127.0.0.1:4800/ws")
  })

  test("anywhere else falls back to the default hub, unless &anyhub=1", () => {
    for (const url of ["ws://evil.example/ws", "wss://127.0.0.1/ws", "http://localhost:4747/ws", "nonsense"])
      expect(liveUrlOf(`?live=${encodeURIComponent(url)}`)).toBe(DEFAULT)
    expect(liveUrlOf(`?live=${encodeURIComponent("ws://localhost.evil.example/ws")}`)).toBe(DEFAULT)
    expect(liveUrlOf("?live=ws://box.lan:4747/ws&anyhub=1")).toBe("ws://box.lan:4747/ws")
  })
})
