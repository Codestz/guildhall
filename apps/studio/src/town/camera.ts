/**
 * The town's camera presets, as orbit poses (pure):
 * - `hero`: the concept image's 3/4 golden-hour establishing shot (az ≈ 40°, el ≈ 38°), turned so the
 *   harbour lies lower-left when the town has one, within the arc where the evening sun lights the
 *   street fronts the camera sees;
 * - `street`: low among the houses, down a main street toward the square;
 * - `map`: straight down with a narrow lens (near-orthographic), north up as on the planner's sheet;
 * - `free`: free flight (the stage's rig), starting from the hero shot.
 * `townWorld` is what the rig is held inside: the site's box, the land's height and the water's.
 */
import type { CameraPose } from "@guildhall/core"
import type { World } from "@guildhall/render"
import { LEVELS, type TownPlan, type Vec2 } from "@guildhall/world"
import type { Cam } from "./query.ts"

/** The stage's own lens, and the narrow one the map preset swaps in (degrees, vertical). */
export const LENS = { perspective: 40, map: 24 } as const

/** The stage's far plane (render/stage.ts), and the map's: past the eye's distance with room for the sheet. */
export const FAR = { perspective: 2000, map: (distance: number) => Math.max(2000, 1.5 * distance) } as const

const DEG = 180 / Math.PI
/** The concept image's pose (plan §6 U1). */
const HERO = { azimuth: 40, elevation: 38 } as const
/**
 * Azimuths that keep the 17.5 h sun (light.ts: from +x, a little +z) behind the camera's right
 * shoulder: past them the fronts the camera sees fall into shade.
 */
const LIT_ARC: readonly [number, number] = [0, 85]
/** The street preset: where along the street the eye and the look point are, and their heights (metres). */
const STREET = { eye: 42, look: 8, eyeHeight: 6, lookHeight: 3 } as const
/** The orbit's ceiling (render rig/world.ts LIMITS); straight down would flip the view. */
const TOP = 89
/** The closest the town orbit comes (metres): the street preset on a bent street stands this close. */
const STREET_MIN = 6

export interface Framing {
  /** Width over height of the canvas. */
  aspect: number
}

const centroid = (ring: readonly Vec2[]): Vec2 => {
  if (ring.length === 0) return [0, 0]
  let x = 0
  let z = 0
  for (const p of ring) {
    x += p[0]
    z += p[1]
  }
  return [x / ring.length, z / ring.length]
}

/** The bounds' box: its centre and half its larger side (the site sits off the town's origin). */
export function sheet(plan: Pick<TownPlan, "bounds">): { centre: Vec2; half: number } {
  if (plan.bounds.length === 0) return { centre: [0, 0], half: 1 }
  let x0 = Number.POSITIVE_INFINITY
  let z0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let z1 = Number.NEGATIVE_INFINITY
  for (const [x, z] of plan.bounds) {
    x0 = Math.min(x0, x)
    z0 = Math.min(z0, z)
    x1 = Math.max(x1, x)
    z1 = Math.max(z1, z)
  }
  return { centre: [(x0 + x1) / 2, (z0 + z1) / 2], half: Math.max(1, (x1 - x0) / 2, (z1 - z0) / 2) }
}

/** The town's heart: the square's centre, the origin when there is none. */
export function heart(plan: Pick<TownPlan, "plazas">): Vec2 {
  const plaza = plan.plazas[0]
  return plaza ? centroid(plaza) : [0, 0]
}

/**
 * The azimuth that puts water at `bearing` (radians, `[cos, sin]` on x/z) at the lower left of the
 * view, clamped into the arc the evening sun lights. The lower-left of a view from azimuth `a` points
 * along `(sin a − cos a, cos a + sin a)`, which is bearing `135° − a`.
 */
export function heroAzimuth(bearing: number | null): number {
  if (bearing === null) return HERO.azimuth
  const want = 135 - bearing * DEG
  // The equivalent angle nearest the concept's, then into the lit arc.
  const near = want - 360 * Math.round((want - HERO.azimuth) / 360)
  return Math.min(LIT_ARC[1], Math.max(LIT_ARC[0], near))
}

/** The distance at which a sphere of `radius` fills the frame's shorter field of view. */
function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const v = (fovDeg / 2) * (Math.PI / 180)
  const h = Math.atan(Math.tan(v) * aspect)
  return radius / Math.sin(Math.min(v, h))
}

