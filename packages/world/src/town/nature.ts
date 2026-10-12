/**
 * Stage 8, the wild part (plan §4; nature v2): what grows on the green nobody farms, composed rather
 * than sprinkled. The field (nature-field.ts) says where woods stand and how dense they are; this
 * stage plants it in four passes, each keeping clear of what came before:
 *
 * 1. Glades: an open ring of flowers round a stump at each glade's heart (W8 may claim a glade).
 * 2. Lines: trees along country roads in runs with gaps, a boulder at a bend; hedgerow bushes and
 *    the odd tree along the outside of field edges.
 * 3. Vignettes (nature-vignettes.ts): small authored scenes stamped where they belong: deadfall and
 *    mushroom rings in the woods, thickets and boulders at their edges, an old tree ringed with
 *    flowers or a birch copse in a meadow, stones and reeds on the shore, outcrops on rough ground.
 * 4. Scatter: a jittered grid (one seeded candidate per 2 m cell, kept only clear of its neighbours),
 *    read against the field: a closed canopy of full-grown trees in a wood's core, young trees, bushes
 *    and tall grass in the band round it, a few trees and bushes in the meadow beside, flowers in
 *    drifts, rocks only where the ground is rocky (the shore, rough far ground), never one alone.
 *
 * Species zone by the field (pines on the coast and far rough ground and in pine patches, birch
 * patches, one broadleaf leading each stand, mixes at the borders); trees are sized by age (young at a
 * wood's edge, old and big alone in a meadow) and toned a step lighter or darker by stand. Every plant
 * carries a cluster key (its wood or the wild, and a 24 m cell) for the LOD batch. Nothing stands on a
 * street, in the water, in a field, inside a closed fence or hedge, on an edge, or on a building's
 * footprint (a placement of a known prefab: a rect at `at`, turned by `rot`), and no tree on the shore.
 */
import { PALETTE } from "@guildhall/assets"
import { DMath } from "@guildhall/core"
import { distTo, lineIndex } from "../geom/line.ts"
import { axes, type Rect } from "../geom/obb.ts"
import { bbox, contains, insideIndex } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { dist, dot, round3, snap, sub, type Vec2 } from "../geom/vec.ts"
import { SHORE, seedOf } from "./farms.ts"
import { hash, type NatureField, natureField } from "./nature-field.ts"
import { type Setting, type Slot, VIGNETTES, type Vignette, vignetteFor } from "./nature-vignettes.ts"
import type { Placement, TownLibrary, TownPlan } from "./types.ts"

export {
  BELT,
  type Glade,
  type GroundTint,
  type NatureField,
  natureField,
  type Wood,
} from "./nature-field.ts"
export { SLOTS, type Slot, VIGNETTES, type Vignette } from "./nature-vignettes.ts"

/**
 * What nature reads beyond the pinned library, every list optional: which trees are pines, birches
 * and willows, and the ground cover (flowers, tall grass, reeds, mushrooms, fallen logs, stumps,
 * boulders, flat stones). A slot the library leaves empty falls back (boulders and stones to rocks,
 * birches and willows to the broadleaf trees) or is left out.
 */
export interface NatureExtras {
  pines?: string[]
  flowers?: string[]
  birches?: string[]
  willows?: string[]
  grass?: string[]
  reeds?: string[]
  mushrooms?: string[]
  logs?: string[]
  stumps?: string[]
  boulders?: string[]
  stones?: string[]
}
export type NatureLibrary = TownLibrary & { wild?: NatureExtras }

export type NatureInput = Pick<TownPlan, "bounds" | "blocks"> &
  Partial<Pick<TownPlan, "placements" | "edges" | "fields" | "water" | "spec" | "streets">> & {
    /**
     * Whether the ground within `clear` of p is free of what the plan's own lists do not hold (the
     * island's occupancy raster: settlement frames, POI pads, lakes); absent, all of it is.
     */
    free?: (p: Vec2, clear: number) => boolean
  }

