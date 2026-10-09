import type { Spot } from "../../layout.ts"
import {
  BANK,
  courseLine,
  gradeHalfWidth,
  gradeSlopes,
  type Point3,
  type Reach,
  TERRACE,
  type Waterways,
} from "../../waterways.ts"
import { key } from "../hex.ts"
import type { Relief } from "../relief/index.ts"
import { CORNERS, centreOf, pointOf, RES } from "../relief/lattice.ts"

/**
 * The relief cut to the water's contract (terrain v2 §4.1), in place. A flat reach (a river hex
 * under a massif that grading left alone) has its bed carved to `level·TERRACE − 0.6` within BANK
 * of the course line and the rest of its hex raised to at least `level·TERRACE − 0.1`, so its flat
 * patch of water is clipped at the banks; where two hexes meet over a fall the shared edge keeps
 * the upper bed: the lip. A graded reach (grade.ts) has its bed cut down its slope, `DEPTH` under
 * its surface within the channel's half-width, and its banks held `FREEBOARD` over it beside the
 * channel — a levee where the slope falls away — easing back into the natural ground beyond.
 */

/** The bed under the water, below the river's level; the banks are at least this far below the level's top. */
const BED = 0.6
const BANK_TOP = 0.1
/** A graded reach's bed under its surface, and its banks over it. */
const DEPTH = 0.16
const FREEBOARD = 0.34
/** Past the channel the banks hold for SHOULDER, then ease out to the natural ground over EASE. */
const SHOULDER = 1.6
const EASE = 2.4

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

/** What a reach asks of the ground at a point: the bed if it lies in the channel, else the height its banks hold. */
type Cut = (x: number, z: number, ground: number) => { bed?: number; bank?: number }

/** A flat reach's cut over one of its hexes, whose top is `top`. */
function flatCut(reach: Reach, top: number): Cut {
  const line = courseLine(reach)
  return (x, z) => (distanceTo(line, x, z) <= BANK ? { bed: top - BED } : { bank: top - BANK_TOP })
}

/** A graded reach's cut: by the nearest stretch of its surface. */
function gradedCut(grade: readonly Point3[]): Cut {
  const slopes = gradeSlopes(grade)
  return (x, z, ground) => {
    let best = { d: Number.POSITIVE_INFINITY, y: 0, half: BANK }
    for (let k = 0; k + 1 < grade.length; k++) {
      const [a, b] = [grade[k] as Point3, grade[k + 1] as Point3]
      const len = (b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2
      const t =
        len === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (z - a[2]) * (b[2] - a[2])) / len))
      const d = Math.hypot(x - (a[0] + (b[0] - a[0]) * t), z - (a[2] + (b[2] - a[2]) * t))
      if (d < best.d) {
        const slope = (slopes[k] as number) * (1 - t) + (slopes[k + 1] as number) * t
        best = { d, y: a[1] + (b[1] - a[1]) * t, half: gradeHalfWidth(slope) }
      }
    }
    if (best.d <= best.half) return { bed: best.y - DEPTH }
    const ease = 1 - Math.min(1, Math.max(0, (best.d - best.half - SHOULDER) / EASE))
    const held = best.y + FREEBOARD
    return ease > 0 && held > ground ? { bank: ground + (held - ground) * ease } : {}
  }
}

/** Carves every massif's grid to the water. Returns the river hexes it cut, by key. */
export function carveRelief(relief: Relief, waters: Waterways): Set<string> {
  const cut = new Set<string>()
  for (const massif of relief.massifs) {
    const { grid } = massif
    const bed = new Map<number, number>()
    const bank = new Map<number, number>()
    for (const reach of waters.rivers) {
      const graded = reach.grade ? gradedCut(reach.grade) : undefined
      for (const hex of reach.hexes) {
        if (!massif.keys.has(key(hex.cell))) continue
        cut.add(key(hex.cell))
        const [ci, cj] = centreOf(hex.cell)
        const cutHex = graded ?? flatCut(reach, hex.level * TERRACE)
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
              const asked = cutHex(x, z, grid.data[at] as number)
              if (asked.bed !== undefined) bed.set(at, Math.max(bed.get(at) ?? -1e9, asked.bed))
              else if (asked.bank !== undefined) bank.set(at, Math.max(bank.get(at) ?? -1e9, asked.bank))
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
