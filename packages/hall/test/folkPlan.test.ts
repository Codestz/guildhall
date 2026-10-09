import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Walker } from "../src/scene/life/folkWalk.ts"
import { blocker, islandObstacles, onDryLand } from "../src/world/clearance.ts"
import { anchorsOf } from "../src/world/folk/anchors.ts"
import { censusOf, folkShown } from "../src/world/folk/census.ts"
import { type Stride, wander } from "../src/world/folk/critters.ts"
import { slotAt } from "../src/world/folk/day.ts"
import { FOLK_MOST, hasFolk, islandTier, populationOf, shown } from "../src/world/folk/plan.ts"
import { WALL_TOP } from "../src/world/folk/stops.ts"
import { ROLES, type Role } from "../src/world/folk/types.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { handWorld, repoWorld, type World } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"
import IS_ODD from "./fixtures/repos/jonschlinkert__is-odd.json"
import { glbJson } from "./support/glb.ts"

/**
 * The folk and animals of a gen 2 island (world/folk): who there is, where they live and stand,
 * how many each quality tier shows, and that a day lived on their feet never leaves a place that
 * is not theirs.
 */

const grow = (fixture: { entries: unknown[]; repo: string }, gen: 1 | 2): World =>
  repoWorld(islandFromTree(fixture.entries as RepoEntry[], 0, gen), {
    repo: fixture.repo,
    source: "fixture",
    ...(gen === 2 ? { gen } : {}),
  })
const react = grow(REACT, 2)
const guild = grow(SELF, 2)
const hamlet = grow(IS_ODD, 2)

const ANIMS = glbJson(join(import.meta.dir, "../public/assets/anims.glb"))
const CLIPS = new Set((ANIMS.animations ?? []).map((clip) => clip.name))

const rolesOf = (world: World): Set<Role> => new Set(populationOf(world).folk.map((one) => one.role))

describe("who lives there", () => {
  test("only a gen 2 island with a town has folk: not the hand lands, not the first generator", () => {
    expect(hasFolk(handWorld())).toBe(false)
    expect(populationOf(handWorld()).folk).toEqual([])
    const first = grow(SELF, 1)
    expect(hasFolk(first)).toBe(false)
    expect(populationOf(first).critters).toEqual([])
  })

  test("a bigger island holds more, within its tier's most", () => {
    const counts = [hamlet, guild, react].map((world) => populationOf(world).folk.length)
    expect(counts[0]).toBeLessThan(counts[1] as number)
    expect(counts[1]).toBeLessThan(counts[2] as number)
    for (const world of [hamlet, guild, react])
      expect(populationOf(world).folk.length).toBeLessThanOrEqual(FOLK_MOST[islandTier(world)])
  })

  test("the same repo is always the same town", () => {
    const again = populationOf(grow(SELF, 2))
    expect(JSON.stringify(again)).toBe(JSON.stringify(populationOf(guild)))
  })

  test("a city has every trade; a trade the island has no place for is not on it", () => {
    expect(rolesOf(react)).toEqual(new Set(ROLES))
    // The guild's island has no mine: no miners, though it has a quay and fields.
    expect(rolesOf(guild).has("miner")).toBe(false)
    expect(rolesOf(guild).has("fisher")).toBe(true)
    // A hamlet has neither fields nor a market.
    expect(rolesOf(hamlet).has("farmer")).toBe(false)
    expect(rolesOf(hamlet).has("trader")).toBe(false)
  })

  test("each lives in a house of their own, with a window", () => {
    for (const world of [guild, react]) {
      const homes = new Map((world.homes ?? []).map((home) => [home.id, home]))
      const lived = populationOf(world).folk.map((one) => one.home)
      expect(new Set(lived).size).toBe(lived.length)
      for (const id of lived) expect(homes.get(id as string)?.window.y).toBeGreaterThan(0)
    }
  })

  test("the first few of any number are a mix of trades, not all one", () => {
    const first = new Set(
      populationOf(react)
        .folk.slice(0, 8)
        .map((one) => one.role),
    )
    expect(first.size).toBeGreaterThanOrEqual(5)
  })
})

describe("how many each quality shows", () => {
  test("Low shows the fewest and Ultra all, folk and animals both", () => {
    for (const world of [guild, react]) {
      const counts = ([0, 1, 2, 3] as const).map((q) => censusOf(world, q))
      for (let q = 1; q < 4; q++) {
        expect(counts[q]?.folk).toBeGreaterThanOrEqual(counts[q - 1]?.folk as number)
        expect(counts[q]?.animals).toBeGreaterThanOrEqual(counts[q - 1]?.animals as number)
      }
      expect(counts[3]?.folk).toBe(populationOf(world).folk.length)
      expect(counts[0]?.folk).toBeLessThan(counts[3]?.folk as number)
    }
  })

  test("the census counts what the scene would show", () => {
    const census = censusOf(react, 2)
    const folk = folkShown(populationOf(react).folk, 2)
    expect(census.folk).toBe(folk.length)
    expect(census.folk).toBe(shown(populationOf(react).folk.length, 2))
    expect(Object.values(census.roles).reduce((a, b) => a + b, 0)).toBe(census.folk)
  })

  test("a folk's day never has a slot without a stop to go to, and every clip is one the rig has", () => {
    for (const one of populationOf(react).folk) {
      for (const stops of Object.values(one.stops)) {
        expect(stops.length).toBeGreaterThan(0)
        for (const stop of stops) expect(CLIPS.has(stop.clip)).toBe(true)
      }
    }
  })
})

