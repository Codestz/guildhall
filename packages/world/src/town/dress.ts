/**
 * Stage 11 (plan §4): the plan as render draws it, flat and serialisable. Each placement whose prefab
 * was compiled expands through its recipe (every instance moved into the placement's frame, its
 * `rampMap` baked into a `swatchMap` against the shared palette); any other placement names a catalog
 * piece and is drawn as that one piece at its footprint's centre. Edges lay out through their kit
 * (segments, towers, gates). Pieces come out sorted by piece id, so each piece's instances are one
 * run for the batch. The ground is the land with the lakes as holes, painted with the street
 * ribbons, the square, the castle ward, the quay, fields and plots; footprints of buildings and walls
 * are kept for contact darkening; the water carries its shore lines (the land's outline). townGround and
 * townWater are the ground and water alone, for the worker that builds their meshes (ground.ts, water.ts).
 */
import { PALETTE, type Recipe, type RecipeInstance, rampMapToSwatchMap } from "@guildhall/assets"
import { ribbon } from "../geom/line.ts"
import { axes, rectCorners } from "../geom/obb.ts"
import { area, bbox, clip, type MultiPolygon, type Ring } from "../geom/poly.ts"
import { add, at, EPS, round3, scale, snap, type Vec2 } from "../geom/vec.ts"
import { type EdgeKitProfile, edgeKits, edgePieces } from "./edges.ts"
import type { Plot } from "./interiors.ts"
import { normalizeSpec } from "./spec.ts"
import {
  type Edge,
  LEVELS,
  type PieceInstance,
  type Placement,
  type TownDraw,
  type TownPlan,
} from "./types.ts"

/** The kit each edge kind is laid out with (edges.ts `edgeKits(tier)` by default). */
export type DressKits = Record<Edge["kind"], EdgeKitProfile>

/** Placement roles that are plants: they stand close together and leave no footprint. */
export const PLANT_ROLES: ReadonlySet<string> = new Set(["crop", "tree", "bush", "flower", "rock", "orchard"])
/** Placement roles that are buildings (besides every compiled prefab): their footprints darken the ground. */
const BUILDING_ROLES: ReadonlySet<string> = new Set(["keep", "barn", "shed", "farmhouse"])

/**
 * The key a compiled recipe is looked up by: a placement's own variant (`prefab#seed`) first, then the
 * prefab's one recipe (`prefab`), so a caller may compile every variant or one per prefab.
 */
export const recipeKey = (prefab: string, seed: number): string => `${prefab}#${seed}`

/** What dressing reads beyond the pinned plan (a generated TownLayout has both). */
export type DressInput = TownPlan & { plots?: readonly Plot[]; sizes?: Record<string, [number, number]> }

type Overlay = TownDraw["ground"]["overlays"][number]

export function dressTown(
  plan: DressInput,
  compiled: ReadonlyMap<string, Recipe>,
  kits: DressKits = edgeKits(normalizeSpec(plan.spec).tier),
): TownDraw {
  const swatches = new Map<string, Record<number, number>>()
  const recipeOf = (p: Placement) => compiled.get(recipeKey(p.prefab, p.seed)) ?? compiled.get(p.prefab)
  const pieces: PieceInstance[] = []
  for (const p of [...plan.placements, ...plan.nature]) {
    const recipe = recipeOf(p)
    if (!recipe) {
      pieces.push(instance(p.prefab, p.at, 0, p.rot, 1))
      continue
    }
    const { x, z } = axes(p.rot)
    for (const i of recipe.instances) {
      const w = add(p.at, add(scale(x, i.x), scale(z, i.z)))
      const piece = instance(i.piece, w, i.y, p.rot + i.rot, i.scale)
      const map = swatchMap(i, swatches)
      pieces.push(map ? { ...piece, swatchMap: map } : piece)
    }
  }
  for (const e of plan.edges) pieces.push(...edgePieces(e, kits[e.kind]).map(tidy))
  // Stable by piece id: one run per piece for the batch, in plan order within it.
  const order = pieces.map((p, i) => ({ p, i }))
  order.sort((a, b) => (a.p.piece < b.p.piece ? -1 : a.p.piece > b.p.piece ? 1 : a.i - b.i))

  const ground = townGround(plan, (p) => recipeOf(p) !== undefined, kits.wall.thickness)
  return { pieces: order.map((o) => o.p), ground, water: townWater(plan, ground) }
}

/**
 * The town's ground alone (what the worker builds the ground mesh from): the land, the painted
 * overlays and the footprints of the placements `compiled` says are prefabs (or have a building's
 * role) and of the walls.
 */
export function townGround(
  plan: DressInput,
  compiled: (p: Placement) => boolean,
  wallThickness = edgeKits(normalizeSpec(plan.spec).tier).wall.thickness,
): TownDraw["ground"] {
  const footprints: Vec2[][] = []
  for (const p of plan.placements) {
    const size = plan.sizes?.[p.prefab]
    if (size && (compiled(p) || BUILDING_ROLES.has(p.role ?? "")))
      footprints.push(rectCorners({ c: p.at, rot: p.rot, w: size[0], d: size[1] }).map(snap))
  }
  for (const e of plan.edges) if (e.kind === "wall") footprints.push(...wallFootprint(e, wallThickness))
  return { ...landOf(plan), overlays: overlays(plan), footprints }
}

