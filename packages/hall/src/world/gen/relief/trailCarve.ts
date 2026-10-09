import type { Cell } from "../../lands.ts"
import { key } from "../hex.ts"
import { planeAt } from "./facets.ts"
import { CIRCUM, CORNERS, centreOf, type HeightGrid, RES, ROW } from "./lattice.ts"
import { at, ijOf, type Lattice, SLOPE } from "./trailSearch.ts"

/**
 * Carving a trail into the relief (terrain v2 §3.2, "smooth, then carve"): the trail's vertices take
 * the heights it was planned at, and beside each leg the uphill vertex of the triangle on that side is
 * cut to the leg's height, so a flat shelf (two triangles' width) runs across the slope with the hill
 * standing above it and the ground falling away below. Hairpins get a landing, the end a pad for the
 * lookout. The vertices between the coarse ones are brought back to the coarse planes afterwards,
 * so the mesh, `heightAt` and the walkers agree. Vertices carry flags (`flagsOf`) for the mesh to paint.
 */

/** A vertex on a trail's shelf, and on a stair leg (steeper than a walking trail: painted as stone). */
export const ON_TRAIL = 1
export const ON_STAIRS = 2

/** What the carve works on: the massif's own arrays. */
export interface Ground {
  grid: HeightGrid
  slope: Float32Array
}

const flags = new WeakMap<HeightGrid, Uint8Array>()
/** A massif's trail flags by lattice vertex (`ON_TRAIL`, `ON_STAIRS`); undefined where no trail runs. */
export const flagsOf = (grid: HeightGrid): Uint8Array | undefined => flags.get(grid)

/** A planned trail to carve: the lattice vertices from the head, and the height of each. */
export interface Plan {
  chain: readonly number[]
  heights: readonly number[]
  /** Chain positions that turn back on themselves (they get a landing). */
  hairpins: readonly number[]
}

/** The unit steps of the lattice, for finding the vertices beside a leg. */
const SIX = CORNERS

/** The two vertices that touch both ends of a leg (the corners of the triangles either side of it). */
function beside(lattice: Lattice, a: number, b: number): number[] {
  const { grid, stride } = lattice
  const [bi, bj] = ijOf(grid, b)
  const found: number[] = []
  for (const [di, dj] of SIX) {
    const n = at(grid, a, di * stride, dj * stride)
    if (n < 0 || n === b) continue
    const [ni, nj] = ijOf(grid, n)
    const [ei, ej] = [ni - bi, nj - bj]
    if (SIX.some(([si, sj]) => si * stride === ei && sj * stride === ej)) found.push(n)
  }
  return found
}

/**
 * Carves the plan into the ground; returns the vertices it changed. The head (chain[0]) is the rim
 * and stays as it is. The shelf is flagged (`flagsOf`).
 */
export function carve(ground: Ground, lattice: Lattice, plan: Plan, pad: boolean): Set<number> {
  const { grid } = ground
  const paths = flags.get(grid) ?? new Uint8Array(grid.data.length)
  flags.set(grid, paths)
  const { chain, heights } = plan
  const changed = new Set<number>()
  const pitch = (CIRCUM / RES) * lattice.stride
  const ordinary = (v: number): boolean =>
    v >= 0 &&
    !Number.isNaN(grid.data[v] as number) &&
    !lattice.rim.has(v) &&
    !lattice.blocked.has(v) &&
    ((paths[v] as number) & ON_TRAIL) === 0 &&
    !chain.includes(v)
  // A vertex beside several legs takes the one that matters most: the pad's, a landing's, then the highest leg's.
  const cuts = new Map<number, { to: number; rank: number }>()
  const cut = (v: number, to: number, rank: number): void => {
    const held = cuts.get(v)
    if (!held || rank > held.rank || (rank === held.rank && to > held.to)) cuts.set(v, { to, rank })
  }
  chain.forEach((v, k) => {
    const to = heights[k] as number
    if (k > 0) grid.data[v] = to
    const steep =
      Math.abs(to - (heights[k - 1] ?? to)) / pitch > SLOPE ||
      Math.abs((heights[k + 1] ?? to) - to) / pitch > SLOPE
    paths[v] = (paths[v] as number) | ON_TRAIL | (steep ? ON_STAIRS : 0)
    changed.add(v)
  })
  for (let k = 0; k + 1 < chain.length; k++) {
    const a = chain[k] as number
    const b = chain[k + 1] as number
    const level = ((heights[k] as number) + (heights[k + 1] as number)) / 2
    // The uphill side is cut into the hill; where neither is free the leg runs on its own.
    const sides = beside(lattice, a, b)
      .filter(ordinary)
      .sort((p, q) => (grid.data[q] as number) - (grid.data[p] as number) || p - q)
    if (sides[0] !== undefined) cut(sides[0], level, 1)
  }
  for (const k of plan.hairpins) {
    const v = chain[k] as number
    for (const [di, dj] of SIX) {
      const n = at(grid, v, di * lattice.stride, dj * lattice.stride)
      if (ordinary(n) && (grid.data[n] as number) > (heights[k] as number)) cut(n, heights[k] as number, 2)
    }
  }
  if (pad) {
    const v = chain[chain.length - 1] as number
    for (const [di, dj] of SIX) {
      const n = at(grid, v, di * lattice.stride, dj * lattice.stride)
      if (ordinary(n)) cut(n, heights[heights.length - 1] as number, 3)
    }
  }
  for (const [v, { to }] of cuts) {
    grid.data[v] = to
    paths[v] = (paths[v] as number) | ON_TRAIL
    changed.add(v)
  }
  return changed
}

