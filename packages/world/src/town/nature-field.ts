/**
 * The wild's shape, before anything is planted (nature v2): where the woods stand, how dense they are,
 * which species leads where, and how the grass under it all is toned. Everything here is a pure
 * function of the plan's ground (bounds, water, streets, spec) and a seed, so the ground painter
 * (render's createGround, through `groundTint`) and later stages (W8 claiming a glade for a campsite)
 * can rebuild the very field nature planted from: `natureField(layout, (s) => roll(seed, `${s}:nature`))`.
 *
 * Woods are clusters, not a uniform scatter: forest cores sit on a jittered grid (kept more often, and
 * larger, the further from the town), each a few overlapping lobes, their outline warped by noise so
 * edges run ragged. Big woods hold glades. Along the coast a forest belt closes the land inland of an
 * open shore band. Values come from an integer hash of the cell (no strings, no tiles), so nothing
 * repeats across the map.
 */
import { DMath } from "@guildhall/core"
import { lineIndex } from "../geom/line.ts"
import { bbox, contains } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { round3, type Vec2 } from "../geom/vec.ts"
import { SHORE } from "./farms.ts"
import { normalizeSpec } from "./spec.ts"
import type { TownPlan } from "./types.ts"

/** What the field reads: the ground only (never the placements), so render can rebuild it. */
export type FieldInput = Pick<TownPlan, "bounds"> & Partial<Pick<TownPlan, "water" | "spec" | "streets">>

/** A wood (forest cluster), by its core: W8 may claim one for a lumber camp, wildlife, a ruin. */
export interface Wood {
  id: number
  at: Vec2
  /** Metres: the core's reach (its lobes and ragged rim go a little past it). */
  r: number
  /** The species that leads the stand at its core. */
  lead: "broadleaf" | "pine" | "birch"
}

/** An open glade inside a wood: grass, flowers and a stump, nothing tall. W8 may claim it. */
export interface Glade {
  id: number
  wood: number
  at: Vec2
  r: number
}

/**
 * The grass's tone at a point, each weight in [0, 1], for the ground painter to blend on its grass
 * ramp: `shade` toward grass-dark (forest floor, under the woods), `light` toward grass-light (sunny
 * meadow patches), `dry` toward dry-grass (the shore strip, dry patches), `worn` toward dirt (trodden
 * verges along roads and lanes outside the walls).
 */
export interface GroundTint {
  shade: number
  light: number
  dry: number
  worn: number
}

export interface NatureField {
  woods: Wood[]
  glades: Glade[]
  /** Forest cover, 0 (open meadow) to 1 (closed canopy). */
  cover(p: Vec2): number
  /** The wood whose core reaches p (cover from it above 0.05), or -1. */
  woodAt(p: Vec2): number
  /** The glade p stands in, or -1. */
  glade(p: Vec2): number
  /** Metres to the coast (or the bounds), capped at COAST_REACH; a raster read, within a metre or so. */
  coast(p: Vec2): number
  /** Whether p lies in the open shore band (measured exactly against the coast). */
  inShore(p: Vec2): boolean
  /** The shore band's width at p, metres (SHORE[0]..SHORE[1]). */
  shore(p: Vec2): number
  /** How strongly pines lead at p, 0..1 (coast, far rough ground, pine patches). */
  pine(p: Vec2): number
  /** Whether p lies in a birch patch, 0..1. */
  birch(p: Vec2): number
  /** Which broadleaf leads the stand at p, [0, 1). */
  stand(p: Vec2): number
  /** How wild the ground is (distance from the town), 0 near the walls to 1 far out. */
  wild(p: Vec2): number
  /** The flower-drift strength at p, 0..1: drifts are clusters, never single dots. */
  drift(p: Vec2): number
  /** Rocky ground at p, 0..1 (rock clusters along the shore and on rough far ground). */
  rocky(p: Vec2): number
  /** A slow tone field, -1 (darker foliage) .. 1 (lighter), for per-stand colour variation. */
  tone(p: Vec2): number
  groundTint(x: number, z: number): GroundTint
}

