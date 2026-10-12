/**
 * Stage 8, the wild part (plan §4): what grows on the green nobody farms. The island's edge is its
 * coast: a shore band runs along it (5–9 m, wavering) of grass with rocks, a bush and flowers here and
 * there, and inland of that a forest belt (18–30 m deep, wavering) closes the land (Look bar #5); the
 * woods thicken away from the town; forest patches stand where a low-frequency noise runs high; the
 * rest is meadow with a rock, a bush or a clump of flowers here and there. Woods are dense in their
 * core (broadleaf, a few pines) and thin at their edges (pines, bushes, rocks: undergrowth), so a wood
 * reads as a mass with a ragged rim. Nothing stands on a street, in the water, in a field, inside a
 * closed fence or hedge, on an edge, or on a building's footprint (a placement of a known prefab: a
 * rect at `at`, turned by `rot`). A plan without water (no coast) closes on its bounds instead.
 */
import { distTo, lineIndex } from "../geom/line.ts"
import { axes, type Rect } from "../geom/obb.ts"
import { bbox, contains, insideIndex } from "../geom/poly.ts"
import { poissonIn, type Roll } from "../geom/sample.ts"
import { add, at, dist, dot, round3, snap, sub, type Vec2 } from "../geom/vec.ts"
import { SHORE, seedOf } from "./farms.ts"
import { normalizeSpec } from "./spec.ts"
import type { Placement, TownLibrary, TownPlan } from "./types.ts"

/** What nature reads beyond the pinned library: which trees are pines (the woods' rims), and flowers. */
export interface NatureExtras {
  pines?: string[]
  flowers?: string[]
}
export type NatureLibrary = TownLibrary & { wild?: NatureExtras }

export type NatureInput = Pick<TownPlan, "bounds" | "blocks"> &
  Partial<Pick<TownPlan, "placements" | "edges" | "fields" | "water" | "spec">>

/** Samples this far apart: the spacing of trees in a wood's core, metres. */
const SPACING = 3.4
/** The belt's depth inland of the shore band, wavering between these, metres. */
export const BELT = [18, 30] as const
/** Noise lattice steps for patches (two octaves) and for which species leads a stand, metres. */
const PATCH_CELL = [40, 17] as const
const STAND_CELL = 70
/** Woods thicken beyond this many town radii from the town's centre. */
const WILD_FROM = 2.3
/** Forest strength above which a sample is a wood's core, and above which it is a wood's rim. */
const CORE = 0.7
const RIM = 0.3
/** Clearance from anything built or fenced, and from the block's edge (the kerb of a street), metres. */
const CLEAR = { tree: 2, bush: 1, rock: 1, flower: 0.5 } as const
/** Samples come from a few Poisson-disk tiles this wide laid over the bounds, metres. */
const TILE = 48
const TILE_VARIANTS = 3
/** A grid cell for the lookups, metres. */
const CELL = 8

type Kind = keyof typeof CLEAR