/** The scatter's grid pitch, metres: one candidate per cell. */
const PITCH = 2
/** The green's index cells, metres (a whole number of PITCH). */
const GREEN = 16
/** Vignette sites sit on a jittered grid this wide, metres. */
const SITE = 13
/** Cluster cells (one far LOD shell each), metres. */
const CLUSTER = 24
/** Cover at and above which a point is a wood's core, its edge band, and its fringe in the meadow. */
const CORE = 0.62
const EDGE = 0.3
const FRINGE = 0.08
/** Clearance from anything built or fenced, and from the block's edge (the kerb of a street), metres. */
const CLEAR = { tree: 2, bush: 1, rock: 1, flower: 0.5 } as const
type Role = keyof typeof CLEAR

/** Each slot's role in the plan (what the rest of the town knows plants by), and its footprint radius. */
const SLOT: Record<Slot, { role: Role; r: number }> = {
  tree: { role: "tree", r: 2.4 },
  pine: { role: "tree", r: 1.7 },
  birch: { role: "tree", r: 1.8 },
  willow: { role: "tree", r: 2.6 },
  bush: { role: "bush", r: 1.1 },
  grass: { role: "bush", r: 0.45 },
  reed: { role: "bush", r: 0.4 },
  flower: { role: "flower", r: 0.35 },
  mushroom: { role: "flower", r: 0.3 },
  rock: { role: "rock", r: 0.7 },
  boulder: { role: "rock", r: 1.6 },
  stone: { role: "rock", r: 0.9 },
  log: { role: "rock", r: 1.6 },
  stump: { role: "rock", r: 0.8 },
}

/** Foliage tone shifts a step darker or lighter on the leaf and grass ramps (trees and bushes). */
const TONES = toneShifts()

