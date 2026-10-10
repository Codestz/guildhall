import type { HeightGrid } from "./lattice.ts"
import { CORNERS, RES } from "./lattice.ts"
import { onLedge } from "./strata.ts"

/**
 * Where a hex of the finest lattice (a river's bed, n = 4) meets one of the coarse (n = 2): a hex
 * edge the coarse side has two segments on and the fine side four. Over a segment of the coarse edge
 * `a`..`b` the fine side has a vertex `m` at its middle, and three triangles meet there: the coarse
 * one (`a`, `b`, its apex), and the fine side's two (`a`, `m` and `m`, `b`, each with its own apex).
 * When all six vertices stand on ledges (and none on a trail's shelf) the seam is stairs too: the
 * coarse triangle is split at `m` (its two halves share the fine triangles' edges, so both sides cut
 * the same riser in the same place) and no ramp is needed. Otherwise the seam stays a ramp (mesh.ts).
 *
 * Lattice points are integer pairs (the lattice's i, j); `turn` rotates a step by a sixth of a turn.
 */

export type Lat = readonly [number, number]
/** Whether a vertex (by its array index) stands on a trail's shelf, which is drawn as a ramp. */
type Ramped = (at: number) => boolean

/** A lattice step turned a sixth of a turn one way (+1) or the other (-1). */
export const turn = ([i, j]: Lat, side: 1 | -1): Lat => (side > 0 ? [-j, i + j] : [i + j, -i])

const plus = (a: Lat, b: Lat): Lat => [a[0] + b[0], a[1] + b[1]]
const minus = (a: Lat, b: Lat): Lat => [a[0] - b[0], a[1] - b[1]]
const twice = (a: Lat): Lat => [2 * a[0], 2 * a[1]]
const same = (a: Lat, b: Lat): boolean => a[0] === b[0] && a[1] === b[1]

/** A coarse vertex: both coordinates even (the lattice's coarse stride is two). */
const isCoarse = ([i, j]: Lat): boolean => i % 2 === 0 && j % 2 === 0

/** The six vertices of a coarse segment from `a` in the fine step `d`, its coarse apex on `side`: a, m, b, the coarse apex, the fine apexes beside a–m and m–b. */
export function seamPoints(a: Lat, d: Lat, side: 1 | -1): Lat[] {
  const m = plus(a, d)
  const away = turn(d, side > 0 ? -1 : 1)
  return [a, m, plus(m, d), plus(a, twice(turn(d, side))), plus(a, away), plus(m, away)]
}

const plain = (grid: HeightGrid, points: readonly Lat[], ramped: Ramped): boolean =>
  points.every(([i, j]) => onLedge(grid.get(i, j)) && !ramped(grid.index(i, j)))

/** Whether the seam over the coarse segment `a`–`b`, its coarse triangle's apex `c`, is stairs. */
export function coarseSeamStairs(grid: HeightGrid, a: Lat, b: Lat, c: Lat, ramped: Ramped): boolean {
  const d: Lat = [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2]
  const side = same(minus(c, a), twice(turn(d, 1))) ? 1 : -1
  return plain(grid, seamPoints(a, d, side), ramped)
}

/** Whether the seam is stairs, from a fine triangle's edge `u`–`v` on it and that triangle's apex `x`, inside the fine hex. */
export function fineSeamStairs(grid: HeightGrid, u: Lat, v: Lat, x: Lat, ramped: Ramped): boolean {
  const [a, m] = isCoarse(u) ? [u, v] : [v, u]
  const d = minus(m, a)
  // The fine apex lies on the side opposite the coarse one: x = a + turn(d, -side).
  const side = same(minus(x, a), turn(d, -1)) ? 1 : -1
  return plain(grid, seamPoints(a, d, side), ramped)
}

/**
 * Whether the seam edge `u`–`v` (a fine step or a coarse segment on a hex edge between the two
 * lattices) is stairs. `sizeAt` gives the lattice (4 or 2) of the hex holding a lattice point.
 */
export function steppedSeam(
  grid: HeightGrid,
  u: Lat,
  v: Lat,
  sizeAt: (at: Lat) => number,
  ramped: Ramped,
): boolean {
  const d = minus(v, u)
  const coarse = isCoarse(u) && isCoarse(v)
  const half: Lat = coarse ? [d[0] / 2, d[1] / 2] : d
  // The apexes either side: one in a fine hex, the other in a coarse one, or this is no seam of ours.
  const sides = ([1, -1] as const).map((side) => plus(u, coarse ? twice(turn(half, side)) : turn(half, side)))
  const fine = sides.find((at) => sizeAt(at) === RES)
  const near = sides.find((at) => sizeAt(at) === RES / 2)
  if (!fine || !near) return false
  return coarse ? coarseSeamStairs(grid, u, v, near, ramped) : fineSeamStairs(grid, u, v, fine, ramped)
}

/**
 * The heights a fine hex's in-between edge vertices take where a coarser hex lies across the edge
 * (`coarseOf(d)`, the size of the hex across edge d): on the coarse edge, a straight line between
 * its vertices, unless the seam is stairs, whose vertex keeps its own ledge height. By lattice point.
 */
export function snapsOf(
  grid: HeightGrid,
  [ci, cj]: Lat,
  n: number,
  coarseOf: (d: number) => number,
  ramped: Ramped,
): Map<string, number> {
  const snapped = new Map<string, number>()
  if (n < 2) return snapped
  for (let d = 0; d < 6; d++) {
    const coarse = coarseOf(d)
    if (coarse >= n) continue
    const [ai, aj] = CORNERS[d] as Lat
    const [bi, bj] = CORNERS[(d + 1) % 6] as Lat
    /** The vertex a of the way along the edge, and the one a row in beside the step from a to a + 1. */
    const edgeAt = (a: number): Lat => [ci + (n - a) * ai + a * bi, cj + (n - a) * aj + a * bj]
    const innerAt = (a: number): Lat => [ci + (n - 1 - a) * ai + a * bi, cj + (n - 1 - a) * aj + a * bj]
    const gap = n / coarse
    for (let a = 1; a < n; a++) {
      if (a % gap === 0) continue
      const lo = Math.floor(a / gap) * gap
      if (n === RES && gap === 2 && fineSeamStairs(grid, edgeAt(lo), edgeAt(lo + 1), innerAt(lo), ramped))
        continue
      const t = (a - lo) / gap
      const [i, j] = edgeAt(a)
      snapped.set(`${i},${j}`, grid.get(...edgeAt(lo)) * (1 - t) + grid.get(...edgeAt(lo + gap)) * t)
    }
  }
  return snapped
}
