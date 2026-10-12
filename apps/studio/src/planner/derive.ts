/**
 * Plan → map: everything the planner draws, as plain shapes in metres (no canvas here, so the worker
 * runs it and tests read it). Each list fills from its own part of the plan and stays empty until a
 * stage produces that part: houses from placements, trees from `nature`, fields from `fields`, POIs from
 * `stations` (and a later `pois`), trails from a later `paths`/`trails`.
 */
import { buildHouse, PALETTE, type PrefabMeta, type PrefabRecipe } from "@guildhall/assets"
import {
  area,
  axes,
  centroid,
  contains,
  type Edge,
  edgeKits,
  KEEP_FALLBACK,
  KEEP_RECIPE,
  layoutEdge,
  type Placement,
  type Tier,
  type TownPlan,
  type Vec2,
} from "@guildhall/world"
import type { EdgeRole, Overlay } from "./generate.ts"

/** What the catalog says about a piece the plan names (size and category), for non-recipe placements. */
export interface PieceInfo {
  w: number
  d: number
  h: number
  cat: string
}

/** What derive needs besides the plan: compiled prefab metas, the recipes, and catalog piece sizes. */
export interface DeriveLib {
  prefabs: readonly PrefabMeta[]
  recipes: readonly PrefabRecipe[]
  pieces: Readonly<Record<string, PieceInfo>>
  nature?: { trees: string[]; bushes: string[]; crops: string[]; hay: string[]; rocks: string[] }
}

/** Three tones of one material, dark to light, as `#rrggbb`. */
export type Tones = [dark: string, base: string, light: string]

export interface HouseShape {
  prefab: string
  kind: string
  c: Vec2
  rot: number
  /** Along local x (the frontage) and local z (the depth); +z faces the street. */
  w: number
  d: number
  h: number
  ridge: "x" | "z" | "point" | "flat"
  roof: Tones
  /** The door's foot in the house frame, or null. */
  door: Vec2 | null
  chimney: Vec2 | null
}

export interface RectShape {
  c: Vec2
  rot: number
  w: number
  d: number
  h: number
  kind: "pier" | "stall" | "keep" | "building" | "well" | "boat" | "cargo"
  tone: string
}

export interface NatureShape {
  c: Vec2
  r: number
  h: number
  kind: "tree" | "bush" | "rock" | "hay" | "crop" | "flower" | "animal" | "orchard"
  tone: Tones
}

export interface EdgeShape {
  id: number
  kind: Edge["kind"]
  /** The castle's own curtain, not the town's edge. */
  castle: boolean
  /** A field's or paddock's fence or hedge (farms), not the town's edge. */
  farm: boolean
  /** The solid stretches between the gaps. */
  runs: Vec2[][]
  width: number
  towers: { c: Vec2; r: number }[]
  /** Gate gaps as their two ends. */
  gates: [Vec2, Vec2][]
}

export interface Label {
  text: string
  at: Vec2
  kind: "district" | "square" | "water" | "castle"
}

export interface Poi {
  at: Vec2
  kind: string
}

export interface MapData {
  plan: TownPlan
  /** min x, min z, max x, max z of the sheet. */
  box: [number, number, number, number]
  houses: HouseShape[]
  rects: RectShape[]
  nature: NatureShape[]
  edges: EdgeShape[]
  pois: Poi[]
  /** Footpaths and trails beyond the street graph (a later stage), as polylines. */
  trails: Vec2[][]
  overlays: Overlay[]
  labels: Label[]
}

const swatch = (id: number): string => PALETTE.swatches[id]?.hex ?? "#888888"
/** A palette ramp's three tones by name; grey when the palette does not know it. */
export function rampTones(name: string): Tones {
  const ramp = PALETTE.ramps.find((r) => r.name === name)
  if (!ramp) return ["#5a5a5a", "#7a7a7a", "#a0a0a0"]
  return [swatch(ramp.tones.dark), swatch(ramp.tones.base), swatch(ramp.tones.light)]
}

/** `#rrggbb` mixed toward `#rrggbb` by t. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => Number.parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16)
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t))
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

/** A roof's three shades around its tone: the dark side, the tone itself, the sunlit side. */
const shades = (tone: string): Tones => [mix(tone, "#1d140c", 0.3), tone, mix(tone, "#fff4dc", 0.22)]

