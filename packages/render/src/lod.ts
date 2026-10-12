/**
 * The static batch's level-of-detail rules, by screen size: how big a bounding sphere looks (its
 * radius in drawing-buffer pixels) picks a tier, with a hysteresis band at every boundary so an
 * instance sitting on one does not flicker between tiers as the camera moves.
 *
 *   pieces    tier 0 (full) → tier 1 (~40 % tris) → tier 2 (~15 %) as they shrink on screen
 *   clusters  (a house, a field, a wood) its pieces near, one merged shell far: one draw, not dozens
 *   shadows   every pass draws clusters as shells and pieces at SHADOW_TIER, camera-independent, so a
 *             cached shadow cascade never changes with the view
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
/** Screen radius (px) under which a piece drops to tier 1, then tier 2. */
export const PIECE_PX: readonly number[] = [40, 12]

/**
 * A cluster's shell, from its parts' coarsest tiers: parts under 0.75 m radius left out (unless all
 * are), the rest merged and simplified as one if that keeps TIER_MIN_AREA of their area.
 */
export const SHELL: Shell = {
  minRadius: 0.75,
  simplify: { ratio: 0.1, error: 0.05, prune: true },
  minArea: TIER_MIN_AREA,
}
/** Screen radius (px) under which a cluster draws as its shell. */
export const SHELL_PX = 90

/** The piece tier the shadow passes draw: the coarsest (a tier only exists if it keeps the outline, TIER_MIN_AREA). */
export const SHADOW_TIER = 2

/** The hysteresis band: a boundary at t px is crossed coarser below t·(1−BAND), finer above t·(1+BAND). */
export const BAND = 0.15

/**
 * The tier for an on-screen radius of `px`, given the tier it had (`previous`) and the boundaries
 * `thresholds` (px, descending: under the k-th it is at least tier k+1). Crossing a boundary takes
 * `band` beyond it in the direction of travel, so it stays put while it sits inside the band.
 */
export function pickTier(px: number, previous: number, thresholds: readonly number[], band = BAND): number {
  let tier = 0
  for (let k = 0; k < thresholds.length; k++) {
    const t = thresholds[k] as number
    const coarser = previous > k ? px < t * (1 + band) : px < t * (1 - band)
    if (!coarser) break
    tier = k + 1
  }
  return tier
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
