import { BRIDGE_CLEAR, clearOf, type Wall } from "./bridgeWalls.ts"

/**
 * The idle ships' lap round an island (scene/Ships.tsx): an ellipse round its keep, sailed round and
 * round. A bridge leaving the island crosses the lap, and a ship never crosses a bridge, so where
 * one does the ship sails back and forth along the longest stretch of the lap that is clear instead.
 * Pure.
 */

/** A lap's samples, for finding the bridges' shadows on it. */
const SAMPLES = 360
const TAU = Math.PI * 2

/**
 * The part of the lap a ship sails: the whole of it (`span` 2π) when no bridge crosses, else the
 * longest clear arc from angle `start` (radians, as `Math.atan2(z / rz, x / rx)`) going on by `span`.
 */
export interface Track {
  start: number
  span: number
}

/** Where a ship is on its track, and which way it is going along the lap (on a whole lap, always 1: the ship's own way). */
export interface Along {
  angle: number
  /** 1 going on with the angle, -1 coming back. */
  dir: 1 | -1
}

/** The track of a lap `rx` × `rz` round the keep, with `walls` (in the island's own coordinates) crossing it. */
export function trackOf(rx: number, rz: number, walls: readonly Wall[], margin = BRIDGE_CLEAR): Track {
  const free = Array.from({ length: SAMPLES }, (_, i) => {
    const a = (i / SAMPLES) * TAU
    return clearOf(walls, Math.cos(a) * rx, Math.sin(a) * rz, margin)
  })
  if (free.every(Boolean)) return { start: 0, span: TAU }
  // The longest run of clear samples, going round (it may wrap past the last sample).
  let best = { from: 0, length: 0 }
  for (let i = 0; i < SAMPLES; i++) {
    if (!free[i] || free[(i + SAMPLES - 1) % SAMPLES]) continue
    let length = 0
    while (length < SAMPLES && free[(i + length) % SAMPLES]) length++
    if (length > best.length) best = { from: i, length }
  }
  // A sample's own width off each end: the ship stops a step short of the wall's margin.
  const length = Math.max(0, best.length - 3)
  return { start: ((best.from + 1.5) / SAMPLES) * TAU, span: (length / SAMPLES) * TAU }
}

/**
 * Where the ship is once it has sailed `travelled` radians of lap (any sign, any size). On a whole lap
 * that is the angle itself; on an arc it eases out to one end and back, so it comes about slowly.
 */
export function trackAt(track: Track, travelled: number): Along {
  if (track.span >= TAU - 1e-9) return { angle: travelled, dir: 1 }
  if (track.span <= 0) return { angle: track.start, dir: 1 }
  const x = ((travelled % (2 * track.span)) + 2 * track.span) % (2 * track.span)
  const out = x < track.span
  const u = out ? x / track.span : 2 - x / track.span
  return { angle: track.start + track.span * ((1 - Math.cos(Math.PI * u)) / 2), dir: out ? 1 : -1 }
}
