import type { Camera, OrthographicCamera, PerspectiveCamera } from "three"

/**
 * Detail tiers for the static world (research world-gen-v2 §5.2–5.3): a region of the island
 * draws its pieces at full detail (NEAR, the research's T0) or as coarse copies (FAR, its T2;
 * render/simplify.ts) by how big it is on screen. Tiers are numbered as the research numbers them,
 * so a layer may index its geometry by tier; T1 (shadow-box detail) is not drawn yet.
 *
 * A coarse copy moves its surface at most FAR_ERROR world units, so it may only stand in where
 * that is under MAX_PIXELS on screen: the swap is below what the eye can resolve, not a pop.
 * Measured on React at `?gen=2` (overview): 0.1 / 0.5 px draws 1.31M triangles, 0.2 / 1 px 1.19M;
 * the finer pair is kept, for detail. Pure: the scene's tier pass (scene/tiers.ts) calls it per
 * region per frame.
 */

export const NEAR = 0
export const FAR = 2
export type DetailTier = typeof NEAR | typeof FAR

/** The most a far tier's coarse copy moves a piece's surface, world units. */
export const FAR_ERROR = 0.1
/** The most that error may show as, CSS pixels. */
export const MAX_PIXELS = 0.5
/** Below this many CSS pixels per world unit a region goes far… */
export const FAR_BELOW = MAX_PIXELS / FAR_ERROR
/** …and above this it comes back near: the gap keeps a zoom resting at the edge from flickering. */
export const NEAR_ABOVE = FAR_BELOW * 1.2

/**
 * How many CSS pixels a world unit spans at a region (a sphere at `x, y, z`, `radius` across):
 * the zoom on an orthographic camera, else by distance to the region's nearest point.
 */
export function pixelsPerUnit(
  camera: Camera,
  height: number,
  x: number,
  y: number,
  z: number,
  radius: number,
): number {
  const ortho = camera as OrthographicCamera
  if (ortho.isOrthographicCamera) return (height * ortho.zoom) / Math.max(1e-6, ortho.top - ortho.bottom)
  const perspective = camera as PerspectiveCamera
  const p = camera.position
  const distance = Math.max(1, Math.hypot(p.x - x, p.y - y, p.z - z) - radius)
  return height / (2 * Math.tan((perspective.fov * Math.PI) / 360) * distance)
}

/** A region's tier given its current one and its pixels per unit (with the hysteresis gap). */
export function tierAt(current: DetailTier, pixels: number): DetailTier {
  if (current === NEAR) return pixels < FAR_BELOW ? FAR : NEAR
  return pixels > NEAR_ABOVE ? NEAR : FAR
}
