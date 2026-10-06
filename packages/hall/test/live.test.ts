import { afterAll, describe, expect, test } from "bun:test"
import type { GuildEvent } from "@guildhall/core"
import { GuildStore } from "../src/guild/store.ts"

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
})
