import type { Extents } from "../world/chronicle/growthReach.ts"
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

/** A screen this narrow for its height (width / height) counts as a phone held upright. */
const PORTRAIT_ASPECT = 0.46
/** The island's reach fills this much of a portrait screen's width at the furthest zoom-out. */
const FILL = 0.96

/** How upright a screen is: 0 for a square or landscape one, 1 for a phone held upright (CameraRig's close-in, the fills below). */
export function uprightOf(screen: Screen): number {
  const aspect = screen.width / Math.max(screen.height, 1)
  return Math.min(1, Math.max(0, (1 - aspect) / (1 - PORTRAIT_ASPECT)))
}

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

/**
 * The furthest orthographic zoom-out of the controls (CameraRig `widest`): the island's width, which
 * on a portrait phone a small island's reach fills (the island overview opens here, so a hamlet is
 * not a speck mid-screen).
 */
export function widestOf(screen: Screen, land: Land): number {
  const across = (baseZoomOf(screen.width, screen.height) * 0.42 * 0.5) / land.outreach
  const fill = (screen.width * FILL) / 2 / land.reach
  const wide = across + Math.max(0, fill - across) * uprightOf(screen)
  return widestZoom(wide, screen.height, land.reach, land.peak)
}

/** The film fills this much of the limiting dimension of the screen with the land (the rest is sea, and the HUD's room). */
const FILM_FILL = 0.9
/** What stands on the land (buildings, trees) rises this high above its ground, world units: the top of the frame needs it. */
const FILM_RISE = 8
/** The film never frames less than this much ground each way, world units (the keep alone is a stone). */
const FILM_LEAST = 16

/**
 * The film's orthographic zoom for a land of camera-aligned `extents` (growth/orbit.ts, growthReach.ts):
 * how far it stands from the frame's middle across the view, and along it. It fills FILM_FILL of
 * whichever of the screen's width and height it meets first (the height reads the ground foreshortened
 * by the view's elevation, and what stands on it), so a phone fits it by width and a desktop by what is tighter.
 */
export function filmZoom(screen: Screen, extents: Extents): number {
  const across = Math.max(FILM_LEAST, extents.across)
  const high = Math.max(FILM_LEAST, extents.deep) * SIN + FILM_RISE * COS
  return Math.min((screen.width * FILM_FILL) / 2 / across, (screen.height * FILM_FILL) / 2 / high)
}

/** The widest a land of `radius` can frame: it stands no further than that from its middle, whichever way the film looks. */
export const roundLand = (radius: number): Extents => ({ across: radius, deep: radius })

/** What a frame of `zoom` shows of the ground round its target: the far corner's distance, and how deep along the view. */
export function groundOf(screen: Screen, zoom: number): { radius: number; depth: number } {
  const across = screen.width / 2 / zoom
  const down = screen.height / 2 / zoom / SIN
  return { radius: Math.hypot(across, down), depth: down * COS }
}

/** The widest ground any orthographic framing of `land` shows on `screen`: the controls' zoom-out, or the film's. */
function widestGround(screen: Screen, land: Land): { radius: number; depth: number } {
  const zoom = Math.min(widestOf(screen, land), filmZoom(screen, roundLand(land.reach * FILM_RADIUS)))
  return groundOf(screen, zoom)
}

/** The radius from the origin the sea must cover so no orthographic view shows past it. */
export function viewReachOf(screen: Screen, land: Land): number {
  return (land.reach * TARGET + widestGround(screen, land).radius) * MARGIN
}

/** The fog starts no nearer than this share of its radius, in any weather (atmosphere/sky.ts: `fogNear`, 1 - 0.42 haze). */
const FOG_NEAR = 0.58

/**
 * The radius the island fog (atmosphere/Atmosphere.tsx) is scaled by in an orthographic view of
 * `land`, given `coast`, the radius it takes from the island's own tiles. Fog is radial from the
 * island's middle, so ground further out than it starts is only fog colour: a portrait phone
 * (and the film pulling back on it) sees several reaches of sea past a small island, a flat pale
 * void with the sea's own shadows on it. Where the screen is upright the fog is pushed out until
 * none starts inside the widest ground seen; a landscape screen keeps its coast fade.
 */
export function fogReachOf(screen: Screen, land: Land, coast: number): number {
  const clear = (land.reach * TARGET + widestGround(screen, land).radius) / FOG_NEAR
  return coast + Math.max(0, clear - coast) * uprightOf(screen)
}

/** The orthographic camera stands this far back from its target (a multiple of the sea tiles' reach). */
export const ORTHO_BACK = 220

/**
 * The furthest the camera controls let an orthographic camera stand from its target (CameraRig
 * `maxDistance`): they pull it back in when it is further, each frame, so a `back` past it put the
 * camera where the grade (which reads the camera before the film moves it again) and the depth
 * it was drawn at disagreed, and the ground nearest the lens fell inside its near plane.
 */
export const orthoMaxOf = (outreach: number, back: number): number => Math.max(300 * outreach, back * 1.05)

/**
 * How far back the orthographic camera stands: the usual distance, or further when the ground nearest
 * it, in any framing on this screen, would lie inside its near plane; and clear of the peaks.
 */
export function orthoBackOf(screen: Screen, land: Land): number {
  const near = widestGround(screen, land).depth * MARGIN + ROOM
  return Math.max(ORTHO_BACK * land.outreach, near) + 2 * land.peak
}
