import type { Cell } from "../../lands.ts"
import { stairAt } from "./facets.ts"
import type { Massif } from "./field.ts"
import { CORNERS, centreOf, RES } from "./lattice.ts"
import { TRAIL_STRIDE } from "./shape.ts"
import { ramped } from "./trailCarve.ts"

/** A vertex is carved when it differs from the field's own height and from its stairs by more than this (units). */
const CARVED = 0.05

/**
 * Whether a river carved into the hex: a vertex between the coarse ones that is neither the field's
 * own height nor the coarse stairs' (a trail brings those back to the stairs, which a coarse tier
 * draws as they are; a river's bed is finer than a coarse face).
 */
export function carvedHex(massif: Massif, cell: Cell): boolean {
  const { grid, pristine } = massif
  const [ci, cj] = centreOf(cell)
  for (let k = 0; k < 6; k++) {
    const [ai, aj] = CORNERS[k] as readonly [number, number]
    const [bi, bj] = CORNERS[(k + 1) % 6] as readonly [number, number]
    for (let a = 0; a <= RES; a++)
      for (let b = 0; a + b <= RES; b++) {
        const [i, j] = [ci + a * ai + b * bi, cj + a * aj + b * bj]
        const at = grid.index(i, j)
        if (at < 0 || (i % TRAIL_STRIDE === 0 && j % TRAIL_STRIDE === 0)) continue
        const h = grid.data[at] as number
        if (
          Math.abs(h - (pristine[at] as number)) > CARVED &&
          Math.abs(h - stairAt(grid, i, j, TRAIL_STRIDE, ramped(grid))) > CARVED
        )
          return true
      }
  }
  return false
}