export function nature(plan: NatureInput, lib: NatureLibrary, roll: Roll): Placement[] {
  const trees = lib.nature.trees
  if (trees.length === 0 && lib.nature.bushes.length === 0 && lib.nature.rocks.length === 0) return []
  const pines = (lib.wild?.pines ?? []).filter((id) => id.length > 0)
  const broad = trees.filter((t) => !pines.includes(t))
  const ids: Record<Kind | "pine", readonly string[]> = {
    tree: broad.length > 0 ? broad : trees,
    pine: pines.length > 0 ? pines : trees,
    bush: lib.nature.bushes,
    rock: lib.nature.rocks,
    flower: lib.wild?.flowers ?? [],
  }
  const blocked = obstacles(plan, lib)
  const [bmin, bmax] = bbox(plan.bounds)
  const coarse = noise(PATCH_CELL[0], (salt) => roll(`${salt}:patch`))
  const fine = noise(PATCH_CELL[1], (salt) => roll(`${salt}:patch-fine`))
  const patch = (p: Vec2) => 0.65 * coarse(p) + 0.35 * fine(p)
  const stand = noise(STAND_CELL, (salt) => roll(`${salt}:stand`))
  const waver = noise(PATCH_CELL[0], (salt) => roll(`${salt}:belt`))
  const lap = noise(PATCH_CELL[1], (salt) => roll(`${salt}:shore`))
  // The town's centre is the origin; its radius sets how far out the wild begins.
  const radius = plan.spec ? normalizeSpec(plan.spec).radius : (bmax[0] - bmin[0]) / 9
  const water = (plan.water ?? []).filter((w) => w.length > 2)
  const reach = SHORE[1] + BELT[1] + 10
  const coast = water.length > 0 ? lineIndex(water, true) : null
  const fromCoast = (p: Vec2): number =>
    coast
      ? coast.near(p, reach)
      : Math.min(p[0] - bmin[0], bmax[0] - p[0], p[1] - bmin[1], bmax[1] - p[1], reach)
  const shoreAt = (p: Vec2) => SHORE[0] + (SHORE[1] - SHORE[0]) * lap(p)
  const strength = (p: Vec2, edge: number): number => {
    const depth = shoreAt(p) + BELT[0] + (BELT[1] - BELT[0]) * waver(p)
    const belt = smooth((depth - edge) / 10 + 0.5)
    // Away from the town the woods close in; the ring round its walls stays open.
    const far = smooth((Math.hypot(p[0], p[1]) / radius - WILD_FROM) / 0.6) * (0.5 + 0.5 * patch(p))
    return Math.max(belt, far, smooth((patch(p) - 0.44) / 0.16))
  }

  const green = plan.blocks
    .filter((b) => b.use === "green")
    .map((b) => ({ b, box: bbox(b.poly), inside: insideIndex([b.poly]), edge: lineIndex([b.poly], true) }))
  const tiles = Array.from({ length: TILE_VARIANTS }, (_, v) => tile((salt) => roll(`${v}:${salt}:tile`)))
  const out: Placement[] = []
  for (let tx = Math.floor(bmin[0] / TILE); tx * TILE < bmax[0]; tx++)
    for (let tz = Math.floor(bmin[1] / TILE); tz * TILE < bmax[1]; tz++) {
      const o: Vec2 = [tx * TILE, tz * TILE]
      const near = green.filter(
        ({ box: [lo, hi] }) => lo[0] <= o[0] + TILE && hi[0] >= o[0] && lo[1] <= o[1] + TILE && hi[1] >= o[1],
      )
      if (near.length === 0) continue
      const pattern = at(tiles, Math.floor(roll(`${tx}:${tz}:pattern`) * TILE_VARIANTS))
      pattern.forEach((q, i) => {
        const p = snap(add(o, q))
        const home = near.find((g) => g.inside(p))
        if (!home) return
        const draw = (salt: string) => roll(`${tx}:${tz}:${i}:${salt}`)
        const edge = fromCoast(p)
        const kind = edge < shoreAt(p) ? pickShore(draw) : pick(strength(p, edge), stand(p), draw)
        const list = kind ? ids[kind] : []
        if (!kind || list.length === 0) return
        const role: Kind = kind === "pine" ? "tree" : kind
        if (home.edge.near(p, CLEAR[role]) < CLEAR[role] || blocked(p, CLEAR[role])) return
        out.push({
          prefab: at(list, Math.floor(draw("id") * list.length)),
          seed: seedOf(draw("seed")),
          at: p,
          rot: round3(2 * Math.PI * draw("turn")),
          role,
        })
      })
    }
  return out
}

/**
 * What grows at a sample, from the forest's strength there and which species leads the stand: a
 * wood's core is trees with a little undergrowth, its rim fewer trees (more of them pines) among
 * bushes, rocks and flowers, and a meadow now and then a rock, flowers, a bush or a lone tree.
 */
function pick(f: number, stand: number, draw: Roll): Kind | "pine" | null {
  const u = draw("what")
  const tree = () => (draw("pine") < 0.15 + 0.5 * stand * (f < CORE ? 1.4 : 1) ? "pine" : "tree")
  if (f >= CORE) return u < 0.82 ? tree() : u < 0.92 ? "bush" : "rock"
  if (f >= RIM) {
    if (u < 0.25 + 0.6 * ((f - RIM) / (CORE - RIM))) return tree()
    return u < 0.75 ? "bush" : u < 0.88 ? "rock" : "flower"
  }
  return u < 0.03 ? "rock" : u < 0.08 ? "flower" : u < 0.1 ? "bush" : u < 0.11 ? "tree" : null
}

/** The shore band: open grass with rocks along the water, a bush or flowers now and then. */
function pickShore(draw: Roll): Kind | null {
  const u = draw("what")
  return u < 0.12 ? "rock" : u < 0.16 ? "flower" : u < 0.18 ? "bush" : null
}

