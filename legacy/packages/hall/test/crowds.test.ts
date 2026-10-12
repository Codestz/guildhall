import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { townViewsOf } from "../src/guild/town/views.ts"
import { Visits } from "../src/guild/visits.ts"
import { Walker } from "../src/scene/life/folkWalk.ts"
import { clearOccupancy, occupy } from "../src/scene/life/occupancy.ts"
import { Visiting } from "../src/scene/visit.ts"
import { activeWorld, setActiveWorld } from "../src/world/active.ts"
import { decodeChronicle } from "../src/world/chronicle/format.ts"
import { populationOf } from "../src/world/folk/plan.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { townsfolkAt } from "../src/world/town/townsfolk.ts"
import { VENUE_KINDS } from "../src/world/venues.ts"
import { repoWorld, type World } from "../src/world/world.ts"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"

/**
 * Crowds: the world reads alive, never a blob. However many folk, townsfolk and agents an island
 * has, nobody piles up at a door or in a square (venue capacity, the short line at the step, the
 * evening's few seats at the inn, spaced gatherings and rests), anywhere but inside a building.
 */

const CHRONICLES = join(import.meta.dir, "../public/chronicles")
const chronicle = (name: string) =>
  decodeChronicle(gunzipSync(readFileSync(join(CHRONICLES, `${name}.json.gz`))).toString())

const grow = (fixture: { entries: unknown[]; repo: string }): World =>
  repoWorld(islandFromTree(fixture.entries as RepoEntry[], 0, 2), {
    repo: fixture.repo,
    source: "fixture",
    gen: 2,
  })

/** The most bodies within RADIUS of any one, outdoors: more than a dozen would be a crowd. */
const RADIUS = 2
const MOST = 6

/** The most any figure has within RADIUS of it (itself counted) among `spots`. */
const densest = (spots: readonly (readonly [number, number])[]): number =>
  spots.reduce(
    (most, a) => Math.max(most, spots.filter((b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < RADIUS).length),
    0,
  )

/** A day of every folk on their feet (the room of venues counted as the scene counts it); the worst moment. */
function worstFolkMoment(world: World, from: number, to: number, wet: boolean) {
  const inside = new Map<string, Set<string>>()
  const bound = new Map<string, Set<string>>()
  const load = (venue: string, self: string): number => {
    const all = new Set([...(inside.get(venue) ?? []), ...(bound.get(venue) ?? [])])
    all.delete(self)
    return all.size
  }
  const around = {
    // Straight across: the roads only line the same walks up (and cost a day's sim most of its time).
    route: (_from: readonly [number, number], to: readonly [number, number]) => [to] as const,
    crowded: (venue: string, cap: number, self: string) => load(venue, self) >= cap,
    ground: () => 0,
  }
  const walkers = populationOf(world).folk.map((one) => new Walker(one, around as never))
  const tavern = world.venues?.find((venue) => venue.kind === "tavern")
  let hour = from
  for (const walker of walkers) walker.snap(hour, wet)
  let worst = { count: 0, hour: 0 }
  let atTavern = 0
  const DT = 4
  // The first hour is the walkers finding their feet after being placed all at once.
  for (let t = 0; hour < to; t += DT) {
    hour += DT / 3600
    inside.clear()
    bound.clear()
    for (const walker of walkers) {
      walker.update(DT, hour, wet)
      if (walker.venue) inside.set(walker.venue, (inside.get(walker.venue) ?? new Set()).add(walker.folk.id))
      if (walker.bound) bound.set(walker.bound, (bound.get(walker.bound) ?? new Set()).add(walker.folk.id))
    }
    if (t < 3600 || t % 10 !== 0) continue
    const out = walkers.filter((walker) => walker.visible && walker.level === 0)
    const count = densest(out.map((walker) => [walker.x, walker.z] as const))
    if (count > worst.count) worst = { count, hour }
    if (tavern)
      atTavern = Math.max(
        atTavern,
        out.filter((w) => Math.hypot(w.x - tavern.door.step[0], w.z - tavern.door.step[1]) < 5).length,
      )
  }
  return { ...worst, atTavern, seats: tavern?.capacity ?? 0 }
}

describe("venue capacity", () => {
  test("every kind holds a few: a tavern six, the rest three or four", () => {
    expect(VENUE_KINDS.tavern.capacity).toBe(6)
    for (const [kind, { capacity }] of Object.entries(VENUE_KINDS))
      if (kind !== "tavern") expect([3, 4]).toContain(capacity)
  })
})

describe("folk keep apart through a day", () => {
  for (const [name, fixture] of [
    ["react", REACT],
    ["opencode", COCKPIT],
  ] as const) {
    const world = grow(fixture)

    test(`${name}: from dawn to night nowhere outdoors has more than ${MOST} within ${RADIUS}`, {
      timeout: 120_000,
    }, () => {
      const worst = worstFolkMoment(world, 5, 24, false)
      expect(worst.count).toBeLessThanOrEqual(MOST)
    })

    test(`${name}: a wet evening, the inn's door has no crowd at it`, { timeout: 120_000 }, () => {
      const worst = worstFolkMoment(world, 16, 22, true)
      expect(worst.count).toBeLessThanOrEqual(MOST)
      // Its seats and the few at its step, never the town.
      expect(worst.atTavern).toBeLessThanOrEqual(worst.seats + 4)
    })
  }
})

describe("townsfolk rest spread out", () => {
  const before = activeWorld()
  afterAll(() => setActiveWorld(before))

  for (const [name, fixture, chron] of [
    ["react", REACT, "react__react"],
    ["opencode", COCKPIT, "anomalyco__opencode"],
  ] as const) {
    test(`${name}: the quiet town, however large, stands apart`, { timeout: 60_000 }, () => {
      const world = grow(fixture)
      setActiveWorld(world)
      const c = chronicle(chron)
      const views = townViewsOf(townsfolkAt(c, world, c.end), world, "world", false)
      const resting = views.filter((v) => v.phase === "resting" || v.phase === "idle")
      expect(resting.length).toBeGreaterThan(0)
      expect(densest(resting.map((v) => [v.target[0], v.target[1]] as const))).toBeLessThanOrEqual(4)
    })
  }
})

describe("townsfolk calling in respect the venue's load", () => {
  const world = grow(REACT)
  const tavern = world.venues?.find((venue) => venue.kind === "tavern")
  const visit = tavern ? new Visits(world.venues ?? []).to(tavern).visit : undefined
  /** A townsperson with a visit to make, the world frozen at t = 0; true if they set out within `seconds`. */
  const setsOut = (seconds: number): boolean => {
    if (!visit) throw new Error("no tavern")
    const visiting = new Visiting(
      "town:someone",
      () => {},
      () => 0,
    )
    for (let t = 0; t < seconds; t += 0.5) {
      visiting.update(visit, false, 0.5)
      if (visiting.phase === "go") return true
    }
    return false
  }

  test("with the house full they stay at work; with room they set out", () => {
    clearOccupancy()
    for (let n = 0; n < (visit?.capacity ?? 0); n++) occupy(visit?.venue ?? "", `other:${n}`, 0)
    expect(setsOut(120)).toBe(false)
    clearOccupancy()
    expect(setsOut(120)).toBe(true)
  })
})
