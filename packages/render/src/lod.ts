/**
 * The static batch's level-of-detail rules, by what a switch would change on screen, in CSS pixels
 * (so the DPR governor never moves where anything switches):
 *
 *   pieces    tier 0 (full) → tier 1 (~40 % tris) → tier 2 (~15 %): a tier comes in as its own
 *             deviation from the full piece (the simplifier's measure, lodGeometry.ts) falls to ~2 px
 *   clusters  (a house, a field, a wood) its pieces near, one merged shell far, as all the shell gives up
 *             (left-out trim, the parts' coarser tiers, the merge's own simplification) falls to ~2 px
 *   detail    small pieces shrink away round their own origin as their radius falls from 4 px to 2.5
 *   shadows   every pass draws clusters as shells and pieces at SHADOW_TIER, camera-independent, so a
 *             cached shadow cascade never changes with the view
 *
 * No switch is a swap: across SWAP_PX the two levels crossfade (a screen-space dither, lodFade.ts), and
 * a piece leaving shrinks rather than blinks out. The band is the gap between where a switch starts
 * and where it is done; a camera sitting inside it holds a steady mix, so nothing flickers back and forth.
 */
import type { Shell, Simplify } from "./lodGeometry.ts"

/** Piece tiers past the full one, coarsest last: at most `ratio` of the triangles, within `error`. */
export const PIECE_TIERS: readonly Simplify[] = [
  { ratio: 0.4, error: 0.05 },
  { ratio: 0.15, error: 0.12 },
]
/** A tier that keeps more than this share of the tier before it is not worth its memory; it reuses that one. */
export const TIER_MIN_SAVING = 0.85
/** A tier must keep this share of the full piece's surface area, or it has lost outline; it reuses the one before. */
export const TIER_MIN_AREA = 0.8
/**
 * Detail: a piece whose bounding radius is under DETAIL_RADIUS metres (grass, crops, flowers, small
 * rocks, barrels, logs). The main view shrinks it away as its screen radius falls through
 * DETAIL_FADE_PX; shadows still cast it.
 */
export const DETAIL_RADIUS = 0.9

/**
 * A cluster's shell, from its parts' coarsest tiers: parts under 0.75 m radius left out (unless all
 * are), the rest merged and simplified as one if that keeps TIER_MIN_AREA of their area.
 */
export const SHELL: Shell = {
  minRadius: 0.75,
  simplify: { ratio: 0.1, error: 0.05, prune: true },
  minArea: TIER_MIN_AREA,
}
/** The piece tier the shadow passes draw: the coarsest (a tier only exists if it keeps the outline, TIER_MIN_AREA). */
export const SHADOW_TIER = 2

/**
 * A coarser stand-in's deviation on screen (CSS px) over which it crossfades in: none of it at the
 * upper end, all of it at the lower. The deviation is the worst vertex's, so the typical one is well
 * under a pixel. Measured from the hero view to the farthest zoom: half a pixel to one drew ~1.7x the
 * triangles of the old radius switches and doubled the frame time; this band draws what they did, and
 * a narrow band keeps few pieces drawn twice mid-crossfade.
 */
export const SWAP_PX: readonly [number, number] = [2, 2.8]
/**
 * A detail piece's screen radius (CSS px) over which it shrinks away: full size above, gone below.
 * Where the old cut dropped it whole (4 px radius), it now starts to shrink.
 */
export const DETAIL_FADE_PX: readonly [number, number] = [2.5, 4]

/**
 * How far into a band [lo, hi] a falling `value` has come: 0 at or above hi, 1 at or below lo,
 * linear between (the weight of what comes in as it falls).
 */
export function fadeWeight(value: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(1, Math.max(0, (hi - value) / (hi - lo)))
}

/**
 * The radius in pixels of a sphere of `radius` at `distance` from a perspective camera whose
 * projection's y scale is `projectionY` (1 / tan(fov/2)) on a drawing buffer `height` px high.
 * Infinite when the camera is inside it.
 */
export function screenRadius(radius: number, distance: number, projectionY: number, height: number): number {
  return distance <= radius ? Number.POSITIVE_INFINITY : (radius * projectionY * height) / (2 * distance)
}

/** What the last main pass drew, per tier. */
export interface LodCounts {
  /** Piece instances drawn at tier 0, 1, 2 (cluster parts of near clusters included). */
  tiers: number[]
  /** Clusters near enough for their pieces (on screen or not), and shells drawn. */
  near: number
  shells: number
}