/**
 * One Poisson-disk tile, its points kept half a spacing in from every side so tiles laid edge to edge
 * never bring two points closer than the spacing. Sampling a square is cheap; sampling each green
 * block (the island round the town, its box most of the map) is not.
 */
function tile(draw: Roll): Vec2[] {
  const h = SPACING / 2
  return poissonIn(
    [
      [h, h],
      [TILE - h, h],
      [TILE - h, TILE - h],
      [h, TILE - h],
    ],
    SPACING,
    draw,
  )
}

/** The cells of a grid `CELL` wide that a box covers. */
function* cellsOf(lo: Vec2, hi: Vec2): Generator<string> {
  for (let i = Math.floor(lo[0] / CELL); i <= Math.floor(hi[0] / CELL); i++)
    for (let j = Math.floor(lo[1] / CELL); j <= Math.floor(hi[1] / CELL); j++) yield `${i},${j}`
}

/**
 * Whether a point lies within `clear` of anything already on the ground: a building's footprint, a
 * field, the inside of a closed edge or the line of any edge, or another placement.
 */
function obstacles(plan: NatureInput, lib: TownLibrary): (p: Vec2, clear: number) => boolean {
  const sizes = new Map(lib.prefabs.map((m) => [m.id, m]))
  const pad = Math.max(...Object.values(CLEAR)) + 0.5
  const rects = new Map<string, Rect[]>()
  const points = new Map<string, Vec2[]>()
  const add2 = <T>(grid: Map<string, T[]>, lo: Vec2, hi: Vec2, item: T) => {
    for (const k of cellsOf(lo, hi)) {
      const list = grid.get(k)
      if (list) list.push(item)
      else grid.set(k, [item])
    }
  }
  for (const pl of plan.placements ?? []) {
    const m = sizes.get(pl.prefab)
    const r = m ? Math.hypot(m.frontage, m.depth) / 2 + pad : pad
    const lo: Vec2 = [pl.at[0] - r, pl.at[1] - r]
    const hi: Vec2 = [pl.at[0] + r, pl.at[1] + r]
    if (m) add2(rects, lo, hi, { c: pl.at, rot: pl.rot, w: m.frontage, d: m.depth })
    else add2(points, lo, hi, pl.at)
  }
  type Shape = { ring: Vec2[]; closed: boolean }
  const shapes = new Map<string, Shape[]>()
  for (const s of [
    ...(plan.fields ?? []).map((f) => ({ ring: f.poly, closed: true })),
    ...(plan.edges ?? []).map((e) => ({ ring: e.points, closed: e.closed })),
  ]) {
    const [lo, hi] = bbox(s.ring)
    add2(shapes, [lo[0] - pad, lo[1] - pad], [hi[0] + pad, hi[1] + pad], s)
  }
  return (p, clear) => {
    const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`
    for (const r of rects.get(k) ?? []) {
      const { x, z } = axes(r.rot)
      const d = sub(p, r.c)
      if (Math.abs(dot(d, x)) <= r.w / 2 + clear && Math.abs(dot(d, z)) <= r.d / 2 + clear) return true
    }
    for (const s of shapes.get(k) ?? [])
      if ((s.closed && contains(s.ring, p, 0)) || distTo(p, s.ring, s.closed) < clear) return true
    for (const q of points.get(k) ?? []) if (dist(p, q) < clear + 0.5) return true
    return false
  }
}

/** Smooth value noise in [0, 1] on a lattice `cell` metres wide, every lattice value a draw. */
function noise(cell: number, draw: Roll): (p: Vec2) => number {
  const cache = new Map<string, number>()
  const value = (i: number, j: number) => {
    const k = `${i}:${j}`
    let v = cache.get(k)
    if (v === undefined) {
      v = draw(k)
      cache.set(k, v)
    }
    return v
  }
  return (p) => {
    const x = p[0] / cell
    const z = p[1] / cell
    const i = Math.floor(x)
    const j = Math.floor(z)
    const fx = fade(x - i)
    const fz = fade(z - j)
    const a = value(i, j) + (value(i + 1, j) - value(i, j)) * fx
    const b = value(i, j + 1) + (value(i + 1, j + 1) - value(i, j + 1)) * fx
    return a + (b - a) * fz
  }
}

const fade = (t: number) => t * t * (3 - 2 * t)
const smooth = (t: number) => fade(Math.min(1, Math.max(0, t)))
