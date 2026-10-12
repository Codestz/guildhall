import type { Beat } from "../../world/behaviours.ts"

/**
 * Work beats in flight (world/behaviours.ts): adventurers write them as their routines strike,
 * scene/life/WorkFx.tsx draws them. A fixed ring of plain numbers, so a frame full of blows
 * allocates nothing. A beat is a moment of *working*, never a result: nothing here counts.
 */
export const BEAT_KINDS: readonly Beat[] = [
  "chop",
  "chip",
  "spark",
  "steam",
  "splash",
  "arrow",
  "page",
  "pin",
  "magic",
  "dust",
  "sawdust",
]
const CODE = new Map(BEAT_KINDS.map((kind, i) => [kind, i]))

/** Beats a frame can hold before the oldest unread is dropped. */
export const RING = 64

export const beats = {
  /** Kind codes (index into BEAT_KINDS). */
  kind: new Uint8Array(RING),
  /** Per beat: where it happens (x, y, z), then where it comes from (an arrow's bow). */
  at: new Float32Array(RING * 6),
  /** Beats written so far, ever: a reader keeps its own count and reads what is new. */
  written: 0,
}

/** One beat at (x, y, z); `from` is where an arrow leaves the bow (else the same place). */
export function emitBeat(kind: Beat, x: number, y: number, z: number, fx = x, fy = y, fz = z): void {
  const i = beats.written % RING
  beats.kind[i] = CODE.get(kind) ?? 0
  beats.at[i * 6] = x
  beats.at[i * 6 + 1] = y
  beats.at[i * 6 + 2] = z
  beats.at[i * 6 + 3] = fx
  beats.at[i * 6 + 4] = fy
  beats.at[i * 6 + 5] = fz
  beats.written++
}

/** Heights (world units) each beat happens at when its spot is on the ground. */
export const BEAT_HEIGHT: Record<Beat, number> = {
  chop: 1.1,
  chip: 0.55,
  spark: 0.85,
  steam: 0.95,
  splash: 0.05,
  arrow: 1.35,
  page: 1.45,
  pin: 1.25,
  magic: 2.2,
  dust: 0.2,
  sawdust: 0.7,
}