/** The belt's depth inland of the shore band, wavering between these, metres. */
export const BELT = [18, 30] as const
/** Coast distances are only needed this far in, metres. */
export const COAST_REACH = SHORE[1] + BELT[1] + 12
/** Forest cores sit on a jittered grid this wide, metres. */
const WOOD_CELL = 80
/** The coast-distance raster's pitch, metres. */
const RASTER = 5
/** How far the warp moves a point at most, metres (half of 18 + 10). */
const WARP = 14
/** The cover raster's pitch, metres. */
const COVER_STEP = 4

/**
 * The field of a plan's ground. `roll` seeds it (one draw); the rest are integer hashes of lattice
 * cells, so any point is cheap and no pattern repeats.
 */
export function natureField(plan: FieldInput, roll: Roll): NatureField {
  const seed = Math.floor(roll("field-seed") * 4294967296) >>> 0
  const n = (salt: number, cell: number) => noise(seed, salt, cell)
  const [bmin, bmax] = bbox(plan.bounds)
  const radius = plan.spec ? normalizeSpec(plan.spec).radius : (bmax[0] - bmin[0]) / 9

  // --- The coast, as a raster of distances (exact queries are kept for the few that need them).
  const water = (plan.water ?? []).filter((w) => w.length > 2)
  const coastLine = water.length > 0 ? lineIndex(water, true) : null
  const exactCoast = (p: Vec2, max: number): number =>
    coastLine
      ? coastLine.near(p, max)
      : Math.min(p[0] - bmin[0], bmax[0] - p[0], p[1] - bmin[1], bmax[1] - p[1], max)
  const cols = Math.ceil((bmax[0] - bmin[0]) / RASTER) + 2
  const rows = Math.ceil((bmax[1] - bmin[1]) / RASTER) + 2
  const raster = coastRaster(water, bmin, bmax, cols, rows)
  const coast = (p: Vec2): number => {
    const x = Math.min(cols - 1.001, Math.max(0, (p[0] - bmin[0]) / RASTER))
    const z = Math.min(rows - 1.001, Math.max(0, (p[1] - bmin[1]) / RASTER))
    const i = Math.floor(x)
    const j = Math.floor(z)
    const fx = x - i
    const fz = z - j
    const k = j * cols + i
    const a = (raster[k] as number) + ((raster[k + 1] as number) - (raster[k] as number)) * fx
    const b =
      (raster[k + cols] as number) + ((raster[k + cols + 1] as number) - (raster[k + cols] as number)) * fx
    return a + (b - a) * fz
  }
  const wet = (p: Vec2) => water.some((w) => contains(w, p, 0))

  // --- Slow fields.
  const lap = n(1, 17)
  const waver = n(2, 40)
  const beltGate = n(3, 45)
  const pineN = n(4, 85)
  const birchN = n(5, 60)
  const standN = n(6, 75)
  const warpX = n(7, 32)
  const warpZ = n(8, 32)
  const raggedX = n(9, 7)
  const raggedZ = n(10, 7)
  const driftN = n(11, 8)
  const driftGate = n(12, 50)
  const rockN = n(13, 21)
  const toneN = n(14, 38)
  const lightN = n(15, 22)
  const dryN = n(16, 55)
  const wornN = n(17, 5)

  const wild = (p: Vec2) => smooth((Math.sqrt(p[0] * p[0] + p[1] * p[1]) / radius - 1.3) / 1.3)
  const shore = (p: Vec2) => SHORE[0] + (SHORE[1] - SHORE[0]) * lap(p)
  const warp = (p: Vec2): Vec2 => [
    p[0] + 18 * (warpX(p) - 0.5) + 10 * (raggedX(p) - 0.5),
    p[1] + 18 * (warpZ(p) - 0.5) + 10 * (raggedZ(p) - 0.5),
  ]

  // --- Woods: cores on a jittered grid, each a few lobes; glades in the big ones.
  type Lobe = { x: number; z: number; r: number }
  /** A wood's lobes with the circle that holds all their reach (a cheap first test). */
  type Core = { wood: number; x: number; z: number; reach: number; lobes: Lobe[] }
  const woods: Wood[] = []
  const glades: Glade[] = []
  const cores = new Map<number, Core>()
  const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)
  const ci0 = Math.floor(bmin[0] / WOOD_CELL)
  const cj0 = Math.floor(bmin[1] / WOOD_CELL)
  for (let ci = ci0; ci * WOOD_CELL < bmax[0]; ci++)
    for (let cj = cj0; cj * WOOD_CELL < bmax[1]; cj++) {
      const h = (k: number) => hash(seed, ci, cj, 100 + k)
      const at: Vec2 = [(ci + 0.15 + 0.7 * h(0)) * WOOD_CELL, (cj + 0.15 + 0.7 * h(1)) * WOOD_CELL]
      const w = wild(at)
      if (w < 0.02 || h(2) > 0.35 + 0.6 * w || coast(at) < SHORE[1] || wet(at)) continue
      const r = round3((20 + 30 * h(3)) * (0.7 + 0.45 * w))
      const id = woods.length
      const lead = pineAt(at) > 0.5 ? "pine" : birchN(at) > 0.68 ? "birch" : "broadleaf"
      woods.push({ id, at, r, lead })
      const core: Core = {
        wood: id,
        x: at[0],
        z: at[1],
        reach: 1.25 * 0.75 * r,
        lobes: [{ x: at[0], z: at[1], r: 0.75 * r }],
      }
      const count = 2 + Math.floor(3 * h(4))
      for (let k = 0; k < count; k++) {
        const a = 2 * Math.PI * h(10 + k)
        const d = r * (0.3 + 0.35 * h(20 + k))
        const lobe = { x: at[0] + d * cos(a), z: at[1] + d * sin(a), r: r * (0.4 + 0.3 * h(30 + k)) }
        core.lobes.push(lobe)
        core.reach = Math.max(core.reach, d + 1.25 * lobe.r)
      }
      cores.set(key(ci, cj), core)
      if (r >= 34 && coast(at) > r) {
        const a = 2 * Math.PI * h(40)
        const d = r * (0.1 + 0.3 * h(41))
        const g: Glade = {
          id: glades.length,
          wood: id,
          at: [round3(at[0] + d * cos(a)), round3(at[1] + d * sin(a))],
          r: round3(6 + 0.16 * r * (0.7 + 0.6 * h(42))),
        }
        glades.push(g)
      }
    }

  function pineAt(p: Vec2): number {
    const belt = 1 - smooth((coast(p) - SHORE[1] - BELT[1]) / 15)
    return clamp01(0.08 + 0.3 * belt + 0.3 * wild(p) + 1.1 * (pineN(p) - 0.5))
  }

  /** Cover from the woods at a warped point, and which wood gives it. */
  const woodCover = (q: Vec2): { c: number; wood: number } => {
    let best = 0
    let wood = -1
    const ci = Math.floor(q[0] / WOOD_CELL)
    const cj = Math.floor(q[1] / WOOD_CELL)
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++) {
        const core = cores.get(key(i, j))
        if (!core) continue
        const cx = q[0] - core.x
        const cz = q[1] - core.z
        if (cx * cx + cz * cz >= core.reach * core.reach) continue
        for (const l of core.lobes) {
          const dx = q[0] - l.x
          const dz = q[1] - l.z
          const t = Math.sqrt(dx * dx + dz * dz) / l.r
          if (t >= 1.25) continue
          const c = smooth((1.25 - t) / 0.55)
          if (c > best) {
            best = c
            wood = core.wood
          }
        }
      }
    return { c: best, wood }
  }

  /** Whether any wood's lobes could reach p once warped (a cheap test before the warp). */
  const nearWood = (p: Vec2): boolean => {
    const ci = Math.floor(p[0] / WOOD_CELL)
    const cj = Math.floor(p[1] / WOOD_CELL)
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++) {
        const core = cores.get(key(i, j))
        if (!core) continue
        const dx = p[0] - core.x
        const dz = p[1] - core.z
        const reach = core.reach + WARP
        if (dx * dx + dz * dz < reach * reach) return true
      }
    return false
  }

  /** How open the glades leave a point (unwarped: a glade is round): 0 inside one, 1 past its 6 m rim. */
  const open = (q: Vec2): number => {
    let f = 1
    for (const g of glades) {
      const dx = q[0] - g.at[0]
      const dz = q[1] - g.at[1]
      const reach = g.r + 6
      if (Math.abs(dx) >= reach || Math.abs(dz) >= reach) continue
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < reach) f *= smooth((d - g.r) / 6)
    }
    return f
  }

  const beltCover = (p: Vec2, edge: number): number => {
    const depth = shore(p) + BELT[0] + (BELT[1] - BELT[0]) * waver(p)
    const gate = smooth((beltGate(p) - 0.3) / 0.25)
    return smooth((depth - edge) / 10 + 0.5) * gate
  }

  /** Cover worked out in full at p, and the wood it comes from (-1: none, or the coast's belt). */
  const coverAt = (p: Vec2): { c: number; wood: number } => {
    const edge = coast(p)
    if (edge < shore(p) - 1 || (edge >= COAST_REACH && !nearWood(p))) return { c: 0, wood: -1 }
    const q = warp(p)
    const w = woodCover(q)
    const c = Math.max(w.c, edge < COAST_REACH ? beltCover(q, edge) : 0)
    return { c: c > 0 && glades.length > 0 ? c * open(p) : c, wood: w.c > 0.05 ? w.wood : -1 }
  }
  // Cover is read many times per metre: worked out once per COVER_STEP node, on first use, and read
  // between nodes bilinearly (the warp's ragged rim is coarser than a node).
  const gcols = Math.ceil((bmax[0] - bmin[0]) / COVER_STEP) + 2
  const grows = Math.ceil((bmax[1] - bmin[1]) / COVER_STEP) + 2
  const covers = new Float32Array(gcols * grows).fill(-1)
  const woodIds = new Int32Array(gcols * grows)
  const node = (i: number, j: number): number => {
    const k = Math.min(grows - 1, Math.max(0, j)) * gcols + Math.min(gcols - 1, Math.max(0, i))
    if ((covers[k] as number) < 0) {
      const got = coverAt([bmin[0] + i * COVER_STEP, bmin[1] + j * COVER_STEP])
      covers[k] = got.c
      woodIds[k] = got.wood
    }
    return k
  }
  const cover = (p: Vec2): number => {
    const x = (p[0] - bmin[0]) / COVER_STEP
    const z = (p[1] - bmin[1]) / COVER_STEP
    const i = Math.floor(x)
    const j = Math.floor(z)
    const fx = x - i
    const fz = z - j
    const a = covers[node(i, j)] as number
    const b = covers[node(i + 1, j)] as number
    const c = covers[node(i, j + 1)] as number
    const d = covers[node(i + 1, j + 1)] as number
    const top = a + (b - a) * fx
    return top + (c + (d - c) * fx - top) * fz
  }

  const roads = roadIndex(plan)

  return {
    woods,
    glades,
    cover,
    woodAt: (p) => {
      const k = node(Math.round((p[0] - bmin[0]) / COVER_STEP), Math.round((p[1] - bmin[1]) / COVER_STEP))
      return (covers[k] as number) > 0.05 ? (woodIds[k] as number) : -1
    },
    glade: (p) => {
      for (const g of glades) {
        const dx = p[0] - g.at[0]
        const dz = p[1] - g.at[1]
        if (dx * dx + dz * dz < g.r * g.r) return g.id
      }
      return -1
    },
    coast,
    inShore: (p) => {
      const c = coast(p)
      const band = shore(p)
      // Within a raster step of the band the shore's own line is measured.
      return c < band + RASTER && exactCoast(p, band + RASTER) < band
    },
    shore,
    pine: pineAt,
    birch: (p) => smooth((birchN(p) - 0.62) / 0.12),
    stand: (p) => Math.min(0.999, standN(p)),
    wild,
    drift: (p) => smooth((driftN(p) - 0.7) / 0.1) * smooth((driftGate(p) - 0.35) / 0.25),
    rocky: (p) => smooth((rockN(p) - 0.55) / 0.2) * (0.35 + 0.65 * Math.max(wild(p), coast(p) < 14 ? 1 : 0)),
    tone: (p) => 2 * toneN(p) - 1,
    groundTint(x, z) {
      const p: Vec2 = [x, z]
      const edge = coast(p)
      const c = edge < shore(p) - 1 ? 0 : cover(p)
      const open = 1 - c
      const shoreDry = 1 - smooth((edge - shore(p)) / 4)
      const worn = roads(p)
      return {
        shade: round3(0.85 * smooth(c / 0.8)),
        light: round3(open * smooth((lightN(p) - 0.45) / 0.35)),
        dry: round3(open * Math.max(0.8 * shoreDry, 0.75 * smooth((dryN(p) - 0.6) / 0.2))),
        worn: round3(worn * (0.6 + 0.4 * wornN(p))),
      }
    },
  }
}