/**
 * After carving: the vertices between the coarse ones of every hex a carve touched go back to the
 * coarse planes (a hex a river carved is left as its bed made it), and the steepness the mesh
 * paints by is read again round the changes.
 */
export function settle(
  ground: Ground,
  lattice: Lattice,
  cells: readonly Cell[],
  changed: ReadonlySet<number>,
  river: ReadonlySet<string>,
): void {
  const { grid, slope } = ground
  const { stride } = lattice
  const near = (ci: number, cj: number, visit: (i: number, j: number) => void): void => {
    for (let dj = -RES; dj <= RES; dj++)
      for (let di = -RES; di <= RES; di++) if (Math.abs(di + dj) <= RES) visit(ci + di, cj + dj)
  }
  for (const cell of cells) {
    if (river.has(key(cell))) continue
    const [ci, cj] = centreOf(cell)
    let touched = false
    near(ci, cj, (i, j) => {
      if (changed.has(grid.index(i, j))) touched = true
    })
    if (!touched) continue
    near(ci, cj, (i, j) => {
      const v = grid.index(i, j)
      if (v < 0 || Number.isNaN(grid.data[v] as number) || lattice.rim.has(v)) return
      if (i % stride === 0 && j % stride === 0) return
      const plane = planeAt(grid, i, j, stride)
      if (!Number.isNaN(plane)) grid.data[v] = plane
    })
  }
  const pitch = CIRCUM / RES
  for (const v of changed) {
    const [ci, cj] = ijOf(grid, v)
    for (let dj = -stride; dj <= stride; dj++)
      for (let di = -stride; di <= stride; di++) {
        const n = grid.index(ci + di, cj + dj)
        if (n < 0 || Number.isNaN(grid.data[n] as number)) continue
        let steep = 0
        for (const [si, sj] of SIX) {
          const m = grid.index(ci + di + si, cj + dj + sj)
          if (m >= 0 && !Number.isNaN(grid.data[m] as number))
            steep = Math.max(steep, Math.abs((grid.data[m] as number) - (grid.data[n] as number)) / pitch)
        }
        slope[n] = steep
      }
  }
}

/** Whether a point stands on or beside a trail's shelf (within about a vertex of it): nothing grows or lies there. */
export function onShelf(massif: Pick<Ground, "grid">, x: number, z: number): boolean {
  const { grid } = massif
  const paths = flags.get(grid)
  if (!paths) return false
  const fj = (z * RES) / ROW
  const fi = (x * RES) / CIRCUM - fj / 2
  const [i, j] = [Math.round(fi), Math.round(fj)]
  for (let dj = -2; dj <= 2; dj++)
    for (let di = -2; di <= 2; di++) {
      const v = grid.index(i + di, j + dj)
      if (v >= 0 && (paths[v] as number) !== 0) return true
    }
  return false
}
