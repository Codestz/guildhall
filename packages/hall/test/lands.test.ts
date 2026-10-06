import { describe, expect, test } from "bun:test"
import {
  cellToWorld,
  GRAVEYARD_PLOT,
  island,
  MAP_FOR_TESTS as MAP,
  ROAD_EDGES,
  ROAD_NODES,
  SITES,
  toPlot,
} from "../src/world/lands.ts"
import { GATE, type Spot, STATIONS } from "../src/world/layout.ts"
import { route } from "../src/world/paths.ts"

const WATER = new Set(["~", "o", "r"])
const ROAD = new Set(["=", "#"])
const posts = Object.values(SITES).flatMap((site) => site.posts.map((post) => [post[0], post[1]] as Spot))

/** Half the width of a river tile's channel, world units (measured from the pack's river tiles). */
const CHANNEL = 2.4
const toSegment = (p: Spot, a: Spot, b: Spot): number => {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t)
}
/** In the water: open water, or a river hex's channel (its banks are dry). */
function wet(point: Spot): boolean {
  const cell = MAP.cellOf(point)
  const char = MAP.at(cell)
  if (char === "~" || char === "o") return true
  if (char !== "r") return false
  const centre = cellToWorld(cell)
  for (const dir of MAP.riverLinks.get(cell.join(",")) ?? []) {
    const angle = Math.PI / 6 + (dir * Math.PI) / 3
    const edge: Spot = [centre[0] + Math.cos(angle) * 5, centre[1] + Math.sin(angle) * 5]
    if (toSegment(point, centre, edge) < CHANNEL) return true
  }
  return false
}

/** Every point along a walk, every 0.5 units. */
function walk(from: Spot, path: readonly Spot[]): Spot[] {
  const points: Spot[] = []
  let at = from
  for (const next of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(next[0] - at[0], next[1] - at[1]) / 0.5))
    for (let i = 1; i <= steps; i++)
      points.push([at[0] + ((next[0] - at[0]) * i) / steps, at[1] + ((next[1] - at[1]) * i) / steps])
    at = next
  }
  return points
}

