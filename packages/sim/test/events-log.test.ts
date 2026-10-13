import { describe, expect, test } from "bun:test"
import type { Change, SeaEvent } from "@guildhall/core"
import {
  CHECKPOINT_EVERY,
  EventLog,
  emptyWorld,
  type GuildWorld,
  reduce,
  type WorldEvent,
} from "../src/index.ts"
import { Feed, fileIn, PACKAGES } from "./events-fixtures.ts"

/** A seeded generator (mulberry32): the same seed, the same stream. */
function random(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T
  return { next, int, pick }
}

const TOOLS = ["read", "edit", "write", "grep", "glob", "bash", "webfetch", "task"] as const
const STATES = ["running", "completed", "failed"] as const
const STATUSES = ["busy", "idle", "waiting", "failed"] as const

/** A random guild: a root and its subagents doing random things to random packages, and a sea. */
function randomFeed(seed: number, n: number, every?: number): Feed {
  const r = random(seed)
  const feed = new Feed(every)
  const ids = ["root"]
  let t = 1_000_000
  let calls = 0
  for (let i = 0; i < n; i++) {
    t += r.pick([0, 0, 50, 400, 2000, 7000, 30_000])
    const roll = r.next()
    if (roll < 0.04 || ids.length === 1) {
      const id = `s${ids.length}`
      ids.push(id)
      feed.change({
        type: "session",
        id,
        agent: r.pick(["explore", "general", "guild-implementer"]),
        parentID: "root",
        at: t,
      })
      continue
    }
    const id = r.pick(ids)
    if (roll < 0.12) {
      feed.change({ type: "status", id, status: r.pick(STATUSES), at: t } as Change)
    } else if (roll < 0.16) {
      feed.change({ type: "usage", id, tokens: r.int(3_000_000), at: t })
    } else if (roll < 0.2) {
      feed.change({ type: "thinking", id, key: `k${i}`, delta: "…", at: t })
    } else if (roll < 0.25) {
      const kinds = ["pr_opened", "pr_merged", "ci", "push"] as const
      const kind = r.pick(kinds)
      const n = 1 + r.int(4)
      const base = { id: `e${i}`, repo: "o/r", at: t }
      const event: SeaEvent =
        kind === "ci"
          ? {
              ...base,
              kind,
              state: r.pick(["queued", "running", "passed", "failed"] as const),
              name: "ci",
              branch: "main",
              sha: "s",
            }
          : kind === "push"
            ? { ...base, kind, branch: "main", commits: 1, author: "me", sha: "s" }
            : { ...base, kind, number: n, title: `#${n}`, author: "me", branch: `b${n}` }
      feed.sea(event)
    } else {
      // a call: a new one, or a later word on a recent one
      const call = r.next() < 0.6 || calls === 0 ? `c${++calls}` : `c${Math.max(1, calls - r.int(3))}`
      const name = r.pick(TOOLS)
      const input =
        name === "bash"
          ? { command: r.pick(["bun test", "ls", "bun run typecheck"]) }
          : name === "task"
            ? { description: "a quest" }
            : { filePath: fileIn(r.pick(PACKAGES)) }
      feed.change({
        type: "tool",
        id,
        call,
        name,
        state: r.pick(STATES),
        input,
        ...(name === "bash" && r.next() < 0.3 ? { exit: 1 } : {}),
        at: t,
      })
    }
  }
  return feed
}

const foldTo = (events: readonly WorldEvent[], t: number): GuildWorld =>
  events.filter((e) => e.at <= t).reduce(reduce, emptyWorld())

describe("EventLog", () => {
  test("stateAt(t) is the fold from the start, for random streams and random t", () => {
    for (const [seed, every] of [
      [1, 16],
      [2, 7],
      [3, CHECKPOINT_EVERY],
      [4, 1],
    ] as const) {
      const feed = randomFeed(seed, 1200, every)
      const { events } = feed.log
      expect(events.length).toBeGreaterThan(500)
      // the streams exercise the hysteresis rule, leaves and the sea, not just joins
      const seen = new Set(events.map((e) => e.kind))
      for (const kind of ["actor.step", "actor.deed", "actor.loot", "actor.leave", "sea.pr", "sea.ci"])
        expect(seen.has(kind as WorldEvent["kind"])).toBe(true)
      expect([...feed.log.head.actors.values()].some((a) => a.place !== undefined)).toBe(true)
      const r = random(seed * 31)
      const first = (events[0] as WorldEvent).at
      const last = (events[events.length - 1] as WorldEvent).at
      const ts = [first - 1, first, last, last + 1]
      for (let i = 0; i < 40; i++) ts.push(first + r.next() * (last - first))
      // and right on events' own times (ties included)
      for (let i = 0; i < 20; i++) ts.push((events[r.int(events.length)] as WorldEvent).at)
      for (const t of ts) {
        expect(feed.log.stateAt(t)).toEqual(foldTo(events, t))
        expect(feed.log.foldsAt(t)).toBeLessThan(every)
      }
    }
  })

  test("a seek folds at most CHECKPOINT_EVERY − 1 events", () => {
    const feed = randomFeed(9, 3000)
    expect(feed.log.length).toBeGreaterThan(CHECKPOINT_EVERY * 4)
    let worst = 0
    for (const ev of feed.log.events) worst = Math.max(worst, feed.log.foldsAt(ev.at))
    expect(worst).toBeLessThan(CHECKPOINT_EVERY)
    expect(worst).toBeGreaterThan(CHECKPOINT_EVERY / 2)
  })

  test("the head is the fold of everything; before the first event the world is empty", () => {
    const feed = randomFeed(5, 400)
    expect(feed.log.head).toEqual(foldTo(feed.log.events, Number.POSITIVE_INFINITY))
    expect(feed.log.stateAt(0)).toEqual(emptyWorld())
  })

  test("an event out of order is refused", () => {
    const log = new EventLog()
    log.append({ at: 10, seq: 1, src: "t", kind: "actor.plea", id: "x" })
    expect(() => log.append({ at: 9, seq: 2, src: "t", kind: "actor.plea", id: "x" })).toThrow(RangeError)
    expect(() => log.append({ at: 10, seq: 1, src: "t", kind: "actor.plea", id: "x" })).toThrow(RangeError)
    expect(log.length).toBe(1)
  })
})