interface RoofLook {
  ridge: HouseShape["ridge"]
  roof: Tones
  door: Vec2 | null
  chimney: Vec2 | null
  w: number
  d: number
}

/**
 * How a house recipe's roof reads from above for `seed`: its colour is the kit's baked roof ramp
 * (low roofs teal at base tone, high roofs the accent ramp's light tone) carried through the seed's
 * ramp map, exactly as the 3D build tints it.
 */
export function roofLook(recipe: PrefabRecipe, seed: number): RoofLook | null {
  const h = recipe.house
  if (!h) return null
  let built: ReturnType<typeof buildHouse>
  try {
    built = buildHouse(h, seed)
  } catch {
    return null
  }
  const roof = built.parts.find((p) => /\/roof/.test(p.instance.piece))?.instance
  const high = roof ? /roof-high/.test(roof.piece) : false
  const baked = high ? "accent" : "teal"
  const ramp = roof?.rampMap?.[baked] ?? baked
  const tones = rampTones(ramp)
  const tone = high ? tones[2] : tones[1]
  const pot = built.parts.find((p) => /chimney-top/.test(p.instance.piece))?.instance
  const style = h.roof.style
  return {
    ridge: style === "point" ? "point" : style === "flat" ? "flat" : h.roof.ridge,
    roof: shades(tone),
    door: built.door,
    chimney: pot ? [pot.x, pot.z] : null,
    w: built.frontage,
    d: built.depth,
  }
}

