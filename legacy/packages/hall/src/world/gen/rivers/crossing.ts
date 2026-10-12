import { DMath } from "../../dmath.ts"
import { type Cell, cellToWorld, HEX_SCALE } from "../../lands.ts"
import { step } from "../hex.ts"

/**
 * Where a road may cross a river by the kit's stone bridge (building_bridge_A, drawn at HEX_SCALE on
 * its river hex's level): its deck runs the hex along the road's axis, rising from its ends (just
 * above the hex's top) to a crown at the middle. A crossing is clear when the ground under that
 * deck's footprint stays below it, and the ground a step past either end is the deck's own end's
 * height: the bridge meets both banks at the road's level and never sinks into the land.
 */

/** The deck's height above its hex's top, by distance from the middle (units): the piece's own profile. */
const PROFILE: readonly (readonly [number, number])[] = [
  [0, 1.25],
  [2.4, 1.25],
  [2.9, 1.2],
  [3.4, 0.92],
  [3.85, 0.58],
  [4.3, 0.3],
  [4.81, 0.14],
]
/** Half the deck's length and width. */
export const HALF_LENGTH = 0.962 * HEX_SCALE
const HALF_WIDTH = 0.667 * HEX_SCALE * 0.9622
/** How far the ground at a deck's end may differ from it, and may stand above the deck anywhere under it. */
const SLACK = 0.5
/** Where past a deck's ends the banks are sampled (units from the middle). */
const BANK = HALF_LENGTH + 0.6

export function deckAbove(t: number): number {
  const d = Math.abs(t)
  for (let i = 1; i < PROFILE.length; i++) {
    const [d1, y1] = PROFILE[i] as readonly [number, number]
    const [d0, y0] = PROFILE[i - 1] as readonly [number, number]
    if (d <= d1) return y0 + ((y1 - y0) * (d - d0)) / (d1 - d0)
  }
  return (PROFILE.at(-1) as readonly [number, number])[1]
}

/** The points a crossing samples: (distance along the axis, across it), for a bridge on `cell` over road axis `axis`. */
function samples(cell: Cell, axis: number): { t: number; s: number; x: number; z: number }[] {
  const [cx, cz] = cellToWorld(cell)
  const [nx, nz] = cellToWorld(step(cell, axis))
  const len = DMath.hypot(nx - cx, nz - cz)
  const [ux, uz] = [(nx - cx) / len, (nz - cz) / len]
  const out: { t: number; s: number; x: number; z: number }[] = []
  for (const t of [-BANK, -HALF_LENGTH, -3.6, -2.4, -1.2, 0, 1.2, 2.4, 3.6, HALF_LENGTH, BANK])
    for (const s of [-HALF_WIDTH, 0, HALF_WIDTH])
      out.push({ t, s, x: cx + ux * t - uz * s, z: cz + uz * t + ux * s })
  return out
}

/** How a bridge on `cell` (a road along `axis`) sits on `ground`: undefined where it is clear, else what is wrong. */
export function crossingFault(
  cell: Cell,
  axis: number,
  ground: (x: number, z: number) => number,
): string | undefined {
  const [cx, cz] = cellToWorld(cell)
  const top = ground(cx, cz)
  for (const { t, x, z } of samples(cell, axis)) {
    const rise = ground(x, z) - top
    if (Math.abs(t) > HALF_LENGTH) {
      if (Math.abs(rise - deckAbove(HALF_LENGTH)) > SLACK) return `bank ${rise.toFixed(2)} at ${t.toFixed(1)}`
    } else if (rise > deckAbove(t) + 0.05) return `ground ${rise.toFixed(2)} over the deck at ${t.toFixed(1)}`
  }
  return undefined
}
