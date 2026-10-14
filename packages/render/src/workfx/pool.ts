/**
 * The work FX's bookkeeping (pure): the particle slots and when each is free again, a burst's seeds,
 * and whether a burst is worth spawning at all (near the camera and on the screen).
 *
 * Determinism: a burst's particles take their seeds from (kind, where, `seed`), never from a counter
 * or the clock, so the same beat at the same spot draws the same particles whenever it is replayed.
 * When the caller passes no seed the beat's time on the FX clock stands in (cosmetic: a seek does not
 * bring back particles spawned before it).
 */
import { KIND, MAX_BURST, type WorkKind } from "./kinds.ts"

/** Particles alive at most (the one draw's instances). */
export const MAX_PARTICLES = 256
/** Bursts spawn only this near the camera (metres)... */
export const NEAR_M = 35
/** ...and thin out over this range of distance as the camera pulls away (no pops on a zoom). */
export const FADE_M: [number, number] = [26, 40]

/** 32-bit integer mix (murmur3's finaliser). */
export function mix32(x: number): number {
  let h = x >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A burst's seed: its kind, where it is (to the centimetre) and the caller's seed. */
export function burstSeed(kind: WorkKind, at: readonly [number, number, number], seed: number): number {
  let h = mix32(KIND[kind].id + 0x51ed)
  for (const v of at) h = mix32(h ^ (Math.round(v * 100) | 0))
  return mix32(h ^ (Math.floor(seed) | 0) ^ mix32(Math.round((seed % 1) * 1e6)))
}

/** The burst's `k`th particle's seed, in [0, 1) on a 2^22 grid (exact in the shader's float). */
export function particleSeed(burst: number, k: number): number {
  return (mix32(burst ^ Math.imul(k + 1, 0x9e3779b9)) >>> 10) / 4194304
}

/** How many particles a burst of `kind` spawns at `scale` (a bigger blow throws a few more). */
export function burstCount(kind: WorkKind, scale = 1): number {
  const n = Math.round(KIND[kind].count * Math.min(1.5, Math.max(0.5, scale)))
  return Math.max(1, Math.min(MAX_BURST, n))
}

/** The slots: when each one's particle is gone (FX clock, s), and where to look for a free one next. */
export interface Slots {
  free: Float64Array
  cursor: number
}

export function createSlots(n = MAX_PARTICLES): Slots {
  return { free: new Float64Array(n), cursor: 0 }
}

/**
 * Up to `n` slots free at `now`, the ones longest free first round the ring (a live particle is never
 * taken: when too few are free the burst is smaller, or nothing). Marks them taken until `until`.
 */
export function takeSlots(slots: Slots, n: number, now: number, until: number): number[] {
  const out: number[] = []
  const size = slots.free.length
  let k = 0
  for (; k < size && out.length < n; k++) {
    const i = (slots.cursor + k) % size
    if ((slots.free[i] as number) <= now) {
      out.push(i)
      slots.free[i] = until
    }
  }
  slots.cursor = (slots.cursor + k) % size
  return out
}

/** How many particles are alive at `now`. */
export function aliveAt(slots: Slots, now: number): number {
  let n = 0
  for (const f of slots.free) if (f > now) n++
  return n
}

/**
 * Whether a burst at `at` is worth spawning: within `near` metres of the eye and on the screen (with a
 * margin, as a burst spreads), by the camera's view-projection matrix (column-major, three's `elements`).
 */
export function inView(
  at: readonly [number, number, number],
  eye: readonly [number, number, number],
  viewProjection: ArrayLike<number>,
  near = NEAR_M,
  margin = 0.15,
): boolean {
  const dx = at[0] - eye[0]
  const dy = at[1] - eye[1]
  const dz = at[2] - eye[2]
  if (dx * dx + dy * dy + dz * dz > near * near) return false
  const m = viewProjection
  const e = (i: number) => m[i] as number
  const x = e(0) * at[0] + e(4) * at[1] + e(8) * at[2] + e(12)
  const y = e(1) * at[0] + e(5) * at[1] + e(9) * at[2] + e(13)
  const w = e(3) * at[0] + e(7) * at[1] + e(11) * at[2] + e(15)
  if (w <= 1e-6) return false
  const lim = 1 + margin
  return Math.abs(x / w) <= lim && Math.abs(y / w) <= lim
}