/** The hero shot: the walled town filling the frame, the countryside round its edge. */
export function heroPose(plan: Pick<TownPlan, "plazas" | "spec">, radius: number, f: Framing): CameraPose {
  const [x, z] = heart(plan)
  const bearing = plan.spec.harbour?.bearing ?? null
  return {
    target: [x, 0, z],
    azimuth: heroAzimuth(bearing),
    elevation: HERO.elevation,
    // The town's radius reaches its gates; a little less fills the frame the way the concept does.
    distance: 0.95 * fitDistance(radius, LENS.perspective, f.aspect),
  }
}

/** The point `s` metres along a polyline (clamped to its ends). */
export function along(points: readonly Vec2[], s: number): Vec2 {
  let left = Math.max(0, s)
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as Vec2
    const b = points[i + 1] as Vec2
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (left <= l && l > 0) return [a[0] + ((b[0] - a[0]) * left) / l, a[1] + ((b[1] - a[1]) * left) / l]
    left -= l
  }
  return points[points.length - 1] ?? [0, 0]
}

/**
 * The street shot: on the main street that starts nearest the square, the eye over the middle of the
 * street STREET.eye metres out along it, looking back down the street toward the square (both points
 * on its centreline, so a bend never puts the eye inside a house): fronts either side, roofs against
 * the sky.
 */
export function streetPose(plan: Pick<TownPlan, "plazas" | "streets">): CameraPose {
  const centre = heart(plan)
  const near = (p: Vec2) => Math.hypot(p[0] - centre[0], p[1] - centre[1])
  const mains = plan.streets.edges.filter((e) => e.cls === "main" && e.points.length > 1)
  const pool = mains.length > 0 ? mains : plan.streets.edges.filter((e) => e.points.length > 1)
  let best: Vec2[] | null = null
  let bestNear = Number.POSITIVE_INFINITY
  for (const e of pool) {
    const a = e.points[0] as Vec2
    const b = e.points[e.points.length - 1] as Vec2
    const line = near(a) <= near(b) ? e.points : [...e.points].reverse()
    const d = near(line[0] as Vec2)
    if (d < bestNear) {
      bestNear = d
      best = line
    }
  }
  if (!best) return { target: [centre[0], 2, centre[1]], azimuth: 40, elevation: 12, distance: 40 }
  const look = along(best, STREET.look)
  const eye = along(best, STREET.eye)
  const dx = eye[0] - look[0]
  const dz = eye[1] - look[1]
  const flat = Math.hypot(dx, dz) || 1
  const rise = STREET.eyeHeight - STREET.lookHeight
  return {
    target: [look[0], STREET.lookHeight, look[1]],
    azimuth: Math.atan2(dx, dz) * DEG,
    elevation: Math.atan2(rise, flat) * DEG,
    distance: Math.hypot(flat, rise),
  }
}

/** Straight down over the whole sheet, north (−z) up, as the planner draws it. */
export function mapPose(plan: Pick<TownPlan, "bounds">, f: Framing): CameraPose {
  const { centre, half } = sheet(plan)
  const v = (LENS.map / 2) * (Math.PI / 180)
  // Fit the square's half side in the tighter of the two directions, with a 4% margin.
  const distance = (1.04 * half) / Math.min(Math.tan(v), Math.tan(v) * f.aspect)
  return { target: [centre[0], 0, centre[1]], azimuth: 0, elevation: TOP, distance }
}

/**
 * The world a town's camera is held inside: the site's box (the island and the sea round it; the sea
 * is drawn on past it to the haze), the land and the water's levels. The land is flat today: terraced
 * terrain hands its `heightAt` in here, and every clamp follows it.
 */
export function townWorld(plan: Pick<TownPlan, "bounds">): World {
  const { centre, half } = sheet(plan)
  // Close enough for the street preset, whose look point can sit a few metres off the eye on a bend.
  return { centre, half, heightAt: () => LEVELS.land, water: LEVELS.water, minDistance: STREET_MIN }
}

/** The pose of a preset for a plan (free flight starts from the hero shot). */
export function poseFor(
  cam: Cam,
  plan: Pick<TownPlan, "bounds" | "plazas" | "spec" | "streets">,
  radius: number,
  f: Framing,
): CameraPose {
  if (cam === "map") return mapPose(plan, f)
  if (cam === "street") return streetPose(plan)
  return heroPose(plan, radius, f)
}