/** The town's water: its polygons, and the shore along the land's outline (never a seam between them). */
export function townWater(plan: TownPlan, ground: TownDraw["ground"]): TownDraw["water"] {
  const coast = [ground.land, ...ground.holes, ...(ground.islets ?? [])]
  return {
    polys: plan.water,
    level: LEVELS.water,
    shore: plan.water.length === 0 ? [] : coast.flatMap((r) => shoreOf(r, plan.bounds)),
  }
}

const instance = (piece: string, at: Vec2, y: number, rot: number, s: number): PieceInstance => ({
  piece,
  x: round3(at[0]),
  y: round3(y),
  z: round3(at[1]),
  rot: round3(rot),
  scale: round3(s),
})
const tidy = (p: PieceInstance): PieceInstance => ({
  ...p,
  x: round3(p.x),
  y: round3(p.y),
  z: round3(p.z),
  rot: round3(p.rot),
})

/** The instance's swatch map with its ramp map baked in (cached per distinct ramp map). */
function swatchMap(
  i: RecipeInstance,
  cache: Map<string, Record<number, number>>,
): Record<number, number> | undefined {
  if (!i.rampMap || Object.keys(i.rampMap).length === 0) return i.swatchMap
  const key = JSON.stringify(Object.entries(i.rampMap).sort())
  let ramps = cache.get(key)
  if (!ramps) {
    ramps = rampMapToSwatchMap(PALETTE, i.rampMap)
    cache.set(key, ramps)
  }
  const merged = { ...ramps, ...(i.swatchMap ?? {}) }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * The land: the bounds minus each water piece in turn (the pieces meet along seams, so taken all at
 * once the booleans can leave sea in the land). The largest piece is the land with its holes (the
 * island); the others are islets.
 */
function landOf(plan: TownPlan): { land: Vec2[]; holes: Vec2[][]; islets: Vec2[][] } {
  let parts: MultiPolygon = [[plan.bounds]]
  for (const ring of plan.water)
    if (ring.length >= 3 && parts.length > 0) parts = clip(parts, ring, "difference")
  const sorted = [...parts].sort((p, q) => area(at(q, 0)) - area(at(p, 0)))
  const best = sorted[0]
  if (!best) return { land: plan.bounds, holes: [], islets: [] }
  return { land: at(best, 0), holes: best.slice(1), islets: sorted.slice(1).map((p) => at(p, 0)) }
}

/** The painted ground, back to front: streets, the square and ward, the quay, fields, plots. */
function overlays(plan: DressInput): Overlay[] {
  const out: Overlay[] = []
  for (const e of plan.streets.edges)
    out.push({ kind: e.cls === "road" ? "dirt" : "cobble", poly: ribbon(e.points, e.width) })
  for (const b of plan.blocks) {
    if (b.use === "plaza") out.push({ kind: "plaza", poly: b.poly })
    if (b.use === "castle") out.push({ kind: "cobble", poly: b.poly })
    if (b.use === "harbour") out.push({ kind: "sand", poly: b.poly })
  }
  for (const f of plan.fields) out.push({ kind: "field", poly: f.poly })
  const paint: Record<Plot["kind"], Overlay["kind"]> = {
    garden: "garden",
    orchard: "garden",
    allotment: "field",
    yard: "dirt",
  }
  for (const p of plan.plots ?? []) out.push({ kind: paint[p.kind], poly: p.poly })
  return out
}

/** A wall's ground: a strip as wide as the wall along each of its runs between gaps. */
function wallFootprint(e: Edge, thickness: number): Vec2[][] {
  const pts = e.closed ? [...e.points, at(e.points, 0)] : e.points
  const out: Vec2[][] = []
  for (let i = 0; i + 1 < pts.length; i++) out.push(ribbon([at(pts, i), at(pts, i + 1)], thickness).map(snap))
  return out
}

/**
 * The shore: the water ring's sides that are not the bounds' (a lake clipped by the bounds runs along
 * them), as open lines.
 */
function shoreOf(ring: Ring, bounds: readonly Vec2[]): Vec2[][] {
  const [lo, hi] = bbox(bounds)
  const onBounds = (a: Vec2, b: Vec2) =>
    (Math.abs(a[0] - lo[0]) < EPS && Math.abs(b[0] - lo[0]) < EPS) ||
    (Math.abs(a[0] - hi[0]) < EPS && Math.abs(b[0] - hi[0]) < EPS) ||
    (Math.abs(a[1] - lo[1]) < EPS && Math.abs(b[1] - lo[1]) < EPS) ||
    (Math.abs(a[1] - hi[1]) < EPS && Math.abs(b[1] - hi[1]) < EPS)
  const n = ring.length
  // Start just after a bounds side, so each shore line comes out whole.
  const start = ring.findIndex((_, i) => onBounds(at(ring, i - 1 + n), at(ring, i)))
  const from = start < 0 ? 0 : start
  const out: Vec2[][] = []
  let line: Vec2[] = []
  for (let k = 0; k < n; k++) {
    const a = at(ring, (from + k) % n)
    const b = at(ring, (from + k + 1) % n)
    if (onBounds(a, b)) {
      if (line.length > 1) out.push(line)
      line = []
      continue
    }
    if (line.length === 0) line.push(a)
    line.push(b)
  }
  if (line.length > 1) out.push(line)
  return out
}
