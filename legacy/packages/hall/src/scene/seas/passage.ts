import type { PrStatus } from "@guildhall/core"

/**
 * What every voyage on the sea shares (scene/seas/fleet.ts, pulls.ts): the passages' lengths, the
 * harbour's places — (side, out) from the quay, `side` along the shore and `out` away from the
 * island — and the little maths of getting from one to another. No three, no React.
 */

/** Story ms each passage takes. */
export const SAIL_OUT_MS = 16_000
export const ARRIVE_MS = 9_000
export const MERGE_MS = 12_000
export const LEAVE_MS = 14_000
export const GALLEON_MS = 11_000
/** How long a merged ship stays moored, and the galleon at anchor, before they go. */
export const MOORED_MS = 60_000
export const GALLEON_STAY_MS = 120_000

export type Hull = "cargo" | "pr" | "galleon"

/** The colour a pull request's pennant flies: its status while open, then how it ended. */
export type Mark = PrStatus | "merged" | "closed"

export interface Voyage {
  hull: Hull
  /** Stable while the ship is on the water: the event (push, release) or the pull request it is. */
  key: string
  /** Harbour frame (see `Harbour`), heading in radians (bow +z, as the Kenney ships face). */
  side: number
  out: number
  heading: number
  /** 1 on the water, 0 gone: shrinks and sinks below the horizon as it goes. */
  shown: number
  /** Under way (sails full) rather than at anchor or moored: the bob and lean follow it. */
  sailing: boolean
  crates: number
  /** A pull request's ship: its pennant, and how big its diff is (0-1; the hull grows with it). */
  mark?: Mark
  size?: number
}

/** A point in the harbour's frame. */
export interface Spot {
  side: number
  out: number
}

// ── the harbour's places, (side, out) from the quay ──

/** The quay's west side, where merged ships moor (a berth per ship, further along the shore). */
export const BERTH: Spot = { side: -14, out: -3 }
export const BERTH_STEP = -8
/** The quay's east side, where cargo is loaded. */
export const LOADING: Spot = { side: 9, out: -6 }
/** Offshore anchorage for open pull requests: berths in rows of four, going west. */
export const ANCHORAGE: Spot = { side: -32, out: 26 }
export const ANCHORAGE_STEP = -14
export const ANCHORAGE_ROW = 15
export const ANCHORAGE_ROW_LENGTH = 4
/** Where the galleon drops anchor. */
export const GALLEON: Spot = { side: 26, out: 28 }
/** Over the horizon: where ships come from and go to. */
export const FAR = 120

/** Where anchorage berth `slot` lies. */
export function berthSpot(slot: number): Spot {
  return {
    side: ANCHORAGE.side + (slot % ANCHORAGE_ROW_LENGTH) * ANCHORAGE_STEP,
    out: ANCHORAGE.out + Math.floor(slot / ANCHORAGE_ROW_LENGTH) * ANCHORAGE_ROW,
  }
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const easeOut = (t: number): number => 1 - (1 - t) ** 3
export const easeInOut = (t: number): number => t * t * (3 - 2 * t)
/** 1 → 0 over the last `fraction` of a passage. */
export const fadeOut = (p: number, fraction = 0.3): number => clamp01((1 - p) / fraction)

/** Heading from one harbour point toward another (bow +z). */
function course(fromSide: number, fromOut: number, toSide: number, toOut: number): number {
  return Math.atan2(toSide - fromSide, toOut - fromOut)
}

export interface Leg {
  from: Spot
  to: Spot
}

/** A point along a leg at progress `p` (already eased), heading along it. */
export function along({ from, to }: Leg, p: number): Pick<Voyage, "side" | "out" | "heading"> {
  return {
    side: lerp(from.side, to.side, p),
    out: lerp(from.out, to.out, p),
    heading: course(from.side, from.out, to.side, to.out),
  }
}

/** Turns from `a` to `b` the short way round. */
export function turn(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + d * t
}
