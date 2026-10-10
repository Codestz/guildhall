import { describe, expect, test } from "bun:test"
import { cellAt, key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import { dressingOf } from "../src/world/gen/relief/dressing.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { cellToWorld } from "../src/world/lands.ts"
import { repoWorld } from "../src/world/world.ts"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"
import IS_ODD from "./fixtures/repos/jonschlinkert__is-odd.json"

/** Terrain 2c: rivers from the mountains, hill-country terraces, and the forest on the slopes. */

const worldOf = (entries: unknown, gen: 1 | 2 = 2) => {
  const made = islandFromTree(entries as RepoEntry[], 0, gen)
  return { made, world: repoWorld(made, { repo: "x/y", source: "fixture", gen }) }
}
const CITY = worldOf(REACT.entries)
const TOWN = worldOf(COCKPIT.entries)
const VILLAGE = worldOf(SELF.entries)
const springs = (w: typeof CITY) => w.world.water?.rivers.filter((reach) => !reach.prev).length

describe("rivers", () => {
  test("a tier gets one, two or three rivers; a hamlet and generator 1 none", () => {
    // A valley lake (rivers/lakes.ts) is fed by a stream of its own: the rivers a tier gets, and one for each lake.
    const lakes = (w: typeof CITY) => w.world.water?.lakes.length ?? 0
    expect([
      (springs(VILLAGE) ?? 0) - lakes(VILLAGE),
      (springs(TOWN) ?? 0) - lakes(TOWN),
      (springs(CITY) ?? 0) - lakes(CITY),
    ]).toEqual([1, 2, 3])
    expect(worldOf(IS_ODD.entries).world.water).toBeUndefined()
    expect(worldOf(REACT.entries, 1).world.water).toBeUndefined()
  })

  test("rivers run down the mountains as one stream, falling only over the odd ledge", () => {
    const water = CITY.world.water
    const graded = (water?.rivers ?? []).filter((reach) => reach.grade)
    expect(graded.length).toBeGreaterThan(2)
    for (const reach of graded) {
      const grade = reach.grade ?? []
      expect((grade[0]?.[1] ?? 0) - (grade.at(-1)?.[1] ?? 0)).toBeGreaterThanOrEqual(0)
    }
    for (const fall of water?.falls ?? []) expect(fall.top).toBeGreaterThan(fall.bottom)
  })

  test("the carved bed lies under each graded reach's water", () => {
    // (Past its first few points: a fall's foot shares its edge with the lip's bed above.)
    for (const { world } of [CITY, TOWN, VILLAGE])
      for (const reach of world.water?.rivers ?? [])
        for (const [x, y, z] of reach.grade?.slice(3) ?? []) {
          const bed = world.relief?.heightAt(x, z)
          if (bed !== undefined && bed > 0) expect(bed).toBeLessThan(y + 0.2)
        }
  })

  test("a river crosses a road only under a bridge, and keeps off lots and the keep", () => {
    for (const { made, world } of [CITY, TOWN, VILLAGE]) {
      const roads = new Set(made.plan.roads.flat().map(key))
      const bridges = world.island.decor.filter((d) => d.piece === "building_bridge_A")
      for (const reach of world.water?.rivers ?? [])
        for (const { cell } of reach.hexes) {
          expect("KVvsdw".includes(made.plan.land.get(key(cell))?.char ?? "~")).toBe(false)
          if (!roads.has(key(cell))) continue
          const [x, z] = cellToWorld(cell)
          expect(bridges.some((b) => Math.hypot(b.x - x, b.z - z) < 1)).toBe(true)
        }
    }
  })
})

describe("hill country", () => {
  test("gen 2 raises lots onto terraces, never past their plan's level; gen 1 raises none", () => {
    const lots = [...CITY.made.plan.land].filter(([, hex]) => hex.level && hex.char === "v")
    expect(lots.length).toBeGreaterThan(0)
    for (const [id, hex] of lots) expect(CITY.made.levels.get(id) ?? 0).toBeLessThanOrEqual(hex.level ?? 0)
    const v1 = islandFromTree(REACT.entries as RepoEntry[], 0, 1)
    expect([...v1.plan.land.values()].some((hex) => hex.level)).toBe(false)
  })
})

describe("dressing", () => {
  test("trees stand below the treeline and never in a river hex", () => {
    for (const { world } of [CITY, TOWN]) {
      const relief = world.relief
      if (!relief) throw new Error("no relief")
      const wet = new Set(world.water?.rivers.flatMap((reach) => reach.hexes.map((h) => key(h.cell))))
      const trees = dressingOf(relief, 1, wet).filter((p) => p.piece.startsWith("tree"))
      expect(trees.length).toBeGreaterThan(20)
      const top = Math.max(...relief.massifs.map((m) => m.height))
      for (const tree of trees) {
        expect(tree.y ?? 0).toBeLessThan(top * 0.6)
        expect(wet.has(key(cellAt([tree.x, tree.z])))).toBe(false)
      }
    }
  })

  test("the same relief grows the same forest", () => {
    const relief = CITY.world.relief
    if (!relief) throw new Error("no relief")
    expect(dressingOf(relief, 5)).toEqual(dressingOf(relief, 5))
  })
})
