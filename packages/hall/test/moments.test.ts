import { afterAll, describe, expect, test } from "bun:test"
import { apply, type Change, emptyModel, type GuildEvent, type Model } from "@guildhall/core"
import { party, toEvents } from "@guildhall/sim"
import { before, happenings, type Moment, sizeOf } from "../src/guild/moments.ts"
import { GuildStore } from "../src/guild/store.ts"

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** Applies `change` to `model` and returns the moments it made, as the store derives them. */
function step(model: Model, change: Change): ReturnType<typeof happenings> {
  const was = before(model, change)
  apply(model, change)
  return happenings(model, change, was)
}

/** Plays the store's scenario to its end in 50 ms ticks, without wrapping round. */
function playThrough(store: GuildStore): void {
  while (store.time < store.duration) store.tick(Math.min(50, store.duration - store.time))
}

/** What a moment says, minus when and its place in the stream: comparable across clocks. */
const gist = (m: Moment) => {
  const { seq: _seq, at: _at, live: _live, ...rest } = m
  return rest
}

describe("moments: derivation", () => {
  test("a join, a quest, a deed and loot, each once, in the order they happened", () => {
    const model = emptyModel()
    const kinds = [
      { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 },
      {
        type: "tool",
        id: "m",
        call: "c1",
        name: "task",
        state: "running",
        input: { description: "Map it" },
        at: 1,
      },
      { type: "session", id: "k", parentID: "m", agent: "guild-explorer", title: "x", at: 2 },
      { type: "status", id: "k", status: "busy", at: 2 },
      { type: "tool", id: "k", call: "c2", name: "grep", state: "running", at: 3 },
      { type: "tool", id: "k", call: "c2", state: "completed", at: 4 },
      { type: "status", id: "k", status: "idle", at: 5 },
    ].flatMap((change) => step(model, change as Change).map((m) => [m.kind, m.id]))
    expect(kinds).toEqual([
      ["quest", "m"],
      ["join", "k"],
      ["deed", "k"],
      ["loot", "k"],
    ])
  })

  test("repeats make no second moment: a re-sent running call, a second session change, idle twice", () => {
    const model = emptyModel()
    step(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
    const running: Change = { type: "tool", id: "m", call: "c", name: "task", state: "running", at: 1 }
    expect(step(model, running).map((m) => m.kind)).toEqual(["quest"])
    expect(step(model, { ...running, output: "more", at: 2 })).toEqual([])
    const join: Change = { type: "session", id: "k", parentID: "m", agent: "guild-verifier", at: 3 }
    expect(step(model, join).map((m) => m.kind)).toEqual(["join"])
    expect(step(model, { ...join, title: "renamed", at: 4 })).toEqual([])
    step(model, { type: "status", id: "k", status: "busy", at: 5 })
    step(model, { type: "tool", id: "k", call: "d", name: "bash", state: "running", at: 6 })
    expect(step(model, { type: "status", id: "k", status: "idle", at: 7 }).map((m) => m.kind)).toEqual([
      "loot",
    ])
    expect(step(model, { type: "status", id: "k", status: "idle", at: 8 })).toEqual([])
  })

  test("pleas, failures and recoveries come from status moves, answer before outcome", () => {
    const model = emptyModel()
    step(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
    step(model, { type: "session", id: "k", parentID: "m", agent: "guild-implementer", at: 1 })
    step(model, { type: "status", id: "k", status: "busy", at: 1 })
    const kinds = (change: Change) => step(model, change).map((m) => m.kind)
    expect(kinds({ type: "status", id: "k", status: "waiting", at: 2 })).toEqual(["plea"])
    expect(kinds({ type: "status", id: "k", status: "failed", error: "denied", at: 3 })).toEqual([
      "plea-answered",
      "fail",
    ])
    expect(kinds({ type: "status", id: "k", status: "busy", at: 4 })).toEqual(["recover"])
  })

  test("a failure that settles what the session launched makes their fail moments too, after its own", () => {
    const model = emptyModel()
    step(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
    step(model, { type: "session", id: "a", parentID: "m", agent: "guild-architect", at: 1 })
    step(model, { type: "status", id: "a", status: "busy", at: 1 })
    step(model, { type: "session", id: "b", parentID: "a", agent: "guild-explorer", at: 2 })
    step(model, { type: "status", id: "b", status: "busy", at: 2 })
    const out = step(model, { type: "status", id: "a", status: "failed", error: "boom", at: 3 })
    expect(out).toEqual([
      { kind: "fail", id: "a", error: "boom" },
      { kind: "fail", id: "b", error: expect.stringContaining("cancelled") },
    ])
  })

  test("a failed deed carries its tool and error; a completed write its size in lines", () => {
    const model = emptyModel()
    step(model, { type: "session", id: "m", agent: "guild-master", title: "t", at: 0 })
    step(model, {
      type: "tool",
      id: "m",
      call: "w",
      name: "write",
      state: "running",
      input: { content: "a\nb\nc" },
      at: 1,
    })
    expect(step(model, { type: "tool", id: "m", call: "w", state: "completed", at: 2 })).toEqual([
      { kind: "deed", id: "m", tool: "write", call: "w", size: 3 },
    ])
    step(model, { type: "tool", id: "m", call: "b", name: "bash", state: "running", at: 3 })
    expect(
      step(model, { type: "tool", id: "m", call: "b", state: "failed", error: "exit 1", at: 4 }),
    ).toEqual([{ kind: "deed-failed", id: "m", tool: "bash", call: "b", error: "exit 1" }])
    expect(sizeOf("edit", { newString: "x\ny" })).toBe(2)
    expect(sizeOf("read", { filePath: "a.ts" })).toBeUndefined()
  })
})

describe("moments: the store's stream", () => {
  const stores: GuildStore[] = []
  afterAll(() => {
    for (const store of stores) store.load("party")
  })

  test("in order: seq always grows, and change moments never go back in time", () => {
    const store = new GuildStore()
    const seen: Moment[] = []
    store.moments.on((m) => seen.push(m))
    playThrough(store)
    expect(seen.length).toBeGreaterThan(20)
    expect(seen.every((m) => m.live)).toBe(true)
    for (let i = 1; i < seen.length; i++) expect(seen[i]?.seq).toBe((seen[i - 1]?.seq ?? 0) + 1)
    const timed = seen.filter((m) => m.kind !== "leave").map((m) => m.at)
    expect(timed).toEqual([...timed].sort((a, b) => a - b))
    // The story's shape: the first quest goes out before the first subagent joins, who joins before any loot.
    const first = (kind: Moment["kind"]) => seen.findIndex((m) => m.kind === kind)
    expect(first("quest")).toBeLessThan(first("join"))
    expect(first("join")).toBeLessThan(first("loot"))
    // Actors are named as the log names them, with their party.
    const join = seen.find((m) => m.kind === "join")
    expect(join?.parent).toBe(join?.master)
    expect(
      store.log.some((line) => line.kind === "join" && line.id === join?.id && line.title === join?.title),
    ).toBe(true)
  })

  test("a seek makes no live moments: it rebuilds history, marked not live, and says so once", () => {
    const store = new GuildStore()
    const heard: Moment[] = []
    let rebuilds = 0
    store.moments.on((m) => heard.push(m))
    store.moments.onRebuild(() => rebuilds++)
    const middle = store.duration / 2
    store.seek(middle)
    expect(heard).toEqual([])
    expect(rebuilds).toBe(1)
    expect(store.moments.history.length).toBeGreaterThan(5)
    expect(store.moments.history.every((m) => !m.live && m.at <= middle)).toBe(true)
    // Playing on from there: only what happens after the seek is news.
    for (let i = 0; i < 100; i++) store.tick(50)
    expect(heard.length).toBeGreaterThan(0)
    expect(heard.every((m) => m.live && m.at > middle)).toBe(true)
    // Seeking back again throws the rebuilt history away; seq still only grows.
    const last = store.moments.history.at(-1)?.seq ?? 0
    store.seek(0)
    expect(rebuilds).toBe(2)
    while (store.moments.history.length === 0) store.tick(50)
    expect(store.moments.history[0]?.seq).toBeGreaterThan(last)
  })

  test("a seek and a play-through tell the same story", () => {
    const played = new GuildStore()
    stores.push(played)
    playThrough(played)
    const rebuilt = new GuildStore()
    stores.push(rebuilt)
    rebuilt.seek(rebuilt.duration)
    const story = (store: GuildStore) => store.moments.history.filter((m) => m.kind !== "leave").map(gist)
    expect(story(rebuilt)).toEqual(story(played))
  })

  test("a subagent that finished leaves once, GONE_MS after it ended", () => {
    const store = new GuildStore()
    const heard: Moment[] = []
    store.moments.on((m) => heard.push(m))
    playThrough(store)
    const leaves = heard.filter((m) => m.kind === "leave")
    expect(leaves.length).toBeGreaterThan(0)
    expect(new Set(leaves.map((m) => m.id)).size).toBe(leaves.length)
    for (const leave of leaves) {
      const loot = heard.findLast((m) => m.kind === "loot" && m.id === leave.id && m.seq < leave.seq)
      expect(loot).toBeDefined()
      expect(leave.at - (loot?.at ?? 0)).toBe(27_000)
    }
  })

  test("live and sim agree: the same scenario through a hub makes the same moments", async () => {
    const events: GuildEvent[] = toEvents(party(), "demo")
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, srv) => (srv.upgrade(request, { data: undefined }) ? undefined : new Response("no")),
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ type: "hello", version: 1, events: [] }))
          ws.send(JSON.stringify({ type: "events", events }))
        },
        message() {},
      },
    })
    const live = new GuildStore()
    stores.push(live)
    const heard: Moment[] = []
    live.moments.on((m) => heard.push(m))
    live.live(`ws://127.0.0.1:${server.port}/ws`)
    const until = performance.now() + 3000
    while (heard.length === 0 && performance.now() < until) await wait(20)
    await wait(50)
    server.stop(true)

    const sim = new GuildStore()
    stores.push(sim)
    playThrough(sim)
    const story = (moments: readonly Moment[]) => moments.filter((m) => m.kind !== "leave").map(gist)
    expect(heard.every((m) => m.live)).toBe(true)
    expect(story(heard)).toEqual(story(sim.moments.history))
  })

  test("a live hello's backlog is history, not news", async () => {
    const events: GuildEvent[] = toEvents(party(), "demo")
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, srv) => (srv.upgrade(request, { data: undefined }) ? undefined : new Response("no")),
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ type: "hello", version: 1, events }))
        },
        message() {},
      },
    })
    const store = new GuildStore()
    stores.push(store)
    const heard: Moment[] = []
    store.moments.on((m) => heard.push(m))
    store.live(`ws://127.0.0.1:${server.port}/ws`)
    const until = performance.now() + 3000
    while (store.moments.history.length === 0 && performance.now() < until) await wait(20)
    server.stop(true)
    expect(store.moments.history.length).toBeGreaterThan(20)
    expect(heard).toEqual([])
  })
})
