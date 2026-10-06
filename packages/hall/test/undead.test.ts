import { describe, expect, test } from "bun:test"
import type { Moment } from "../src/guild/moments.ts"
import { GuildStore } from "../src/guild/store.ts"
import {
  type Fallen,
  MAX_MINIONS,
  MAX_STANDING,
  MINION_MS,
  RISE_MS,
  SINK_MS,
  Undead,
  undeadOf,
} from "../src/guild/undead.ts"

/** A live moment about `id`. */
const moment = (kind: Moment["kind"], id: string, live = true): Moment =>
  ({
    kind,
    id,
    agent: "guild-implementer",
    title: id,
    color: "#fff",
    master: "m",
    seq: 1,
    at: 0,
    live,
  }) as Moment
const fallen = (...ids: string[]): Fallen[] =>
  ids.map((id) => ({ id, agent: "guild-implementer", title: id }))

/** A graveyard that has had its first (quiet) sync, as after the store's first refresh. */
function settled(): Undead {
  const undead = new Undead(() => 0.5)
  undead.sync([], 0)
  return undead
}

describe("the undead: who stands and how they came", () => {
  test("a live failure rises from a grave, then keeps vigil", () => {
    const undead = settled()
    undead.take(moment("fail", "a"))
    undead.sync(fallen("a"), 100)
    expect(undead.risers.map((r) => [r.id, r.state])).toEqual([["a", "rising"]])
    expect(undead.glancing()).toBeDefined()
    undead.sync(fallen("a"), 100 + RISE_MS)
    expect(undead.risers.map((r) => r.state)).toEqual(["vigil"])
    expect(undead.wanted).toBe(true)
  })

  test("recovering, it dies back into the grave and is gone", () => {
    const undead = settled()
    undead.take(moment("fail", "a"))
    undead.sync(fallen("a"), 0)
    undead.take(moment("recover", "a"))
    undead.sync([], 10)
    expect(undead.risers.map((r) => r.state)).toEqual(["sinking"])
    undead.sync([], 10 + SINK_MS)
    expect(undead.risers).toEqual([])
  })

  test("dismissed without a moment (no longer failed), it still sinks", () => {
    const undead = settled()
    undead.sync(fallen("a"), 0)
    undead.sync([], 50)
    expect(undead.risers.map((r) => r.state)).toEqual(["sinking"])
  })

  test("after a rebuild (a seek) the fallen simply stand: no rise, no glance, no death", () => {
    const undead = settled()
    undead.take(moment("fail", "gone"))
    undead.sync(fallen("gone"), 0)
    undead.rebuild()
    undead.take(moment("fail", "a", false))
    undead.sync(fallen("a", "b"), 10)
    expect(undead.risers.map((r) => [r.id, r.state])).toEqual([
      ["a", "vigil"],
      ["b", "vigil"],
    ])
    expect(undead.glancing()).toBeUndefined()
  })

  test("not live, not news: a rebuilt failure never rises even outside a rebuild's sync", () => {
    const undead = settled()
    undead.take(moment("fail", "a", false))
    undead.sync(fallen("a"), 10)
    expect(undead.risers.map((r) => r.state)).toEqual(["vigil"])
  })

  test(`at most ${MAX_STANDING} stand, each at their own grave; the rest are counted`, () => {
    const undead = settled()
    const ids = Array.from({ length: MAX_STANDING + 3 }, (_, i) => `s${i}`)
    for (const id of ids) undead.take(moment("fail", id))
    undead.sync(fallen(...ids), 0)
    expect(undead.risers.length).toBe(MAX_STANDING)
    expect(new Set(undead.risers.map((r) => r.grave)).size).toBe(MAX_STANDING)
    expect(undead.overflow).toBe(3)
  })

  test(`a failed deed raises a minion that crumbles; never more than ${MAX_MINIONS}`, () => {
    const undead = settled()
    for (let i = 0; i < MAX_MINIONS + 2; i++) undead.take(moment("deed-failed", "a"))
    expect(undead.minions.length).toBe(MAX_MINIONS)
    expect(new Set(undead.minions.map((m) => m.grave)).size).toBe(MAX_MINIONS)
    undead.sync([], MINION_MS)
    expect(undead.minions.every((m) => m.state === "sinking")).toBe(true)
    undead.sync([], MINION_MS + SINK_MS)
    expect(undead.minions).toEqual([])
  })

  test("a minion never takes a fallen's grave", () => {
    const undead = settled()
    undead.sync(fallen("a", "b"), 0)
    undead.take(moment("deed-failed", "a"))
    const taken = undead.risers.map((r) => r.grave)
    expect(taken).not.toContain(undead.minions[0]?.grave)
  })

  test("each role becomes its kind of skeleton; strangers are minions", () => {
    expect(undeadOf("guild-librarian")).toBe("mage")
    expect(undeadOf("guild-architect")).toBe("warrior")
    expect(undeadOf("guild-implementer")).toBe("warrior")
    expect(undeadOf("guild-verifier")).toBe("rogue")
    expect(undeadOf("general")).toBe("minion")
  })
})

describe("the undead in the store", () => {
  /** Plays the store forward in 50 ms ticks. */
  const play = (store: GuildStore, ms: number) => {
    for (let t = 0; t < ms; t += 50) store.tick(50)
  }

  test("rush: a quest gives up and a skeleton rises, written in the chronicle", () => {
    const store = new GuildStore()
    store.load("rush")
    store.seek(13_000)
    expect(store.undead.risers).toEqual([])
    play(store, 2500)
    expect(store.undead.risers.length).toBe(2)
    expect(store.undead.risers.every((r) => r.state === "rising")).toBe(true)
    expect(store.undead.minions.length).toBe(2)
    expect(store.log.filter((l) => l.text.includes("rises in the graveyard")).map((l) => l.title)).toEqual(
      store.undead.risers.map((r) => r.title),
    )
  })

  test("a seek past the failures raises no burst: they stand, no minions, no glance", () => {
    const store = new GuildStore()
    store.load("rush")
    store.seek(20_000)
    expect(store.undead.risers.map((r) => r.state)).toEqual(["vigil", "vigil"])
    expect(store.undead.minions).toEqual([])
    expect(store.undead.glancing()).toBeUndefined()
    // Already-fallen sessions are a need too: the skeletons load for them.
    expect(store.undead.wanted).toBe(true)
  })

  test("the retried quest recovers: its skeleton sinks; the other keeps vigil", () => {
    const store = new GuildStore()
    store.load("rush")
    store.seek(25_000)
    play(store, 3000)
    expect(store.undead.risers.map((r) => r.state).sort()).toEqual(["sinking", "vigil"])
    play(store, SINK_MS + 200)
    expect(store.undead.risers.length).toBe(1)
  })

  test("party has no session failure: the undead are never wanted, never loaded", () => {
    const store = new GuildStore()
    store.load("party")
    store.seek(store.duration)
    expect(store.undead.wanted).toBe(false)
  })
})
