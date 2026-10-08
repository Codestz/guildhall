import { portOf, type Shore } from "../../world/archipelago.ts"
import { hash01 } from "../events/common.ts"

/**
 * Ships between the islands (scene/archipelago/Ferries.tsx): now and then a ship leaves one island's
 * coast and crosses to another's, along a clear crossing (world/archipelago.ts `crossingsOf`). Each
 * ferry sails one voyage a period, then lies in port (unseen) until its next; which crossing, and
 * which way, is a hash of the ferry and the voyage. All of it from the story's clock: a paused
 * probe shot, or a seek, shows the same sea.
 */
export const FERRIES = 3
/** Each ferry sets out once this often, story seconds. */
export const PERIOD_S = 140
/** World units a second under sail. */
export const SPEED = 4.5
/** Share of a voyage spent rising from the quay at the start, and sinking out of sight at the end. */
const FADE = 0.08
/** How far a crossing bows sideways, as a share of its length. */
const BOW = 0.1

export interface FerryAt {
  x: number
  z: number
  /** Bow direction (bow +z, as scene/Ships.tsx). */
  heading: number
  /** 0 just out of port or just in, 1 under way: ships rise and sink at the quays. */
  shown: number
}

/**
 * Where ferry `ferry` is at story time `t` (seconds), into `out`; false while it lies in port.
 * `islands` are [home, ...far islands], `crossings` index pairs into them.
 */
export function ferryAt(
  islands: readonly Shore[],
  crossings: readonly (readonly [number, number])[],
  ferry: number,
  t: number,
  out: FerryAt,
): boolean {
  if (crossings.length === 0) return false
  const local = t - (ferry * PERIOD_S) / FERRIES - hash01(ferry * 31 + 7) * 20
  const voyage = Math.floor(local / PERIOD_S)
  const s = local - voyage * PERIOD_S
  const seed = ferry * 7919 + voyage * 104_729
  const pair = crossings[Math.floor(hash01(seed) * crossings.length)] as readonly [number, number]
  const reverse = hash01(seed + 1) < 0.5
  const a = islands[reverse ? pair[1] : pair[0]] as Shore
  const b = islands[reverse ? pair[0] : pair[1]] as Shore
  const [fx, fz] = portOf(a, b)
  const [tx, tz] = portOf(b, a)
  const length = Math.hypot(tx - fx, tz - fz)
  const duration = Math.min(PERIOD_S - 10, length / SPEED)
  if (s < 0 || s > duration) return false
  const u = s / duration
  // A quadratic curve, bowed to one side (alternating by voyage), so crossings don't read as rails.
  const side = (hash01(seed + 2) < 0.5 ? -1 : 1) * BOW * length
  const cx = (fx + tx) / 2 + (-(tz - fz) / (length || 1)) * side
  const cz = (fz + tz) / 2 + ((tx - fx) / (length || 1)) * side
  const v = 1 - u
  out.x = v * v * fx + 2 * v * u * cx + u * u * tx
  out.z = v * v * fz + 2 * v * u * cz + u * u * tz
  const dx = 2 * v * (cx - fx) + 2 * u * (tx - cx)
  const dz = 2 * v * (cz - fz) + 2 * u * (tz - cz)
  out.heading = Math.atan2(dx, dz)
  out.shown = Math.min(1, Math.min(u, 1 - u) / FADE)
  return true
}
