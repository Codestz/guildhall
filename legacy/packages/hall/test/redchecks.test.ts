import { afterAll, describe, expect, test } from "bun:test"
import { type Change, createV2Translator, type GuildEvent } from "@guildhall/core"
import { worldEventsOf } from "../src/guild/events.ts"
import { GuildStore } from "../src/guild/store.ts"

/**
 * Live, a red test suite is a *completed* shell call with `exit 1` (OpenCode never marks it failed).
 * The hall must still read it as red work: rain or storm, a dragon for a streak, failed deeds for the
 * graveyard's minions and the captions. A `grep` that finds nothing (also exit 1) must not.
 *
 * The changes come from the real v2 translator fed real-shaped raw events (the recorded `shell`
 * calls in ~/.cache/guildhall/chronicles), through a stand-in hub, down the store's live path.
 */

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

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

/** One `shell` call, as OpenCode 2 sends it, that exits `exit`. */
function shellCall(session: string, call: string, command: string, exit: number, output: string): unknown[] {
  const data = { sessionID: session, assistantMessageID: `msg_${call}` }
  return [
    { type: "session.tool.input.started", data: { ...data, id: call, name: "shell" } },
    { type: "session.tool.called", data: { ...data, id: call, input: { command }, executed: false } },
    {
      type: "session.tool.success",
      data: {
        ...data,
        id: call,
        content: [{ type: "text", text: output }],
        metadata: { status: "completed", truncated: false, exit },
        executed: false,
      },
    },
  ]
}

/** A guildmaster and one implementer who runs `command` four times in the last few seconds (live, not backlog). */
async function liveRun(command: string, output: string, rebuilt = false) {
  const now = Date.now()
  const translate = createV2Translator()
  const changes: Change[] = [
    { type: "session", id: "m", agent: "guild-master", title: "fix the tests", at: now - 20_000 },
    { type: "status", id: "m", status: "busy", at: now - 20_000 },
    { type: "session", id: "i", parentID: "m", agent: "guild-implementer", title: "fix", at: now - 19_000 },
    { type: "status", id: "i", status: "busy", at: now - 19_000 },
  ]
  for (let n = 0; n < 4; n++) {
    const at = now - 3500 + n * 800
    shellCall("i", `call_${n}`, command, 1, output).forEach((event, k) => {
      changes.push(...translate.event(event, at + k * 200))
    })
  }
  let seq = 0
  const event = (change: Change): GuildEvent => ({ v: 1, guild: "g", seq: ++seq, change })
  // Rebuilt: everything arrives in the hello, as after a reconnect — history, not news.
  const [opening, rest] = rebuilt ? [changes, []] : [changes.slice(0, 4), changes.slice(4)]
  const hub = fakeHub([
    { type: "hello", version: 1, events: opening.map(event) },
    ...(rest.length > 0 ? [{ type: "events", events: rest.map(event) }] : []),
  ])
  const store = new GuildStore()
  stores.push(store)
  store.live(hub.url)
  await wait(300)
  const events = worldEventsOf(store)
  events.tick(store.moments)
  hub.server.stop(true)
  return { store, events }
}

const stores: GuildStore[] = []
afterAll(() => {
  for (const store of stores) store.load("party")
})

const RED = "bun test v1.3.13\n\n 41 pass\n 3 fail\nRan 44 tests across 6 files. [2.00s]\n"

describe("live: a red check that exits non-zero", () => {
  test("four red `bun test` runs: failed deeds, rain or storm, and a dragon", async () => {
    const { store, events } = await liveRun("bun test", RED)
    const failed = store.moments.history.filter((m) => m.kind === "deed-failed")
    expect(failed).toHaveLength(4)
    expect(failed.every((m) => m.live && m.kind === "deed-failed" && m.exit === 1)).toBe(true)
    expect(["rain", "storm"]).toContain(store.environment.weather)
    expect(store.environment.health).toBeLessThan(0.5)
    expect(events.ledger.earned.map((r) => r.kind)).toContain("dragon")
  })

  test("a red check gets a fail marker and a chronicle line; a grep that finds nothing gets neither", async () => {
    const red = (await liveRun("bun test", RED)).store
    expect(red.markers.filter((m) => m.kind === "fail")).toHaveLength(4)
    expect(red.log.filter((l) => l.kind === "fail" && /exited 1: bun test/.test(l.text))).toHaveLength(4)
    const grep = (await liveRun("grep -rn createSession src", "")).store
    expect(grep.markers.filter((m) => m.kind === "fail")).toEqual([])
    expect(grep.log.filter((l) => l.kind === "fail")).toEqual([])
  })

  test("rebuilt from a hello, the same failed deeds, weather and dragon (not news)", async () => {
    const streamed = await liveRun("bun test", RED)
    const rebuilt = await liveRun("bun test", RED, true)
    const deeds = (store: GuildStore) =>
      store.moments.history.flatMap((m) => (m.kind === "deed-failed" ? [[m.call, m.exit]] : []))
    expect(deeds(rebuilt.store)).toEqual(deeds(streamed.store))
    expect(rebuilt.store.moments.history.some((m) => m.live)).toBe(false)
    expect(rebuilt.store.environment.weather).toBe(streamed.store.environment.weather)
    expect(rebuilt.events.ledger.earned.map((r) => r.kind)).toEqual(
      streamed.events.ledger.earned.map((r) => r.kind),
    )
  })

  test("four `grep`s that find nothing (exit 1) are plain deeds: clear sky, no dragon", async () => {
    const { store, events } = await liveRun("grep -rn createSession src", "")
    expect(store.moments.history.filter((m) => m.kind === "deed-failed")).toEqual([])
    expect(store.moments.history.filter((m) => m.kind === "deed")).toHaveLength(4)
    expect(store.environment.weather).toBe("clear")
    expect(events.ledger.earned.map((r) => r.kind)).not.toContain("dragon")
  })
})