export function nature(
  plan: NatureInput,
  lib: NatureLibrary,
  roll: Roll,
  field: NatureField = natureField(plan, roll),
): Placement[] {
  const kit = slotIds(lib)
  if (kit.tree.ids.length === 0 && kit.bush.ids.length === 0 && kit.rock.ids.length === 0) return []
  const seed = Math.floor(roll("plant-seed") * 4294967296) >>> 0
  const h = (i: number, j: number, k: number) => hash(seed, i, j, k)
  const blocked = obstacles(plan, lib)
  const green = greenIndex(plan)
  const [bmin, bmax] = bbox(plan.bounds)
  const taken = occupancy()
  const out: Placement[] = []

  /**
   * Whether a plant of `slot` may stand at p: on the green, clear of the kerb and of what is built
   * (by `pad` metres more, when the test stands for a few plants round p).
   */
  const fits = (p: Vec2, slot: Slot, pad = 0): boolean => {
    const role = SLOT[slot].role
    const clear = CLEAR[role] + pad
    const home = green.at(p)
    if (!home) return false
    if (!(home.deep && pad === 0) && home.home.edge.near(p, clear) < clear) return false
    if (blocked(p, clear)) return false
    if (plan.free && !plan.free(p, clear)) return false
    if (role === "tree" && field.inShore(p)) return false
    return true
  }
  /** The plant as a placement (its id, seed, turn, size, tone and cluster drawn from `u`s). */
  const emit = (slot: Slot, p: Vec2, size: number, turn: number, u: (k: number) => number): void => {
    const pick = kit[slot]
    const list = slot === "tree" ? standIds(pick.ids, field.stand(p), u(0)) : pick.ids
    const role = SLOT[slot].role
    const wood = field.woodAt(p)
    const at = snap(p)
    const pl: Placement = {
      prefab: list[Math.floor(u(1) * list.length)] as string,
      seed: seedOf(u(2)),
      at,
      rot: round3(turn),
      role,
      scale: round2(size * pick.scale),
      cluster: `${wood >= 0 ? `wood${wood}` : "wild"}:${Math.floor(at[0] / CLUSTER)},${Math.floor(at[1] / CLUSTER)}`,
    }
    if (role === "tree" || role === "bush") {
      const shift = 0.8 * field.tone(p) + 1.4 * (u(3) - 0.5)
      if (shift < -0.6) pl.swatchMap = TONES.darker
      else if (shift > 0.6) pl.swatchMap = TONES.lighter
    }
    out.push(pl)
  }
  /** Plants one piece if it fits and is clear of its neighbours; true when it went in. */
  const put = (
    slot: Slot,
    p: Vec2,
    size: number,
    turn: number,
    u: (k: number) => number,
    checked = false,
  ): boolean => {
    if (kit[slot].ids.length === 0) return false
    const r = SLOT[slot].r * size * kit[slot].scale
    if (taken.clash(p, r) || (!checked && !fits(p, slot))) return false
    taken.add(p, r)
    emit(slot, p, size, turn, u)
    return true
  }
  /** Stamps a vignette at p turned by `turn`: its pieces that fit, if at least two (and its first) do. */
  const stamp = (v: Vignette, p: Vec2, turn: number, size: number, u: (k: number) => number): void => {
    const c = DMath.cos(turn)
    const s = DMath.sin(turn)
    const ok: { slot: Slot; at: Vec2; size: number; r: number; turn: number; k: number }[] = []
    v.pieces.forEach((piece, k) => {
      if (kit[piece.slot].ids.length === 0) return
      const at: Vec2 = [p[0] + size * (piece.x * c - piece.z * s), p[1] + size * (piece.x * s + piece.z * c)]
      const sz = size * (piece.scale ?? 1) * (0.9 + 0.2 * u(100 + k))
      const r = SLOT[piece.slot].r * sz * kit[piece.slot].scale
      if (taken.clash(at, r) || !fits(at, piece.slot)) return
      const t = piece.rot === undefined ? 2 * Math.PI * u(200 + k) : turn + piece.rot
      ok.push({ slot: piece.slot, at, size: sz, r, turn: t, k })
    })
    if (ok.length < 2 || ok[0]?.k !== 0) return
    for (const o of ok) {
      taken.add(o.at, o.r)
      emit(o.slot, o.at, o.size, o.turn, (k) => u(300 + 10 * o.k + k))
    }
  }

  // 1. Glades: an open ring at each heart.
  const glade = VIGNETTES.find((v) => v.id === "glade-ring") as Vignette
  for (const g of field.glades) {
    const u = (k: number) => h(g.id, -1, k)
    stamp(glade, g.at, 2 * Math.PI * u(0), 0.9 + 0.3 * u(1), u)
  }

  // 2. Lines: roadside trees and bend boulders, hedgerows along fields.
  roadsides(plan, field, h, put, (p, turn, u) => {
    const v = vignetteFor("bend", u(0))
    if (v) stamp(v, p, turn, 0.8 + 0.3 * u(1), u)
  })
  hedgerows(plan, field, h, put)

  // 3. Vignettes where they belong.
  for (let i = Math.floor(bmin[0] / SITE); i * SITE < bmax[0]; i++)
    for (let j = Math.floor(bmin[1] / SITE); j * SITE < bmax[1]; j++) {
      const u = (k: number) => h(i, j, 1000 + k)
      const p: Vec2 = [(i + 0.1 + 0.8 * u(0)) * SITE, (j + 0.1 + 0.8 * u(1)) * SITE]
      // A glade keeps its own ring; nothing else is stamped in it or on its rim.
      if (!green.maybe(p) || field.glades.some((g) => dist(p, g.at) < g.r + 5)) continue
      const v = vignetteFor(settingAt(field, p), u(2))
      if (v) stamp(v, p, 2 * Math.PI * u(3), 0.85 + 0.3 * u(4), u)
    }

  // 4. The scatter.
  const per = GREEN / PITCH
  for (const [gi, gj] of green.cells)
    for (let j = gj * per; j < (gj + 1) * per; j++)
      for (let i = gi * per; i < (gi + 1) * per; i++) {
        const u = (k: number) => h(i, j, k)
        const p: Vec2 = [(i + u(0)) * PITCH, (j + u(1)) * PITCH]
        const what = scatterAt(field, p, u)
        if (!what) continue
        if (what.slot === "flower") {
          // A drift: three to five flowers of one kind close together.
          // Its ground is checked once, wide enough for every flower in it (none is over 0.7 m out).
          if (!fits(p, "flower", 0.75)) continue
          const n = 3 + Math.floor(3 * u(20))
          for (let k = 0; k < n; k++) {
            const q: Vec2 = [p[0] + 1.4 * (u(30 + k) - 0.5), p[1] + 1.4 * (u(40 + k) - 0.5)]
            put(
              "flower",
              q,
              0.85 + 0.3 * u(50 + k),
              2 * Math.PI * u(60 + k),
              (m) => (m === 1 ? u(9) : u(70 + 5 * k + m)),
              true,
            )
          }
          continue
        }
        put(what.slot, p, what.size, 2 * Math.PI * u(5), (k) => u(10 + k))
      }
  return out
}

