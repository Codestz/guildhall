import { afterAll, describe, expect, test } from "bun:test"
import type { CiState, SeaEvent, SeaRecord } from "@guildhall/core"
import { seas } from "@guildhall/sim"
import { sampleFor } from "../src/audio/samples.ts"
import { legendOf } from "../src/guild/legends.ts"
import { HARBOUR, type Moment, seaHappening } from "../src/guild/moments.ts"
import { GuildStore } from "../src/guild/store.ts"
import { beatOf, lineOf } from "../src/guild/story.ts"

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
const ci = (id: string, state: CiState, branch = "main"): SeaEvent => ({
  kind: "ci",
  id,
  at: 0,
  repo: "acme/shop",
  state,
  name: "CI",
  branch,
  sha: "s",
})
const merged: SeaEvent = {
  kind: "pr_merged",
  id: "m",
  at: 0,
  repo: "acme/shop",
  number: 128,
  title: "Dark mode for the settings page",
  author: "mira",
  branch: "dark-mode",
}
const release: SeaEvent = {
  kind: "release",
  id: "r",
  at: 0,
  repo: "acme/shop",
  tag: "v1.4.0",
  name: "Dark mode",
}
const record = (event: SeaEvent, guild = "shop"): SeaRecord => ({ v: 1, guild, event })
const session = (seq: number, at: number) => ({
  v: 1,
  guild: "shop",
  seq,
  change: { type: "session", id: "ses_1", title: "t", at },
})
/** A sea moment as the store makes it. */
const seaMoment = (event: SeaEvent, at = 1000): Moment => {
  const happening = seaHappening(event, new Map())
  if (!happening) throw new Error(`no moment for ${event.kind}`)
  return { ...HARBOUR, master: "root", ...happening, at, live: true, seq: 1 }
}

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

/** Plays the store's story to its end in 50 ms ticks, without wrapping round. */
function playThrough(store: GuildStore): void {
  while (store.time < store.duration) store.tick(Math.min(50, store.duration - store.time))
}

const seaKinds = (moments: readonly Moment[]) =>
  moments.filter((m) => m.kind.startsWith("sea-")).map((m) => m.kind)

describe("sea moments", () => {
  test("a push, a merge and a release each make one", () => {
    expect(seaHappening(push("p", 0), new Map())?.kind).toBe("sea-push")
    expect(seaHappening(merged, new Map())?.kind).toBe("sea-merged")
    expect(seaHappening(release, new Map())?.kind).toBe("sea-release")
  })

  test("CI: red when a run fails, green only when it passes after a failure on the same branch", () => {
    const finished = new Map<string, CiState>()
    expect(seaHappening(ci("1", "queued"), finished)).toBeUndefined()
    expect(seaHappening(ci("2", "passed"), finished)).toBeUndefined()
    expect(seaHappening(ci("3", "failed"), finished)?.kind).toBe("sea-red")
    expect(seaHappening(ci("4", "running"), finished)).toBeUndefined()
    // Another branch's pass is no recovery for this one.
    expect(seaHappening(ci("5", "passed", "other"), finished)).toBeUndefined()
    expect(seaHappening(ci("6", "passed"), finished)?.kind).toBe("sea-green")
    expect(seaHappening(ci("7", "passed"), finished)).toBeUndefined()
  })
})

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

  test("played through, the sea's news is told live, in order, once", () => {
    const store = new GuildStore()
    store.load("seas")
    const live: Moment[] = []
    store.moments.on((m) => live.push(m))
    playThrough(store)
    const kinds = seaKinds(live)
    expect(kinds.filter((k) => k !== "sea-push")).toEqual([
      "sea-red",
      "sea-green",
      "sea-merged",
      "sea-release",
    ])
    expect(kinds.filter((k) => k === "sea-push")).toHaveLength(3)
    expect(live.filter((m) => m.kind.startsWith("sea-")).every((m) => m.id === HARBOUR.id)).toBe(true)
  })

  test("a seek rebuilds the same sea moments as history, never as news", () => {
    const played = new GuildStore()
    played.load("seas")
    playThrough(played)
    const store = new GuildStore()
    store.load("seas")
    const live: Moment[] = []
    store.moments.on((m) => live.push(m))
    store.seek(store.duration)
    expect(seaKinds(store.moments.history)).toEqual(seaKinds(played.moments.history))
    expect(seaKinds(live)).toEqual([])
    // Seeking again rebuilds them once, not twice.
    store.seek(store.duration)
    expect(seaKinds(store.moments.history)).toEqual(seaKinds(played.moments.history))
  })
})

