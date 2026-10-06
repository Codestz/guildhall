import { describe, expect, test } from "bun:test"
import { island, ROAD_EDGES, ROAD_NODES, SITES } from "../src/world/lands.ts"
import { ROOM } from "../src/world/layout.ts"
import { LIGHTS, toSegment } from "../src/world/lights.ts"

const land = island()
const at = (l: (typeof LIGHTS)[number]) => [l.placement.x, l.placement.z] as const

describe("night lights", () => {
  test("the island is lit: torches along the roads, lanterns at gathering places and sites", () => {
    const torches = LIGHTS.filter((l) => l.placement.piece === "torch").length
    const lanterns = LIGHTS.filter((l) => l.placement.piece === "lantern").length
    expect(torches).toBeGreaterThan(25)
    expect(lanterns).toBeGreaterThan(8)
  })

  test("no light stands in water, in the keep, on a road, in a building or on a work post", () => {
    const buildings = land.decor.filter((d) => d.piece.startsWith("building_"))
    const posts = Object.values(SITES).flatMap((s) => s.posts)
    for (const light of LIGHTS) {
      const [x, z] = at(light)
      const gate = Math.abs(x) < 5 && z > ROOM.depth / 2 && z < ROOM.depth / 2 + 5
      expect(Math.abs(x) < ROOM.width / 2 + 2 && Math.abs(z) < ROOM.depth / 2 + 2 && !gate).toBe(false)
      for (const w of land.water) expect(Math.hypot(w[0] - x, w[1] - z)).toBeGreaterThan(5)
      const lantern = light.placement.piece === "lantern"
      for (const b of buildings) expect(Math.hypot(b.x - x, b.z - z)).toBeGreaterThan(lantern ? 3.1 : 4)
      for (const p of posts) expect(Math.hypot(p[0] - x, p[1] - z)).toBeGreaterThan(1.7)
      if (gate) continue
      for (const [a, b] of ROAD_EDGES) {
        const from = ROAD_NODES[a]
        const to = ROAD_NODES[b]
        if (from && to) expect(toSegment([x, z], from, to)).toBeGreaterThan(lantern ? 1.6 : 2.7)
      }
    }
  })

  test("lights keep their distance from each other", () => {
    for (let i = 0; i < LIGHTS.length; i++)
      for (let j = i + 1; j < LIGHTS.length; j++) {
        const [ax, az] = at(LIGHTS[i]!)
        const [bx, bz] = at(LIGHTS[j]!)
        expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThan(6)
      }
  })
})