/** What a scatter cell grows, from the field there (null for open grass, most of the meadow). */
function scatterAt(
  field: NatureField,
  p: Vec2,
  u: (k: number) => number,
): { slot: Slot; size: number } | null {
  const edge = field.coast(p)
  const x = u(2)
  if (edge < SHORE[1] && edge < field.shore(p)) {
    // The shore strip: rocks where the ground is rocky, tufts of grass, nothing tall.
    const rocky = field.rocky(p)
    if (x < 0.22 * rocky) return { slot: u(3) < 0.4 ? "stone" : "rock", size: 0.7 + 0.6 * u(4) }
    return x > 0.95 ? { slot: "grass", size: 1 } : null
  }
  const c = field.cover(p) + 0.12 * (u(3) - 0.5)
  if (c >= CORE) {
    if (x < 0.72) return { slot: treeSlot(field, p, edge, u), size: 0.9 + 0.35 * u(4) }
    if (x < 0.78) return { slot: "bush", size: 0.8 + 0.4 * u(4) }
    if (x < 0.82) return { slot: "grass", size: 1.1 }
    return x < 0.835 ? { slot: "mushroom", size: 1 } : null
  }
  if (c >= EDGE) {
    // The forest's edge band: young trees thinning outward, bushes and tall grass between them.
    const t = (c - EDGE) / (CORE - EDGE)
    const tree = 0.1 + 0.5 * t
    const bush = tree + 0.2
    const grass = bush + 0.14
    const rock = grass + 0.03 * field.rocky(p)
    if (x < tree) return { slot: treeSlot(field, p, edge, u), size: 0.55 + 0.35 * t + 0.15 * u(4) }
    if (x < bush) return { slot: "bush", size: 0.7 + 0.5 * u(4) }
    if (x < grass) return { slot: "grass", size: 0.9 + 0.4 * u(4) }
    if (x < rock) return { slot: "rock", size: 0.6 + 0.6 * u(4) }
    return x < rock + 0.05 ? { slot: "flower", size: 1 } : null
  }
  if (c >= FRINGE) {
    if (x < 0.04) return { slot: treeSlot(field, p, edge, u), size: 0.75 + 0.4 * u(4) }
    if (x < 0.09) return { slot: "bush", size: 0.7 + 0.5 * u(4) }
    if (x < 0.17) return { slot: "grass", size: 1 }
  }
  const d = field.drift(p)
  if (d > 0 && u(6) < 0.55 * d) return { slot: "flower", size: 1 }
  if (x > 0.9993 && field.glade(p) < 0) return { slot: treeSlot(field, p, edge, u), size: 1.15 + 0.25 * u(4) }
  return null
}

