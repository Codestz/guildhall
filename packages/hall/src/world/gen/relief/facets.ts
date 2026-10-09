import type { HeightGrid } from "./lattice.ts"
import { LEDGE_SHARE, LEDGE_STEP, TRAIL_STRIDE } from "./shape.ts"

/**
 * The relief's ground (relief/shape.ts): below the top ledge it stands on ledges (the mesh cuts the
 * ramps between two ledges into stairs, strata.ts), above it the sculpted height is kept, the peak.
 */

/**
 * The height of the coarse triangle's plane at lattice vertex (i, j), NaN where a corner is not
 * owned. The trails (trailCarve.ts) are laid on every `stride`-th vertex and bring the ones
 * between back to these planes.
 */
export function planeAt(grid: HeightGrid, i: number, j: number, stride: number): number {
  const fi = i / stride
  const fj = j / stride
  const i0 = Math.floor(fi)
  const j0 = Math.floor(fj)
  const u = fi - i0
  const v = fj - j0
  const at = (a: number, b: number): number => grid.get((i0 + a) * stride, (j0 + b) * stride)
  return u + v <= 1
    ? at(0, 0) * (1 - u - v) + at(1, 0) * u + at(0, 1) * v
    : at(1, 1) * (u + v - 1) + at(1, 0) * (1 - v) + at(0, 1) * (1 - u)
}

export interface Shaping {
  /** Vertices the saddle cuts must leave alone: the rim. */
  fixed(i: number, j: number): boolean
  /** Brings the grid to the shaped ground: ledges up to the top ledge, the planes between. Call after any cut. */
  apply(): void
}

/**
 * The ground rules over a massif's grid. The coarse vertices (every `TRAIL_STRIDE`-th) stand on
 * ledges up to the top ledge and keep their sculpted height above it (the faceted peak); the
 * vertices between them lie on the coarse triangles' planes, so the mesh, `heightAt` (walkers,
 * trees, rocks) and the grid all agree, a ledge's contour is a clean line the trails and rivers can
 * be laid on, and the peak's faces are big flat planes.
 */
export function shapingOf(
  grid: HeightGrid,
  owned: Uint8Array,
  isRim: (at: number) => boolean,
  ledgeTop: number,
): Shaping {
  const each = (visit: (i: number, j: number, at: number) => void): void => {
    for (let j = grid.j0; j < grid.j0 + grid.height; j++)
      for (let i = grid.i0; i < grid.i0 + grid.width; i++) {
        const at = grid.index(i, j)
        if (owned[at] && !isRim(at)) visit(i, j, at)
      }
  }
  const coarse = (i: number, j: number): boolean => i % TRAIL_STRIDE === 0 && j % TRAIL_STRIDE === 0
  return {
    fixed: (i, j) => isRim(grid.index(i, j)) || !coarse(i, j),
    apply() {
      // Idempotent: a ledge height stays. Above the top ledge the coarse vertices keep their sculpted height.
      each((i, j, at) => {
        const h = grid.data[at] as number
        if (coarse(i, j) && h <= ledgeTop + LEDGE_STEP / 2)
          grid.data[at] = Math.min(ledgeTop, Math.round(h / LEDGE_STEP) * LEDGE_STEP)
      })
      each((i, j, at) => {
        if (coarse(i, j)) return
        const plane = planeAt(grid, i, j, TRAIL_STRIDE)
        if (!Number.isNaN(plane)) grid.data[at] = plane
      })
    },
  }
}

/**
 * Sculpted peaks: heights above two thirds of the peak fall away faster from it (the peak itself
 * kept), so a summit stands as a horn rather than a dome.
 */
export function sharpen(height: number, peak: number, kneeShare = 0.67): number {
  const knee = kneeShare * peak
  if (height <= knee || peak <= knee) return height
  return knee + (peak - knee) * ((height - knee) / (peak - knee)) ** 1.9
}

/**
 * The top ledge: a share of what the footprint reached, since the slope limit clips the height
 * asked. The stairs end there and the sculpted peak rises above it.
 */
export function ledgeTopOf(grid: HeightGrid): number {
  let reach = 0
  for (const h of grid.data) if (h > reach) reach = h
  return Math.max(LEDGE_STEP, Math.round((LEDGE_SHARE * reach) / LEDGE_STEP) * LEDGE_STEP)
}
