import type { Spot } from "../../layout.ts"
import { BANK, courseLine, TERRACE, type Waterways } from "../../waterways.ts"
import { key } from "../hex.ts"
import type { Relief } from "../relief/index.ts"
import { CORNERS, centreOf, pointOf, RES } from "../relief/lattice.ts"

/**
 * The relief cut to the water's contract (terrain v2 §4.1), in place: wherever a river hex lies
 * under a massif its bed is carved to `level·TERRACE − 0.6` within BANK of the course line, and the
 * rest of the hex is raised to at least `level·TERRACE − 0.1` so its flat patch of water is clipped
 * at the banks. Where two hexes meet over a fall the shared edge keeps the upper bed: the lip.
 */

/** The bed under the water, below the river's level; the banks are at least this far below the level's top. */
const BED = 0.6
const BANK_TOP = 0.1

/** Distance from a point to a polyline. */
function distanceTo(line: readonly Spot[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k] as Spot
    const [bx, bz] = line[k + 1] as Spot
    const len = (bx - ax) ** 2 + (bz - az) ** 2
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len))
    best = Math.min(best, Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t)))
  }
  return best
}

/** Carves every massif's grid to the water. Returns the river hexes it cut, by key. */
export function carveRelief(relief: Relief, waters: Waterways): Set<string> {
  const cut = new Set<string>()
  for (const massif of relief.massifs) {
    const { grid } = massif
    const bed = new Map<number, number>()
    const bank = new Map<number, number>()
    for (const reach of waters.rivers) {
      const line = courseLine(reach)
      for (const hex of reach.hexes) {
        if (!massif.keys.has(key(hex.cell))) continue
        cut.add(key(hex.cell))
        const [ci, cj] = centreOf(hex.cell)
        const top = hex.level * TERRACE
        for (let k = 0; k < 6; k++) {
          const [ai, aj] = CORNERS[k] as readonly [number, number]
          const [bi, bj] = CORNERS[(k + 1) % 6] as readonly [number, number]
          for (let a = 0; a <= RES; a++)
            for (let b = 0; a + b <= RES; b++) {
              const i = ci + a * ai + b * bi
              const j = cj + a * aj + b * bj
              const at = grid.index(i, j)
              if (at < 0 || Number.isNaN(grid.data[at])) continue
              const [x, z] = pointOf(i, j)
              if (distanceTo(line, x, z) <= BANK) bed.set(at, Math.max(bed.get(at) ?? -1e9, top - BED))
              else bank.set(at, Math.max(bank.get(at) ?? -1e9, top - BANK_TOP))
            }
        }
      }
    }
    for (const [at, height] of bank)
      if (!bed.has(at)) grid.data[at] = Math.max(grid.data[at] as number, height)
    for (const [at, height] of bed) {
      grid.data[at] = height
      massif.slope[at] = 0.1
    }
  }
  return cut
}
