import { describe, expect, test } from "bun:test"
import { DWELL_MS, heroes, leadOf, placeAt, WINDOW_MS } from "../src/index.ts"
import { Feed } from "./events-fixtures.ts"

/**
 * The hysteresis rule (reduce.ts): a hero walks only when its work settles at one place, a place
 * that holds more than half its trail's weight for `DWELL_MS`. Places: core 0, world 1, sim 2, render 3.
 */

const T0 = 1_000_000
const heroAt = (feed: Feed, t: number) => heroes(feed.log.stateAt(t), t).find((h) => h.id === "h")

function started(): Feed {
  const feed = new Feed()
  feed.start("root", T0)
  feed.start("h", T0, "root", "explore")
  return feed
}

describe("where a hero stands", () => {
  test("a grep across four packages moves nobody", () => {
    const feed = started()
    feed.grep("h", "core", T0 + 1000)
    feed.grep("h", "world", T0 + 2000)
    feed.grep("h", "sim", T0 + 3000)
    feed.grep("h", "render", T0 + 4000)
    for (const t of [T0 + 4500, T0 + 10_000, T0 + 60_000]) {
      expect(heroAt(feed, t)?.place).toBeUndefined()
      expect(heroAt(feed, t)?.heading).toBeUndefined()
    }
    expect(feed.actor("h")?.pending).toBeUndefined()
  })

  test("work that settles at one place moves the hero there, DWELL_MS after it took the lead", () => {
    const feed = started()
    feed.edit("h", "world", T0 + 1000)
    feed.edit("h", "world", T0 + 2000)
    feed.edit("h", "world", T0 + 3000)
    const moved = T0 + 1000 + DWELL_MS
    expect(heroAt(feed, moved - 1)?.place).toBeUndefined()
    expect(heroAt(feed, moved - 1)?.heading).toBe(1)
    expect(heroAt(feed, moved)?.place).toBe(1)
    expect(heroAt(feed, moved)?.heading).toBeUndefined()
    // the next event commits the move in the state, at the move's own time
    feed.edit("h", "world", T0 + 20_000)
    expect(feed.actor("h")?.place).toBe(1)
    expect(feed.actor("h")?.moved).toBe(moved)
  })

  test("a grep across four packages, then edits in one: the hero goes where the edits are", () => {
    const feed = started()
    for (const [i, pkg] of (["core", "world", "sim", "render"] as const).entries())
      feed.grep("h", pkg, T0 + 1000 * i)
    // searches weigh ½ each (2 in all); the first edit (2) gives world 2.5 of 4: a lead
    feed.edit("h", "world", T0 + 4000)
    feed.edit("h", "world", T0 + 5000)
    expect(heroAt(feed, T0 + 4000 + DWELL_MS - 1)?.place).toBeUndefined()
    expect(heroAt(feed, T0 + 4000 + DWELL_MS)?.place).toBe(1)
  })

  test("a lead that changes before its dwell is over resets the dwell", () => {
    const feed = started()
    feed.edit("h", "core", T0) // core leads
    feed.edit("h", "world", T0 + 1000) // 2 vs 2: nobody leads, the move is off
    expect(feed.actor("h")?.pending).toBeUndefined()
    feed.edit("h", "world", T0 + 2000) // world 4 of 6 leads from here
    expect(heroAt(feed, T0 + DWELL_MS)?.place).toBeUndefined()
    expect(heroAt(feed, T0 + 2000 + DWELL_MS - 1)?.place).toBeUndefined()
    expect(heroAt(feed, T0 + 2000 + DWELL_MS)?.place).toBe(1)
  })

  test("one read elsewhere among a place's edits is an errand, not a move", () => {
    const feed = started()
    for (let i = 0; i < 3; i++) feed.edit("h", "world", T0 + 1000 * i)
    feed.edit("h", "world", T0 + 8000)
    expect(feed.actor("h")?.place).toBe(1)
    feed.tool("h", "read", { filePath: "/Users/me/guildhall/packages/core/src/hash.ts" }, T0 + 9000)
    feed.edit("h", "world", T0 + 10_000)
    for (const t of [T0 + 9500, T0 + 30_000]) expect(heroAt(feed, t)?.place).toBe(1)
    expect(feed.actor("h")?.pending).toBeUndefined()
  })

  test("a settled hero moves on once its new place outweighs the old over the window", () => {
    const feed = started()
    for (let i = 0; i < 3; i++) feed.edit("h", "world", T0 + 1000 * i) // world 6
    feed.edit("h", "render", T0 + 10_000) // 6 vs 2: world
    feed.edit("h", "render", T0 + 11_000) // 6 vs 4
    feed.edit("h", "render", T0 + 12_000) // 6 vs 6: nobody
    expect(feed.actor("h")?.pending).toBeUndefined()
    feed.edit("h", "render", T0 + 13_000) // 6 vs 8: render leads
    expect(heroAt(feed, T0 + 13_000 + DWELL_MS - 1)?.place).toBe(1)
    expect(heroAt(feed, T0 + 13_000 + DWELL_MS)?.place).toBe(3)
  })

  test("old marks fall out of the window", () => {
    const feed = started()
    for (let i = 0; i < 5; i++) feed.edit("h", "world", T0 + 1000 * i)
    // long after, one read in core: world's marks are gone, so core leads alone
    feed.tool(
      "h",
      "read",
      { filePath: "/Users/me/guildhall/packages/core/src/hash.ts" },
      T0 + 4000 + WINDOW_MS + 1,
    )
    expect(feed.actor("h")?.trail.map((m) => m.place)).toEqual([0])
    expect(feed.actor("h")?.pending?.place).toBe(0)
  })

  test("work that names no file leaves no mark", () => {
    const feed = started()
    feed.tool("h", "webfetch", { url: "https://example.com" }, T0 + 1000)
    feed.tool("h", "bash", { command: "ls packages" }, T0 + 2000)
    expect(feed.actor("h")?.trail).toEqual([])
    expect(heroAt(feed, T0 + 60_000)?.place).toBeUndefined()
  })

  test("a finished hero stops heading anywhere and stays where it stood", () => {
    const feed = started()
    for (let i = 0; i < 2; i++) feed.edit("h", "world", T0 + 1000 * i)
    feed.edit("h", "world", T0 + 8000) // settled at world
    feed.edit("h", "sim", T0 + 21_000)
    feed.edit("h", "sim", T0 + 21_500) // sim leads: a move is pending
    expect(feed.actor("h")?.pending?.place).toBe(2)
    feed.change({ type: "status", id: "h", status: "idle", at: T0 + 22_000 })
    expect(feed.actor("h")?.status).toBe("done")
    expect(feed.actor("h")?.pending).toBeUndefined()
    expect(placeAt(feed.actor("h") as never, T0 + 60_000)).toBe(1)
  })

  test("leadOf: more than half the weight, else nobody", () => {
    expect(leadOf([])).toBeUndefined()
    expect(leadOf([{ at: 0, place: 1, weight: 1 }])).toBe(1)
    expect(
      leadOf([
        { at: 0, place: 1, weight: 1 },
        { at: 0, place: 2, weight: 1 },
      ]),
    ).toBeUndefined()
    expect(
      leadOf([
        { at: 0, place: 1, weight: 1 },
        { at: 0, place: 2, weight: 0.5 },
        { at: 0, place: 3, weight: 0.4 },
      ]),
    ).toBe(1)
  })
})
