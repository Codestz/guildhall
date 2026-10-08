import { afterAll, describe, expect, test } from "bun:test"
import type { SeaEvent, SeaRecord } from "@guildhall/core"
import { seas } from "@guildhall/sim"
import { GuildStore } from "../src/guild/store.ts"

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

const push = (id: string, at: number): SeaEvent => ({
  kind: "push",
  id,
  at,
  repo: "acme/shop",
  branch: "main",
  commits: 2,
  author: "mira",
  sha: id,
})
const record = (event: SeaEvent, guild = "shop"): SeaRecord => ({ v: 1, guild, event })
const session = (seq: number, at: number) => ({
  v: 1,
  guild: "shop",
  seq,
  change: { type: "session", id: "ses_1", title: "t", at },
})

/** A stand-in hub: sends `script` to each hall as it connects. */
function fakeHub(script: unknown[]) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, srv) => (srv.upgrade(request, { data: undefined }) ? undefined : new Response("no")),
    websocket: {
      open(ws) {
        for (const message of script) ws.send(JSON.stringify(message))
      },
      message() {},
    },
  })
  return { server, url: `ws://127.0.0.1:${server.port}/ws` }
}

describe("the seas story", () => {
  test("loads its sea beside its changes, timed from the story's start", () => {
    const store = new GuildStore()
    store.load("seas")
    const tale = seas()
    const start = tale.changes[0]?.at ?? 0
    expect(store.sea.map((s) => s.event.id)).toEqual(tale.sea.map((e) => e.id))
    expect(store.sea.map((s) => s.at)).toEqual(tale.sea.map((e) => e.at - start))
    expect(store.sea.every((s) => s.at >= 0 && s.at <= store.duration)).toBe(true)
  })

  test("other stories have no sea", () => {
    const store = new GuildStore()
    store.load("seas")
    store.load("party")
    expect(store.sea).toEqual([])
  })
})

describe("the sea, live", () => {
  const stores: GuildStore[] = []
  afterAll(() => {
    for (const store of stores) store.load("party")
  })

  test("a hello's sea and sea messages are taken once each, by event id", async () => {
    const hub = fakeHub([
      { type: "hello", version: 1, events: [session(1, 1000)], sea: [record(push("a", 1500))] },
      { type: "sea", events: [record(push("a", 1500)), record(push("b", 2500))] },
      // A reconnect's hello repeats what was already sent.
      { type: "hello", version: 1, events: [session(1, 1000)], sea: [record(push("b", 2500))] },
    ])
    const store = new GuildStore()
    stores.push(store)
    store.live(hub.url)
    await wait(300)
    expect(store.sea.map((s) => s.event.id)).toEqual(["a", "b"])
    expect(store.sea.map((s) => s.at)).toEqual([500, 1500])
    hub.server.stop(true)
  })

  test("records not shaped like a SeaRecord are left out", async () => {
    const hub = fakeHub([
      { type: "hello", version: 1, events: [], sea: "nope" },
      {
        type: "sea",
        events: [{ v: 1, guild: "shop", event: { kind: "tsunami", id: "x", at: 1, repo: "r" } }],
      },
      { type: "sea", events: [{ v: 1, guild: "shop" }, record(push("ok", Date.now()))] },
    ])
    const store = new GuildStore()
    stores.push(store)
    store.live(hub.url)
    await wait(300)
    expect(store.sea.map((s) => s.event.id)).toEqual(["ok"])
    hub.server.stop(true)
  })
})