/** A stable small hash of a string, for picking tones. */
function hashStr(s: string, seed = 0): number {
  let h = 2166136261 ^ seed
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const LEAVES: readonly Tones[] = [rampTones("leaf"), rampTones("grass"), [swatch(33), swatch(34), swatch(2)]]
const FLOWERS: readonly Tones[] = [
  rampTones("accent"),
  rampTones("orange"),
  rampTones("autumn"),
  rampTones("snow"),
]
const ANIMALS: readonly Tones[] = [
  rampTones("snow"),
  rampTones("timber"),
  rampTones("sand"),
  rampTones("skin"),
]
const AWNINGS = ["#cc3333", "#2581bf", "#d0a33a", "#43c09f", "#f79945", "#e8d9ac"]

/** The point `s` metres along a polyline (wrapping when closed), with the segment it lies on. */
export function pointAt(points: readonly Vec2[], closed: boolean, s: number): Vec2 {
  const n = points.length
  const segs = closed ? n : n - 1
  let total = 0
  for (let i = 0; i < segs; i++) {
    const a = points[i] as Vec2
    const b = points[(i + 1) % n] as Vec2
    total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  if (total <= 0) return points[0] ?? [0, 0]
  let left = closed ? ((s % total) + total) % total : Math.max(0, Math.min(total, s))
  for (let i = 0; i < segs; i++) {
    const a = points[i] as Vec2
    const b = points[(i + 1) % n] as Vec2
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (left <= l || i === segs - 1) {
      const t = l > 0 ? Math.min(1, left / l) : 0
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    left -= l
  }
  return points[n - 1] ?? [0, 0]
}

/** The polyline between arc lengths `a` and `b` (a closed line wraps). */
export function slice(points: readonly Vec2[], closed: boolean, a: number, b: number): Vec2[] {
  const n = points.length
  const segs = closed ? n : n - 1
  const out: Vec2[] = [pointAt(points, closed, a)]
  let s = 0
  // Walk twice round a closed line so a stretch that wraps past the start is whole.
  const laps = closed ? 2 : 1
  for (let lap = 0; lap < laps; lap++)
    for (let i = 0; i < segs; i++) {
      const p = points[(i + 1) % n] as Vec2
      const q = points[i] as Vec2
      s += Math.hypot(p[0] - q[0], p[1] - q[1])
      if (s > a && s < b) out.push(p)
    }
  out.push(pointAt(points, closed, b))
  return out
}

function lineLength(points: readonly Vec2[], closed: boolean): number {
  let total = 0
  const n = points.length
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i] as Vec2
    const b = points[(i + 1) % n] as Vec2
    total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return total
}

/** The edge's solid stretches between its gaps, as polylines. */
export function solidRuns(edge: Pick<Edge, "points" | "closed" | "gaps">): Vec2[][] {
  const total = lineLength(edge.points, edge.closed)
  const gaps = [...edge.gaps].sort((x, y) => x.s - y.s)
  if (gaps.length === 0) return [edge.closed ? [...edge.points, edge.points[0] as Vec2] : [...edge.points]]
  const cuts = gaps.map((g) => [g.s - g.width / 2, g.s + g.width / 2] as const)
  const runs: Vec2[][] = []
  if (edge.closed) {
    for (let i = 0; i < cuts.length; i++) {
      const from = (cuts[i] as readonly [number, number])[1]
      const next = cuts[(i + 1) % cuts.length] as readonly [number, number]
      const to = i + 1 < cuts.length ? next[0] : next[0] + total
      if (to - from > 0.05) runs.push(slice(edge.points, true, from, to))
    }
  } else {
    let from = 0
    for (const [a, b] of cuts) {
      if (a - from > 0.05) runs.push(slice(edge.points, false, from, a))
      from = b
    }
    if (total - from > 0.05) runs.push(slice(edge.points, false, from, total))
  }
  return runs
}

const DISTRICT_NAMES: Record<string, string> = {
  market: "Market Quarter",
  residential: "Old Town",
  craft: "Craftsmen's Row",
  harbour: "Harbour",
  castle: "Castle Ward",
  farm: "Farmsteads",
}

/** One label per district kind, on the block nearest the district's area-weighted middle. */
function districtLabels(plan: TownPlan): Label[] {
  const groups = new Map<string, { sum: Vec2; w: number; blocks: { c: Vec2; a: number }[] }>()
  for (const b of plan.blocks) {
    if (b.use !== "lots" && b.use !== "harbour") continue
    const a = Math.abs(area(b.poly))
    const c = centroid(b.poly)
    const g = groups.get(b.district) ?? { sum: [0, 0], w: 0, blocks: [] }
    g.sum = [g.sum[0] + c[0] * a, g.sum[1] + c[1] * a]
    g.w += a
    g.blocks.push({ c, a })
    groups.set(b.district, g)
  }
  const out: Label[] = []
  for (const [district, g] of groups) {
    if (g.w <= 0) continue
    const mid: Vec2 = [g.sum[0] / g.w, g.sum[1] / g.w]
    let best = g.blocks[0]
    let bestScore = Infinity
    for (const blk of g.blocks) {
      // Near the middle, and big enough to hold the words.
      const score = Math.hypot(blk.c[0] - mid[0], blk.c[1] - mid[1]) - Math.sqrt(blk.a) * 0.6
      if (score < bestScore) {
        bestScore = score
        best = blk
      }
    }
    const small = plan.spec.tier === "hamlet" || plan.spec.tier === "village"
    const name = small && district === "residential" ? "Cottages" : (DISTRICT_NAMES[district] ?? district)
    if (best) out.push({ text: name, at: best.c, kind: "district" })
  }
  return out
}

const isVecList = (v: unknown): v is Vec2[] =>
  Array.isArray(v) && v.length > 1 && v.every((p) => Array.isArray(p) && p.length === 2)

/** Polylines a later stage may add under any of these names: `Vec2[]` or `{ points }` items. */
function trailsOf(plan: TownPlan): Vec2[][] {
  const bag = plan as unknown as Record<string, unknown>
  const out: Vec2[][] = []
  for (const key of ["paths", "trails", "footpaths", "roads"]) {
    const list = bag[key]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (isVecList(item)) out.push(item)
      else if (item && typeof item === "object" && isVecList((item as { points?: unknown }).points))
        out.push((item as { points: Vec2[] }).points)
    }
  }
  return out
}

function poisOf(plan: TownPlan): Poi[] {
  const out: Poi[] = plan.stations.map((s) => ({ at: s.at, kind: s.kind }))
  const extra = (plan as unknown as Record<string, unknown>).pois
  if (Array.isArray(extra))
    for (const p of extra)
      if (p && typeof p === "object" && Array.isArray((p as Poi).at))
        out.push({ at: (p as Poi).at, kind: String((p as Poi).kind ?? "poi") })
  return out
}

/** Everything the map draws for `plan`. */
export function derive(
  plan: TownPlan,
  lib: DeriveLib,
  overlays: Overlay[] = [],
  edgeRoles: Readonly<Record<number, EdgeRole>> = {},
): MapData {
  const metas = new Map(lib.prefabs.map((m) => [m.id, m]))
  const recipes = new Map(lib.recipes.map((r) => [r.id, r]))
  const looks = new Map<string, RoofLook | null>()
  const lookOf = (r: PrefabRecipe, seed: number) => {
    const key = `${r.id}#${seed}`
    if (!looks.has(key)) looks.set(key, roofLook(r, seed))
    return looks.get(key) ?? null
  }
  const natureKind = (id: string, cat: string | undefined, role?: string): NatureShape["kind"] | null => {
    if (role === "tree" || role === "bush" || role === "rock" || role === "hay" || role === "crop")
      return role
    if (role === "flower" || role === "animal" || role === "orchard") return role
    const n = lib.nature
    if (n?.trees.includes(id) || cat === "tree") return "tree"
    if (n?.bushes.includes(id) || cat === "bush") return "bush"
    if (n?.rocks.includes(id) || cat === "rock") return "rock"
    if (n?.hay.includes(id) || /hay/.test(id)) return "hay"
    if (n?.crops.includes(id)) return "crop"
    return null
  }

  const houses: HouseShape[] = []
  const rects: RectShape[] = []
  const nature: NatureShape[] = []

  const addNature = (p: Placement, kind: NatureShape["kind"], info: PieceInfo | undefined) => {
    const pick = hashStr(p.prefab, p.seed)
    const fallback = kind === "tree" ? 5 : kind === "orchard" ? 3.5 : kind === "animal" ? 1.4 : 1.6
    const size = info ? Math.max(info.w, info.d) : fallback
    const r = Math.max(kind === "tree" ? 1.8 : 0.3, size / 2)
    const tone: Tones =
      kind === "rock"
        ? rampTones("grey")
        : kind === "hay"
          ? rampTones("thatch")
          : kind === "crop"
            ? rampTones("dry-grass")
            : kind === "flower"
              ? (FLOWERS[pick % FLOWERS.length] as Tones)
              : kind === "animal"
                ? (ANIMALS[pick % ANIMALS.length] as Tones)
                : kind === "orchard"
                  ? [swatch(33), swatch(35), swatch(54)]
                  : (LEAVES[pick % LEAVES.length] as Tones)
    nature.push({ c: p.at, r, h: info?.h ?? (kind === "tree" ? 7 : 1.5), kind, tone })
  }

  for (const p of plan.placements) {
    const recipe = recipes.get(p.prefab)
    const meta = metas.get(p.prefab)
    const info = lib.pieces[p.prefab]
    if (p.role === "keep" || p.prefab === KEEP_RECIPE || p.prefab === KEEP_FALLBACK.piece) {
      const w = meta?.frontage ?? info?.w ?? KEEP_FALLBACK.w
      const d = meta?.depth ?? info?.d ?? KEEP_FALLBACK.d
      rects.push({
        c: p.at,
        rot: p.rot,
        w,
        d,
        h: meta?.height ?? info?.h ?? 18,
        kind: "keep",
        tone: "#7d819c",
      })
      continue
    }
    const roleKind = natureKind(p.prefab, undefined, p.role)
    if (roleKind) {
      addNature(p, roleKind, info)
      continue
    }
    if (p.role === "pier" || p.role === "boat" || p.role === "cargo") {
      const w = info?.w ?? (p.role === "cargo" ? 1 : 3.5)
      const d = info?.d ?? (p.role === "cargo" ? 1 : p.role === "boat" ? 5 : 3.5)
      const kind = p.role === "pier" ? "pier" : p.role
      const tone = p.role === "boat" ? rampTones("timber")[2] : rampTones("timber")[p.role === "pier" ? 1 : 0]
      rects.push({ c: p.at, rot: p.rot, w, d, h: p.role === "boat" ? 1.5 : 0.4, kind, tone })
      continue
    }
    const look = recipe ? lookOf(recipe, p.seed) : null
    if (look && recipe) {
      houses.push({
        prefab: p.prefab,
        kind: recipe.kind,
        c: p.at,
        rot: p.rot,
        w: meta?.frontage ?? look.w,
        d: meta?.depth ?? look.d,
        h: meta?.height ?? 3 * ((recipe.house?.storeys.length ?? 1) + 1),
        ridge: look.ridge,
        roof: look.roof,
        door: look.door,
        chimney: look.chimney,
      })
      continue
    }
    const kind = meta?.kind ?? recipe?.kind
    const w = meta?.frontage ?? info?.w ?? 3
    const d = meta?.depth ?? info?.d ?? 3
    const h = meta?.height ?? info?.h ?? 2
    const nk = kind ? null : natureKind(p.prefab, info?.cat)
    if (nk) {
      addNature(p, nk, info)
      continue
    }
    if (kind === "dock" || /dock|pier|jetty/.test(p.prefab))
      rects.push({ c: p.at, rot: p.rot, w, d, h: 0.4, kind: "pier", tone: rampTones("timber")[1] })
    else if (kind === "stall")
      rects.push({
        c: p.at,
        rot: p.rot,
        w,
        d,
        h,
        kind: "stall",
        tone: AWNINGS[hashStr(p.prefab, p.seed) % AWNINGS.length] as string,
      })
    else if (kind === "well")
      rects.push({ c: p.at, rot: p.rot, w, d, h, kind: "well", tone: rampTones("stone")[1] })
    else rects.push({ c: p.at, rot: p.rot, w, d, h, kind: "building", tone: rampTones("timber")[1] })
  }
  for (const p of plan.nature)
    addNature(p, natureKind(p.prefab, lib.pieces[p.prefab]?.cat, p.role) ?? "tree", lib.pieces[p.prefab])

  const castleGround = plan.blocks.filter((b) => b.use === "castle")
  const kits = edgeKits(plan.spec.tier as Tier)
  const edges: EdgeShape[] = plan.edges.map((e) => {
    const kit = kits[e.kind]
    const mid = centroid(e.points)
    const role = edgeRoles[e.id]
    const castle = role
      ? role === "castle"
      : e.kind === "wall" && e.closed && castleGround.some((b) => contains(b.poly, mid))
    let towers: EdgeShape["towers"] = []
    try {
      towers = layoutEdge(e, kit).towers.map((t) => ({ c: [t.x, t.z] as Vec2, r: (kit.towerSize ?? 3) / 2 }))
    } catch {
      towers = []
    }
    return {
      id: e.id,
      kind: e.kind,
      castle,
      farm: role === "farm",
      runs: solidRuns(e),
      width: kit.thickness,
      towers,
      gates: e.gaps
        .filter((g) => g.kind === "gate")
        .map((g) => [
          pointAt(e.points, e.closed, g.s - g.width / 2),
          pointAt(e.points, e.closed, g.s + g.width / 2),
        ]),
    }
  })

  const labels = districtLabels(plan)
  const plaza = plan.plazas[0]
  if (plaza && plaza.length > 2)
    labels.push({
      text: plan.spec.tier === "hamlet" ? "The Green" : "Market Square",
      at: centroid(plaza),
      kind: "square",
    })
  const keep = rects.find((r) => r.kind === "keep")
  if (keep) labels.push({ text: "Castle", at: keep.c, kind: "castle" })
  for (const lake of plan.water) {
    if (lake.length < 3 || Math.abs(area(lake)) < 400) continue
    labels.push({ text: plan.spec.harbour ? "The Mere" : "Water", at: centroid(lake), kind: "water" })
  }

  const xs = plan.bounds.map((p) => p[0])
  const zs = plan.bounds.map((p) => p[1])
  const box: MapData["box"] =
    xs.length > 0
      ? [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
      : [-100, -100, 100, 100]

  return {
    plan,
    box,
    houses,
    rects,
    nature,
    edges,
    pois: poisOf(plan),
    trails: trailsOf(plan),
    overlays,
    labels,
  }
}

/** The four corners of a rotated rect (centre, frame turn, extents along local x and z). */
export function cornersOf(c: Vec2, rot: number, w: number, d: number): Vec2[] {
  const { x, z } = axes(rot)
  const hx: Vec2 = [x[0] * (w / 2), x[1] * (w / 2)]
  const hz: Vec2 = [z[0] * (d / 2), z[1] * (d / 2)]
  return [
    [c[0] - hx[0] - hz[0], c[1] - hx[1] - hz[1]],
    [c[0] + hx[0] - hz[0], c[1] + hx[1] - hz[1]],
    [c[0] + hx[0] + hz[0], c[1] + hx[1] + hz[1]],
    [c[0] - hx[0] + hz[0], c[1] - hx[1] + hz[1]],
  ]
}

/** A point in a frame (centre, turn) to world. */
export function toWorld(c: Vec2, rot: number, local: Vec2): Vec2 {
  const { x, z } = axes(rot)
  return [c[0] + x[0] * local[0] + z[0] * local[1], c[1] + x[1] * local[0] + z[1] * local[1]]
}
