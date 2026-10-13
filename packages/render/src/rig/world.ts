import type { CameraPose } from "@guildhall/core"
import { poseToCamera } from "../camera.ts"

/**
 * The world a camera rig is held inside (pure): where the land is, how high the ground and the water
 * stand, and how far the view may reach before the edge of what is drawn would show. A screen hands
 * one to `stage.rig.setWorld`; without one the rig is the free orbit every piece viewer uses.
 */
export interface World {
  /** The centre (x, z) of the site's box: the island plus the sea round it. */
  centre: [number, number]
  /** Half the site box's larger side, metres: the camera's target pans inside it. */
  half: number
  /**
   * The ground's height at (x, z). Flat today; a terraced terrain passes its `heightAt` here and every
   * clamp follows it. Absent: flat at 0.
   */
  heightAt?(x: number, z: number): number
  /** The water's surface (the sea, lakes), or null where there is none to keep above. */
  water: number | null
  /** The closest the orbit may come to its target, metres. */
  minDistance?: number
  /**
   * The farthest the orbit may stand, as a share of the distance at which the whole site box fills the
   * frame looking straight down (1: just the site box, edge to edge).
   */
  maxReach?: number
  /** Free flight (the F key) on this screen. */
  free?: boolean
  /**
   * How far the orbit's target may stray from the centre at the farthest zoom, as a share of `half`
   * (1, the default: the whole site box at every zoom). Below 1 the leash tightens as the view pulls
   * back, round (not square), so a wide view stays centred on the island and the eased orbit drifts
   * home rather than hitting a wall.
   */
  hold?: number
  /** The free camera's half side, metres (`half` by default): looser than the orbit's. */
  roam?: number
}

type Vec3 = [number, number, number]

/** The camera's lens: vertical field of view (degrees), width over height, far plane (metres). */
export interface Lens {
  fov: number
  aspect: number
  far: number
}

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** The rig's limits; the rest follow from the world and the lens. */
export const LIMITS = {
  /** The eye's least height over the ground or the water under it, metres (orbit and free). */
  clearance: 1.6,
  /** The orbit never looks up: the lowest it may sit over its target, degrees. */
  minElevation: 3,
  /** Straight down would flip the view. */
  maxElevation: 89,
  minDistance: 10,
  maxReach: 1.05,
  /**
   * The tilt follows the zoom: close in, the orbit may tip no higher than LOW_CEILING; far out it may
   * sink no lower than HIGH_FLOOR (a view from far off and low only shows haze and the sea's end).
   */
  lowCeiling: 32,
  highFloor: 38,
  /**
   * Below this height over the floor the haze thickens to the sky before the far plane, so the view
   * may run out to the horizon; above it the far plane would cut the sea off in a hard line, so the
   * view's top corners must meet the floor inside REACH of the far plane.
   */
  hazeHeight: 220,
  reach: 0.9,
} as const

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * The floor under (x, z): the ground or the water, whichever is higher. Every height clamp reads the
 * world through this one function.
 */
export function floorAt(world: World, x: number, z: number): number {
  const ground = world.heightAt ? world.heightAt(x, z) : 0
  return world.water === null ? ground : Math.max(ground, world.water)
}

/**
 * How far the frame's top corners reach to meet the floor, metres along the ray, from `height` over it
 * looking `elevation` degrees down; Infinity when they see the horizon.
 */
export function viewReach(height: number, elevation: number, lens: Lens): number {
  const ty = Math.tan((lens.fov / 2) * RAD)
  const tx = ty * lens.aspect
  const el = elevation * RAD
  const down = Math.sin(el) - ty * Math.cos(el)
  return down <= 0 ? Number.POSITIVE_INFINITY : (Math.max(0, height) * Math.hypot(tx, ty, 1)) / down
}

/** True when a view from `height` over the floor, `elevation` degrees down, shows no far-plane cut. */
export function seesNoCut(height: number, elevation: number, lens: Lens): boolean {
  return height <= LIMITS.hazeHeight || viewReach(height, elevation, lens) <= LIMITS.reach * lens.far
}

/** The least elevation (degrees down) that shows no far-plane cut from `height` over the floor. */
export function leastElevation(height: number, lens: Lens): number {
  if (height <= LIMITS.hazeHeight) return Number.NEGATIVE_INFINITY
  let lo = -90
  let hi = 90
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (seesNoCut(height, mid, lens)) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * The orbit's zoom range on a world through a lens: out to the distance at which the site box fills
 * the frame looking straight down (times `maxReach`), and never so far that even straight down the
 * frame's corners would reach past the far plane (a big site under the stage's lens).
 */
export function distanceRange(world: World, lens: Lens): [number, number] {
  const min = world.minDistance ?? LIMITS.minDistance
  const ty = Math.tan((lens.fov / 2) * RAD)
  const fit = world.half / ty
  const far = (LIMITS.reach * lens.far) / Math.hypot(ty * lens.aspect, ty, 1)
  return [min, Math.max(min * 2, Math.min(far, (world.maxReach ?? LIMITS.maxReach) * fit))]
}

/** Where `distance` falls in the zoom range, 0 (closest) to 1 (farthest), on a log scale. */
export function zoomFraction(distance: number, [min, max]: readonly [number, number]): number {
  return clamp(Math.log(distance / min) / Math.log(max / min), 0, 1)
}

