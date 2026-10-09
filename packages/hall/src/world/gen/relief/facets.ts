import type { Cell } from "../../lands.ts"
import { CORNERS, centreOf, type HeightGrid, RES } from "./lattice.ts"
import { LEDGE_STEP, type ReliefStyle, strideOf } from "./style.ts"

/**
 * The chunky styles' ground (relief/style.ts): the lattice is meshed every `strideOf`-th vertex, and the
 * vertices between are set to the planes of the coarse triangles, so the mesh, `heightAt` (walkers,
 * trees, rocks) and the grid all agree and nothing floats or sinks. Strata also quantise the coarse
 * vertices to ledges. A hex a river carved is the exception: its bed is finer than a coarse face, so
 * the mesh keeps its full lattice (`isFaceted` tells).
 */

const onStride = (i: number, j: number, stride: number): boolean => i % stride === 0 && j % stride === 0

/** The height of the coarse triangle's plane at lattice vertex (i, j), NaN where a corner is not owned. */
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

/** Whether a hex's vertices all lie on its coarse planes (no river bed was cut into it). */
export function isFaceted(grid: HeightGrid, cell: Cell, stride: number): boolean {
  const [ci, cj] = centreOf(cell)
  for (let k = 0; k < 6; k++) {
    const [ai, aj] = CORNERS[k] as readonly [number, number]
    const [bi, bj] = CORNERS[(k + 1) % 6] as readonly [number, number]
    for (let a = 0; a <= RES; a++)
      for (let b = 0; a + b <= RES; b++) {
        const i = ci + a * ai + b * bi
        const j = cj + a * aj + b * bj
        // The hex's own edge is left out: a rim there is the neighbour's top, which the mesh meets as it is.
        if (
          a + b < RES &&
          !onStride(i, j, stride) &&
          Math.abs(grid.get(i, j) - planeAt(grid, i, j, stride)) > 0.05
        )
          return false
      }
  }
  return true
}

export interface Shaping {
  /** Vertices the saddle cuts must leave alone: the rim, and the ones between the coarse ones. */
  fixed(i: number, j: number): boolean
  /** Brings the grid to the style's ground: ledges for strata, then the planes between. Call after any cut. */
  apply(): void
}

/** The style's ground rules over a massif's grid, or undefined for the default (nothing to do). */
export function shapingOf(
  style: ReliefStyle,
  grid: HeightGrid,
  owned: Uint8Array,
  isRim: (at: number) => boolean,
): Shaping | undefined {
  if (style === "current") return undefined
  const stride = strideOf(style)
  const each = (visit: (i: number, j: number, at: number) => void): void => {
    for (let j = grid.j0; j < grid.j0 + grid.height; j++)
      for (let i = grid.i0; i < grid.i0 + grid.width; i++) {
        const at = grid.index(i, j)
        if (owned[at] && !isRim(at)) visit(i, j, at)
      }
  }
  return {
    fixed: (i, j) => isRim(grid.index(i, j)) || !onStride(i, j, stride),
    apply() {
      if (style === "b")
        each((i, j, at) => {
          if (onStride(i, j, stride))
            grid.data[at] = Math.round((grid.data[at] as number) / LEDGE_STEP) * LEDGE_STEP
        })
      each((i, j, at) => {
        if (onStride(i, j, stride)) return
        const plane = planeAt(grid, i, j, stride)
        if (!Number.isNaN(plane)) grid.data[at] = plane
      })
    },
  }
}

/**
 * Sculpted peaks: heights above two thirds of the peak fall away faster from it (the peak itself
 * kept), so a summit stands as a horn rather than a dome.
 */
export function sharpen(height: number, peak: number): number {
  const knee = 0.67 * peak
  if (height <= knee || peak <= knee) return height
  return knee + (peak - knee) * ((height - knee) / (peak - knee)) ** 1.9
}
