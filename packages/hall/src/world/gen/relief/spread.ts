import { DMath } from "../../dmath.ts"
import { Heap } from "../heap.ts"
import type { HeightGrid } from "./lattice.ts"
import { pointOf } from "./lattice.ts"

/**
 * Multi-source distance over a massif's lattice vertices: how far each owned vertex is from the
 * nearest source, and the value that source carries (a rim height, a crest height). Twelve moves (the
 * six neighbours and the six between them) so no direction is favoured. Dijkstra with the
 * generator's heap (`cost` scales every step: a slope limit is a spread of heights at cost = grade); every vertex is touched about a dozen times, which is what keeps the field
 * cheap enough to build in a few milliseconds.
 */

const MOVES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
  [1, 1],
  [-1, 2],
  [-2, 1],
  [-1, -1],
  [1, -2],
  [2, -1],
]
const LENGTH = MOVES.map(([i, j]) => DMath.hypot(...(pointOf(i, j) as [number, number])))

export interface Source {
  /** Lattice vertex. */
  i: number
  j: number
  /** Its distance already (a source not quite on a vertex). */
  d?: number
  value: number
}

export interface Spread {
  dist: Float32Array
  /** The nearest source's value, per vertex. */
  carry: Float32Array
}

export function spread(grid: HeightGrid, owned: Uint8Array, sources: readonly Source[], cost = 1): Spread {
  const dist = new Float32Array(owned.length).fill(Number.POSITIVE_INFINITY)
  const carry = new Float32Array(owned.length)
  const heap = new Heap<{ at: number; d: number; i: number; j: number }>((a, b) => a.d < b.d)
  for (const { i, j, d = 0, value } of sources) {
    const at = grid.index(i, j)
    if (at < 0 || !owned[at] || d >= (dist[at] as number)) continue
    dist[at] = d
    carry[at] = value
    heap.push({ at, d, i, j })
  }
  for (let top = heap.pop(); top; top = heap.pop()) {
    if (top.d > (dist[top.at] as number)) continue
    for (let m = 0; m < MOVES.length; m++) {
      const [di, dj] = MOVES[m] as readonly [number, number]
      const at = grid.index(top.i + di, top.j + dj)
      if (at < 0 || !owned[at]) continue
      const d = top.d + (LENGTH[m] as number) * cost
      if (d >= (dist[at] as number)) continue
      dist[at] = d
      carry[at] = carry[top.at] as number
      heap.push({ at, d, i: top.i + di, j: top.j + dj })
    }
  }
  return { dist, carry }
}