/** The elevations the orbit may take at zoom fraction `t`, degrees: lower close in, higher far out. */
export function elevationRange(t: number): [number, number] {
  const ceiling = LIMITS.lowCeiling + (LIMITS.maxElevation - LIMITS.lowCeiling) * smoothstep(0, 0.45, t)
  const floor = LIMITS.minElevation + (LIMITS.highFloor - LIMITS.minElevation) * smoothstep(0.6, 1, t)
  return [floor, ceiling]
}

/**
 * The tilt a zoom leans toward at fraction `t`, degrees: down among the roofs close in, the hero
 * shot's three-quarter view (about 38° at 0.7) in the middle, straight down far out. A zoom eases the
 * elevation toward it (`zoomTilt`), a drag sets it freely.
 */
export function restingTilt(t: number): number {
  return 6 + 79 * clamp(t, 0, 1) ** 2.5
}

/**
 * The elevation after a zoom from fraction `from` to `to`: eased toward the resting tilt by as much as
 * the zoom moved (a full sweep of the range arrives), so close in reads as a street and far out as a map.
 */
export function zoomTilt(elevation: number, from: number, to: number): number {
  const w = clamp(Math.abs(to - from) * 4, 0, 1)
  return elevation + (restingTilt(to) - elevation) * w
}

/** A point (x, z) held inside the site box. */
export function insideSite(world: World, x: number, z: number, slack = 0): [number, number] {
  const r = world.half + slack
  const [cx, cz] = world.centre
  return [clamp(x, cx - r, cx + r), clamp(z, cz - r, cz + r)]
}

/** The target (x, z) on the leash `World.hold` sets at zoom fraction `t`: a circle that tightens far out. */
export function leash(world: World, [x, z]: [number, number], t: number): [number, number] {
  if (world.hold === undefined || world.hold >= 1) return [x, z]
  const r = world.half * (1 - (1 - world.hold) * smoothstep(0.3, 1, t))
  const [cx, cz] = world.centre
  const d = Math.hypot(x - cx, z - cz)
  if (d <= r) return [x, z]
  return [cx + ((x - cx) * r) / d, cz + ((z - cz) * r) / d]
}

/**
 * An orbit pose held inside the world: the target in the site box (riding the floor as it pans), the
 * distance in the zoom range, the elevation in the band for that zoom and high enough that the eye
 * clears the floor under it. Never looks up from under the horizon, never shows the ground's underside.
 */
export function clampOrbit(pose: CameraPose, world: World, lens: Lens): CameraPose {
  const range = distanceRange(world, lens)
  const distance = clamp(pose.distance, range[0], range[1])
  const t = zoomFraction(distance, range)
  const [tx, tz] = leash(world, insideSite(world, pose.target[0], pose.target[2]), t)
  // The target keeps its height over the floor (a preset's look point sits above the street).
  const lift = Math.max(0, pose.target[1] - floorAt(world, pose.target[0], pose.target[2]))
  const ty = floorAt(world, tx, tz) + lift
  const [lo, hi] = elevationRange(zoomFraction(distance, range))
  let elevation = clamp(pose.elevation, lo, hi)
  // The eye over the floor under it: raise the elevation until it clears (twice, as the eye moves).
  for (let i = 0; i < 2; i++) {
    const [ex, ey, ez] = poseToCamera({ ...pose, target: [tx, ty, tz], elevation, distance })
    const need = floorAt(world, ex, ez) + LIMITS.clearance
    if (ey >= need) break
    elevation = clamp(Math.asin(clamp((need - ty) / distance, -1, 1)) * DEG, elevation, LIMITS.maxElevation)
  }
  // High up, tip down until the frame meets the sea inside the far plane. Tipping raises the eye as
  // well, but the frame's reach still shortens as it tips: the least elevation that works, by halving.
  const floor = floorAt(world, tx, tz)
  const clear = (el: number) => seesNoCut(ty + distance * Math.sin(el * RAD) - floor, el, lens)
  if (!clear(elevation)) {
    let lo = elevation
    let hi: number = LIMITS.maxElevation
    for (let i = 0; i < 24 && clear(hi); i++) {
      const mid = (lo + hi) / 2
      if (clear(mid)) hi = mid
      else lo = mid
    }
    elevation = hi
  }
  return { target: [tx, ty, tz], azimuth: pose.azimuth, elevation, distance }
}

/**
 * The highest a free camera at `eye` may look (pitch up from level, degrees): level and above near
 * the ground, tipped down high up so the far plane never cuts the sea off.
 */
export function pitchCeiling(eye: Vec3, world: World, lens: Lens): number {
  return -leastElevation(eye[1] - floorAt(world, eye[0], eye[2]), lens)
}

/** The free camera's ceiling over a world through a lens: no higher than the orbit's farthest reach. */
export function ceilingOf(world: World, lens: Lens): number {
  return distanceRange(world, lens)[1]
}

/** A free eye held inside the world: inside the site box, over the floor, under the ceiling. */
export function clampEye(eye: Vec3, world: World, lens: Lens): Vec3 {
  const [x, z] = insideSite(world, eye[0], eye[2], Math.max(0, (world.roam ?? world.half) - world.half))
  const floor = floorAt(world, x, z) + LIMITS.clearance
  return [x, clamp(eye[1], floor, Math.max(floor, ceilingOf(world, lens))), z]
}