/**
 * Distances to the coast on a RASTER-pitch grid from `bmin`, capped at COAST_REACH: each side of the
 * water stamps the nodes within reach of it, so nodes far inland cost nothing. Without water the
 * bounds are the coast.
 */
function coastRaster(
  water: readonly Vec2[][],
  bmin: Vec2,
  bmax: Vec2,
  cols: number,
  rows: number,
): Float32Array {
  const raster = new Float32Array(cols * rows)
  if (water.length === 0) {
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const x = bmin[0] + i * RASTER
        const z = bmin[1] + j * RASTER
        raster[j * cols + i] = Math.max(
          0,
          Math.min(x - bmin[0], bmax[0] - x, z - bmin[1], bmax[1] - z, COAST_REACH),
        )
      }
    return raster
  }
  raster.fill(COAST_REACH)
  const cell = (v: number, lo: number) => (v - lo) / RASTER
  for (const ring of water)
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k] as Vec2
      const b = ring[(k + 1) % ring.length] as Vec2
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const l2 = dx * dx + dz * dz
      const i0 = Math.max(0, Math.floor(cell(Math.min(a[0], b[0]) - COAST_REACH, bmin[0])))
      const i1 = Math.min(cols - 1, Math.ceil(cell(Math.max(a[0], b[0]) + COAST_REACH, bmin[0])))
      const j0 = Math.max(0, Math.floor(cell(Math.min(a[1], b[1]) - COAST_REACH, bmin[1])))
      const j1 = Math.min(rows - 1, Math.ceil(cell(Math.max(a[1], b[1]) + COAST_REACH, bmin[1])))
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const px = bmin[0] + i * RASTER - a[0]
          const pz = bmin[1] + j * RASTER - a[1]
          const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + pz * dz) / l2))
          const ex = px - t * dx
          const ez = pz - t * dz
          const d = Math.sqrt(ex * ex + ez * ez)
          const at = j * cols + i
          if (d < (raster[at] as number)) raster[at] = d
        }
    }
  return raster
}

