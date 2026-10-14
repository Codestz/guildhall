/**
 * A fisher's line (pure): where the float is through the fishing routine (world routines.ts "fish": cast,
 * wait, bite, reel, catch) and the line from the rod's tip to it as a few sagging segments.
 *
 *   Fishing_Cast     the float hangs under the tip on the swing back; let go at 0.7, it flies out in an
 *                    arc and lands (a splash: the cast beat)
 *   Fishing_Idle     it rides the swell, the line slack
 *   Fishing_Bite     it is pulled under and bobs up, twice (the bite beat), the line taut
 *   Fishing_Reeling  it is drawn in, a wake of little dips, taut
 *   Fishing_Catch    it comes in to the quay and out of the water with the fish at 0.62 (the catch beat):
 *                    after that no float and no line, the fish is in the hand
 */

/** The float's state: shown, how far out (0 under the tip, 1 where it lands), its height off the water. */
export interface FloatState {
  shown: boolean
  /** 0 hanging under the rod's tip, 1 out where it was cast. */
  out: number
  /** Metres over (+) or under (−) its rest on the water; in flight, the arc's height over the straight. */
  dy: number
  /** In the air (cast out, or lifted out): its height is the tip's eased to the water's, plus `dy`. */
  flying: boolean
  /** Line sag as a share of its length (slack at rest, taut on a bite or reeling). */
  sag: number
}

/** Metres the float hangs under the tip before the cast. */
export const HANG = 0.45
/** When Fishing_Cast lets go and Fishing_Catch lifts the fish out (routines.ts). */
export const CAST_AT = 0.7
export const CATCH_AT = 0.62

const NONE: FloatState = { shown: false, out: 0, dy: 0, flying: false, sag: 0 }

/** The float at `phase` (0–1) of a fishing clip; `t` (seconds) drives the swell. Other clips: none. */
export function floatAt(clip: string, phase: number, t: number): FloatState {
  const swell = Math.sin(t * 2.1) * 0.012 + Math.sin(t * 3.7 + 1) * 0.006
  switch (clip) {
    case "Fishing_Cast": {
      if (phase < CAST_AT) return { shown: true, out: 0, dy: 0, flying: true, sag: 0 }
      const f = Math.min(1, (phase - CAST_AT) / (1 - CAST_AT))
      // out along an arc that lands at f = 1
      return { shown: true, out: ease(f), dy: 1.2 * 4 * f * (1 - f), flying: f < 1, sag: 0.02 }
    }
    case "Fishing_Idle":
      return { shown: true, out: 1, dy: swell, flying: false, sag: 0.09 }
    case "Fishing_Bite": {
      // two tugs under, the second deeper
      const tug = bump(phase, 0.15, 0.32) * 0.06 + bump(phase, 0.45, 0.62) * 0.09
      return { shown: true, out: 1, dy: swell - tug, flying: false, sag: 0.015 }
    }
    case "Fishing_Reeling":
      return {
        shown: true,
        out: 1 - 0.12 * phase,
        dy: -Math.abs(Math.sin(phase * Math.PI * 4)) * 0.03,
        flying: false,
        sag: 0.01,
      }
    case "Fishing_Catch": {
      if (phase >= CATCH_AT) return NONE
      const f = phase / CATCH_AT
      // drawn in to the quay, then up out of the water
      return {
        shown: true,
        out: 0.88 * (1 - ease(f)),
        dy: f > 0.75 ? ((f - 0.75) / 0.25) * 0.4 : 0,
        flying: false,
        sag: 0.005,
      }
    }
    default:
      return NONE
  }
}

/** A bump 0 → 1 → 0 over [a, b] of x. */
function bump(x: number, a: number, b: number): number {
  if (x <= a || x >= b) return 0
  return Math.sin(((x - a) / (b - a)) * Math.PI)
}

const ease = (x: number) => 1 - (1 - x) * (1 - x)

type V3 = readonly [number, number, number]

/**
 * The float's place (world metres) from the rod's tip, the spot where it lands (`far`, on the water)
 * and the near end of the cast (`near`, the water by the quay), at `state`.
 */
export function floatPoint(
  state: FloatState,
  tip: V3,
  near: V3,
  far: V3,
  out: number[] = [0, 0, 0],
): number[] {
  if (state.out <= 0 && state.flying) {
    // hanging under the tip
    out[0] = tip[0]
    out[1] = tip[1] - HANG
    out[2] = tip[2]
    return out
  }
  const f = state.out
  const water = near[1] + (far[1] - near[1]) * f
  if (state.flying) {
    // from the tip out to where it lands, over an arc
    out[0] = tip[0] + (far[0] - tip[0]) * f
    out[2] = tip[2] + (far[2] - tip[2]) * f
    out[1] = tip[1] - HANG + (water - (tip[1] - HANG)) * f + state.dy
    return out
  }
  out[0] = near[0] + (far[0] - near[0]) * f
  out[2] = near[2] + (far[2] - near[2]) * f
  out[1] = water + state.dy
  return out
}

/** Segments a line is drawn with. */
export const LINE_SEGMENTS = 6

/**
 * The line from `a` (the tip) to `b` (the float) as `segments` pieces sagging by `sag` of its length at
 * the middle (a parabola), written as segment pairs (x, y, z, x, y, z per segment) into `out` at
 * `offset` floats; the floats written.
 */
export function sagLine(
  a: V3,
  b: V3,
  sag: number,
  out: Float32Array,
  offset: number,
  segments = LINE_SEGMENTS,
): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const drop = sag * len
  let o = offset
  const point = (f: number) => {
    out[o++] = a[0] + (b[0] - a[0]) * f
    out[o++] = a[1] + (b[1] - a[1]) * f - drop * 4 * f * (1 - f)
    out[o++] = a[2] + (b[2] - a[2]) * f
  }
  for (let k = 0; k < segments; k++) {
    point(k / segments)
    point((k + 1) / segments)
  }
  return o - offset
}
