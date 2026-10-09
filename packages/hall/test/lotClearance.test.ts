import { describe, expect, test } from "bun:test"
import { clearLots, LOT_GAP } from "../src/world/gen/dress/clearLots.ts"
import { crowds, type Footprint, footprintsOf } from "../src/world/gen/dress/footprints.ts"
import type { Lot } from "../src/world/gen/dress/town.ts"
import { key, unkey } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { cellToWorld, type LandPlacement } from "../src/world/lands.ts"
import { instantiate, prefab } from "../src/world/prefabs/index.ts"
import { repoWorld } from "../src/world/world.ts"
import HINDSIGHT from "./fixtures/repos/codestz__claude-hindsight.json"
import COCKPIT from "./fixtures/repos/codestz__opencode-cockpit.json"
import REACT from "./fixtures/repos/facebook__react.json"
import SELF from "./fixtures/repos/guildhall.json"

/**
 * Room between buildings on a gen 2 island (dress/footprints.ts, dress/clearLots.ts): the town's
 * lots keep off the civic centre, the wall and the venues, and off each other.
 */

const at = (piece: string, x: number, z: number, rot = 0): LandPlacement => ({
  piece: piece as LandPlacement["piece"],
  x,
  z,
  rot,
})
const one = (placement: LandPlacement): Footprint => footprintsOf([placement])[0] as Footprint

describe("footprints", () => {
  test("a tower and a house a pace apart crowd each other; a few units apart they do not", () => {
    const tower = one(at("building_tower_B_blue", 0, 0))
    expect(crowds(tower, one(at("building_home_A_yellow", 0.36, 0)), LOT_GAP)).toBe(true)
    expect(crowds(tower, one(at("building_home_A_yellow", 8, 0)), LOT_GAP)).toBe(false)
  })

  test("a turned box keeps its own corners: a wall run along z is not crowded along x", () => {
    const wall = one(at("wall_straight", 0, 0, Math.PI / 2))
    expect(crowds(wall, one(at("building_home_A_yellow", 4.5, 0)), 0)).toBe(false)
    expect(crowds(wall, one(at("building_home_A_yellow", 0, 4.5)), 0)).toBe(true)
  })

  test("props and underfoot pieces take no room", () => {
    expect(footprintsOf([at("barrel", 0, 0), at("building_dirt", 0, 0)])).toEqual([])
  })
})

describe("clearing lots", () => {
  const lot = (name: string): Lot => ({ prefab: prefab(name), rot: 0 })
  const centre = key([2, 0])
  const [cx, cz] = cellToWorld([2, 0])

  test("a lot whose house would stand in a tower is dropped", () => {
    const lots = new Map([[centre, lot("house-townhouse")]])
    clearLots(lots, [], [], [one(at("building_tower_B_blue", cx, cz))])
    expect(lots.has(centre)).toBe(false)
  })

  test("a roomy lot is kept as it is", () => {
    const lots = new Map([[centre, lot("house-row")]])
    clearLots(lots, [], [], [one(at("building_tower_B_blue", cx + 30, cz))])
    expect(lots.get(centre)?.prefab.id).toBe("house-row")
  })

  test("a row of houses that would touch a tower makes way for a cottage that does not", () => {
    const lots = new Map([[centre, lot("house-row")]])
    // The row reaches about 4.7 east of the hex's middle; a tower just past that (its 3 half-width) is touched.
    clearLots(lots, [], [], [one(at("building_tower_B_blue", cx + 8, cz))])
    expect(lots.get(centre)?.prefab.id).toBe("house-cottage")
  })

  test("of two lots that would touch, the market keeps its place and what stays does not touch", () => {
    const next = key([2, 2])
    // The hexes are 10 apart: turned toward each other, the row's far house and the stalls meet.
    const lots = new Map<string, Lot>([
      [centre, { prefab: prefab("house-row"), rot: Math.PI }],
      [next, { prefab: prefab("market-stalls"), rot: 0 }],
    ])
    clearLots(lots, [], [], [])
    expect(lots.get(next)?.prefab.id).toBe("market-stalls")
    const stood = [...lots].flatMap(([id, kept]) =>
      footprintsOf(instantiate(kept.prefab, cellToWorld(unkey(id)), kept.rot, "blue")),
    )
    expect(stood.filter((a, i) => stood.some((b, j) => j > i && crowds(a, b, 0)))).toEqual([])
  })
})

const WORLDS: [string, ReturnType<typeof repoWorld>][] = [REACT, SELF, COCKPIT, HINDSIGHT].map((fixture) => [
  fixture.repo,
  repoWorld(islandFromTree(fixture.entries as RepoEntry[], 0, 2), {
    repo: fixture.repo,
    source: "fixture",
    gen: 2,
  }),
])

/** Homes and wells are the town's; the rest of the civic centre's buildings and the wall are not. */
const TOWN = /^building_(home_|well_)/
const CIVIC = /^(wall_|building_(tower_B|castle|barracks|tower_base|church))/

describe("a gen 2 island's buildings", () => {
  for (const [name, world] of WORLDS) {
    const decor = world.island.decor
    const town = decor.filter((item) => TOWN.test(item.piece))
    const civic = decor.filter((item) => CIVIC.test(item.piece))

    test(`${name}: no house or well stands in the wall, a tower or the castle`, () => {
      const crowded: string[] = []
      for (const a of town)
        for (const b of civic)
          if (Math.hypot(a.x - b.x, a.z - b.z) < 14 && crowds(one(a), one(b), 0.5))
            crowded.push(`${a.piece}@${a.x},${a.z} / ${b.piece}@${b.x},${b.z}`)
      expect(crowded).toEqual([])
    })

    test(`${name}: no two homes overlap`, () => {
      const homes = town.filter((item) => item.piece.startsWith("building_home_"))
      const crowded: string[] = []
      for (let i = 0; i < homes.length; i++)
        for (let j = i + 1; j < homes.length; j++) {
          const [a, b] = [homes[i] as LandPlacement, homes[j] as LandPlacement]
          if (Math.hypot(a.x - b.x, a.z - b.z) < 10 && crowds(one(a), one(b), 0))
            crowded.push(`${a.x},${a.z} / ${b.x},${b.z}`)
        }
      expect(crowded).toEqual([])
    })
  }
})