/** How worn the grass is at p by a street or road's verge: 1 at the kerb, 0 three metres out. */
function roadIndex(plan: FieldInput): (p: Vec2) => number {
  const byWidth = new Map<number, Vec2[][]>()
  for (const e of plan.streets?.edges ?? []) {
    const list = byWidth.get(e.width)
    if (list) list.push(e.points)
    else byWidth.set(e.width, [e.points])
  }
  const indexes = [...byWidth.entries()].map(([w, lines]) => ({
    half: w / 2,
    index: lineIndex(lines, false),
  }))
  return (p) => {
    let worn = 0
    for (const { half, index } of indexes) {
      const d = index.near(p, half + 3) - half
      if (d < 3) worn = Math.max(worn, 1 - smooth(d / 3))
    }
    return worn
  }
}

/** 32-bit integer hash of a lattice cell and a salt, as a number in [0, 1). */
export function hash(seed: number, i: number, j: number, k: number): number {
  let h = seed ^ Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x2545f491)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1) on a lattice `cell` metres wide (hash-valued, never repeating). */
function noise(seed: number, salt: number, cell: number): (p: Vec2) => number {
  return (p) => {
    const x = p[0] / cell
    const z = p[1] / cell
    const i = Math.floor(x)
    const j = Math.floor(z)
    const fx = fade(x - i)
    const fz = fade(z - j)
    const v00 = hash(seed, i, j, salt)
    const v10 = hash(seed, i + 1, j, salt)
    const v01 = hash(seed, i, j + 1, salt)
    const v11 = hash(seed, i + 1, j + 1, salt)
    const a = v00 + (v10 - v00) * fx
    const b = v01 + (v11 - v01) * fx
    return a + (b - a) * fz
  }
}

const fade = (t: number) => t * t * (3 - 2 * t)
export const smooth = (t: number) => fade(Math.min(1, Math.max(0, t)))
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const sin = (a: number) => DMath.sin(a)
const cos = (a: number) => DMath.cos(a)
