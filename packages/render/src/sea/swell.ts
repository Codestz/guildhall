/**
 * How a hull rides the water (pure, no three): the sea's swell as the water's shader draws it
 * (water.ts: the sea's vertices rise and fall as one, and two long swells at odd angles shade its
 * face), sampled at a hull's bow, stern and beam for its heave, pitch and roll. A small boat answers
 * every wave at once and bobs on the chop; a big one lags a little and averages the swell over its
 * length. At anchor a hull drifts on the swell's orbit and swings a few degrees about its anchor.
 * Every value is a function of where the hull is and the swell's clock (seconds), so a seek, a pause
 * and a replay show the same motion.
 */

/** The sea's surface offset at `t` (water.ts's vertex bob for the open sea, exactly). */
export function seaBob(t: number): number {
  return 0.05 * (0.6 * Math.sin(t * 1.1) + 0.4 * Math.sin(t * 0.7))
}

/** The two swells of the water's `waveSlope` (direction x, z; wavenumber; height, metres). */
const SWELLS = [
  [0.94, 0.33, 0.31, 0.05],
  [-0.41, 0.91, 0.57, 0.028],
] as const

/** The swell's height at (x, z) at `t`: the shader's slope field integrated (its warp and both swells). */
export function swellHeight(x: number, z: number, t: number): number {
  const px = x + 4 * Math.sin(z * 0.071 + t * 0.13)
  const pz = z + 4 * Math.sin(x * 0.083 - t * 0.11)
  let h = 0
  for (const [dx, dz, k, a] of SWELLS) h += a * Math.sin((dx * px + dz * pz) * k + t * Math.sqrt(9.8 * k))
  return h
}

/** The swell's horizontal orbit at (x, z): the water's surge along the swells, metres (a hull at anchor drifts on it). */
export function swellSurge(x: number, z: number, t: number): [number, number] {
  let sx = 0
  let sz = 0
  for (const [dx, dz, k, a] of SWELLS) {
    const c = a * Math.cos((dx * x + dz * z) * k + t * Math.sqrt(9.8 * k))
    sx += dx * c
    sz += dz * c
  }
  return [sx, sz]
}

/**
 * The wind: from the main swell's quarter (the swell runs before it), as a heading (radians from +x
 * toward +z) the wind blows toward. Sails fill and pennants stream toward it.
 */
export const WIND = Math.atan2(-0.33, -0.94)

/**
 * A sailing ship's pace by its heading against the wind: slowest beating into it, fastest on a broad
 * reach (the wind over the quarter), a little less dead before it. 1 on average round a lap.
 */
export function windPace(heading: number, share = 0.14): number {
  const off = Math.cos(heading - WIND) // 1 running before the wind … -1 into it
  const reach = Math.sin(heading - WIND) ** 2 // across it
  return 1 + share * (0.55 * off + 0.6 * reach - 0.3)
}

/** How a hull answers the water: its size, how hard it is thrown (gain), how slow (lag, s), its chop. */
export interface HullFeel {
  /** Stem to stern and across the beam, metres. */
  length: number
  beam: number
  /** The swell's slope and height, multiplied (the toy sea reads larger than its five centimetres). */
  gain: number
  /** Seconds the hull lags the water (a heavy hull is slow to answer). */
  lag: number
  /** A small boat's own quick bob and rock on the chop, 0 … 1. */
  chop: number
  /** Its own roll (its period, s, and how far, radians). */
  rollPeriod: number
  rollAmp: number
}

export const FEEL = {
  rowboat: { length: 2.4, beam: 1.1, gain: 3.4, lag: 0, chop: 1, rollPeriod: 2.6, rollAmp: 0.05 },
  small: { length: 5.5, beam: 2.2, gain: 2.6, lag: 0.1, chop: 0.5, rollPeriod: 4.2, rollAmp: 0.035 },
  medium: { length: 7.5, beam: 2.8, gain: 2.2, lag: 0.2, chop: 0.3, rollPeriod: 5.2, rollAmp: 0.028 },
  large: { length: 9.4, beam: 3.2, gain: 1.9, lag: 0.3, chop: 0.2, rollPeriod: 6, rollAmp: 0.024 },
  galleon: { length: 11.5, beam: 3.8, gain: 1.7, lag: 0.38, chop: 0.12, rollPeriod: 6.8, rollAmp: 0.02 },
  ghost: { length: 10, beam: 3.4, gain: 1.1, lag: 0.6, chop: 0, rollPeriod: 8, rollAmp: 0.03 },
} as const satisfies Record<string, HullFeel>

export interface Ride {
  /** Up from the sea's rest level, metres. */
  heave: number
  /** Bow down, radians (about the hull's athwartships axis). */
  pitch: number
  /** Port side up (leaning to starboard), radians (about the keel). */
  roll: number
}