describe("where they stand", () => {
  test("on open ground clear of props, a body apart: the villagers' work, the square and the inn", () => {
    for (const world of [guild, react]) {
      const obstacles = islandObstacles(world)
      const seen: [number, number][] = []
      for (const one of populationOf(world).folk) {
        if (one.role !== "villager") continue
        for (const slot of ["work", "plaza", "inn"] as const)
          for (const stop of one.stops[slot]) {
            const at = stop.at
            // A door's step stands against its building.
            if (stop.door || seen.some((s) => s[0] === at[0] && s[1] === at[1])) continue
            expect(onDryLand(at, world)).toBe(true)
            expect(blocker(at, obstacles, 0.5)?.name).toBeUndefined()
            for (const other of seen)
              expect(Math.hypot(other[0] - at[0], other[1] - at[1])).toBeGreaterThan(0.9)
            seen.push([at[0], at[1]])
          }
      }
    }
  })

  test("fishers on the quay, seaward; farmers inside their plot", () => {
    const anchors = anchorsOf(react)
    const dock = anchors.dock as [number, number]
    for (const one of populationOf(react).folk) {
      if (one.role === "fisher")
        for (const stop of one.stops.work) {
          expect(Math.abs(stop.at[0] - dock[0])).toBeLessThan(1.2)
          expect(stop.at[1]).toBeGreaterThan(dock[1] - 12)
          expect(stop.at[1]).toBeLessThan(dock[1])
          expect(stop.face).toBe(0)
        }
      if (one.role === "farmer")
        for (const stop of one.stops.work)
          expect(anchors.fields.some((f) => Math.hypot(f[0] - stop.at[0], f[1] - stop.at[1]) < 4)).toBe(true)
    }
  })

  test("the watch of a walled island walks the wall's top, with a stair to it", () => {
    const anchors = anchorsOf(react)
    expect(anchors.runs.length).toBeGreaterThan(0)
    const watch = populationOf(react).folk.filter((one) => one.role === "guard")
    expect(watch.some((one) => one.night)).toBe(true)
    for (const one of watch) {
      expect(one.lift?.up).toBe(WALL_TOP)
      for (const stop of one.stops.work) expect(stop.up).toBe(WALL_TOP)
      const on = (spot: readonly [number, number]): boolean =>
        anchors.runs.some((run) => {
          const along = [run.to[0] - run.from[0], run.to[1] - run.from[1]]
          const length = Math.hypot(along[0] as number, along[1] as number)
          const t =
            ((spot[0] - run.from[0]) * (along[0] as number) +
              (spot[1] - run.from[1]) * (along[1] as number)) /
            length ** 2
          const off = Math.hypot(
            run.from[0] + (along[0] as number) * t - spot[0],
            run.from[1] + (along[1] as number) * t - spot[1],
          )
          return t > -0.01 && t < 1.01 && off < 0.1
        })
      for (const stop of one.stops.work) expect(on(stop.at)).toBe(true)
    }
  })

  test("an island with no wall posts its guards at the keep's gate, on the ground", () => {
    expect(anchorsOf(guild).runs).toEqual([])
    for (const one of populationOf(guild).folk.filter((p) => p.role === "guard")) {
      expect(one.lift).toBeUndefined()
      for (const stop of one.stops.work) expect(stop.up).toBeUndefined()
    }
  })
})

describe("a day on their feet", () => {
  test("every folk of a city lives a day without leaving the island's ground or hiding for good", () => {
    const around = {
      route: (_from: readonly [number, number], to: readonly [number, number]) => [to] as const,
      crowded: () => false,
      ground: () => 0,
    }
    const reach = Math.max(...react.island.tiles.map((t) => Math.hypot(t.x, t.z))) + 10
    for (const one of populationOf(react).folk) {
      const walker = new Walker(one, around)
      walker.snap(5)
      let hiddenFor = 0
      for (let t = 0; t < 24 * 15 * 2; t += 0.2) {
        const hour = (5 + t / 15) % 24
        walker.update(0.2, hour)
        expect(Number.isFinite(walker.x + walker.z)).toBe(true)
        expect(Math.hypot(walker.x, walker.z)).toBeLessThan(reach)
        hiddenFor = walker.visible ? 0 : hiddenFor + 0.2
        // Indoors no longer than the night and the day's other visits: the hours of home, at most.
        if (slotAt(one, hour) !== "home") expect(hiddenFor).toBeLessThan(15 * 6)
      }
    }
  })
})

describe("the animals", () => {
  const critters = populationOf(react).critters

  test("a few of each kind a field, a door, a square and a meadow call for", () => {
    const kinds = new Set(critters.map((c) => c.species))
    expect(kinds.has("cow") || kinds.has("pig")).toBe(true)
    expect(kinds.has("dog")).toBe(true)
    expect(kinds.has("chick") || kinds.has("cat") || kinds.has("bunny")).toBe(true)
  })

  test("they wander only the patch they are given, and chicks roost", () => {
    const out: Stride = { x: 0, z: 0, yaw: 0, pace: 0 }
    for (const critter of critters) {
      for (let t = 0; t < 600; t += 7) {
        wander(critter, t, out)
        expect(Math.hypot(out.x - critter.at[0], out.z - critter.at[1])).toBeLessThanOrEqual(
          critter.radius + 1e-6,
        )
        expect(out.pace).toBeGreaterThanOrEqual(0)
        expect(out.pace).toBeLessThanOrEqual(1)
      }
      expect(critter.roosts).toBe(critter.species === "chick")
    }
  })

  test("a patch of a dog, cat, chick or rabbit is open ground", () => {
    for (const critter of critters) {
      if (critter.species === "cow" || critter.species === "pig") continue
      expect(onDryLand(critter.at, react)).toBe(true)
    }
  })
})
