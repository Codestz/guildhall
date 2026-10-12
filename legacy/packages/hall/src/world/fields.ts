import { DMath } from "./dmath.ts"
import type { Piece, Placement } from "./furniture.ts"
import KIT from "./kit.json"
import { type Field, HEX_SCALE, island } from "./lands.ts"

/**
 * The farms' crops (the user: "those terrains look like farms but they don't have anything"). Every
 * field hex in island().fields is tilled soil; this plants it, from the map data and a seed, never
 * by hand:
 * soil ridges on every plot, and along them lettuce or carrots — or nothing, a plot ploughed and
 * resting (the user: other crops "look very strange"; lettuce, carrots and some empty).
 * Rows run parallel to a hex edge, clipped to the hex with a margin for its fence.
 */

/** A hex's inradius in world units (flat-top: its flat sides face ±z, as the map's neighbours do). */
const INRADIUS = HEX_SCALE
/** Room left at the edge for the fence posts. */
const MARGIN = 0.75
const CROP_ROW = 1.15
const CROP_STEP = 0.9
const RIDGE_HEIGHT = 0.16
/** The soil tile's top (building_dirt at HEX_SCALE). */
export const SOIL = 0.067 * HEX_SCALE

export interface Ridge {
  x: number
  z: number
  rot: number
  length: number
}

export interface Plantings {
  ridges: Ridge[]
  crops: Placement[]
}

type Crop = "food_ingredient_lettuce" | "food_ingredient_carrot"
/** What each plot grows, in turn round the farms; `null` is ploughed and resting (just furrows). */
const PLOTS: readonly (Crop | null)[] = ["food_ingredient_lettuce", "food_ingredient_carrot", null]
/** How much of each vegetable is underground: a carrot shows only its leafy top. */
const SINK: Record<Crop, number> = { food_ingredient_lettuce: 0.12, food_ingredient_carrot: 0.62 }
const CROP_SCALE: Record<Crop, number> = { food_ingredient_lettuce: 0.5, food_ingredient_carrot: 0.55 }

/** Is a point (relative to the hex centre) inside the hex, `margin` in from its sides? */
export function insideHex(px: number, pz: number, margin = MARGIN): boolean {
  const r = INRADIUS - margin
  return Math.abs(pz) <= r && Math.abs(pz) * 0.5 + Math.abs(px) * (Math.sqrt(3) / 2) <= r
}

/** Half the length of the chord at offset `u` across the hex, along a direction parallel to an edge. */
function halfChord(u: number, margin: number): number {
  const r = INRADIUS - margin
  if (Math.abs(u) > r) return 0
  // Along z at x = u: |z| ≤ (r − |u|/2) / (√3/2).
  return (r - Math.abs(u) * 0.5) / (Math.sqrt(3) / 2)
}

/** Local (u across rows, v along rows) → world, for rows turned by `angle`. */
function toWorld(field: Field, angle: number, u: number, v: number): [number, number] {
  const c = DMath.cos(angle)
  const s = DMath.sin(angle)
  return [field.x + u * c + v * s, field.z - u * s + v * c]
}

export function plant(fields: readonly Field[] = island().fields): Plantings {
  const ridges: Ridge[] = []
  const crops: Placement[] = []
  let n = 0
  fields.forEach((field, i) => {
    // Rows along one of the hex's three edge directions (0, ±60°), so the edge they run beside is
    // a fence side and the rows look ploughed, not scattered.
    // (The row frame's u axis starts across ±z, the hex's flat sides.)
    const angle = Math.PI / 2 + (Math.floor(hash(i * 13 + 5) * 3) - 1) * (Math.PI / 3)
    // Lettuce, carrots, or freshly ploughed and empty, in turn: every kind shows, none dominates.
    const crop = PLOTS[i % PLOTS.length] ?? null
    const scale = crop ? CROP_SCALE[crop] : 1
    const bounds = crop ? KIT[crop] : undefined
    const height = (bounds?.size[1] ?? 1) * scale
    const lift = -(bounds?.min[1] ?? 0) * scale
    for (let u = -INRADIUS + CROP_ROW / 2; u <= INRADIUS; u += CROP_ROW) {
      const half = halfChord(u, MARGIN + 0.1)
      if (half < 0.6) continue
      const [rx, rz] = toWorld(field, angle, u, 0)
      ridges.push({ x: rx, z: rz, rot: angle, length: half * 2 })
      if (!crop) continue
      for (let v = -half + 0.4; v <= half - 0.4; v += CROP_STEP) {
        n++
        const [x, z] = toWorld(field, angle, u, v + (hash(n * 3 + 1) - 0.5) * 0.12)
        crops.push({
          piece: crop as Piece,
          x,
          z,
          y: SOIL + RIDGE_HEIGHT + lift - height * SINK[crop],
          rot: hash(n * 3 + 2) * Math.PI * 2,
          scale: scale * (0.85 + hash(n * 3 + 3) * 0.3),
          mounted: true,
        })
      }
    }
  })
  return { ridges, crops }
}

export { RIDGE_HEIGHT }

/** Deterministic 0..1 from an integer (world/ keeps its own; scene/ may not be imported here). */
function hash(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}
