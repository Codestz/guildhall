import { HEX_R } from "./growthSpans.ts"

/**
 * How far the land that is up reaches in every direction (the film's framing, growth/orbit.ts): its
 * support at REACH_DIRS evenly spaced directions, so the camera can read how wide the land stands
 * across its view and how deep along it, whatever the orbit's turn. Direction `a` is the unit
 * (sin a, cos a) on the ground, the azimuth's own convention.
 */

export const REACH_DIRS = 24
const STEP = (2 * Math.PI) / REACH_DIRS
const AXES = Array.from({ length: REACH_DIRS }, (_, k) => [Math.sin(k * STEP), Math.cos(k * STEP)] as const)
/** A hex counts as land once it is this far up (growthFrame's `up`): rising, it has hardly shown yet. */
const UP = 0.5
/** The keep's hex stands at the middle from the first frame; this much ground is always held (its hex). */
const KEEP = HEX_R

/** Writes into `out` the reach, from the origin, of the hexes at `spots` ([x, z] pairs) that are `up`, and of the keep. */
export function reachOf(spots: ArrayLike<number>, up: ArrayLike<number>, out: Float32Array): Float32Array {
  out.fill(KEEP)
  for (let h = 0; h < up.length; h++) {
    if ((up[h] as number) < UP) continue
    const x = spots[h * 2] as number
    const z = spots[h * 2 + 1] as number
    for (let k = 0; k < REACH_DIRS; k++) {
      const [ux, uz] = AXES[k] as readonly [number, number]
      out[k] = Math.max(out[k] as number, x * ux + z * uz + HEX_R)
    }
  }
  return out
}

/** How far the land stands from the middle of a camera's frame, world units: across the view and deep along it. */
export interface Extents {
  across: number
  deep: number
}

/** A frame of the land: where the camera looks on the ground (x, z), and the land's extents about it. */
export interface Fit extends Extents {
  x: number
  z: number
}

/** The reach along `angle`, between its sampled directions (linear). */
function supportAt(reach: ArrayLike<number>, angle: number): number {
  const at = (((angle / STEP) % REACH_DIRS) + REACH_DIRS) % REACH_DIRS
  const k = Math.floor(at)
  const a = reach[k] as number
  const b = reach[(k + 1) % REACH_DIRS] as number
  return a + (b - a) * (at - k)
}

/** `fit`'s extents about another middle (x, z) instead (a camera still easing toward it): wider by how far off it is each way. */
export function extentsFrom(fit: Fit, x: number, z: number, azimuth: number): Extents {
  const off = (angle: number) => Math.abs((x - fit.x) * Math.sin(angle) + (z - fit.z) * Math.cos(angle))
  return { across: fit.across + off(azimuth + Math.PI / 2), deep: fit.deep + off(azimuth) }
}

/**
 * The frame that holds the land evenly for a camera at `azimuth` (growth/orbit.ts): its middle
 * across the view and along it, and how far the land stands from there each way. Where the camera
 * looks follows the land's own camera-aligned box, so it sits as centred on screen as the land is.
 */
export function fitAt(reach: ArrayLike<number>, azimuth: number): Fit {
  const across = azimuth + Math.PI / 2
  const near = supportAt(reach, azimuth)
  const far = supportAt(reach, azimuth + Math.PI)
  const left = supportAt(reach, across)
  const right = supportAt(reach, across + Math.PI)
  // Each pair's half-sum is the extent; its half-difference, how far the box's middle is from the origin along that axis.
  const along = (near - far) / 2
  const side = (left - right) / 2
  return {
    across: (left + right) / 2,
    deep: (near + far) / 2,
    x: Math.sin(azimuth) * along + Math.sin(across) * side,
    z: Math.cos(azimuth) * along + Math.cos(across) * side,
  }
}
