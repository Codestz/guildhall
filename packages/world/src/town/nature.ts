/**
 * Stage 8, the wild part (plan §4): what grows on the green nobody farms. A forest belt runs inside
 * the bounds (18–30 m deep, wavering) and closes the region (Look bar #5); the woods thicken toward
 * the bounds' corners, far from the town; forest patches stand where a low-frequency noise runs
 * high; the rest is meadow with a rock, a bush or a clump of flowers here
 * and there. Woods are dense in their core (broadleaf, a few pines) and thin at their edges (pines,
 * bushes, rocks: undergrowth), so a wood reads as a mass with a ragged rim. Nothing stands on a
 * street, in the water, in a field, inside a closed fence or hedge, on an edge, or on a building's
 * footprint (a placement of a known prefab: a rect at `at`, turned by `rot`).
 */
import { distTo } from "../geom/line.ts"
import { axes, type Rect } from "../geom/obb.ts"
import { bbox, contains, type Ring } from "../geom/poly.ts"
import { poissonIn, type Roll } from "../geom/sample.ts"
import { add, at, dist, dot, round3, snap, sub, type Vec2 } from "../geom/vec.ts"
import { seedOf } from "./farms.ts"
import type { Placement, TownLibrary, TownPlan } from "./types.ts"

/** What nature reads beyond the pinned library: which trees are pines (the woods' rims), and flowers. */
export interface NatureExtras {
  pines?: string[]
  flowers?: string[]
}
export type NatureLibrary = TownLibrary & { wild?: NatureExtras }

export type NatureInput = Pick<TownPlan, "bounds" | "blocks"> &
  Partial<Pick<TownPlan, "placements" | "edges" | "fields">>

/** Samples this far apart: the spacing of trees in a wood's core, metres. */
const SPACING = 3.4
/** The belt's depth from the bounds, wavering between these, metres. */
const BELT = [18, 30] as const
/** Noise lattice steps for patches (two octaves) and for which species leads a stand, metres. */
const PATCH_CELL = [40, 17] as const
const STAND_CELL = 70
/** Woods thicken beyond this share of the bounds' half-width from the centre. */
const WILD_FROM = 0.95
/** Forest strength above which a sample is a wood's core, and above which it is a wood's rim. */
const CORE = 0.7
const RIM = 0.3
/** Clearance from anything built or fenced, and from the block's edge (the kerb of a street), metres. */
const CLEAR = { tree: 2, bush: 1, rock: 1, flower: 0.5 } as const
/** Samples come from a few Poisson-disk tiles this wide laid over the bounds, metres. */
const TILE = 48
const TILE_VARIANTS = 3
/** A grid cell for the placement lookup, metres. */
const CELL = 4

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
  const centre: Vec2 = [(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2]
  const half = (bmax[0] - bmin[0]) / 2
  const strength = (p: Vec2): number => {
    const fromEdge = Math.min(p[0] - bmin[0], bmax[0] - p[0], p[1] - bmin[1], bmax[1] - p[1])
    const depth = BELT[0] + (BELT[1] - BELT[0]) * waver(p)
    const belt = smooth((depth - fromEdge) / 10 + 0.5)
    // Away from the town the woods close in: the bounds' corners are forest, the ring by the walls open.
    const far = smooth((dist(p, centre) / half - WILD_FROM) / 0.3) * (0.5 + 0.5 * patch(p))
    return Math.max(belt, far, smooth((patch(p) - 0.44) / 0.16))
  }

  const green = plan.blocks.filter((b) => b.use === "green").map((b) => ({ b, box: bbox(b.poly) }))
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
        const home = near.find(({ b }) => inside(b.poly, p))
        if (!home) return
        const draw = (salt: string) => roll(`${tx}:${tz}:${i}:${salt}`)
        const kind = pick(strength(p), stand(p), draw)
        const list = kind ? ids[kind] : []
        if (!kind || list.length === 0) return
        const role: Kind = kind === "pine" ? "tree" : kind
        if (distTo(p, home.b.poly, true) < CLEAR[role] || blocked(p, CLEAR[role])) return
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

/**
 * One Poisson-disk tile, its points kept half a spacing in from every side so tiles laid edge to edge
 * never bring two points closer than the spacing. Sampling a square is cheap; sampling each green
 * block (a ring round the town, its box the whole bounds) is not.
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

/**
 * Whether a point lies within `clear` of anything already on the ground: a building's footprint, a
 * field, the inside of a closed edge or the line of any edge, or another placement.
 */
function obstacles(plan: NatureInput, lib: TownLibrary): (p: Vec2, clear: number) => boolean {
  const sizes = new Map(lib.prefabs.map((m) => [m.id, m]))
  const rects: Rect[] = []
  const points = new Map<string, Vec2[]>()
  const key = (x: number, z: number) => `${x},${z}`
  for (const pl of plan.placements ?? []) {
    const m = sizes.get(pl.prefab)
    if (m) rects.push({ c: pl.at, rot: pl.rot, w: m.frontage, d: m.depth })
    else {
      const k = key(Math.floor(pl.at[0] / CELL), Math.floor(pl.at[1] / CELL))
      const list = points.get(k) ?? []
      list.push(pl.at)
      points.set(k, list)
    }
  }
  const shapes = [
    ...(plan.fields ?? []).map((f) => ({ ring: f.poly, closed: true })),
    ...(plan.edges ?? []).map((e) => ({ ring: e.points, closed: e.closed })),
  ].map((s) => ({ ...s, box: bbox(s.ring) }))
  return (p, clear) => {
    for (const r of rects) {
      const { x, z } = axes(r.rot)
      const d = sub(p, r.c)
      if (Math.abs(dot(d, x)) <= r.w / 2 + clear && Math.abs(dot(d, z)) <= r.d / 2 + clear) return true
    }
    for (const s of shapes) {
      const [lo, hi] = s.box
      if (p[0] < lo[0] - clear || p[0] > hi[0] + clear || p[1] < lo[1] - clear || p[1] > hi[1] + clear)
        continue
      if ((s.closed && contains(s.ring, p, 0)) || distTo(p, s.ring, s.closed) < clear) return true
    }
    const cx = Math.floor(p[0] / CELL)
    const cz = Math.floor(p[1] / CELL)
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cz - 1; j <= cz + 1; j++)
        for (const q of points.get(key(i, j)) ?? []) if (dist(p, q) < clear + 0.5) return true
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

/**
 * Whether p is inside the ring, by crossings alone: `contains` also measures the distance to every
 * side, which the samples (thousands per town, most of them outside) cannot afford. A sample on a
 * side is then kept off it by the clearance anyway.
 */
function inside(ring: Ring, p: Vec2): boolean {
  let odd = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Vec2
    const b = ring[j] as Vec2
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      odd = !odd
  }
  return odd
}

const fade = (t: number) => t * t * (3 - 2 * t)
const smooth = (t: number) => fade(Math.min(1, Math.max(0, t)))
