import { CIRCUM, type HeightGrid, RES, ROW } from "./lattice.ts"

/**
 * A cheap ambient-occlusion bake: the ground's concavity at every lattice vertex, the mean height of
 * the ring of vertices `REACH` steps round it minus its own (world units; positive in a gully or at
 * the foot of a wall, negative on a ridge or a ledge's lip). Computed once per grid, when the first
 * mesh asks (after the rivers and trails have carved it), and read by the mesh's vertex colours (paint.ts).
 */

/** The ring's radius in lattice steps (about 2.9 units). */
const REACH = 2
const RING = [
  [REACH, 0],
  [0, REACH],
  [-REACH, REACH],
  [-REACH, 0],
  [0, -REACH],
  [REACH, -REACH],
] as const

const baked = new WeakMap<HeightGrid, Float32Array>()

function bake(grid: HeightGrid): Float32Array {
  const curve = new Float32Array(grid.data.length)
  for (let j = grid.j0; j < grid.j0 + grid.height; j++)
    for (let i = grid.i0; i < grid.i0 + grid.width; i++) {
      const here = grid.get(i, j)
      if (Number.isNaN(here)) continue
      let sum = 0
      let n = 0
      for (const [di, dj] of RING) {
        const h = grid.get(i + di, j + dj)
        if (!Number.isNaN(h)) {
          sum += h
          n++
        }
      }
      // Beside the edge of what the massif owns there is no ring to read.
      curve[grid.index(i, j)] = n >= 4 ? sum / n - here : 0
    }
  return curve
}

/** The concavity at the lattice vertex nearest a world point (0 off the grid). */
export function curvatureAt(grid: HeightGrid, x: number, z: number): number {
  let curve = baked.get(grid)
  if (!curve) {
    curve = bake(grid)
    baked.set(grid, curve)
  }
  const fj = (z * RES) / ROW
  const fi = (x * RES) / CIRCUM - fj / 2
  const at = grid.index(Math.round(fi), Math.round(fj))
  return at < 0 ? 0 : (curve[at] as number)
}