/** Which tree grows at p: pines where they lead, birch in birch patches, willows by the water. */
function treeSlot(field: NatureField, p: Vec2, edge: number, u: (k: number) => number): Slot {
  if (field.pine(p) + 0.35 * (u(7) - 0.5) > 0.5) return "pine"
  if (edge < SHORE[1] + 7 && edge < field.shore(p) + 7 && u(8) < 0.5) return "willow"
  if (field.birch(p) + 0.3 * (u(8) - 0.5) > 0.5) return "birch"
  return "tree"
}

/** The setting a vignette site lies in. */
function settingAt(field: NatureField, p: Vec2): Setting {
  const edge = field.coast(p)
  if (edge < SHORE[1] && edge < field.shore(p)) return "shore"
  const c = field.cover(p)
  if (field.wild(p) > 0.6 && field.rocky(p) > 0.3 && c < CORE) return "rough"
  return c >= CORE ? "core" : c >= EDGE ? "edge" : c >= FRINGE ? "fringe" : "meadow"
}

/** Broadleaf trees: the stand's lead id most of the time, any other now and then (mixed borders). */
function standIds(ids: readonly string[], stand: number, u: number): readonly string[] {
  if (ids.length < 2 || u < 0.2) return ids
  return [ids[Math.floor(stand * ids.length)] as string]
}

type Put = (slot: Slot, p: Vec2, size: number, turn: number, u: (k: number) => number) => boolean
type Hash = (i: number, j: number, k: number) => number

/**
 * Trees along the country roads, both sides, in runs with gaps (one species per run), a road's width
 * and three metres out; at a bend, now and then, a boulder vignette on its outside.
 */
function roadsides(
  plan: NatureInput,
  field: NatureField,
  h: Hash,
  put: Put,
  bend: (p: Vec2, turn: number, u: (k: number) => number) => void,
): void {
  for (const e of plan.streets?.edges ?? []) {
    if (e.cls !== "road") continue
    let s = 0
    for (let k = 0; k + 1 < e.points.length; k++) {
      const a = e.points[k] as Vec2
      const b = e.points[k + 1] as Vec2
      const l = dist(a, b)
      if (l < 1e-6) continue
      const dir: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
      const left: Vec2 = [-dir[1], dir[0]]
      for (const side of [1, -1]) {
        const off = side * (e.width / 2 + 3.2)
        for (
          let t = (h(e.id, k, 2000 + side) * 9) % l;
          t < l;
          t += 9 + 4 * h(e.id, Math.floor(s + t), 2100 + side)
        ) {
          const run = Math.floor((s + t) / 40)
          const u = (m: number) => h(e.id, Math.floor((s + t) * 10), 2200 + 10 * side + m)
          if (h(e.id, run, 2300 + side) > 0.45) continue
          const p: Vec2 = [a[0] + dir[0] * t + left[0] * off, a[1] + dir[1] * t + left[1] * off]
          if (field.cover(p) > EDGE) continue
          const slot: Slot = field.pine(p) > 0.6 ? "pine" : h(e.id, run, 2400) < 0.35 ? "birch" : "tree"
          put(slot, p, 1 + 0.25 * u(0), 2 * Math.PI * u(1), u)
        }
      }
      s += l
      // The bend at b: the turn's outside is away from where the road turns to.
      const c = e.points[k + 2]
      if (!c) continue
      const lc = dist(b, c)
      if (lc < 1e-6) continue
      const next: Vec2 = [(c[0] - b[0]) / lc, (c[1] - b[1]) / lc]
      const turn = dir[0] * next[1] - dir[1] * next[0]
      if (Math.abs(turn) < 0.3 || h(e.id, k, 2500) > 0.5) continue
      const out: Vec2 = [next[0] - dir[0], next[1] - dir[1]]
      const lo = Math.sqrt(out[0] * out[0] + out[1] * out[1])
      const away = (e.width / 2 + 4) / lo
      const p: Vec2 = [b[0] - out[0] * away, b[1] - out[1] * away]
      bend(p, 2 * Math.PI * h(e.id, k, 2600), (m) => h(e.id, k, 2700 + m))
    }
  }
}

