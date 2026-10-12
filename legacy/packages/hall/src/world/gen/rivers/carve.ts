import { DMath } from "../../dmath.ts"
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
import { CIRCUM, CORNERS, centreOf, pointOf, RES } from "../relief/lattice.ts"
import { LEDGE_STEP } from "../relief/shape.ts"

/**
 * The relief cut to the water's contract (terrain v2 §4.1), in place. A flat reach (a river hex
 * under a massif that grading left alone) has its bed carved to `level·TERRACE − 0.6` within BANK
 * of the course line and the rest of its hex raised to at least `level·TERRACE − 0.1`, so its flat
 * patch of water is clipped at the banks; where two hexes meet over a fall the shared edge keeps
 * the upper bed: the lip. A graded reach (grade.ts) is cut as a trench of stairs: its bed a ledge
 * under the ledge its water stands on (or under the one below it, where it falls), and its banks
 * raised to the water's ledge where the ground beside the channel lies lower: every height a ledge,
 * so the trench is flat treads and vertical walls like the rest of the mountain.
 */

/** The bed under the water, below the river's level; the banks are at least this far below the level's top. */
const BED = 0.6
const BANK_TOP = 0.1
/** Ground this much under a graded reach's surface is under water. */
const DEPTH = 0.16
/** Beside the channel, the ground is raised to the water's ledge out to this far (units) past its half-width. */
const BANKS = 1.6
/** A surface falling no faster than this (rise over run) is still water: its banks hold it; a steeper one is a fall. */
const STILL = 0.15
/** The lattice's step: the ground between vertices is a blend of those within this of a point. */
const PITCH = CIRCUM / RES

/** Distance from a point to a polyline. */
function distanceTo(line: readonly Spot[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k] as Spot
    const [bx, bz] = line[k + 1] as Spot
    const len = DMath.pow(bx - ax, 2) + DMath.pow(bz - az, 2)
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len))
    best = Math.min(best, DMath.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t)))
  }
  return best
}

const ceilLedge = (y: number): number => Math.ceil(y / LEDGE_STEP - 1e-6) * LEDGE_STEP
const floorLedge = (y: number): number => Math.floor(y / LEDGE_STEP + 1e-6) * LEDGE_STEP

/** The ledge the water stands on, where it stands on one (a stream on a stair's top or running down its riser), else undefined. */
function ledgeOf(water: number): number | undefined {
  const ledge = Math.round(water / LEDGE_STEP) * LEDGE_STEP
  return Math.abs(water - ledge) < 0.05 ? ledge : undefined
}

/** What a reach asks of the ground at a point: the bed if it lies in the channel, else the height its banks hold. */
type Cut = (x: number, z: number, ground: number) => { bed?: number; bank?: number }

/** A flat reach's cut over one of its hexes, whose top is `top`. */
function flatCut(reach: Reach, top: number): Cut {
  const line = courseLine(reach)
  return (x, z) => (distanceTo(line, x, z) <= BANK ? { bed: top - BED } : { bank: top - BANK_TOP })
}

/**
 * A graded reach's cut: by the nearest stretch of its surface. A channel vertex is cut under the
 * lowest water within a lattice step of it, not just the nearest: the ground between vertices
 * blends them, and where the surface drops faster than the lattice can follow (a river down a ledge's
 * riser) the nearest alone would leave the bed standing over the water below.
 */
function gradedCut(grade: readonly Point3[]): Cut {
  const slopes = gradeSlopes(grade)
  return (x, z, ground) => {
    let best = { d: Number.POSITIVE_INFINITY, y: 0, half: BANK, slope: 0 }
    let lowest = Number.POSITIVE_INFINITY
    for (let k = 0; k + 1 < grade.length; k++) {
      const [a, b] = [grade[k] as Point3, grade[k + 1] as Point3]
      const len = DMath.pow(b[0] - a[0], 2) + DMath.pow(b[2] - a[2], 2)
      const t =
        len === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (z - a[2]) * (b[2] - a[2])) / len))
      const d = DMath.hypot(x - (a[0] + (b[0] - a[0]) * t), z - (a[2] + (b[2] - a[2]) * t))
      if (d <= PITCH) lowest = Math.min(lowest, a[1] + (b[1] - a[1]) * t)
      if (d < best.d) {
        const slope = (slopes[k] as number) * (1 - t) + (slopes[k + 1] as number) * t
        best = { d, y: a[1] + (b[1] - a[1]) * t, half: gradeHalfWidth(slope), slope }
      }
    }
    // A stream runs in a trench of stairs, a ledge deep: flat along the top, a step at the riser.
    const water = Math.min(best.y, lowest)
    if (best.d <= best.half) return { bed: (ledgeOf(water) ?? floorLedge(water)) - LEDGE_STEP }
    // Water holds on a ledge's top, or still, on the ledge over it; a fall has no banks (the riser is its wall).
    const held = ledgeOf(best.y) ?? (best.slope < STILL ? ceilLedge(best.y) : undefined)
    return best.d - best.half <= BANKS && held !== undefined && ground < held - DEPTH ? { bank: held } : {}
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