/**
 * A hull's ride at (x, z) heading `heading` at `t` (seconds on the swell's clock): heave with the
 * swell under it, pitch and roll from the swell's height at bow, stern and either beam. `phase` makes
 * each hull's own roll and chop its own.
 */
export function rideAt(feel: HullFeel, x: number, z: number, heading: number, t: number, phase = 0): Ride {
  const s = t - feel.lag
  const fx = Math.cos(heading)
  const fz = Math.sin(heading)
  // starboard: the heading turned a quarter toward +z
  const rx = -fz
  const rz = fx
  const L = feel.length / 2
  const B = feel.beam / 2
  const bow = swellHeight(x + fx * L, z + fz * L, s)
  const stern = swellHeight(x - fx * L, z - fz * L, s)
  const port = swellHeight(x - rx * B, z - rz * B, s)
  const star = swellHeight(x + rx * B, z + rz * B, s)
  const mid = (bow + stern + port + star) / 4
  const g = feel.gain
  const c = feel.chop
  // the chop: quick, uneven, a boat's own (none of it on the big hulls)
  const chopUp = c * 0.035 * (Math.sin(t * 2.3 + phase) + 0.6 * Math.sin(t * 3.7 + phase * 2.1))
  const chopRock = c * 0.03 * (Math.sin(t * 2.9 + phase * 1.3) + 0.5 * Math.sin(t * 4.3 - phase))
  const own =
    feel.rollAmp *
    Math.sin((t * Math.PI * 2) / feel.rollPeriod + phase) *
    (0.75 + 0.25 * Math.sin(t * 0.21 + phase * 0.7))
  return {
    heave: seaBob(t) + mid * g + chopUp,
    pitch: Math.atan2(stern - bow, feel.length) * g + chopRock * 0.5,
    roll: Math.atan2(port - star, feel.beam) * g * 1.3 + own + chopRock,
  }
}

/**
 * A hull at anchor (or tied up): it drifts on the swell's orbit and wanders a little about its
 * anchor, swinging a few degrees, all of it faded in by `hold` (0 just arrived … 1 settled).
 */
export function anchorSwing(
  feel: HullFeel,
  x: number,
  z: number,
  t: number,
  phase: number,
  hold: number,
  reach = 1,
): { dx: number; dz: number; yaw: number } {
  const [sx, sz] = swellSurge(x, z, t - feel.lag)
  const g = feel.gain * 1.2
  const w = 0.45 * reach
  const dx = sx * g + w * (Math.sin(t * 0.071 + phase) + 0.4 * Math.sin(t * 0.17 + phase * 2.3))
  const dz = sz * g + w * (Math.sin(t * 0.083 + phase * 1.7) + 0.4 * Math.sin(t * 0.13 - phase))
  const yaw = 0.05 * reach * (Math.sin(t * 0.11 + phase * 0.9) + 0.45 * Math.sin(t * 0.29 + phase * 1.9))
  return { dx: dx * hold, dz: dz * hold, yaw: yaw * hold }
}

/** The lean into a turn: speed (m/s) times the rate of turn (rad/s, + to starboard), kept within `max`. */
export function heelOf(speed: number, yawRate: number, max = 0.16): number {
  const h = 0.32 * speed * yawRate
  return Math.max(-max, Math.min(max, h))
}

/** What a hull's attitude is read from: where it is, which way it points, its way and turn, how settled. */
export interface Afloat {
  x: number
  z: number
  heading: number
  /** m/s along its heading, rad/s to starboard. */
  speed: number
  yawRate: number
  /** 0 under way … 1 settled at anchor (it swings that much). */
  hold: number
  /** Under way, 0 … 1 (the wind heels a ship under sail). */
  way: number
}

export interface Attitude {
  x: number
  z: number
  /** Up from the sea's rest level, metres. */
  heave: number
  heading: number
  /** Bow down, port up (radians). */
  pitch: number
  roll: number
}

/**
 * A hull's whole attitude at `t`: swung at anchor (`hold`; `reach`, how far its cable lets it
 * wander), riding the swell, heeled into its turns by its way and by the wind on its sails, its bow
 * lifting a little at speed.
 */
export function attitudeOf(
  a: Afloat,
  feel: HullFeel,
  t: number,
  phase: number,
  opts: { sails?: boolean; reach?: number } = {},
): Attitude {
  let { x, z, heading } = a
  if (a.hold > 0) {
    const sw = anchorSwing(feel, x, z, t, phase, a.hold, opts.reach ?? 1)
    x += sw.dx
    z += sw.dz
    heading += sw.yaw
  }
  const ride = rideAt(feel, x, z, heading, t, phase)
  const wind = opts.sails ? 0.05 * Math.min(1, a.way) * Math.sin(WIND - heading) : 0
  return {
    x,
    z,
    heave: ride.heave,
    heading,
    pitch: ride.pitch - 0.006 * Math.min(8, Math.abs(a.speed)),
    roll: ride.roll + heelOf(a.speed, a.yawRate) + wind,
  }
}