/** Hedgerows: on about half a field's sides, bushes along its outside with a tree now and then. */
function hedgerows(plan: NatureInput, field: NatureField, h: Hash, put: Put): void {
  ;(plan.fields ?? []).forEach((f, fi) => {
    const ring = f.poly
    let area = 0
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k] as Vec2
      const b = ring[(k + 1) % ring.length] as Vec2
      area += a[0] * b[1] - b[0] * a[1]
    }
    const turn = area >= 0 ? 1 : -1
    for (let k = 0; k < ring.length; k++) {
      if (h(fi, k, 3000) > 0.5) continue
      const a = ring[k] as Vec2
      const b = ring[(k + 1) % ring.length] as Vec2
      const l = dist(a, b)
      const dir: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
      // Outside a counter-clockwise ring is to the right of its direction.
      const out: Vec2 = [turn * dir[1], -turn * dir[0]]
      for (let t = 1.5, n = 0; t < l - 1.5; t += 2.4 + 0.8 * h(fi, k * 100 + n, 3100), n++) {
        const u = (m: number) => h(fi, k * 100 + n, 3200 + m)
        if (u(0) < 0.15) continue
        const tree = u(1) < 0.12
        const off = tree ? 3.2 : 2.3
        const p: Vec2 = [a[0] + dir[0] * t + out[0] * off, a[1] + dir[1] * t + out[1] * off]
        if (tree) put(field.pine(p) > 0.6 ? "pine" : "tree", p, 0.9 + 0.3 * u(2), 2 * Math.PI * u(3), u)
        else put("bush", p, 0.8 + 0.4 * u(2), 2 * Math.PI * u(3), u)
      }
    }
  })
}

/** Each slot's ids from the library, with the size its stand-in is drawn at (boulders from rocks: big). */
function slotIds(lib: NatureLibrary): Record<Slot, { ids: readonly string[]; scale: number }> {
  const w = lib.wild ?? {}
  const clean = (l: readonly string[] | undefined) => (l ?? []).filter((id) => id.length > 0)
  const pines = clean(w.pines)
  const trees = clean(lib.nature.trees)
  const broad = trees.filter((t) => !pines.includes(t))
  const tree = broad.length > 0 ? broad : trees
  const rocks = clean(lib.nature.rocks)
  const either = (own: readonly string[], fallback: readonly string[], scale = 1) =>
    own.length > 0 ? { ids: own, scale: 1 } : { ids: fallback, scale }
  const grass = clean(w.grass)
  return {
    tree: { ids: tree, scale: 1 },
    pine: either(pines, trees),
    birch: either(clean(w.birches), tree),
    willow: either(clean(w.willows), tree),
    bush: { ids: clean(lib.nature.bushes), scale: 1 },
    grass: { ids: grass, scale: 1 },
    reed: either(clean(w.reeds), grass),
    flower: { ids: clean(w.flowers), scale: 1 },
    mushroom: { ids: clean(w.mushrooms), scale: 1 },
    rock: { ids: rocks, scale: 1 },
    boulder: either(clean(w.boulders), rocks, 1.7),
    stone: either(clean(w.stones), rocks, 0.75),
    log: { ids: clean(w.logs), scale: 1 },
    stump: { ids: clean(w.stumps), scale: 1 },
  }
}