describe("the island map", () => {
  test("every road node sits on the centre of a road hex", () => {
    for (const [name, spot] of Object.entries(ROAD_NODES)) {
      const cell = MAP.cellOf(spot)
      expect({ name, char: MAP.at(cell) }).toEqual({
        name,
        char: ROAD.has(MAP.at(cell)) ? MAP.at(cell) : "road",
      })
      const centre = cellToWorld(cell)
      expect(Math.hypot(centre[0] - spot[0], centre[1] - spot[1])).toBeLessThan(0.01)
    }
  })

  test("every road edge joins neighbouring hexes, and every drawn road hex is walked", () => {
    for (const [a, b] of ROAD_EDGES) {
      const pa = ROAD_NODES[a] ?? [0, 0]
      const pb = ROAD_NODES[b] ?? [0, 0]
      expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1])).toBeCloseTo(10, 3)
    }
    const walked = new Set(Object.values(ROAD_NODES).map((spot) => MAP.cellOf(spot).join(",")))
    const drawn = MAP.cells().filter((id) => ROAD.has(MAP.at(id.split(",").map(Number) as [number, number])))
    // The gate's apron is drawn but not walked: its centre is under the keep.
    expect(drawn.filter((id) => !walked.has(id))).toEqual(["0,2"])
  })

  test("the gate road starts at the keep's gate", () => {
    expect(ROAD_NODES.OUT).toEqual([0, 20])
    expect(GATE[0]).toBe(0)
  })

  test("no post stands on water, on raised ground or inside a building", () => {
    const buildings = island().decor.filter(
      (piece) => piece.piece.startsWith("building_") && !/grain|dirt|bridge/.test(piece.piece),
    )
    for (const post of posts) {
      const cell = MAP.cellOf(post)
      expect(wet(post)).toBe(false)
      expect(MAP.level(cell)).toBe(0)
      for (const building of buildings)
        expect(Math.hypot(building.x - post[0], building.z - post[1])).toBeGreaterThan(3)
    }
  })

  test("walks to every post stay on roads and never wade through water", () => {
    const forge = STATIONS.forge.posts[0] ?? [0, 0]
    for (const post of posts) {
      const path = route([forge[0], forge[1]], post)
      const roadLegs = path.slice(0, -1)
      for (const point of walk([forge[0], forge[1]], roadLegs)) {
        if (Math.abs(point[0]) < 19 && point[1] < 15) continue // inside the keep and its doorway
        expect(ROAD.has(MAP.at(MAP.cellOf(point)))).toBe(true)
      }
      for (const point of walk([forge[0], forge[1]], path)) expect(wet(point)).toBe(false)
    }
  })

  test("roads, sites and the keep are level; water and meadow lists match the map", () => {
    const land = island()
    for (const tile of land.tiles) {
      const char = MAP.at(MAP.cellOf([tile.x, tile.z]))
      if (ROAD.has(char) || char === "K" || char === "s") expect(tile.y ?? 0).toBe(0)
    }
    for (const spot of land.water) expect([...WATER, "#"]).toContain(MAP.at(MAP.cellOf(spot)))
    for (const spot of land.meadow) {
      const cell = MAP.cellOf(spot)
      expect(MAP.level(cell)).toBe(0)
      expect([".", "f"]).toContain(MAP.at(cell))
    }
    expect(land.meadow.length).toBeGreaterThan(20)
  })

  test("the landmarks Life needs are there, homes with chimneys above their roofs", () => {
    const { landmarks } = island()
    const kinds = new Set(landmarks.map((mark) => mark.kind))
    for (const kind of [
      "windmill",
      "watermill",
      "lumbermill",
      "mine",
      "tower",
      "well",
      "home",
      "market",
      "dock",
      "chimney",
    ])
      expect(kinds.has(kind as never)).toBe(true)
    for (const chimney of landmarks.filter((mark) => mark.kind === "chimney"))
      expect(chimney.y ?? 0).toBeGreaterThan(4)
    expect(landmarks.find((mark) => mark.kind === "mine")?.site).toBe("quarry")
  })

  test("no tree grows through a building", () => {
    const land = island()
    const buildings = land.decor.filter((d) => d.piece.startsWith("building_") && d.piece !== "building_dirt")
    for (const tree of land.decor.filter((d) => /^trees?_/.test(d.piece) && !/_cut$/.test(d.piece)))
      for (const house of buildings)
        expect({
          tree: tree.piece,
          at: [tree.x, tree.z],
          near: house.piece,
          d: Math.hypot(tree.x - house.x, tree.z - house.z) > 3,
        }).toEqual({ tree: tree.piece, at: [tree.x, tree.z], near: house.piece, d: true })
  })

  test("same seed, same island", () => {
    expect(JSON.stringify(island(7))).toBe(JSON.stringify(island(7)))
  })

  test("the graveyard's plot is level open ground, off every road, building, post and walk", () => {
    const { x0, x1, z0, z1 } = GRAVEYARD_PLOT
    for (let x = x0; x <= x1; x += 1)
      for (let z = z0; z <= z1; z += 1) {
        const cell = MAP.cellOf([x, z])
        // Meadow and light woods; its east fence may stand on a road hex's grass verge (the road
        // itself is checked below, by distance).
        expect({ at: [x, z], open: ".f=".includes(MAP.at(cell)), level: MAP.level(cell) }).toEqual({
          at: [x, z],
          open: true,
          level: 0,
        })
      }
    for (const [a, b] of ROAD_EDGES) {
      const from = ROAD_NODES[a] ?? [0, 0]
      const to = ROAD_NODES[b] ?? [0, 0]
      for (const p of walk(from, [to])) expect(toPlot(p[0], p[1])).toBeGreaterThan(2.6 + 0.4)
    }
    const land = island()
    for (const b of land.decor.filter((d) => d.piece.startsWith("building_")))
      expect(toPlot(b.x, b.z)).toBeGreaterThan(5)
    for (const post of posts) expect(toPlot(post[0], post[1])).toBeGreaterThan(5)
    const forge = STATIONS.forge.posts[0] ?? [0, 0]
    for (const post of posts)
      for (const p of walk([forge[0], forge[1]], route([forge[0], forge[1]], post)))
        expect(toPlot(p[0], p[1])).toBeGreaterThan(3)
  })

  test("the island's own scatter and meadow grass keep off the graveyard (and the rest is unchanged)", () => {
    const land = island()
    for (const d of land.decor)
      expect({ piece: d.piece, d: toPlot(d.x, d.z) > 0.5 }).toEqual({ piece: d.piece, d: true })
    for (const [x, z] of land.meadow) expect(toPlot(x, z)).toBeGreaterThan(0)
  })
})
