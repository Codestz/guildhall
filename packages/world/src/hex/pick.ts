/**
 * Picking a tile by hex maths (no meshes): where a ray (from the camera through the pointer) first
 * meets the ground, a height field, and the hex that point falls in. The ray is marched through the
 * band of heights the island has, a quarter of a tile at a time, and the first step that lands under
 * the ground is refined by bisection; the hit is that step's point, just inside the ground, so a ray
 * that meets the side of a raised tile picks the raised tile, never the low one in front of it.
 */
import { type Hex, hexAt } from "./grid.ts"

export interface GroundHit extends Hex {
  /** Where the ray meets the ground (metres). */
  x: number
  y: number
  z: number
}

export interface PickOpts {
  /** A tile's size, centre to corner (metres): world (x, z) / tile is the hex grid's space. */
  tile: number
  /** The lowest and highest the ground goes (metres): the band the ray is marched through. */
  minY: number
  maxY: number
  /** The march's step along the ray (metres; default a quarter tile). */
  step?: number
  /** How far along the ray to look at most (metres). */
  far?: number
}

/** How many halvings refine the crossing (a quarter tile to under a millimetre). */
const BISECT = 12

/**
 * The first ground the ray from `origin` along `dir` meets (null: none within `far`, or it looks away
 * from the band). `groundAt(x, z)` is the ground's height there; `dir` need not be of unit length.
 */
export function pickGround(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  groundAt: (x: number, z: number) => number,
  opts: PickOpts,
): GroundHit | null {
  const len = Math.hypot(dir[0], dir[1], dir[2])
  if (!(len > 0)) return null
  const dx = dir[0] / len
  const dy = dir[1] / len
  const dz = dir[2] / len
  const [ox, oy, oz] = origin
  const far = opts.far ?? 1e4
  // the stretch of the ray inside the band of heights
  let s0 = 0
  let s1 = far
  if (oy > opts.maxY) {
    if (dy >= 0) return null
    s0 = (opts.maxY - oy) / dy
  }
  if (dy < 0) s1 = Math.min(s1, (opts.minY - oy) / dy)
  if (s0 > s1) return null
  const step = opts.step ?? opts.tile / 4
  const below = (s: number) => oy + dy * s <= groundAt(ox + dx * s, oz + dz * s)
  if (below(s0)) return hit(s0)
  let prev = s0
  for (let s = s0 + step; ; s += step) {
    const at = Math.min(s, s1)
    if (below(at)) {
      // the crossing lies between the last step above and this one under
      let lo = prev
      let hi = at
      for (let k = 0; k < BISECT; k++) {
        const mid = (lo + hi) / 2
        if (below(mid)) hi = mid
        else lo = mid
      }
      return hit(hi)
    }
    if (at >= s1) return null
    prev = at
  }

  function hit(s: number): GroundHit {
    const x = ox + dx * s
    const z = oz + dz * s
    const { q, r } = hexAt(x / opts.tile, z / opts.tile)
    // hexAt's rounding gives −0 on some borders (q = −r − s): a hex is the same either way, a key is not
    return { x, y: oy + dy * s, z, q: q + 0, r: r + 0 }
  }
}
