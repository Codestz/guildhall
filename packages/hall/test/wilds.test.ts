import { describe, expect, test } from "bun:test"
import { PILES } from "../src/scene/life/places.ts"
import { ROUNDS } from "../src/scene/life/rounds.ts"
import FOREST from "../src/world/forest.json"
import { island, MAP_FOR_TESTS as MAP, ROAD_EDGES, ROAD_NODES, SITES } from "../src/world/lands.ts"
import { ROOM, type Spot } from "../src/world/layout.ts"
import { LIGHTS, toSegment } from "../src/world/lights.ts"
import { RIVER_CLEARANCE, ROAD_HALF, WATER_CLEARANCE, wilds } from "../src/world/wilds.ts"

const KEEP = {
  paths: ROUNDS.map((round) => [round.door, ...round.stops, round.door].map((s): Spot => [s.x, s.z])),
  spots: Object.values(PILES).map((pile): Spot => [pile.x, pile.z]),
}
const WILDS = wilds(KEEP)
const land = island()

describe("the wilds", () => {
  test("grow a mix of trees, bushes, rocks and grass from the pack's pieces", () => {
    const count = (kind: string) => WILDS.filter((w) => w.kind === kind).length
    expect(count("tree")).toBeGreaterThan(8)
    expect(count("bush")).toBeGreaterThan(25)
    expect(count("rock")).toBeGreaterThan(15)
    expect(count("grass")).toBeGreaterThan(25)
    for (const wild of WILDS) expect(Object.keys(FOREST)).toContain(wild.piece)
  })

  test("are the same every time (seeded, never random)", () => {
    expect(wilds(KEEP)).toEqual(WILDS)
  })

  test("stand on level open ground, never in the keep, the water or down the beach", () => {
    for (const { x, z, radius } of WILDS) {
      const cell = MAP.cellOf([x, z])
      expect(".fvVs=").toContain(MAP.at(cell))
      expect(MAP.level(cell)).toBe(0)
      expect(Math.abs(x) < ROOM.width / 2 + 2 && Math.abs(z) < ROOM.depth / 2 + 2).toBe(false)
      for (const w of land.water) {
        const sea = "~o".includes(MAP.at(MAP.cellOf(w)))
        expect(Math.hypot(w[0] - x, w[1] - z)).toBeGreaterThanOrEqual(
          (sea ? WATER_CLEARANCE : RIVER_CLEARANCE) + radius,
        )
      }
    }
  })

  test("keep off the roads, the work posts and the paths to them", () => {
    const posts = Object.values(SITES).flatMap((s) => s.posts)
    for (const { x, z, radius } of WILDS) {
      for (const [a, b] of ROAD_EDGES) {
        const from = ROAD_NODES[a]
        const to = ROAD_NODES[b]
        if (from && to) expect(toSegment([x, z], from, to)).toBeGreaterThanOrEqual(ROAD_HALF + radius)
      }
      for (const p of posts) expect(Math.hypot(p[0] - x, p[1] - z)).toBeGreaterThanOrEqual(2 + radius)
      expect(Math.hypot(SITES.yard.at[0] - x, SITES.yard.at[1] - z)).toBeGreaterThan(4 + radius)
    }
  })

  test("keep clear of buildings, torches, lanterns and the villagers' rounds", () => {
    const buildings = land.decor.filter((d) => d.piece.startsWith("building_") && !/grain|dirt/.test(d.piece))
    for (const { x, z, radius } of WILDS) {
      for (const b of buildings) expect(Math.hypot(b.x - x, b.z - z)).toBeGreaterThan(radius + 3)
      for (const l of LIGHTS)
        expect(Math.hypot(l.placement.x - x, l.placement.z - z)).toBeGreaterThanOrEqual(2.4 + radius)
      for (const path of KEEP.paths)
        for (let i = 1; i < path.length; i++)
          expect(toSegment([x, z], path[i - 1] as Spot, path[i] as Spot)).toBeGreaterThanOrEqual(1.2 + radius)
    }
  })

  test("never stand inside each other", () => {
    for (let i = 0; i < WILDS.length; i++)
      for (let j = i + 1; j < WILDS.length; j++) {
        const a = WILDS[i]!
        const b = WILDS[j]!
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual((a.radius + b.radius) * 0.8 - 0.01)
      }
  })

  test("Low quality keeps only the big pieces: no grass, no pebbles", () => {
    const low = WILDS.filter((w) => w.detail === 0)
    expect(low.length).toBeGreaterThan(0)
    expect(low.length).toBeLessThan(WILDS.length / 2)
    expect(low.some((w) => w.kind === "grass")).toBe(false)
    for (const w of low) if (w.kind !== "tree") expect(w.radius).toBeGreaterThan(0.9)
  })
})
