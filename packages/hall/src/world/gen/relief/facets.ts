import { CIRCUM, CORNERS, type HeightGrid, RES, ROW } from "./lattice.ts"
import { LEDGE_STEP, TRAIL_STRIDE } from "./shape.ts"
import { onLedge } from "./strata.ts"

/**
 * The relief's ground (relief/shape.ts): every coarse vertex stands on a ledge, from the foot to the
 * summit (the mesh cuts the ramps between two ledges into stairs, strata.ts).
 */

/** The coarse triangle holding lattice point (i, j): its corners' array indices, and the point's barycentric weights on them. */
function triangleAt(
  grid: HeightGrid,
  i: number,
  j: number,
  stride: number,
): { at: [number, number, number]; weights: [number, number, number] } {
  const fi = i / stride
  const fj = j / stride
  const i0 = Math.floor(fi)
  const j0 = Math.floor(fj)
  const u = fi - i0
  const v = fj - j0
  const vertex = (a: number, b: number): number => grid.index((i0 + a) * stride, (j0 + b) * stride)
  return u + v <= 1
    ? { at: [vertex(0, 0), vertex(1, 0), vertex(0, 1)], weights: [1 - u - v, u, v] }
    : { at: [vertex(1, 1), vertex(1, 0), vertex(0, 1)], weights: [u + v - 1, 1 - v, 1 - u] }
}

/**
 * The stairs' own height at lattice point (i, j) (fractional too: a point of the world): where the
 * coarse triangle's corners all stand on ledges, the plane's height rounded to its ledge (the riser is
 * the plane's half-ledge contour, a straight line, which is where the mesh cuts it), else the plane
 * (a rim's half terrace, a trail's shelf). A finer lattice (a river's hex) laid on it is stairs too.
 */
export function stairAt(grid: HeightGrid, i: number, j: number, stride: number): number {
  const { at, weights } = triangleAt(grid, i, j, stride)
  const corners = at.map((v) => (v < 0 ? Number.NaN : (grid.data[v] as number)))
  const plane =
    (corners[0] as number) * weights[0] +
    (corners[1] as number) * weights[1] +
    (corners[2] as number) * weights[2]
  return corners.every(onLedge) ? Math.round(plane / LEDGE_STEP) * LEDGE_STEP : plane
}

/** The stairs' height at a world point, or undefined where the massif owns no triangle there: what the mesh draws. */
export function stairsAt(grid: HeightGrid, x: number, z: number): number | undefined {
  const fj = (z * RES) / ROW
  const h = stairAt(grid, (x * RES) / CIRCUM - fj / 2, fj, TRAIL_STRIDE)
  return Number.isNaN(h) ? undefined : h
}

export interface Shaping {
  /** Vertices the saddle cuts must leave alone: the rim. */
  fixed(i: number, j: number): boolean
  /** Brings the grid to the shaped ground: every coarse vertex on a ledge, the planes between. Call after any cut. */
  apply(): void
}

/** The highest ledge at or under `h`. */
const ledgeBelow = (h: number): number => Math.floor(h / LEDGE_STEP + 1e-6) * LEDGE_STEP
/** The highest ledge a vertex may stand on beside a neighbour at `h`: one ledge above it. */
const within = (h: number): number => ledgeBelow(h + LEDGE_STEP)

/**
 * Lowers the coarse vertices of `grid` that stand on a ledge until every one is at most a ledge above
 * each neighbour (the rim's and a carve's too) and has two neighbours as high as itself (or comes
 * down to the second highest of them): every riser is one ledge high and every ledge at least a
 * coarse triangle wide, so a summit narrows ledge by ledge into a stepped top with no chimney or fin
 * on it. `skip` vertices (the rim, a trail's shelf) are never lowered. Returns the vertices it lowered.
 */
export function limitLevels(grid: HeightGrid, skip: (at: number) => boolean): Set<number> {
  const lowered = new Set<number>()
  for (let moved = true; moved; ) {
    moved = false
    for (let j = grid.j0; j < grid.j0 + grid.height; j++)
      for (let i = grid.i0; i < grid.i0 + grid.width; i++) {
        const at = grid.index(i, j)
        const h = grid.data[at] as number
        if (i % TRAIL_STRIDE !== 0 || j % TRAIL_STRIDE !== 0 || Number.isNaN(h) || skip(at) || !onLedge(h))
          continue
        const near = CORNERS.map(([di, dj]) => grid.get(i + di * TRAIL_STRIDE, j + dj * TRAIL_STRIDE))
          .filter((n) => !Number.isNaN(n))
          .sort((p, q) => q - p)
        const to = Math.min(
          within(near[near.length - 1] ?? h),
          near.length < 2 ? h : ledgeBelow(near[1] as number),
        )
        if (h > to + 1e-6) {
          grid.data[at] = to
          lowered.add(at)
          moved = true
        }
      }
  }
  return lowered
}

/**
 * The ground rules over a massif's grid. The coarse vertices (every `TRAIL_STRIDE`-th) stand on
 * ledges, never more than a ledge from a neighbour (`limitLevels`). The vertices between lie on the
 * stairs of the coarse triangles, so the mesh, `heightAt` (walkers, trees) and the grid all agree, and
 * a ledge's contour is a clean line the trails and rivers can be laid on.
 */
export function shapingOf(grid: HeightGrid, owned: Uint8Array, isRim: (at: number) => boolean): Shaping {
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
      each((i, j, at) => {
        if (coarse(i, j)) grid.data[at] = Math.round((grid.data[at] as number) / LEDGE_STEP) * LEDGE_STEP
      })
      limitLevels(grid, isRim)
      each((i, j, at) => {
        if (coarse(i, j)) return
        const stairs = stairAt(grid, i, j, TRAIL_STRIDE)
        if (!Number.isNaN(stairs)) grid.data[at] = stairs
      })
    },
  }
}
