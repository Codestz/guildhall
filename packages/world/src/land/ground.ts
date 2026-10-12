/**
 * The ground raster (plan-w8 §4.0): the island's bounding box (two cells of sea round it) in 4 m
 * cells, each one sea, lake, land, shore (the land within 8 m of the sea) or rough, with its distance
 * to the sea and to the nearest lake (two-pass chamfer between cell centres, metres; 0 on the water
 * itself, +∞ for lakes when there are none). It is the one O(1) query surface for the island's later
 * stages: road costs, POI sites, the wild. Kinds are stored as their index in `GROUND_KINDS`, the same
 * list the island's contracts pin (island/types.ts; a test keeps the two equal).
 */
import { bbox, insideIndex, type Polygon, type Ring } from "../geom/poly.ts"
import type { Vec2 } from "../geom/vec.ts"

/** In this order: `GroundGrid.kind` stores the index. */
export const GROUND_KINDS = ["sea", "lake", "land", "shore", "rough"] as const
export type GroundKind = (typeof GROUND_KINDS)[number]

/** A raster of the island's bounding box, row-major from `origin`. */
export interface GroundGrid {
  /** Metres per cell. */
  cell: number
  origin: Vec2
  w: number
  h: number
  /** Index into `GROUND_KINDS`, per cell. */
  kind: Uint8Array
  coastDist: Float32Array
  lakeDist: Float32Array
}

/** What the raster is drawn from: the land (lakes as holes, islets included), the lakes and the rock fields. */
export interface Landform {
  land: Polygon[]
  lakes: Ring[]
  rough: Ring[]
}

/** The land within this many metres of the sea is shore (sand and rocks, no trees). */
export const SHORE_BAND = 8
/** Sea cells round the island's bounding box. */
const PAD = 2

const K = Object.fromEntries(GROUND_KINDS.map((k, i) => [k, i])) as Record<GroundKind, number>

export function groundGrid(form: Landform, cell = 4): GroundGrid {
  const outers = form.land.map((poly) => poly[0] ?? [])
  const [lo, hi] = bbox(outers.flat())
  const origin: Vec2 = [
    Math.floor(lo[0] / cell) * cell - PAD * cell,
    Math.floor(lo[1] / cell) * cell - PAD * cell,
  ]
  const w = Math.ceil((hi[0] - origin[0]) / cell) + PAD
  const h = Math.ceil((hi[1] - origin[1]) / cell) + PAD
  // Even–odd over every ring: a lake hole is not land, an islet is.
  const onLand = insideIndex(form.land.flat(), cell)
  const inLake = insideIndex(form.lakes, cell)
  const inRough = insideIndex(form.rough, cell)
  const kind = new Uint8Array(w * h)
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      const p: Vec2 = [origin[0] + (x + 0.5) * cell, origin[1] + (z + 0.5) * cell]
      kind[z * w + x] = inLake(p) ? K.lake : !onLand(p) ? K.sea : inRough(p) ? K.rough : K.land
    }
  const coastDist = chamfer(kind, w, h, cell, K.sea)
  const lakeDist = chamfer(kind, w, h, cell, K.lake)
  // The shore band; a rock field reaching the coast stays rough (a rocky shore).
  for (let i = 0; i < kind.length; i++)
    if (kind[i] === K.land && (coastDist[i] as number) <= SHORE_BAND) kind[i] = K.shore
  return { cell, origin, w, h, kind, coastDist, lakeDist }
}

/** The ground kind under p; outside the raster is open sea. */
export function groundAt(g: GroundGrid, p: Vec2): GroundKind {
  const x = Math.floor((p[0] - g.origin[0]) / g.cell)
  const z = Math.floor((p[1] - g.origin[1]) / g.cell)
  if (x < 0 || z < 0 || x >= g.w || z >= g.h) return "sea"
  return GROUND_KINDS[g.kind[z * g.w + x] as number] as GroundKind
}

/** Metres from each cell's centre to the nearest cell of kind `source` (0 on it, +∞ if none): a 3×3 chamfer, two passes. */
function chamfer(kind: Uint8Array, w: number, h: number, cell: number, source: number): Float32Array {
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = kind[i] === source ? 0 : Number.POSITIVE_INFINITY
  const diag = cell * Math.SQRT2
  const relax = (i: number, x: number, z: number, dx: number, dz: number, cost: number) => {
    const nx = x + dx
    const nz = z + dz
    if (nx < 0 || nz < 0 || nx >= w || nz >= h) return
    const v = (d[nz * w + nx] as number) + cost
    if (v < (d[i] as number)) d[i] = v
  }
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      const i = z * w + x
      relax(i, x, z, -1, 0, cell)
      relax(i, x, z, -1, -1, diag)
      relax(i, x, z, 0, -1, cell)
      relax(i, x, z, 1, -1, diag)
    }
  for (let z = h - 1; z >= 0; z--)
    for (let x = w - 1; x >= 0; x--) {
      const i = z * w + x
      relax(i, x, z, 1, 0, cell)
      relax(i, x, z, 1, 1, diag)
      relax(i, x, z, 0, 1, cell)
      relax(i, x, z, -1, 1, diag)
    }
  return d
}
