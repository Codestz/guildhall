import { DMath } from "./dmath.ts"
import type { Hall } from "./hall/types.ts"
import { HEX_SCALE, MAP_FOR_TESTS, PIECES } from "./lands.ts"
import { ROOM, type Spot } from "./layout.ts"
import { type Light, lightsOf } from "./lights.ts"
import type { Terrain, World } from "./world.ts"

/**
 * What the wilds (world/wilds.ts) keep clear of, read off a world once: its roads, water, work
 * posts, reserved lanes, hall, placed decor and lights, as the plain shapes the clearance rules test.
 */

/** More off a building's walls than off other decor. */
export const BUILDING_CLEARANCE = 1.6

/** A manifest bounding box's ground extent. */
export function box({ min, max }: { min: number[]; max: number[] }) {
  const [x0 = 0, , z0 = 0] = min
  const [x1 = 0, , z1 = 0] = max
  return { x0, z0, x1, z1 }
}

/** A world's ground, as what the wilds must keep clear of. */
export interface Ground {
  hand: boolean
  terrain: Terrain
  roads: (readonly [Spot, Spot])[]
  sea: Spot[]
  river: Spot[]
  posts: Spot[]
  /** How adventurers reach their posts: straight from the nearest road node. */
  approaches: (readonly [Spot, Spot])[]
  reserved: (readonly [Spot, Spot])[] // lanes sites reserve (a bridge's way), 7.5 off each side
  /** A far island's hall: its floor and walls, and what grows round them, keep clear (world/hall). */
  hall: Hall | undefined
  /** Every placed land piece (buildings, fences, crates, hex trees…) as a circle on the ground. */
  decor: { x: number; z: number; r: number }[]
  lights: readonly Light[]
}

export function groundOf(world: World): Ground {
  const hand = world.kind === "hand"
  const { terrain } = world
  const { nodes: graph, edges } = world.roads
  const roads: (readonly [Spot, Spot])[] = edges.flatMap(([a, b]) => {
    const from = graph[a]
    const to = graph[b]
    return from && to ? [[from, to] as const] : []
  })
  // The keep's gate apron: the avenue's drawn stub from the gate up to the road hex nearest it
  // (the hand map's OUT; a repo island's avenue).
  const gate: Spot = [0, ROOM.depth / 2]
  let out: Spot | undefined
  for (const at of Object.values(graph))
    if (
      !out ||
      DMath.hypot(at[0] - gate[0], at[1] - gate[1]) < DMath.hypot(out[0] - gate[0], out[1] - gate[1])
    )
      out = at
  if (out) roads.push([gate, out])
  const nodes = Object.values(graph)
  const isSea = (w: Spot) => ["~", "o"].includes(terrain.at(MAP_FOR_TESTS.cellOf(w)))
  const posts: Spot[] = world.sites.flatMap((site) => site.posts.map((p) => [p[0], p[1]] as Spot))
  return {
    hand,
    terrain,
    roads,
    sea: world.island.water.filter(isSea),
    river: world.island.water.filter((w) => !isSea(w)),
    posts,
    reserved: world.sites.flatMap((site) => site.reserved ?? []),
    hall: world.hall,
    approaches: posts.map((post) => {
      let best = nodes[0] as Spot
      for (const node of nodes)
        if (
          DMath.hypot(node[0] - post[0], node[1] - post[1]) <
          DMath.hypot(best[0] - post[0], best[1] - post[1])
        )
          best = node
      return [best, post] as const
    }),
    decor: world.island.decor.map((d) => {
      const { x0, z0, x1, z1 } = box(PIECES[d.piece])
      const scale = HEX_SCALE * (d.scale ?? 1)
      const cx = ((x0 + x1) / 2) * scale
      const cz = ((z0 + z1) / 2) * scale
      const rot = d.rot ?? 0
      return {
        x: d.x + cx * DMath.cos(rot) + cz * DMath.sin(rot),
        z: d.z - cx * DMath.sin(rot) + cz * DMath.cos(rot),
        r:
          (Math.max(x1 - x0, z1 - z0) / 2) * scale +
          (d.piece.startsWith("building_") ? BUILDING_CLEARANCE : 0),
      }
    }),
    lights: lightsOf(world),
  }
}
