import { describe, expect, test } from "bun:test"
import type { SeaEvent } from "@guildhall/core"
import {
  emptyWorld,
  flush,
  GONE_MS,
  harbourOf,
  heroes,
  normalize,
  normalizer,
  pathsOf,
  pleas,
  recent,
  reduce,
  type WorldEvent,
  weatherOf,
} from "../src/index.ts"
import { Feed, fileIn } from "./events-fixtures.ts"

const T0 = 2_000_000
const kinds = (evs: readonly WorldEvent[]) => evs.map((e) => e.kind)

describe("normalize: the guild", () => {
  test("a session's first sight is a join; a root is the Guildmaster, a subagent joins its party", () => {
    const feed = new Feed()
    const root = feed.change({ type: "session", id: "r", agent: "build", at: T0 })
    expect(kinds(root)).toEqual(["actor.join"])
    expect(root[0]).toMatchObject({ id: "r", name: "Guildmaster", archetype: "guildmaster", body: "knight" })
    expect(root[0]).not.toHaveProperty("parent")
    const sub = feed.change({ type: "session", id: "s", agent: "explore", parentID: "r", at: T0 + 10 })
    expect(sub[0]).toMatchObject({ kind: "actor.join", id: "s", parent: "r" })
    expect(sub[0]?.src).toBe("g#2")
  })

  test("a parent learned later is an info, not a second join", () => {
    const feed = new Feed()
    feed.change({ type: "prompt", id: "s", key: "k", text: "map the repo", at: T0 })
    const later = feed.change({ type: "session", id: "s", agent: "explore", parentID: "r", at: T0 + 5 })
    expect(kinds(later)).toEqual(["actor.info"])
    expect(later[0]).toMatchObject({ parent: "r", task: "map the repo" })
    expect(feed.actor("s")?.parent).toBe("r")
  })

  test("streamed thoughts and repeats make nothing", () => {
    const feed = new Feed()
    feed.start("r", T0)
    expect(feed.change({ type: "thinking", id: "r", key: "t", delta: "hm", at: T0 + 1 })).toEqual([])
    expect(feed.change({ type: "thinking", id: "r", key: "t", delta: "m", at: T0 + 2 })).toEqual([])
    const ctx = normalizer()
    const change = { type: "status", id: "x", status: "busy", at: T0 } as const
    expect(normalize({ v: 1, guild: "g", seq: 5, change }, ctx).length).toBeGreaterThan(0)
    expect(normalize({ v: 1, guild: "g", seq: 5, change }, ctx)).toEqual([])
    expect(normalize({ v: 1, guild: "g", seq: 4, change }, ctx)).toEqual([])
  })

  test("a call is a step when it starts and a deed when it ends, with its paths and places", () => {
    const feed = new Feed()
    feed.start("r", T0)
    const evs = feed.tool("r", "edit", { filePath: fileIn("world", "life.ts"), newString: "a\nb" }, T0 + 100)
    expect(kinds(evs)).toEqual(["actor.step", "actor.deed"])
    expect(evs[0]).toMatchObject({ craft: "edit", target: "src/life.ts", places: [1] })
    expect(evs[1]).toMatchObject({ failed: false, stepped: true, size: 2, places: [1] })
    // a re-sent completion is not a second deed
    const again = feed.change({
      type: "tool",
      id: "r",
      call: "c1",
      name: "edit",
      state: "completed",
      at: T0 + 400,
    })
    expect(again).toEqual([])
  })

  test("a call heard only when it ended is a deed that was not stepped", () => {
    const feed = new Feed()
    feed.start("r", T0)
    const evs = feed.change({
      type: "tool",
      id: "r",
      call: "x",
      name: "read",
      state: "completed",
      input: { filePath: fileIn("sim") },
      at: T0 + 1,
    })
    expect(evs.find((e) => e.kind === "actor.deed")).toMatchObject({ stepped: false, places: [2] })
    expect(feed.actor("r")?.trail.map((m) => m.place)).toEqual([2])
  })

  test("a red check is a failed deed; a grep finding nothing is not", () => {
    const feed = new Feed()
    feed.start("r", T0)
    const red = feed.tool("r", "bash", { command: "bun test" }, T0 + 1, { exit: 1 })
    expect(red.find((e) => e.kind === "actor.deed")).toMatchObject({ craft: "test", failed: true, exit: 1 })
    const none = feed.tool("r", "bash", { command: "grep x y" }, T0 + 2000, { exit: 1 })
    expect(none.find((e) => e.kind === "actor.deed")).toMatchObject({ failed: false })
    expect(feed.actor("r")).toMatchObject({ deeds: 2, failures: 1 })
  })

  test("a quest, a plea and its answer", () => {
    const feed = new Feed()
    feed.start("r", T0)
    const quest = feed.change({
      type: "tool",
      id: "r",
      call: "q",
      name: "task",
      state: "running",
      input: { description: "Map the repo" },
      at: T0 + 1,
    })
    expect(quest.find((e) => e.kind === "actor.quest")).toMatchObject({ text: "Map the repo" })
    expect(kinds(feed.change({ type: "status", id: "r", status: "waiting", at: T0 + 5 }))).toEqual([
      "actor.plea",
    ])
    expect(pleas(feed.log.head)).toEqual([
      { id: "r", name: "Guildmaster", color: expect.any(String), since: T0 + 5 },
    ])
    expect(kinds(feed.change({ type: "status", id: "r", status: "busy", at: T0 + 9 }))).toEqual([
      "actor.answered",
    ])
    expect(pleas(feed.log.head)).toEqual([])
    expect(feed.actor("r")?.status).toBe("working")
  })

  test("a finished subagent leaves GONE_MS later; the guildmaster stays; a resume brings one back", () => {
    const feed = new Feed()
    feed.start("r", T0)
    feed.start("s", T0, "r", "explore")
    feed.edit("s", "core", T0 + 100)
    expect(kinds(feed.change({ type: "status", id: "s", status: "idle", at: T0 + 1000 }))).toEqual([
      "actor.loot",
    ])
    feed.edit("r", "core", T0 + 2000)
    feed.change({ type: "status", id: "r", status: "idle", at: T0 + 3000 })
    // the clock alone
    expect(flush(feed.ctx, T0 + 1000 + GONE_MS - 1)).toEqual([])
    const left = flush(feed.ctx, T0 + 1000 + GONE_MS)
    expect(left).toMatchObject([{ kind: "actor.leave", id: "s", at: T0 + 1000 + GONE_MS, src: "clock" }])
    feed.log.append(...left)
    expect(heroes(feed.log.head).map((h) => h.id)).toEqual(["r"])
    expect(heroes(feed.log.head, undefined, { gone: true }).map((h) => h.id)).toEqual(["r", "s"])
    // the guildmaster is done but stays; a new prompt resumes it
    expect(flush(feed.ctx, T0 + 10 * GONE_MS)).toEqual([])
    const resumed = feed.change({ type: "status", id: "r", status: "busy", at: T0 + 200_000 })
    expect(kinds(resumed)).toEqual(["actor.resume"])
    expect(feed.actor("r")?.status).toBe("working")
  })

  test("a leave falls due before the next input that is later than it", () => {
    const feed = new Feed()
    feed.start("r", T0)
    feed.start("s", T0, "r")
    feed.edit("s", "core", T0 + 1)
    feed.change({ type: "status", id: "s", status: "idle", at: T0 + 1000 })
    const next = feed.change({ type: "step", id: "r", at: T0 + 1000 + GONE_MS + 5 })
    expect(kinds(next)).toEqual(["actor.leave"])
    expect(next[0]?.at).toBe(T0 + 1000 + GONE_MS)
  })

  test("a subagent working again before it left does not leave", () => {
    const feed = new Feed()
    feed.start("r", T0)
    feed.start("s", T0, "r")
    feed.edit("s", "core", T0 + 1)
    feed.change({ type: "status", id: "s", status: "idle", at: T0 + 1000 })
    feed.change({ type: "status", id: "s", status: "busy", at: T0 + 2000 })
    expect(flush(feed.ctx, T0 + 100 * GONE_MS)).toEqual([])
  })

  test("events never go back in time", () => {
    const feed = new Feed()
    feed.start("r", T0)
    const back = feed.change({ type: "session", id: "late", agent: "explore", parentID: "r", at: T0 - 5000 })
    expect(back[0]?.at).toBe(T0)
  })

  test("a rank is earned by deeds", () => {
    const feed = new Feed()
    feed.start("r", T0)
    const ranks: WorldEvent[] = []
    for (let i = 0; i < 21; i++)
      ranks.push(
        ...feed
          .tool("r", "read", { filePath: fileIn("sim") }, T0 + 1000 * i)
          .filter((e) => e.kind === "actor.rank"),
      )
    expect(ranks).toMatchObject([{ rank: "journeyman" }])
    expect(heroes(feed.log.head)[0]?.rank).toBe("journeyman")
  })

  test("pathsOf reads every host's spelling, once each", () => {
    expect(pathsOf({ filePath: "/a", path: "/a", file_path: "/b" })).toEqual(["/a", "/b"])
    expect(pathsOf({ notebook_path: "/n.ipynb" })).toEqual(["/n.ipynb"])
    expect(pathsOf({ pattern: "x" })).toEqual([])
  })
})

