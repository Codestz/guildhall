import { describe, expect, test } from "bun:test"
import {
  agentLoop,
  hexIsland,
  hexWalk,
  hexWorld,
  hexZones,
  LEVEL_STEP,
  lifePose,
  planFolk,
  useOf,
  workTiles,
} from "../src/hex/index.ts"

const built = (seed: number, files = 4000) => {
  const h = hexIsland({ seed, files })
  const z = hexZones(h)
  const w = hexWorld(h, z)
  return { h, z, w, walk: hexWalk(h, z, w, { reach: workTiles(h, z) }) }
}
const islands = [1, 2, 3].map((seed) => built(seed))

describe("hex walk graph", () => {
  test("every road tile is a node, and consecutive road tiles are joined", () => {
    for (const { z, walk } of islands)
      for (const road of z.roads)
        for (let k = 1; k < road.tiles.length; k++) {
          const a = walk.at(road.tiles[k - 1]!)
          const b = walk.at(road.tiles[k]!)
          expect(a).toBeGreaterThanOrEqual(0)
          expect(walk.out[a]!.some((e) => walk.edges[e]!.a === b || walk.edges[e]!.b === b)).toBe(true)
        }
  })

  test("every place is reachable from the town's heart", () => {
    for (const { z, walk } of islands) {
      const town = walk.hearts[0]!
      for (const [i, heart] of walk.hearts.entries()) {
        if (!z.zones[i]!.tiles.length) continue
        const path = walk.route(town, heart)
        expect(path).not.toBeNull()
        expect(path![0]).toBe(town)
        expect(path![path!.length - 1]).toBe(heart)
      }
    }
  })

  test("a route steps only along edges", () => {
    const { z, walk } = islands[0]!
    // the furthest-down place that has tiles (a place the island had no room for has no heart node)
    const far = z.zones.findLastIndex((zone) => zone.tiles.length > 0)
    const path = walk.route(walk.hearts[0]!, walk.hearts[far]!)!
    for (let k = 1; k < path.length; k++)
      expect(
        walk.out[path[k - 1]!]!.some((e) => [walk.edges[e]!.a, walk.edges[e]!.b].includes(path[k]!)),
      ).toBe(true)
  })

  test("doors stand outside the building, toward the street they are joined to", () => {
    for (const { h, z, w, walk } of islands) {
      const tileOf = new Map(w.tiles.map((t) => [t.i, t]))
      let doors = 0
      for (let i = 0; i < h.grid.size; i++) {
        const d = walk.door(i)
        if (d < 0) continue
        doors++
        expect(useOf(z, i)).toMatch(/building|farmstead|homestead/)
        const door = walk.nodes[d]!
        const [e] = walk.out[d]!
        const street = walk.nodes[walk.edges[e!]!.a === d ? walk.edges[e!]!.b : walk.edges[e!]!.a]!
        // the street tile is a neighbour, and the door is nearer it than the building's centre is
        expect(h.grid.neighbours(i)).toContain(street.tile)
        const centre = tileOf.get(i)!
        expect(Math.hypot(door.x - street.x, door.z - street.z)).toBeLessThan(
          Math.hypot(centre.x - street.x, centre.z - street.z) + 1e-9,
        )
      }
      expect(doors).toBeGreaterThan(50)
    }
  })

  test("no walk edge climbs more than one level step (bridge and dock decks aside)", () => {
    for (const { walk } of islands)
      for (const e of walk.edges) {
        if (e.kind === "dock" || e.kind === "bridge") continue
        expect(Math.abs(walk.nodes[e.a]!.y - walk.nodes[e.b]!.y)).toBeLessThanOrEqual(LEVEL_STEP + 1e-6)
      }
  })

  test("work tiles off the roads (docks, fields) get spurs", () => {
    const { walk } = islands[0]!
    expect(walk.nodes.some((n) => n.kind === "dock")).toBe(true)
    expect(walk.nodes.some((n) => n.kind === "path")).toBe(true)
  })

  test("same island, same graph", () => {
    const a = built(4, 900).walk
    const b = built(4, 900).walk
    expect(a.nodes).toEqual(b.nodes)
    expect(a.edges).toEqual(b.edges)
  })
})

describe("hex life", () => {
  const { h, z, w, walk } = islands[0]!
  const folk = planFolk(h, z, w, walk, { seed: 1, pace: 150 })

  test("every place with tiles has people, in the roles its kind needs", () => {
    for (const [i, zone] of z.zones.entries()) {
      if (!zone.tiles.length) continue
      expect(folk.some((f) => f.zone === i)).toBe(true)
    }
    const farm = z.zones.findIndex((zz) => zz.kind === "farm")
    expect(folk.filter((f) => f.zone === farm).every((f) => f.role === "farmer")).toBe(true)
  })

  test("days loop: where someone is at 24:00 is where they are at 00:00", () => {
    for (const f of folk) {
      const a = lifePose(f.day, 0, 24).at
      const b = lifePose(f.day, 23.9999, 24).at
      expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeLessThan(0.05)
    }
  })

  test("most are asleep indoors at 3:00 and out at noon", () => {
    const out = (hour: number) => folk.filter((f) => !lifePose(f.day, hour, 24).indoors).length
    expect(out(3)).toBeLessThan(folk.length * 0.2)
    expect(out(12.3)).toBeGreaterThan(folk.length * 0.8)
  })

  test("walks move continuously: no jump between nearby moments", () => {
    for (const f of folk.slice(0, 40))
      for (let t = 0; t < 24; t += 0.05) {
        const a = lifePose(f.day, t, 24).at
        const b = lifePose(f.day, t + 0.01, 24).at
        // 150 m an hour: 1.5 m in 0.01 h, plus the step to a spot beside a node
        expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeLessThan(4)
      }
  })

  test("an agent's loop leaves the Guildhall square, works at the place and comes back", () => {
    const camp = z.zones.findIndex((zz) => zz.kind === "camp")
    const { steps, period } = agentLoop(walk, z, [{ place: "camp", work: 30, idle: 5 }], { slot: 0 })
    const hall = walk.nodes[walk.hearts[0]!]!
    const site = walk.nodes[walk.hearts[camp]!]!
    const start = lifePose(steps, 0, period)
    expect(Math.hypot(start.at[0] - hall.x, start.at[2] - hall.z)).toBeLessThan(2)
    const working = steps.find((s) => s.kind === "stay" && s.act === "work")!
    expect(working.kind).toBe("stay")
    if (working.kind === "stay")
      expect(Math.hypot(working.at[0] - site.x, working.at[2] - site.z)).toBeLessThan(2.5)
    const end = lifePose(steps, period - 0.01, period)
    expect(Math.hypot(end.at[0] - start.at[0], end.at[2] - start.at[2])).toBeLessThan(0.01)
  })
})
