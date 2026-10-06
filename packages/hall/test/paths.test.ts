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