/** Swatch maps one tone darker and one lighter on the foliage ramps (leaf and grass). */
function toneShifts(): { darker: Record<number, number>; lighter: Record<number, number> } {
  const darker: Record<number, number> = {}
  const lighter: Record<number, number> = {}
  for (const name of ["leaf", "grass"]) {
    const ramp = PALETTE.ramps.find((r) => r.name === name)
    if (!ramp) continue
    const { dark, base, light } = ramp.tones
    darker[base] = dark
    darker[light] = base
    lighter[dark] = base
    lighter[base] = light
  }
  return { darker, lighter }
}

const round2 = (x: number) => Math.round(x * 100) / 100

/** Placed plants by footprint disc, on a 5 m grid: `clash` when one is too close to a new one. */
function occupancy() {
  const CELL = 5
  const cells = new Map<number, number[]>()
  const xs: number[] = []
  const zs: number[] = []
  const rs: number[] = []
  const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)
  return {
    clash(p: Vec2, r: number): boolean {
      const ci = Math.floor(p[0] / CELL)
      const cj = Math.floor(p[1] / CELL)
      for (let i = ci - 1; i <= ci + 1; i++)
        for (let j = cj - 1; j <= cj + 1; j++)
          for (const k of cells.get(key(i, j)) ?? []) {
            const o = rs[k] as number
            const need = 0.5 * (r + o) + 0.25 * Math.min(r, o)
            const dx = p[0] - (xs[k] as number)
            const dz = p[1] - (zs[k] as number)
            if (dx * dx + dz * dz < need * need) return true
          }
      return false
    },
    add(p: Vec2, r: number): void {
      const k = xs.length
      xs.push(p[0])
      zs.push(p[1])
      rs.push(r)
      const c = key(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL))
      const list = cells.get(c)
      if (list) list.push(k)
      else cells.set(c, [k])
    },
  }
}

type Home = { inside: (p: Vec2) => boolean; edge: { near: (p: Vec2, max: number) => number } }

/**
 * The green blocks, bucketed on a grid of GREEN-wide cells: `at(p)` is the block p stands in (`deep`
 * when p's cell lies wholly inside it, clear of its outline by more than any clearance); `maybe(p)` is
 * a cheap test that p's cell touches the green at all (most of the map is town or sea).
 */
function greenIndex(plan: NatureInput): {
  at: (p: Vec2) => { home: Home; deep: boolean } | null
  maybe: (p: Vec2) => boolean
  /** The cells (grid indices) that touch the green, row by row. */
  cells: [i: number, j: number][]
} {
  const blocks = plan.blocks.filter((b) => b.use === "green")
  if (blocks.length === 0) return { at: () => null, maybe: () => false, cells: [] }
  const [lo, hi] = bbox(blocks.flatMap((b) => b.poly))
  const i0 = Math.floor(lo[0] / GREEN)
  const j0 = Math.floor(lo[1] / GREEN)
  const cols = Math.floor(hi[0] / GREEN) - i0 + 1
  const rows = Math.floor(hi[1] / GREEN) - j0 + 1
  const cells: (Home[] | undefined)[] = new Array(cols * rows)
  const deep = new Uint8Array(cols * rows)
  const half = GREEN * Math.SQRT1_2
  const margin = Math.max(...Object.values(CLEAR)) + 0.5
  for (const b of blocks) {
    const home: Home = { inside: insideIndex([b.poly]), edge: lineIndex([b.poly], true) }
    const [blo, bhi] = bbox(b.poly)
    for (let i = Math.floor(blo[0] / GREEN); i <= Math.floor(bhi[0] / GREEN); i++)
      for (let j = Math.floor(blo[1] / GREEN); j <= Math.floor(bhi[1] / GREEN); j++) {
        // A cell wholly outside the block (its centre out and the outline far) never holds it.
        const c: Vec2 = [(i + 0.5) * GREEN, (j + 0.5) * GREEN]
        const edge = home.edge.near(c, half + margin)
        const inside = home.inside(c)
        if (!inside && edge >= half) continue
        const k = (j - j0) * cols + (i - i0)
        const list = cells[k]
        if (list) {
          list.push(home)
          deep[k] = 0
        } else {
          cells[k] = [home]
          deep[k] = inside && edge >= half + margin ? 1 : 0
        }
      }
  }
  const index = (p: Vec2): number => {
    const i = Math.floor(p[0] / GREEN) - i0
    const j = Math.floor(p[1] / GREEN) - j0
    return i < 0 || j < 0 || i >= cols || j >= rows ? -1 : j * cols + i
  }
  const touched: [number, number][] = []
  for (let k = 0; k < cells.length; k++)
    if (cells[k]) touched.push([i0 + (k % cols), j0 + Math.floor(k / cols)])
  return {
    cells: touched,
    maybe: (p) => {
      const k = index(p)
      return k >= 0 && cells[k] !== undefined
    },
    at: (p) => {
      const k = index(p)
      const list = k >= 0 ? cells[k] : undefined
      if (!list) return null
      if (deep[k]) return { home: list[0] as Home, deep: true }
      const home = list.find((g) => g.inside(p))
      return home ? { home, deep: false } : null
    },
  }
}

