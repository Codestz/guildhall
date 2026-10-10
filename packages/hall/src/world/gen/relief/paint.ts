import { DMath } from "../../dmath.ts"
import { valueNoise } from "./noise.ts"
import { SWATCH, type Swatch, swatchV } from "./swatches.ts"

/**
 * The relief's colour, the way the kit's own models wear theirs: every palette swatch is a vertical
 * gradient strip, and a KayKit piece slides along it (light on a convex edge, deep in a crease). A
 * face chooses its zone (a swatch and a place on its strip) from its height and steepness, never a
 * chance of its own, so the zones wander over the massif in big regions with crisp edges along the
 * facets. Each vertex then moves along the strip by its own height (the zone's `rise`) and by the
 * ground's curvature there: darker in a gully or at the foot of a wall, lighter on a convex lip,
 * so a flat face is a soft gradient and the lips of the ledges catch the light.
 */

/** A zone: the swatch, where on its strip a face sits (0 light end, 1 dark end), and how that moves with height (per share of the peak). */
export interface Zone {
  swatch: Swatch
  t: number
  rise: number
}

/** What a vertex adds to its zone: where it stands (share of the peak) and the curvature of the ground there. */
export interface Tone {
  /** Height as a share of the massif's peak. */
  rel: number
  /** Concavity, world units: the neighbours' mean height over its own (positive in a gully, negative on a lip). */
  curve: number
  /** Weathering, -1 to 1: slow patches of lighter and darker stone, smooth across faces (never face by face). */
  weather?: number
}

/** Zone edges as shares of the massif's peak: grass below FOOT, meadow below WOOD, rock above. */
const FOOT = 0.18
const WOOD = 0.5
/** How far the regional noise pushes a zone edge (share of the peak) and how wide a region is (units). */
const WANDER = 0.12
const REGION = 26
/** Steeper than this (degrees) is bare rock at any height; steeper than CLIFF is a wall. */
const BARE = 48
const CLIFF = 60
/** A ledge's top: flatter than this (degrees); steeper is a band. */
const TOP = 28
/** Ground steeper than this (rise over run, 29°) at a corner is no grass's. */
const GENTLE_RISE = 0.45
/** How far the curvature moves a vertex along its strip: a gully's depth (units) that is fully dark, and the share of the strip it moves. */
const FULL_CURVE = 2
const AO = 0.2
const CATCH = 0.14
/** How far the weathering patches move a vertex along its strip, and how wide a patch is (units). */
const WEATHER = 0.06
export const PATCH = 11

/** The grass of the hex tiles' tops (`hex_grass`, v 0.643): what the foot of a massif must match. */
export const TILE_V = 0.643
/** The tile top's own texel: the rim faces of a massif take it, so the seam with the hex ground is one colour. */
export const TILE_TOP: readonly [number, number] = [SWATCH.grass.u, TILE_V]
const GRASS_T = (TILE_V - SWATCH.grass.light) / (SWATCH.grass.dark - SWATCH.grass.light)

interface Face {
  /** Degrees from flat. */
  slope: number
  height: number
  x: number
  z: number
}

function faceOf(p: readonly number[], q: readonly number[], r: readonly number[]): Face {
  const ux = (q[0] as number) - (p[0] as number)
  const uy = (q[1] as number) - (p[1] as number)
  const uz = (q[2] as number) - (p[2] as number)
  const vx = (r[0] as number) - (p[0] as number)
  const vy = (r[1] as number) - (p[1] as number)
  const vz = (r[2] as number) - (p[2] as number)
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  return {
    slope: (DMath.atan2(DMath.hypot(nx, nz), Math.abs(ny)) * 180) / Math.PI,
    height: ((p[1] as number) + (q[1] as number) + (r[1] as number)) / 3,
    x: ((p[0] as number) + (q[0] as number) + (r[0] as number)) / 3,
    z: ((p[2] as number) + (q[2] as number) + (r[2] as number)) / 3,
  }
}

/** Rock by steepness: grey stone (the slate strip) throughout, darker on a wall, lighter higher up. */
function rock(slope: number): Zone {
  if (slope >= CLIFF) return { swatch: SWATCH.slate, t: 0.8, rise: -0.25 }
  return { swatch: SWATCH.slate, t: slope >= BARE ? 0.55 : 0.35, rise: -0.25 }
}

/**
 * Whether grass may grow on a ramp face: gentle itself, and every corner stands on gentle ground, its
 * smoothed steepness (the lattice's own, over the corner's neighbours, so one flat triangle among
 * steep ones is not). What is steep at any corner is rock: no island of grass on a flank.
 */
export const grassy = (p: readonly number[], q: readonly number[], r: readonly number[]): boolean =>
  [p, q, r].every((corner) => (corner[3] as number) < GENTLE_RISE) && faceOf(p, q, r).slope < TOP

/** Grassy and wooded ledge tops, and rock between them: a ledge band's face is its own zone (`riserZone`). */
export function zoneOf(
  p: readonly number[],
  q: readonly number[],
  r: readonly number[],
  peak: number,
  grass = true,
): Zone {
  const { slope, height, x, z } = faceOf(p, q, r)
  if (slope >= TOP || !grass) return rock(slope)
  const t = height / Math.max(1, peak) + WANDER * (2 * valueNoise(11, x / REGION, z / REGION, 22) - 1)
  if (t >= WOOD) return { swatch: SWATCH.slate, t: 0.3, rise: -0.2 }
  if (t >= FOOT) return { swatch: SWATCH.meadow, t: 0.3, rise: 0.4 }
  return { swatch: SWATCH.grass, t: GRASS_T, rise: 0.25 }
}

/**
 * A riser's zone: one grey stone family from the foot to the summit, the strip's blue-grey slate,
 * lighter with each ledge and alternating a shade band by band; the lowest two bands wear the
 * kit's slightly warmer rock grey.
 */
export const riserZone = (low: number): Zone => ({
  swatch: low <= 1 ? SWATCH.rock : SWATCH.slate,
  t: low <= 1 ? 0.5 : Math.max(0.3, 0.6 - 0.03 * low) + (low % 2 === 0 ? 0.05 : 0),
  rise: 0,
})

/** A vertex's v on its zone's strip. */
export function vOf(zone: Zone, { rel, curve, weather = 0 }: Tone): number {
  const shade = Math.max(-1, Math.min(1, curve / FULL_CURVE))
  return swatchV(
    zone.swatch,
    zone.t + zone.rise * (rel - 0.5) + (shade > 0 ? AO : CATCH) * shade + WEATHER * weather,
  )
}
