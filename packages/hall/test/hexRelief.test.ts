import { describe, expect, test } from "bun:test"
import { cellAt, key, neighbours, rings, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { COLUMN_STEP, topOf } from "../src/world/gen/relief/columns.ts"
import { hexMountains } from "../src/world/gen/relief/hexMountains.ts"
import { reliefOf } from "../src/world/gen/relief/index.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { cellToWorld } from "../src/world/lands.ts"
import { repoWorld } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** The hex-native mountains (`?relief=e`, world/gen/relief/hexRelief.ts) on a City. */

const CITY = islandFromTree(REACT.entries as RepoEntry[], 0, 2)
const level = (cell: readonly [number, number]): number => CITY.levels.get(key(cell)) ?? 0
const relief = () => reliefOf({ plan: CITY.plan, level, style: "e" })
const RELIEF = relief()
const HEX = RELIEF.hex
if (!HEX) throw new Error("style e has no hex relief")
const WORLD = repoWorld(CITY, { repo: REACT.repo, source: "fixture", gen: 2, relief: "e" })

describe("the columns", () => {
  test("every massif hex stands a whole number of tiles high, at least one", () => {
    expect(new Set(HEX.columns.keys())).toEqual(new Set(RELIEF.keys))
    for (const top of HEX.columns.values()) {
      expect(top % COLUMN_STEP).toBe(0)
      expect(top).toBeGreaterThanOrEqual(COLUMN_STEP)
    }
  })

  test("heights come from the field: a hex is as high as its field, never lower, and higher only for a crown's shoulder", () => {
    const crowned = new Set(HEX.crowns.flatMap(({ id }) => [id, ...neighbours(unkey(id)).map(key)]))
    for (const massif of RELIEF.massifs)
      for (const cell of massif.cells) {
        const [x, z] = cellToWorld(cell)
        const asked = topOf(massif.grid.heightAt(x, z) ?? 0, massif.height)
        const top = HEX.columns.get(key(cell)) as number
        expect(top).toBeGreaterThanOrEqual(asked)
        if (!crowned.has(key(cell))) expect(top).toBe(asked)
      }
  })

  test("the range varies: ridges, saddles and a summit, not one plateau", () => {
    const tops = new Set(HEX.columns.values())
    expect(tops.size).toBeGreaterThanOrEqual(5)
    for (const massif of RELIEF.massifs) {
      const own = massif.cells.map((cell) => HEX.columns.get(key(cell)) as number)
      expect(Math.max(...own) - Math.min(...own)).toBeGreaterThanOrEqual(3 * COLUMN_STEP)
    }
  })
})

describe("the crowns", () => {
  test("stand on every massif's main peak, or on a column no neighbour tops", () => {
    expect(HEX.crowns.length).toBeGreaterThan(0)
    const peaks = new Set(RELIEF.massifs.flatMap((m) => m.peaks.map((p) => key(p.cell))))
    for (const { id } of HEX.crowns) {
      const top = HEX.columns.get(id) as number
      const topped = neighbours(unkey(id)).some((n) => (HEX.columns.get(key(n)) ?? 0) > top)
      expect(peaks.has(id) || !topped).toBe(true)
    }
    for (const massif of RELIEF.massifs) {
      const main = massif.peaks[0]
      if (main) expect(HEX.crowns.some(({ id }) => rings(offset(id, key(main.cell))) <= 1)).toBe(true)
    }
  })

  test("stand apart, scaled up from the kit's own mountain, on the column's top", () => {
    for (const { id, placement } of HEX.crowns) {
      expect(placement.piece).toMatch(/^mountain_[ABC]$/)
      expect(placement.scale).toBeGreaterThanOrEqual(1.8)
      // Sunk a tile into its column, no more.
      const top = HEX.columns.get(id) as number
      expect(placement.y).toBeLessThan(top)
      expect(placement.y).toBeGreaterThanOrEqual(top - COLUMN_STEP - 1)
      for (const other of HEX.crowns)
        if (other.id !== id) expect(rings(offset(id, other.id))).toBeGreaterThan(1)
    }
  })

  test("the ring round a crown is raised to within a tile of it, so no lip hangs over lower ground", () => {
    for (const { id } of HEX.crowns)
      for (const n of neighbours(unkey(id))) {
        const around = HEX.columns.get(key(n))
        if (around !== undefined)
          expect(around).toBeGreaterThanOrEqual((HEX.columns.get(id) as number) - COLUMN_STEP)
      }
  })
})

describe("the ground walkers read", () => {
  test("heightAt is the column's flat top anywhere in its hex, and nothing off the massifs", () => {
    for (const [id, top] of HEX.columns) {
      const [x, z] = cellToWorld(unkey(id))
      expect(RELIEF.heightAt(x, z)).toBe(top)
      expect(RELIEF.heightAt(x + 1.5, z - 1)).toBe(top)
    }
    const lowland = [...CITY.plan.land.keys()].find((id) => !RELIEF.keys.has(id)) as string
    expect(RELIEF.heightAt(...cellToWorld(unkey(lowland)))).toBeUndefined()
  })

  test("the world's ground, its terrain level and its drawn tiles all agree with the columns", () => {
    const tiles = new Map<string, number>()
    for (const t of WORLD.island.tiles) {
      const id = key(cellAt([t.x, t.z]))
      if (HEX.columns.has(id) && t.piece === "hex_grass")
        tiles.set(id, Math.max(tiles.get(id) ?? 0, t.y ?? 0))
    }
    expect(tiles.size).toBe(HEX.columns.size)
    for (const [id, top] of HEX.columns) {
      expect(tiles.get(id)).toBe(top)
      const [x, z] = cellToWorld(unkey(id))
      expect(WORLD.ground.heightAt(x, z)).toBe(top)
    }
  })

  test("what stands on a column stands on its top: trees, hills and rocks are on the tile", () => {
    const placed = WORLD.island.decor.filter((d) => HEX.columns.has(key(cellAt([d.x, d.z]))))
    expect(placed.length).toBeGreaterThan(50)
    const crowns = new Set(HEX.crowns.map(({ placement }) => placement.piece + placement.x + placement.z))
    for (const d of placed) {
      if (crowns.has(d.piece + d.x + d.z) || !/^(tree|hills|mountain|rock)/.test(d.piece)) continue
      const own = HEX.columns.get(key(cellAt([d.x, d.z]))) as number
      expect(d.y).toBe(own)
    }
  })
})

describe("the island's draw", () => {
  test("the range is the land's own tiles and pieces, in the snow-line material, with no mesh or trails of its own", () => {
    expect(WORLD.mountains?.size).toBeGreaterThan(HEX.columns.size)
    for (const piece of WORLD.mountains ?? []) expect(piece.piece).toMatch(/^(hex_grass|mountain_)/)
    expect(WORLD.trails).toBeUndefined()
  })

  test("no river runs over the columns", () => {
    for (const reach of WORLD.water?.rivers ?? [])
      for (const { cell } of reach.hexes) expect(RELIEF.keys.has(key(cell))).toBe(false)
  })

  test("is deterministic: the same island gives the same columns, crowns and dressing", () => {
    const again = relief()
    expect([...(again.hex?.columns ?? [])]).toEqual([...HEX.columns])
    expect(again.hex?.crowns).toEqual(HEX.crowns)
    expect(hexMountains(again, CITY.plan.seed)?.decor).toEqual(hexMountains(RELIEF, CITY.plan.seed)?.decor)
  })

  test("the other styles have no hex relief, and keep their meshes' ground", () => {
    const current = reliefOf({ plan: CITY.plan, level })
    expect(current.hex).toBeUndefined()
    expect(hexMountains(current, CITY.plan.seed)).toBeUndefined()
  })
})

const offset = (a: string, b: string): [number, number] => {
  const [aq, al] = unkey(a)
  const [bq, bl] = unkey(b)
  return [aq - bq, al - bl]
}
