import { describe, expect, test } from "bun:test"
import { key, neighbours, rings, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { keepOf } from "../src/world/gen/plan/lakes.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { cellToWorld } from "../src/world/lands.ts"
import { repoWorld } from "../src/world/world.ts"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"
import IS_ODD from "./fixtures/repos/jonschlinkert__is-odd.json"

/** Terrain 2c: valley lakes, their ground reserved in the plan (plan/lakes.ts) before roads and lots. */

const worldOf = (entries: unknown, seed = 0, gen: 1 | 2 = 2) => {
  const made = islandFromTree(entries as RepoEntry[], seed, gen)
  return { made, world: repoWorld(made, { repo: "x/y", source: "fixture", gen }) }
}
const CITY = worldOf(REACT.entries)
const TOWN = worldOf(COCKPIT.entries)
const VILLAGE = worldOf(SELF.entries)
const lakesOf = (w: typeof CITY) => w.world.water?.lakes ?? []

describe("lakes in the plan", () => {
  test("a tier reserves its basins: city 1-2, town 1, village 0-1; a hamlet and generator 1 none", () => {
    expect(CITY.made.plan.lakes.length).toBeGreaterThanOrEqual(1)
    expect(CITY.made.plan.lakes.length).toBeLessThanOrEqual(2)
    expect(TOWN.made.plan.lakes.length).toBe(1)
    expect(VILLAGE.made.plan.lakes.length).toBeLessThanOrEqual(1)
    expect(worldOf(IS_ODD.entries).made.plan.lakes).toEqual([])
    expect(worldOf(REACT.entries, 0, 1).made.plan.lakes).toEqual([])
  })

  test("a basin is 6-14 hexes, with open land round it and two hexes of land at least between it and the sea", () => {
    for (const w of [CITY, TOWN, VILLAGE])
      for (const lake of w.made.plan.lakes) {
        expect(lake.cells.length).toBeGreaterThanOrEqual(6)
        expect(lake.cells.length).toBeLessThanOrEqual(14)
        for (const id of lake.cells) {
          // Every hex within two rings of a lake hex is land.
          const near = [unkey(id), ...neighbours(unkey(id))]
          const ring2 = near.flatMap((c) => neighbours(c))
          for (const c of [...near, ...ring2]) expect(w.made.plan.land.has(key(c))).toBe(true)
        }
      }
  })

  test("lots, fields, squares and sites keep off a lake's ground, and roads off its basin and shore", () => {
    for (const w of [CITY, TOWN, VILLAGE]) {
      const roads = new Set(w.made.plan.roads.flat().map(key))
      const squares = new Set(w.made.plan.districts.map((d) => key(d.square)))
      const sites = new Set(w.made.plan.districts.flatMap((d) => (d.site ? [key(d.site)] : [])))
      for (const id of keepOf(w.made.plan.lakes)) {
        // (A road may cross a stream's corridor: the rivers bridge it where it runs straight.)
        expect("KVvswd".includes(w.made.plan.land.get(id)?.char ?? "~")).toBe(false)
        expect(squares.has(id) || sites.has(id)).toBe(false)
        expect(w.made.plan.land.get(id)?.level).toBeUndefined()
      }
      for (const lake of w.made.plan.lakes)
        for (const id of [...lake.cells, ...lake.shore]) expect(roads.has(id)).toBe(false)
    }
  })

  test("the same seed reserves the same lakes", () => {
    expect(worldOf(REACT.entries).made.plan.lakes).toEqual(CITY.made.plan.lakes)
  })
})

describe("valley lakes", () => {
  test("the reserved basins hold water: a city has 1-2 lakes, a town 1, a village at most 1", () => {
    expect(lakesOf(CITY).length).toBeGreaterThanOrEqual(1)
    expect(lakesOf(CITY).length).toBeLessThanOrEqual(2)
    expect(lakesOf(TOWN).length).toBe(1)
    expect(lakesOf(VILLAGE).length).toBeLessThanOrEqual(1)
    expect(worldOf(IS_ODD.entries).world.water).toBeUndefined()
    expect(worldOf(REACT.entries, 0, 1).world.water).toBeUndefined()
  })

  test("a lake lies on its basin, at level 0, and drains by exactly one outlet to the sea", () => {
    for (const w of [CITY, TOWN, VILLAGE])
      for (const lake of lakesOf(w)) {
        const planned = w.made.plan.lakes.find((p) => p.cells.includes(key(lake.cells[0] as never)))
        expect(planned?.cells.slice().sort()).toEqual(lake.cells.map(key).sort())
        expect(lake.level).toBe(0)
        const { cell, dir } = lake.outlet
        const out = neighbours(cell)[dir] as [number, number]
        expect(lake.cells.map(key)).toContain(key(cell))
        expect(lake.cells.map(key)).not.toContain(key(out))
        const reaches = w.world.water?.rivers ?? []
        // The river leaves by the outlet, and none leaves a lake hex by any other edge.
        expect(
          reaches.filter((r) => r.prev && lake.cells.some((c) => key(c) === key(r.prev as never))),
        ).toHaveLength(1)
        // Following the stream out ends at the sea (the open sea past a level-0 river's last hex).
        const last = reaches.filter((r) => r.level === 0).at(-1)
        expect(last).toBeDefined()
      }
  })

  test("a stream comes down into the lake: some river hex beside it is fed by the range's slope", () => {
    for (const w of [CITY, TOWN])
      for (const lake of lakesOf(w)) {
        const beside = (c: [number, number]) =>
          lake.cells.some((l) => neighbours(l).some((n) => key(n) === key(c)))
        const entering = (w.world.water?.rivers ?? []).filter((r) => r.hexes.some((h) => beside(h.cell)))
        expect(entering.length).toBeGreaterThanOrEqual(2)
      }
  })

  test("the shore is lakeshore tiles on the lake's level; the lake is water", () => {
    for (const w of [CITY, TOWN, VILLAGE])
      for (const lake of lakesOf(w)) {
        expect(lake.shore.length).toBeGreaterThan(0)
        for (const cell of lake.shore) {
          const [x, z] = cellToWorld(cell)
          expect(
            w.world.island.tiles.some((t) => t.piece.startsWith("hex_coast_") && t.x === x && t.z === z),
          ).toBe(true)
        }
        for (const cell of lake.cells) {
          const [x, z] = cellToWorld(cell)
          expect(w.world.island.tiles.some((t) => t.piece === "hex_water" && t.x === x && t.z === z)).toBe(
            true,
          )
          expect(w.world.terrain.at(cell)).toBe("r")
        }
      }
  })

  test("lakes lie inland (two hexes from the nearest coast hex, so the sea is three away) and clear of one another and of every venue", () => {
    for (const w of [CITY, TOWN, VILLAGE]) {
      const lakes = lakesOf(w)
      for (const lake of lakes)
        for (const cell of lake.cells)
          for (const c of w.made.plan.land.keys())
            if (neighbours(unkey(c)).some((n) => !w.made.plan.land.has(key(n))))
              expect(rings([cell[0] - unkey(c)[0], cell[1] - unkey(c)[1]])).toBeGreaterThanOrEqual(2)
      for (const venue of w.world.venues ?? []) {
        const [vx, vz] = venue.at
        for (const lake of lakes)
          for (const cell of lake.cells) {
            const [x, z] = cellToWorld(cell)
            expect(Math.hypot(x - vx, z - vz)).toBeGreaterThan(5)
          }
      }
    }
  })

  test("the same seed makes the same lakes", () => {
    expect(lakesOf(worldOf(REACT.entries))).toEqual(lakesOf(CITY))
  })
})
