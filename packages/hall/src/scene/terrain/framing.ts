import type { Camera } from "three"

/**
 * Framing for tall terrain (terrain v2 §5): the camera's numbers that depend on how high the ground
 * rises, kept out of CameraRig. Nothing here changes a world without relief (`peak` 0).
 */

/** The isometric camera's elevation (CameraRig's ISO_DIR): a point `h` up shows `h · COS` higher on screen, a point `r` further `r · SIN`. */
const ISO_Y = 0.93 / Math.hypot(1, 0.93, 1)
const SIN = ISO_Y
const COS = Math.sqrt(1 - ISO_Y * ISO_Y)
/** Room round the island at the furthest zoom-out, as a share of what it needs. */
const MARGIN = 1.08
/** The free camera stays this far above the ground it is over, world units. */
export const CAMERA_CLEARANCE = 3

/**
 * The furthest orthographic zoom-out: `across` (what the island's width alone asks for) or, when
 * the ground rises, what holds its reach and its height in the screen's height. The look at the
 * whole island aims at half the peak's height, so the island's near edge below and its summit above
 * need the same room.
 */
export function widestZoom(across: number, screenHeight: number, reach: number, peak: number): number {
  if (peak <= 0) return across
  const needed = (reach * SIN + (peak * COS) / 2) * MARGIN
  return Math.min(across, screenHeight / 2 / needed)
}

/** Lifts a camera that is below `CAMERA_CLEARANCE` over the ground out of it (never lowers one). */
export function aboveGround(camera: Camera, heightAt: (x: number, z: number) => number): void {
  const floor = heightAt(camera.position.x, camera.position.z) + CAMERA_CLEARANCE
  if (camera.position.y < floor) camera.position.y = floor
}