describe("the sea, live", () => {
  const stores: GuildStore[] = []
  afterAll(() => {
    for (const store of stores) store.load("party")
  })

  test("a hello's sea keeps GitHub's time; each event is taken once, by id", async () => {
    const hub = fakeHub([
      { type: "hello", version: 1, events: [session(1, 1000)], sea: [record(push("a", 1500))] },
      // A reconnect's hello repeats what was already sent.
      { type: "hello", version: 1, events: [session(1, 1000)], sea: [record(push("a", 1500))] },
    ])
    const store = new GuildStore()
    stores.push(store)
    store.live(hub.url)
    await wait(300)
    expect(store.sea.map((s) => s.event.id)).toEqual(["a"])
    expect(store.sea.map((s) => s.at)).toEqual([500])
    hub.server.stop(true)
  })

  test("a sea message is dated as it arrives, so its voyage plays now however late the poll was", async () => {
    // GitHub says the push was ten minutes ago; the hall hears of it now.
    const late = Date.now() - 10 * 60_000
    const hub = fakeHub([
      { type: "hello", version: 1, events: [session(1, Date.now() - 1000)] },
      { type: "sea", events: [record(push("p", late)), record(merged)] },
    ])
    const store = new GuildStore()
    stores.push(store)
    const live: Moment[] = []
    store.moments.on((m) => live.push(m))
    store.live(hub.url)
    await wait(300)
    const sighted = store.sea.find((s) => s.event.id === "p")
    expect(sighted).toBeDefined()
    expect(Math.abs((sighted?.at ?? 0) - store.time)).toBeLessThan(1000)
    // Arriving together, they keep GitHub's order (the merge is dated earlier here).
    expect(seaKinds(live)).toEqual(["sea-merged", "sea-push"])
    hub.server.stop(true)
  })

  test("a hello's sea is told as history, not news", async () => {
    const hub = fakeHub([{ type: "hello", version: 1, events: [session(1, 1000)], sea: [record(release)] }])
    const store = new GuildStore()
    stores.push(store)
    const live: Moment[] = []
    store.moments.on((m) => live.push(m))
    store.live(hub.url)
    await wait(300)
    expect(seaKinds(store.moments.history)).toEqual(["sea-release"])
    expect(seaKinds(live)).toEqual([])
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

describe("the sea in words and sound", () => {
  const lookup = { session: () => undefined }
  const text = (m: Moment) =>
    lineOf("sea", [m], lookup)
      .map((p) => p.text)
      .join("")

  test("captions: a merge, red and green CI and a release; a push sails quietly", () => {
    expect(beatOf(seaMoment(push("p", 0)))).toBeUndefined()
    expect(beatOf(seaMoment(merged))).toBe("sea")
    expect(text(seaMoment(merged))).toContain("#128")
    expect(text(seaMoment(merged))).toMatch(/harbour|quay/)
    expect(text(seaMoment(ci("c", "failed")))).toMatch(/red/)
    const green = seaHappening(ci("g", "passed"), new Map([["acme/shop:main", "failed" as CiState]]))
    expect(green?.kind).toBe("sea-green")
    expect(text({ ...seaMoment(merged), ...(green as NonNullable<typeof green>) })).toMatch(/warm/)
    expect(text(seaMoment(release))).toContain("v1.4.0")
  })

  test("a burst tells the biggest news", () => {
    const line = lineOf("sea", [seaMoment(merged), seaMoment(release)], lookup)
    expect(line.map((p) => p.text).join("")).toContain("v1.4.0")
  })

  test("Legends: the sea's news in the guildmaster's chapter, not among the party's troubles", () => {
    const store = new GuildStore()
    store.load("seas")
    store.seek(store.duration)
    const legend = legendOf(store.moments.history, store.party())
    const master = legend?.chapters.find((c) => !c.sentBy)
    const notes = master?.notables.filter((n) => n.sea).map((n) => n.text) ?? []
    expect(notes).toHaveLength(4)
    expect(notes.some((n) => n.includes("#128"))).toBe(true)
    expect(notes.some((n) => n.includes("v1.4.0"))).toBe(true)
    expect(legend?.closing).not.toMatch(/rose again/)
    // The harbour is not one of the party.
    expect(legend?.party).toBe(new Set(store.party().map((s) => s.id)).size)
  })

  test("sounds: a horn for a merge or a release, a toll for red CI, nothing for a push", () => {
    expect(sampleFor("sea-merged", undefined, {})).toBe("horn")
    expect(sampleFor("sea-release", undefined, {})).toBe("horn")
    expect(sampleFor("sea-red", undefined, {})).toBe("toll")
    expect(sampleFor("sea-push", undefined, {})).toBeNull()
  })
})