describe("normalize: the sea", () => {
  const base = { repo: "o/r", at: T0 }
  const pr = (kind: "pr_opened" | "pr_merged" | "pr_closed", n: number, at: number): SeaEvent =>
    ({
      ...base,
      kind,
      id: `${kind}-${n}`,
      number: n,
      title: `PR ${n}`,
      author: "me",
      branch: `b${n}`,
      at,
    }) as SeaEvent
  const ci = (state: "running" | "failed" | "passed", at: number): SeaEvent => ({
    ...base,
    kind: "ci",
    id: `ci-${state}-${at}`,
    state,
    name: "check",
    branch: "main",
    sha: "abc",
    at,
  })

  test("pull requests open and merge; CI is the weather; repeats are dropped", () => {
    const feed = new Feed()
    expect(kinds(feed.sea(pr("pr_opened", 1, T0)))).toEqual(["sea.pr"])
    expect(feed.sea(pr("pr_opened", 1, T0))).toEqual([])
    feed.sea(pr("pr_opened", 2, T0 + 1))
    expect(harbourOf(feed.log.head).prs.map((p) => p.n)).toEqual([1, 2])
    feed.sea(ci("running", T0 + 2))
    expect(weatherOf(feed.log.head)).toBe("cloudy")
    const red = feed.sea(ci("failed", T0 + 3))
    expect(red[0]).toMatchObject({ kind: "sea.ci", moment: "sea-red" })
    expect(weatherOf(feed.log.head)).toBe("storm")
    const green = feed.sea(ci("passed", T0 + 4))
    expect(green[0]).toMatchObject({ moment: "sea-green" })
    expect(weatherOf(feed.log.head)).toBe("clear")
    feed.sea(pr("pr_merged", 1, T0 + 5))
    feed.sea(pr("pr_closed", 2, T0 + 6))
    const harbour = harbourOf(feed.log.head)
    expect(harbour.prs).toEqual([])
    expect(harbour.merged).toBe(1)
    // captions get the merge, the red and the green, not the running run
    expect(kinds(recent(feed.log.head, 10)).filter((k) => k === "sea.ci")).toHaveLength(2)
  })

  test("a push and a release; an issue makes no event", () => {
    const feed = new Feed()
    feed.sea({ ...base, kind: "push", id: "p1", branch: "main", commits: 3, author: "me", sha: "s" })
    feed.sea({ ...base, kind: "release", id: "r1", tag: "v1.0.0", at: T0 + 1 })
    expect(
      feed.sea({ ...base, kind: "issue_opened", id: "i1", number: 3, title: "bug", author: "x" }),
    ).toEqual([])
    const harbour = harbourOf(feed.log.head)
    expect(harbour.pushes).toBe(1)
    expect(harbour.release).toMatchObject({ tag: "v1.0.0" })
  })
})

describe("reduce", () => {
  test("never changes the world it is given", () => {
    const feed = new Feed()
    feed.start("r", T0)
    feed.start("s", T0, "r")
    feed.edit("s", "world", T0 + 10)
    let world = emptyWorld()
    for (const ev of feed.made) {
      const before = structuredClone(world)
      const next = reduce(world, ev)
      expect(world).toEqual(before)
      world = next
    }
    expect(world).toEqual(feed.log.head)
  })

  test("an event about someone never seen changes nobody", () => {
    const world = reduce(emptyWorld(), { at: 1, seq: 1, src: "t", kind: "actor.loot", id: "ghost" })
    expect(world.actors.size).toBe(0)
    expect(world.count).toBe(1)
  })
})
