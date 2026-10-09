import { describe, expect, test } from "bun:test"
import { islandObstacles } from "../src/world/clearance.ts"
import { clearLots, LOT_GAP } from "../src/world/gen/dress/clearLots.ts"
import { crowds, type Footprint, footprintsOf } from "../src/world/gen/dress/footprints.ts"
import type { Lot } from "../src/world/gen/dress/town.ts"
import { key, unkey } from "../src/world/gen/hex.ts"
import { cellToWorld, HEX_SCALE, type LandPlacement, PIECES } from "../src/world/lands.ts"
import { toSegment } from "../src/world/lights.ts"
import { instantiate, PREFABS, prefab } from "../src/world/prefabs/index.ts"
import { gen2Worlds } from "./support/fixtures.ts"

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

/** Homes and wells are the town's; the rest of the civic centre's buildings and the wall are not. */
const TOWN = /^building_(home_|well_)/
const CIVIC = /^(wall_|building_(tower_B|castle|barracks|tower_base|church))/
/** The wall's own run: its pieces and the towers it joins meet end to end by design. */
const RUN = /^(wall_|building_tower_B)/

describe("a prefab's own buildings", () => {
  for (const item of PREFABS.filter((one) => !one.id.startsWith("wall-")))
    test(`${item.id}: no two of its buildings overlap`, () => {
      const shapes = instantiate(item, [0, 0], 0, "blue").flatMap((part) => footprintsOf([part]))
      const touching = shapes.flatMap((a, i) => shapes.slice(i + 1).filter((b) => crowds(a, b, 0)))
      expect(touching).toEqual([])
    })
})

describe("a gen 2 island's buildings", () => {
  for (const [name, world] of gen2Worlds()) {
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

    test(`${name}: no two buildings overlap, venues included (the wall's own run apart)`, () => {
      const built = decor.filter((item) => footprintsOf([item]).length > 0)
      const crowded: string[] = []
      for (let i = 0; i < built.length; i++)
        for (let j = i + 1; j < built.length; j++) {
          const [a, b] = [built[i] as LandPlacement, built[j] as LandPlacement]
          if (RUN.test(a.piece) && RUN.test(b.piece)) continue
          if (Math.hypot(a.x - b.x, a.z - b.z) < 16 && crowds(one(a), one(b), 0))
            crowded.push(`${a.piece}@${a.x},${a.z} / ${b.piece}@${b.x},${b.z}`)
        }
      expect(crowded).toEqual([])
    })
  }
})

/** The plazas' centrepieces: a fountain's basin and a well. */
const CENTREPIECE = /^(t2_fountain_round|building_well_)/
/** Drawn road's half-width: nothing of a plaza may stand on it. */
const ROAD_HALF = 0.9

describe("a fountain square", () => {
  test("the fountain's basin is no wider than a cottage", () => {
    const basin = prefab("plaza-fountain").parts.find((part) => part.piece === "t2_fountain_round")
    const wide = (PIECES.t2_fountain_round.size[0] ?? 0) * HEX_SCALE * (basin?.scale ?? 1)
    expect(wide).toBeLessThanOrEqual((PIECES.building_home_A_blue.size[0] ?? 0) * HEX_SCALE)
  })

  for (const [name, world] of gen2Worlds()) {
    const decor = world.island.decor
    const centres = decor.filter((item) => CENTREPIECE.test(item.piece))
    const { nodes, edges } = world.roads
    const onRoad = (item: LandPlacement, room = 0): boolean =>
      edges.some(([a, b]) => {
        const [from, to] = [nodes[a], nodes[b]]
        return from && to && toSegment([item.x, item.z], from, to) < ROAD_HALF + room
      })
    /** Half a piece's width, world units. */
    const half = (item: LandPlacement): number =>
      ((PIECES[item.piece as keyof typeof PIECES].size[0] ?? 0) * HEX_SCALE * (item.scale ?? 1)) / 2

    test(`${name}: no fountain or well stands on a road`, () => {
      expect(
        centres.filter((item) => onRoad(item, half(item))).map((item) => `${item.piece}@${item.x},${item.z}`),
      ).toEqual([])
    })

    test(`${name}: no lamp, stall or prop of a plaza stands on a road or in its centrepiece`, () => {
      const bad: string[] = []
      for (const centre of centres)
        for (const item of decor) {
          if (item === centre || Math.hypot(item.x - centre.x, item.z - centre.z) > 4.5) continue
          if (!/^(t2_(lantern|stall)|barrel|crate_)/.test(item.piece)) continue
          const bounds = PIECES[centre.piece as keyof typeof PIECES]
          const reach = ((bounds.size[0] ?? 0) * HEX_SCALE * (centre.scale ?? 1)) / 2
          if (onRoad(item) || Math.hypot(item.x - centre.x, item.z - centre.z) < reach)
            bad.push(`${item.piece}@${item.x},${item.z}`)
        }
      expect(bad).toEqual([])
    })

    test(`${name}: walkers treat every fountain and well as an obstacle`, () => {
      const obstacles = islandObstacles(world)
      const open = centres.filter((item) => !obstacles.some((o) => o.distance(item.x, item.z) === 0))
      expect(open.map((item) => `${item.piece}@${item.x},${item.z}`)).toEqual([])
    })
  }
})
