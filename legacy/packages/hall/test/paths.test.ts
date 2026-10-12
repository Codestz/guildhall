import { describe, expect, test } from "bun:test"
import { SITES } from "../src/world/lands.ts"
import { GATE, HEARTH, INFIRMARY, type Spot, STATIONS, TAVERN } from "../src/world/layout.ts"
import { AISLES, route } from "../src/world/paths.ts"

/** Every point along the walk, every 0.25 units. */
function walk(from: Spot, path: Spot[]): Spot[] {
  const points: Spot[] = []
  let at = from
  for (const next of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(next[0] - at[0], next[1] - at[1]) / 0.25))
    for (let i = 1; i <= steps; i++)
      points.push([at[0] + ((next[0] - at[0]) * i) / steps, at[1] + ((next[1] - at[1]) * i) / steps])
    at = next
  }
  return points
}

const POSTS: Spot[] = [
  ...Object.values(STATIONS).flatMap((station) => station.posts.map((post) => [post[0], post[1]] as const)),
  ...TAVERN.map((post) => [post[0], post[1]] as const),
  ...INFIRMARY.map((post) => [post[0], post[1]] as const),
]

describe("aisles", () => {
  test("the graph is connected", () => {
    const ids = Object.keys(AISLES.nodes)
    const seen = new Set([ids[0]])
    let grew = true
    while (grew) {
      grew = false
      for (const [a, b] of AISLES.edges) {
        if (seen.has(a) !== seen.has(b)) {
          seen.add(a)
          seen.add(b)
          grew = true
        }
      }
    }
    expect(seen.size).toBe(ids.length)
  })

  test("routes end exactly at the target", () => {
    for (const post of POSTS) expect(route(GATE, post).at(-1)).toEqual(post)
  })

  test("nobody walks through the hearth", () => {
    for (const a of POSTS) {
      for (const b of POSTS) {
        for (const point of walk(a, route(a, b))) {
          expect(Math.hypot(point[0] - HEARTH[0], point[1] - HEARTH[1])).toBeGreaterThan(1.6)
        }
      }
    }
  })

  test("every job site is reached out of the gate, along the roads", () => {
    const forge = STATIONS.forge.posts[0] ?? [0, 0]
    for (const site of Object.values(SITES)) {
      for (const post of site.posts) {
        const path = route([forge[0], forge[1]], [post[0], post[1]])
        expect(path.at(-1)).toEqual([post[0], post[1]])
        // Leaves through the doorway: some step is at the gate, x = 0, z ≈ 13.6.
        expect(path.some((p) => p[0] === 0 && p[1] > 13 && p[1] < 14)).toBe(true)
        for (const point of walk([forge[0], forge[1]], path)) {
          const inside = Math.abs(point[0]) < 18 && Math.abs(point[1]) < 12
          const doorway = Math.abs(point[0]) < 2 && point[1] > 9
          if (!inside && Math.abs(point[0]) < 19 && Math.abs(point[1]) < 13) expect(doorway).toBe(true)
        }
      }
    }
  })

  test("arrivals from the gate come in through the doorway", () => {
    const first = route(GATE, STATIONS.forge.posts[0] ?? [0, 0])[0]
    expect(first?.[0]).toBe(0)
  })
})

describe("roads the size of a city island", () => {
  /** A 40 × 40 grid of road nodes 10 apart, walled down the middle but for its far row. */
  const SIDE = 40
  const id = (i: number, j: number) => `G${i}_${j}`
  const at = (i: number, j: number): Spot => [100 + 10 * i, 100 + 10 * j]
  const nodes: Record<string, Spot> = {}
  const edges: [string, string][] = []
  for (let i = 0; i < SIDE; i++)
    for (let j = 0; j < SIDE; j++) {
      nodes[id(i, j)] = at(i, j)
      if (j + 1 < SIDE) edges.push([id(i, j), id(i, j + 1)])
      if (i + 1 < SIDE && (i !== SIDE / 2 - 1 || j === SIDE - 1)) edges.push([id(i, j), id(i + 1, j)])
    }
  const roads = { nodes, edges }
  const length = (from: Spot, path: Spot[]) =>
    path.reduce((sum, next, k) => {
      const prev = k === 0 ? from : (path[k - 1] as Spot)
      return sum + Math.hypot(next[0] - prev[0], next[1] - prev[1])
    }, 0)

  test("the shortest way round a wall, over 1,600 nodes", () => {
    const from = at(0, 0)
    const to = at(SIDE - 1, 0)
    const path = route(from, to, roads)
    expect(path.at(-1)).toEqual(to)
    expect(length(from, path)).toBeCloseTo(3 * 10 * (SIDE - 1), 6)
  })

  test("straight along an open row", () => {
    const from = at(0, SIDE - 1)
    const to = at(SIDE - 1, SIDE - 1)
    expect(length(from, route(from, to, roads))).toBeCloseTo(10 * (SIDE - 1), 6)
  })
})