/** The cells of a grid `CELL` wide that a box covers, as numeric keys. */
const CELL = 8
const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)
function* cellsOf(lo: Vec2, hi: Vec2): Generator<number> {
  for (let i = Math.floor(lo[0] / CELL); i <= Math.floor(hi[0] / CELL); i++)
    for (let j = Math.floor(lo[1] / CELL); j <= Math.floor(hi[1] / CELL); j++) yield cellKey(i, j)
}

/**
 * Whether a point lies within `clear` of anything already on the ground: a building's footprint, a
 * field, the inside of a closed edge or the line of any edge, or another placement.
 */
function obstacles(plan: NatureInput, lib: TownLibrary): (p: Vec2, clear: number) => boolean {
  const sizes = new Map(lib.prefabs.map((m) => [m.id, m]))
  const pad = Math.max(...Object.values(CLEAR)) + 0.5
  const rects = new Map<number, Rect[]>()
  const points = new Map<number, Vec2[]>()
  const add2 = <T>(grid: Map<number, T[]>, lo: Vec2, hi: Vec2, item: T) => {
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
  // `wide`: how far the line itself reaches (a street's half width; a lane's dead end can run into
  // a green block, off its outline).
  type Shape = { ring: Vec2[]; closed: boolean; wide: number; lo: Vec2; hi: Vec2 }
  const shapes = new Map<number, Shape[]>()
  for (const s of [
    ...(plan.fields ?? []).map((f) => ({ ring: f.poly, closed: true, wide: 0 })),
    ...(plan.edges ?? []).map((e) => ({ ring: e.points, closed: e.closed, wide: 0 })),
    ...(plan.streets?.edges ?? []).map((e) => ({ ring: e.points, closed: false, wide: e.width / 2 })),
  ]) {
    const [lo, hi] = bbox(s.ring)
    const r = pad + s.wide
    add2(shapes, [lo[0] - r, lo[1] - r], [hi[0] + r, hi[1] + r], { ...s, lo, hi })
  }
  return (p, clear) => {
    const k = cellKey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL))
    for (const r of rects.get(k) ?? []) {
      const { x, z } = axes(r.rot)
      const d = sub(p, r.c)
      if (Math.abs(dot(d, x)) <= r.w / 2 + clear && Math.abs(dot(d, z)) <= r.d / 2 + clear) return true
    }
    for (const s of shapes.get(k) ?? []) {
      const r = clear + s.wide
      if (p[0] < s.lo[0] - r || p[0] > s.hi[0] + r || p[1] < s.lo[1] - r || p[1] > s.hi[1] + r) continue
      if ((s.closed && contains(s.ring, p, 0)) || distTo(p, s.ring, s.closed) < r) return true
    }
    for (const q of points.get(k) ?? []) if (dist(p, q) < clear + 0.5) return true
    return false
  }
}
