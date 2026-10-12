import { DMath } from "./dmath.ts"
import type { Spot } from "./layout.ts"

/**
 * The way round, when a straight-ish lane would cross a bridge (world/lanes.ts): the shortest path
 * over a grid of the sea between two points, through cells `blocked` leaves open, pulled straight
 * where it can be. Deterministic: ties are broken by cell order. Pure.
 */

/** Grid cell, world units. */
const CELL = 5
/** The search keeps this far past the two ends' bounding box. */
const ROOM = 150
/** Within this of either end the sea is open whatever `blocked` says (the berth stands by its own pier). */
const FREE_NEAR = 20

const SQRT2 = Math.SQRT2
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
]

/** A binary heap of [priority, order, cell]: lowest priority first, then the earliest pushed. */
class Heap {
  private items: [number, number, number][] = []
  private order = 0
  get size(): number {
    return this.items.length
  }
  push(priority: number, cell: number): void {
    const items = this.items
    items.push([priority, this.order++, cell])
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (before(items[parent] as Item, items[i] as Item)) break
      ;[items[parent], items[i]] = [items[i] as Item, items[parent] as Item]
      i = parent
    }
  }
  pop(): number {
    const items = this.items
    const top = items[0] as Item
    const last = items.pop() as Item
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let best = i
        if (l < items.length && before(items[l] as Item, items[best] as Item)) best = l
        if (r < items.length && before(items[r] as Item, items[best] as Item)) best = r
        if (best === i) break
        ;[items[best], items[i]] = [items[i] as Item, items[best] as Item]
        i = best
      }
    }
    return top[2]
  }
}
type Item = [number, number, number]
const before = (a: Item, b: Item): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])

/**
 * The corners of a path from `from` to `to` (both included) that avoids `blocked`, or undefined when
 * there is none within the search room.
 */
export function searchPath(
  from: Spot,
  to: Spot,
  blocked: (x: number, z: number) => boolean,
): Spot[] | undefined {
  const x0 = Math.min(from[0], to[0]) - ROOM
  const z0 = Math.min(from[1], to[1]) - ROOM
  const w = Math.ceil((Math.abs(from[0] - to[0]) + 2 * ROOM) / CELL) + 1
  const h = Math.ceil((Math.abs(from[1] - to[1]) + 2 * ROOM) / CELL) + 1
  const centre = (cell: number): Spot => [x0 + (cell % w) * CELL, z0 + Math.floor(cell / w) * CELL]
  const cellOf = (p: Spot): number =>
    Math.min(h - 1, Math.max(0, Math.round((p[1] - z0) / CELL))) * w +
    Math.min(w - 1, Math.max(0, Math.round((p[0] - x0) / CELL)))
  const open = (x: number, z: number): boolean =>
    DMath.hypot(x - from[0], z - from[1]) < FREE_NEAR ||
    DMath.hypot(x - to[0], z - to[1]) < FREE_NEAR ||
    !blocked(x, z)

  const start = cellOf(from)
  const goal = cellOf(to)
  const cost = new Float64Array(w * h).fill(Number.POSITIVE_INFINITY)
  const came = new Int32Array(w * h).fill(-1)
  const heap = new Heap()
  const guess = (cell: number): number => {
    const [x, z] = centre(cell)
    return DMath.hypot(x - to[0], z - to[1])
  }
  cost[start] = 0
  heap.push(guess(start), start)
  while (heap.size > 0) {
    const cell = heap.pop()
    if (cell === goal) break
    const cx = cell % w
    const cz = Math.floor(cell / w)
    for (const [dx, dz, step] of NEIGHBOURS) {
      const nx = cx + dx
      const nz = cz + dz
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue
      const next = nz * w + nx
      const [px, pz] = centre(next)
      if (!open(px, pz)) continue
      const through = (cost[cell] as number) + step * CELL
      if (through >= (cost[next] as number)) continue
      cost[next] = through
      came[next] = cell
      heap.push(through + guess(next), next)
    }
  }
  if ((came[goal] as number) < 0 && start !== goal) return undefined
  const cells: Spot[] = []
  for (let cell = goal; cell >= 0; cell = came[cell] as number) cells.push(centre(cell))
  cells.reverse()
  const path: Spot[] = [from, ...cells.slice(1, -1), to]
  return straighten(path, open)
}

/** Corners only where the way cannot be pulled straight: from each kept point, the furthest one it sees. */
function straighten(path: Spot[], open: (x: number, z: number) => boolean): Spot[] {
  const seen = (a: Spot, b: Spot): boolean => {
    const steps = Math.ceil(DMath.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2))
    for (let k = 1; k < steps; k++) {
      const t = k / steps
      if (!open(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false
    }
    return true
  }
  const out: Spot[] = [path[0] as Spot]
  let at = 0
  while (at < path.length - 1) {
    let far = at + 1
    for (let k = path.length - 1; k > at + 1; k--) {
      if (seen(path[at] as Spot, path[k] as Spot)) {
        far = k
        break
      }
    }
    out.push(path[far] as Spot)
    at = far
  }
  return out
}
