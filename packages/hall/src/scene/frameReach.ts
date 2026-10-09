import { peakOf } from "../world/peak.ts"
import { reachOf, type World } from "../world/world.ts"
import { outreachOf } from "./nature/shoreTiles.ts"
import { widestZoom } from "./terrain/framing.ts"

/**
 * How much ground the hall's orthographic cameras can show, so the sea and the camera's own depth
 * range are sized from what is seen, not from the island: a portrait phone fits an island by width
 * and sees several times its reach above and below it, and the growth film pulls back over the
 * whole of it. Beyond the sea's last square a top-down view finds the sky dome (the blue disc and
 * the hard edge of the phone and film shots), and ground nearer the camera than the camera's own
 * depth range (CameraRig `back`) is clipped (the band across the film's bottom).
 *
 * The cameras look down the hall's isometric diagonal (CameraRig ISO_DIR (1, 0.93, 1)).
 */

export const ELEVATION = Math.atan2(0.93, Math.SQRT2)
const SIN = Math.sin(ELEVATION)
const COS = Math.cos(ELEVATION)

/** The film's frame of the land up (growth/orbit.ts): the island's radius from its middle, at most this many reaches. */
const FILM_RADIUS = 1.25
/** The camera's target stays within this share of the reach of the origin (the film's centre, a look). */
const TARGET = 0.5
/** Room beyond the frame's far corner, and beyond its nearest ground. */
const MARGIN = 1.15
/** The camera's near plane clears the nearest ground by this much more, world units. */
const ROOM = 30

/** Orthographic zoom that fits the keep (CameraRig `base`, before a portrait screen closes in). */
export const baseZoomOf = (width: number, height: number): number => Math.min(width / 44, height / 31)

interface Screen {
  width: number
  height: number
}

/** What of a world the framing depends on: how far its land reaches, how far its sea tiles do, how high it rises. */
export interface Land {
  reach: number
  outreach: number
  peak: number
}

export const landOf = (world: World): Land => ({
  reach: reachOf(world),
  outreach: outreachOf(world),
  peak: peakOf(world),
})

/** The furthest orthographic zoom-out of the controls (CameraRig `widest`). */
export function widestOf(screen: Screen, land: Land): number {
  const across = (baseZoomOf(screen.width, screen.height) * 0.42 * 0.5) / land.outreach
  return widestZoom(across, screen.height, land.reach, land.peak)
}

/** The film's zoom for a land `radius` wide (growth/orbit.ts): the whole of it, a little tighter on a portrait phone. */
export const filmZoom = (screen: Screen, radius: number): number =>
  Math.min(screen.width / 1.75, screen.height / 1.4) / radius

/** What a frame of `zoom` shows of the ground round its target: the far corner's distance, and how deep along the view. */
export function groundOf(screen: Screen, zoom: number): { radius: number; depth: number } {
  const across = screen.width / 2 / zoom
  const down = screen.height / 2 / zoom / SIN
  return { radius: Math.hypot(across, down), depth: down * COS }
}

/** The widest ground any orthographic framing of `land` shows on `screen`: the controls' zoom-out, or the film's. */
function widestGround(screen: Screen, land: Land): { radius: number; depth: number } {
  const zoom = Math.min(widestOf(screen, land), filmZoom(screen, land.reach * FILM_RADIUS))
  return groundOf(screen, zoom)
}

/** The radius from the origin the sea must cover so no orthographic view shows past it. */
export function viewReachOf(screen: Screen, land: Land): number {
  return (land.reach * TARGET + widestGround(screen, land).radius) * MARGIN
}

/** The orthographic camera stands this far back from its target (a multiple of the sea tiles' reach). */
export const ORTHO_BACK = 220

/**
 * How far back the orthographic camera stands: the usual distance, or further when the ground nearest
 * it, in any framing on this screen, would lie inside its near plane; and clear of the peaks.
 */
export function orthoBackOf(screen: Screen, land: Land): number {
  const near = widestGround(screen, land).depth * MARGIN + ROOM
  return Math.max(ORTHO_BACK * land.outreach, near) + 2 * land.peak
}
