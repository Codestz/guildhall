import type { Camera, OrthographicCamera, Vector3 } from "three"

/**
 * How big a deed sigil is on screen, and the room a name chip keeps for it (scene/Sigils.tsx,
 * scene/chips.ts). The medallion stands on SIGIL_BASE, just over the head; the chip's anchor is
 * higher (CHIP_HEIGHT), so close up the medallion fits in the gap between them, and far away (where
 * that gap is a few px) the chip lifts its plate by `sigilRoom` px to clear it. The shader and the
 * declutter compute the same numbers, so the band and the medallion always agree.
 *
 * Near-constant on screen: the medallion is SIGIL_WORLD units across, clamped to MIN–MAX CSS px, so
 * it stays legible on the far overview and never balloons when the camera comes close.
 */
export const SIGIL_WORLD = 1.2
/** Where the medallion stands, world units over the feet: the top of a KayKit head (hats included). */
export const SIGIL_BASE = 2.6
export const SIGIL_MIN_PX = 26
export const SIGIL_MAX_PX = 38
/** Px between the band's bottom (the chip anchor) and the medallion. */
export const SIGIL_GAP_PX = 3
/** Px of gentle bob up and down. */
export const SIGIL_BOB_PX = 1.5
/** Px between the medallion's top and the chip plate above it. */
const ABOVE_PX = 3

/** CSS px one world unit spans at `world` (facing the camera), on a canvas `cssHeight` px tall. */
export function pxPerUnit(camera: Camera, world: Vector3, cssHeight: number): number {
  // Clip w: 1 for an orthographic camera, the distance along the view axis for a perspective one.
  const m = camera.matrixWorldInverse.elements
  const z = (m[2] ?? 0) * world.x + (m[6] ?? 0) * world.y + (m[10] ?? 0) * world.z + (m[14] ?? 0)
  const w = (camera as OrthographicCamera).isOrthographicCamera ? 1 : Math.max(1e-3, -z)
  return ((camera.projectionMatrix.elements[5] ?? 1) * cssHeight * 0.5) / w
}

/** Medallion diameter in px when one world unit spans `pxPerUnit` px. */
export function sizeFor(pxPerUnit: number): number {
  return Math.min(SIGIL_MAX_PX, Math.max(SIGIL_MIN_PX, SIGIL_WORLD * pxPerUnit))
}

/**
 * The px a chip lifts its plate by for a sigil `size` px across: how far the medallion (and a little
 * air) reaches above the chip's anchor, `chipHeight` world units over the feet. 0 when it fits below.
 */
export function sigilRoom(size: number, perUnit: number, chipHeight: number): number {
  const band = SIGIL_GAP_PX + size + SIGIL_BOB_PX + ABOVE_PX
  return Math.max(0, Math.round(band - (chipHeight - SIGIL_BASE) * perUnit))
}
