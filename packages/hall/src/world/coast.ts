import type { Spot } from "./layout.ts"
import type { World } from "./world.ts"

/**
 * An island's coast as points, for the width of the strait between two: how near their land comes,
 * not how far it reaches (`reachOf` is the furthest point, a lobe that may face away). Pure.
 */

/** From a coast hex's centre to the edge of its land: where the sea starts. */
export const EDGE = 5.8

const coasts = new WeakMap<World, readonly Spot[]>()
/** The centres of an island's coast hexes (island-local). */
export function coastOf(world: World): readonly Spot[] {
  let known = coasts.get(world)
  if (!known) {
    known = world.island.tiles.filter((t) => t.piece.startsWith("hex_coast")).map((t): Spot => [t.x, t.z])
    coasts.set(world, known)
  }
  return known
}

/** The nearest two coast points of two islands (keeps at `from` and `to`), and the sea between them. */
export interface Strait {
  /** Open sea between the two lands, world units. */
  gap: number
  /** The nearest points, in each island's own coordinates. */
  a: Spot
  b: Spot
}

/**
 * The strait between `a` (keep at `from`) and `b` (at `to`). Stops early, with a gap known to be under
 * `below`, as soon as one is found: callers asking "is it at least this wide" don't need the nearest.
 */
export function straitBetween(
  a: readonly Spot[],
  from: Spot,
  b: readonly Spot[],
  to: Spot,
  below = 0,
): Strait | undefined {
  let nearest = Number.POSITIVE_INFINITY
  // Squared distances: the comparison needs no root, and sqrt is exact on every machine.
  const dx = from[0] - to[0]
  const dz = from[1] - to[1]
  const stop = (below + 2 * EDGE) ** 2
  let pair: [Spot, Spot] | undefined
  for (const p of a)
    for (const q of b) {
      const x = dx + p[0] - q[0]
      const z = dz + p[1] - q[1]
      const d2 = x * x + z * z
      if (d2 < nearest) {
        nearest = d2
        pair = [p, q]
        if (d2 < stop) return strait(nearest, pair)
      }
    }
  return pair && strait(nearest, pair)
}

const strait = (d2: number, [a, b]: [Spot, Spot]): Strait => ({
  gap: Math.max(0, Math.sqrt(d2) - 2 * EDGE),
  a,
  b,
})
