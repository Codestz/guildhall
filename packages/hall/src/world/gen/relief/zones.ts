import { valueNoise } from "./field.ts"
import { LEDGE_STEP } from "./style.ts"
import { SWATCH, swatchV } from "./swatches.ts"

/**
 * The styles' colour (relief/style.ts): a face takes the colour of the zone it stands in, never a
 * chance of its own. Height and steepness choose between a few swatches (the hex tile's own grass at
 * the foot, a deeper green in the woods, then three greys of rock by steepness), and the height is
 * shifted by a slow noise sampled at the face, so the zones wander over the massif in big regions
 * with crisp edges along the facets instead of speckling face by face.
 */

type Texel = [number, number]

/** Zone edges as shares of the massif's peak: grass below FOOT, wood below WOOD, rock above. */
const FOOT = 0.18
const WOOD = 0.5
/** How far the regional noise pushes a zone edge (share of the peak) and how wide a region is (units). */
const WANDER = 0.12
const REGION = 26
/** Steeper than this (degrees) is bare rock at any height; steeper than CLIFF is a wall. */
const BARE = 48
const CLIFF = 60
/** Woods grow on ground gentler than this (degrees); steeper is rock even among the trees. */
const WOODED = 34
/** A ledge's top: flatter than this (degrees) in strata; steeper is a band. */
const TOP = 28

/** The grass of the hex tiles' tops (`hex_grass`, v 0.643): what the foot of a massif must match. */
const TILE_GRASS: Texel = [SWATCH.grass.u, 0.643]

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
    slope: (Math.atan2(Math.hypot(nx, nz), Math.abs(ny)) * 180) / Math.PI,
    height: ((p[1] as number) + (q[1] as number) + (r[1] as number)) / 3,
    x: ((p[0] as number) + (q[0] as number) + (r[0] as number)) / 3,
    z: ((p[2] as number) + (q[2] as number) + (r[2] as number)) / 3,
  }
}

/** Rock in three greys by steepness: light slate where it is gentle, grey where steep, dark on walls. */
function rock(slope: number, region: number): Texel {
  if (slope >= CLIFF) return [SWATCH.rock.u, swatchV(SWATCH.rock, 0.8)]
  if (slope >= BARE) return [SWATCH.rock.u, swatchV(SWATCH.rock, 0.35)]
  return region > 0.62
    ? [SWATCH.warm.u, swatchV(SWATCH.warm, 0.3)]
    : [SWATCH.slate.u, swatchV(SWATCH.slate, 0.15)]
}

/** Styles a and c: grass, wood and rock zones, by height and steepness, wandering by region. */
export function paintZones(
  p: readonly number[],
  q: readonly number[],
  r: readonly number[],
  peak: number,
): Texel {
  const { slope, height, x, z } = faceOf(p, q, r)
  const region = valueNoise(11, x / REGION, z / REGION, 21)
  const t = height / Math.max(1, peak) + WANDER * (2 * valueNoise(11, x / REGION, z / REGION, 22) - 1)
  if (slope >= BARE || t >= WOOD || (t >= FOOT && slope >= WOODED)) return rock(slope, region)
  if (t >= FOOT) return [SWATCH.conifer.u, swatchV(SWATCH.conifer, 0.62)]
  return TILE_GRASS
}

/** Style b: grassy and wooded ledge tops, and rock bands between them that alternate by ledge. */
export function paintStrata(
  p: readonly number[],
  q: readonly number[],
  r: readonly number[],
  peak: number,
): Texel {
  const { slope, height, x, z } = faceOf(p, q, r)
  const region = valueNoise(11, x / REGION, z / REGION, 21)
  if (slope >= TOP) {
    const band = Math.round(height / LEDGE_STEP)
    return band % 2 === 0
      ? [SWATCH.rock.u, swatchV(SWATCH.rock, 0.4)]
      : [SWATCH.warm.u, swatchV(SWATCH.warm, 0.4)]
  }
  const t = height / Math.max(1, peak) + WANDER * (2 * valueNoise(11, x / REGION, z / REGION, 22) - 1)
  if (t >= WOOD) return region > 0.62 ? rock(0, region) : [SWATCH.slate.u, swatchV(SWATCH.slate, 0.12)]
  if (t >= FOOT) return [SWATCH.meadow.u, swatchV(SWATCH.meadow, 0.55)]
  return TILE_GRASS
}

/** The tile top's grass: the rim faces of a massif take it, so the seam with the hex ground is one colour. */
export const TILE_TOP: Texel = TILE_GRASS

/** A riser's colour: one flat grey or warm rock for the whole ledge band, alternating band by band. */
export function paintRiser(low: number): Texel {
  return low % 2 === 0
    ? [SWATCH.rock.u, swatchV(SWATCH.rock, 0.4)]
    : [SWATCH.warm.u, swatchV(SWATCH.warm, 0.4)]
}
