/**
 * Stage 8 (plan §4): farms. The farmland outside the town (the green blocks) is laid out from the
 * roads and streets it borders: along each kerb, slots are cut square to it (a strip's long side
 * across the road; where the farmland is too narrow, along it), set back by a verge. Most slots
 * become strip fields, one crop each, planted in
 * rows along the field's long side; every 3–4 slots a farmstead (farmhouse and barn facing the road,
 * hay, an animal paddock behind them), and now and then an orchard. Every field, paddock, orchard
 * and farmstead is closed by a fence or hedge with a gate toward the road (Look bar #5). The shore
 * and the band inland of it along the coast are left to nature's forest belt. Placements stand at their footprint's centre,
 * turned so their +z faces the road (the lot frame of obb.ts).
 */
import { DMath } from "@guildhall/core"
import { length, lineIndex } from "../geom/line.ts"
import { axes, type Rect, rectCorners, rectInPoly, rectsOverlap } from "../geom/obb.ts"
import { bbox, contains, orient } from "../geom/poly.ts"
import { poissonIn, type Roll } from "../geom/sample.ts"
import {
  add,
  at,
  cross,
  dist,
  dot,
  lerp,
  norm,
  perp,
  round3,
  scale,
  snap,
  sub,
  type Vec2,
} from "../geom/vec.ts"
import { normalizeSpec } from "./spec.ts"
import type { Block, Edge, Field, Placement, Station, TownLibrary, TownPlan, TownSpecInput } from "./types.ts"

/**
 * What farms read beyond the pinned library: each crop's growth stages (young to ripe; without it
 * every `nature.crops` id is a crop of one stage), farm animals, and orchard trees. Each list is
 * optional: without animals the paddocks stay empty, without orchard trees there are no orchards.
 */
export interface FarmExtras {
  crops?: string[][]
  animals?: string[]
  orchard?: string[]
}
export type FarmLibrary = TownLibrary & { farm?: FarmExtras }

/**
 * The plan so far that farms read. Buildings already placed (placements of known prefabs) are kept
 * clear of; `edges` only numbers the new edges after the existing ones.
 */
export type FarmInput = Pick<TownPlan, "bounds" | "streets" | "blocks"> &
  Partial<Pick<TownPlan, "edges" | "placements" | "water">>

export interface Farms {
  fields: Field[]
  placements: Placement[]
  edges: Edge[]
  /** Where a farmhand works: each field's gate, each paddock and orchard. */
  stations: Station[]
}

/**
 * Fields keep this far in from the land's edge (the forest belt's ground): a share of the radius, at
 * most 10 m, inland of the shore band where there is a coast, or in from the bounds where there is not.
 */
export const beltReserve = (radius: number): number => Math.min(10, 0.08 * radius)
/** The open shore band along the coast (grass and rocks, no trees: nature.ts), wavering between these, metres. */
export const SHORE = [5, 9] as const
/** Grass between a road's kerb and the fences along it, metres. */
const VERGE = 1.5
/** A field's side along the road and its depth away from it, metres (plan: 14–20 × 30–60). */
const FIELD_W = [14, 20] as const
const FIELD_D = [30, 60] as const
/** The shallowest field square to the road, metres. */
const MIN_DEPTH = 18
/** A strip along the road where the farmland is too narrow for one across it, metres. */
const STRIP_W = [28, 40] as const
const STRIP_D = [10, 16] as const
/** A farmstead's yard along the road, at least, and its depth, metres. */
const YARD_W = 24
const YARD_D = [28, 36] as const
/** The track between two slots along a road, metres. */
const TRACK = [2, 4] as const
/** Crop rows lie this far apart; plants this far apart along a row; and this far in from the fence, metres. */
const ROW_GAP = 1.6
const PLANT_STEP = 1.3
const CROP_INSET = 1.2
/** Orchard trees on a square grid this wide, metres. */
const ORCHARD_STEP = 5
/** Gates in fences and hedges, metres. */
const GATE = 3
/** A slot keeps this far from the ends of its run of edge, metres. */
const END_CLEAR = 2
/** The farmland's outline is split into runs where it turns more than this, radians. */
const CORNER = (35 * Math.PI) / 180

type SlotKind = "field" | "farmstead" | "orchard"

/** One run of the farmland's edge, walked by arc length while it still yields slots. */
interface Frontage {
  /** The farmland lies on its left. */
  line: Vec2[]
  s: number
  total: number
}

/** The heading (a rect's `rot`, obb.ts) whose local +z points along d. */
export function headingTo(d: Vec2): number {
  return round3(DMath.atan2(d[0], d[1]))
}

/** The point at arc length s along the open polyline (clamped to its ends). */
export function pointAlong(line: readonly Vec2[], s: number): Vec2 {
  let left = s
  for (let i = 0; i + 1 < line.length; i++) {
    const a = at(line, i)
    const b = at(line, i + 1)
    const l = dist(a, b)
    if (left <= l || i + 2 === line.length)
      return add(a, scale(sub(b, a), l === 0 ? 0 : Math.min(1, left / l)))
    left -= l
  }
  return at(line, 0)
}

export function farms(plan: FarmInput, spec: TownSpecInput, lib: FarmLibrary, roll: Roll): Farms {
  const s = normalizeSpec(spec)
  const green = plan.blocks.filter((b) => b.use === "green")
  const out: Farms = { fields: [], placements: [], edges: [], stations: [] }
  if (s.farms <= 0 || green.length === 0) return out
  const [bmin, bmax] = bbox(plan.bounds)
  const reserve = beltReserve(s.radius)
  const inBounds = (r: Rect) =>
    rectCorners(r).every(
      (p) =>
        p[0] >= bmin[0] + reserve &&
        p[0] <= bmax[0] - reserve &&
        p[1] >= bmin[1] + reserve &&
        p[1] <= bmax[1] - reserve,
    )
  const boxes = green.map((b) => bbox(b.poly))
  const onFarmland = (r: Rect): boolean => {
    const c = r.c
    return green.some((b, i) => {
      const [lo, hi] = boxes[i] as [Vec2, Vec2]
      if (c[0] < lo[0] || c[0] > hi[0] || c[1] < lo[1] || c[1] > hi[1]) return false
      return contains(b.poly, c, 0) && rectInPoly(r, b.poly)
    })
  }
  const sizes = new Map(lib.prefabs.map((m) => [m.id, m]))
  const taken: Rect[] = (plan.placements ?? []).flatMap((pl) => {
    const m = sizes.get(pl.prefab)
    return m ? [{ c: pl.at, rot: pl.rot, w: m.frontage, d: m.depth }] : []
  })
  const water = (plan.water ?? []).filter((w) => w.length > 2)
  const coast = water.length > 0 ? lineIndex(water, true) : null
  const inland = SHORE[1] + reserve
  // Along its whole outline (a bay can reach in toward the middle of a side), unless its centre is
  // so far inland that no side can be near.
  const offShore = (r: Rect) => {
    if (!coast) return true
    const half = Math.hypot(r.w, r.d) / 2
    if (coast.near(r.c, inland + half) >= inland + half) return true
    const ring = rectCorners(r)
    return ring.every((p, i) => {
      const q = at(ring, i + 1)
      const l = dist(p, q)
      // A point d from the coast clears the next d − inland metres of the side too.
      for (let s = 0; s <= l; ) {
        const d = coast.near(lerp(p, q, s / l), inland + 20)
        if (d < inland) return false
        s += Math.max(0.5, d - inland)
      }
      return true
    })
  }
  const reachOf = (r: Rect) => Math.hypot(r.w, r.d) / 2
  const clear = (r: Rect) =>
    !taken.some((t) => dist(t.c, r.c) < reachOf(t) + reachOf(r) && rectsOverlap(t, r))
  const free = (r: Rect) => inBounds(r) && clear(r) && offShore(r) && onFarmland(r)

  const fronts = frontages(green)
  const crops = cropGroups(lib)
  const orchard = lib.farm?.orchard ?? []
  const house = pickPrefab(lib, ["farmhouse", "house"])
  const barn = pickPrefab(lib, ["shed"])
  let edgeId = plan.edges?.length ?? 0
  let fieldCount = 0
  let slotNo = 0
  // A farmstead comes every 3–4 slots, counted over all the frontages.
  let untilYard = 1 + Math.floor(2 * roll("first:yard"))
  const edge = (kind: Edge["kind"], r: Rect) => out.edges.push(closedEdge(edgeId++, kind, r))
  // A yard holds the farmhouse and the barn side by side, with room between and round them.
  const yardW = Math.max(YARD_W, (house?.frontage ?? 0) + (barn?.frontage ?? 0) + 7)

  // Each frontage in turn takes a run of slots, so fields gather in clusters round the town
  // instead of filling the first road or scattering one by one.
  const take = (f: Frontage, fi: number): boolean => {
    const n = slotNo
    const want: SlotKind =
      untilYard <= 0 && house
        ? "farmstead"
        : orchard.length > 0 && roll(`${n}:orchard`) < 0.15
          ? "orchard"
          : "field"
    const rect = nextSlot(f, want, yardW, free, (salt) => roll(`${fi}:${n}:${salt}`))
    if (!rect) return false
    slotNo++
    untilYard = want === "farmstead" ? 3 + Math.floor(2 * roll(`${n}:yard-rhythm`)) : untilYard - 1
    taken.push(rect)
    const draw = (salt: string) => roll(`${n}:${salt}:slot`)
    if (want === "farmstead" && house) {
      edge("hedge", rect)
      farmstead(rect, house, barn, lib, draw, out, () => edgeId++)
      return true
    }
    fieldCount++
    if (want === "orchard") {
      edge("hedge", rect)
      orchardTrees(rect, orchard, draw, out.placements)
      out.stations.push({ id: `orchard:${n}`, kind: "field", at: snap(rect.c), facing: rect.rot })
      return true
    }
    edge(draw("hedge") < 0.35 ? "hedge" : "fence", rect)
    const group = crops.length > 0 ? at(crops, Math.floor(draw("crop") * crops.length)) : null
    if (!group) return true
    // Most fields stand ripe or nearly; the rest are young: one stage per field.
    const stage = Math.max(0, group.length - 1 - Math.floor(draw("stage") * Math.min(3, group.length)))
    out.fields.push(planted(rect, at(group, stage), draw, out.placements))
    const gate = add(rect.c, scale(axes(rect.rot).z, rect.d / 2 - 1.5))
    out.stations.push({
      id: `field:${out.fields.length - 1}`,
      kind: "field",
      at: snap(gate),
      facing: round3(rect.rot + Math.PI),
    })
    return true
  }
  for (let progress = true; progress && fieldCount < s.farms; ) {
    progress = false
    for (const [fi, f] of fronts.entries()) {
      const run = 3 + Math.floor(3 * roll(`${fi}:${slotNo}:run`))
      for (let k = 0; k < run && fieldCount < s.farms && take(f, fi); k++) progress = true
    }
  }
  return out
}

/**
 * The farmland's edges, as runs between sharp corners: each green block's outline (counter-clockwise,
 * so the farmland is on the left) split where it turns by more than `CORNER`. The runs along the
 * kerbs face the roads and streets; those along the bounds or the water yield nothing (the reserve
 * and the block's outline turn their slots away).
 */
function frontages(green: readonly Block[]): Frontage[] {
  const out: Frontage[] = []
  for (const b of green) {
    const ring = orient(b.poly)
    const n = ring.length
    const turn = (i: number) => {
      const u = sub(at(ring, i), at(ring, i - 1))
      const v = sub(at(ring, i + 1), at(ring, i))
      return Math.abs(DMath.atan2(cross(u, v), dot(u, v)))
    }
    const corners = ring.map((_, i) => i).filter((i) => turn(i) > CORNER)
    const runs: Vec2[][] =
      corners.length === 0
        ? [[...ring, at(ring, 0)]]
        : corners.map((c, k) => {
            const next = at(corners, k + 1)
            const span = ((next - c + n - 1) % n) + 1
            return Array.from({ length: span + 1 }, (_, j) => at(ring, c + j))
          })
    for (const line of runs) {
      const total = length(line)
      if (total >= FIELD_W[0] + 2 * END_CLEAR) out.push({ line, s: END_CLEAR, total })
    }
  }
  return out
}

/**
 * The next slot of the given kind along the frontage: its front a chord of the edge moved in by a
 * verge, its depth square to that chord, shrunk toward the shallowest field before the walk
 * moves on. The frontage's cursor advances past the slot (and a track) or past the place that failed.
 */
function nextSlot(
  f: Frontage,
  kind: SlotKind,
  yardW: number,
  free: (r: Rect) => boolean,
  draw: Roll,
): Rect | null {
  const shapes = slotShapes(kind, yardW, draw)
  const track = TRACK[0] + (TRACK[1] - TRACK[0]) * draw("track")
  while (f.s + FIELD_W[0] <= f.total - END_CLEAR) {
    for (const [w, d] of shapes) {
      if (f.s + w > f.total - END_CLEAR) continue
      const a = pointAlong(f.line, f.s)
      const b = pointAlong(f.line, f.s + w)
      const n = perp(norm(sub(b, a)))
      // The front keeps a verge beyond wherever the edge bulges in past the chord.
      let bulge = 0
      for (let k = 1; k < 8; k++)
        bulge = Math.max(bulge, dot(sub(pointAlong(f.line, f.s + (w * k) / 8), a), n))
      const c = add(scale(add(a, b), 0.5), scale(n, bulge + VERGE + d / 2))
      const rect: Rect = { c: snap(c), rot: headingTo(scale(n, -1)), w: round3(w), d: round3(d) }
      if (free(rect)) {
        f.s += w + track
        return rect
      }
    }
    f.s += 3
  }
  return null
}

/**
 * The sizes a slot may take, best first, as [along the road, away from it]: a strip square to the
 * road, shallower and shallower; failing that (a narrow band of farmland) a strip along the road.
 */
function slotShapes(kind: SlotKind, yardW: number, draw: Roll): [number, number][] {
  if (kind === "farmstead") {
    const d = YARD_D[0] + (YARD_D[1] - YARD_D[0]) * draw("d")
    return [
      [yardW + 4 * draw("w"), d],
      [yardW + 4 * draw("w"), YARD_D[0]],
    ]
  }
  const w = FIELD_W[0] + (FIELD_W[1] - FIELD_W[0]) * draw("w")
  const out: [number, number][] = []
  for (let d = FIELD_D[0] + (FIELD_D[1] - FIELD_D[0]) * draw("d"); d >= MIN_DEPTH; d -= 6) out.push([w, d])
  const along = STRIP_W[0] + (STRIP_W[1] - STRIP_W[0]) * draw("strip")
  out.push([along, STRIP_D[1]], [along, STRIP_D[0]])
  return out
}

/** A closed edge round the rect, its gate in the middle of the front (+z) side. */
function closedEdge(id: number, kind: Edge["kind"], r: Rect, gate = GATE): Edge {
  const points = rectCorners(r).map(snap)
  // Corners run (−x−z), (+x−z), (+x+z), (−x+z): the front side starts after w + d.
  return {
    id,
    kind,
    points,
    closed: true,
    gaps: [{ s: round3(r.w + r.d + (r.w - gate) / 2), width: gate, kind: "gate" }],
  }
}

/** The field the rect makes, and its crop planted in rows along its long side. */
function planted(r: Rect, crop: string, draw: Roll, into: Placement[]): Field {
  const { x, z } = axes(r.rot)
  // Rows run along the long side; `rows` is the heading whose local +x runs along them.
  const alongZ = r.d >= r.w
  const along = alongZ ? z : x
  const across = alongZ ? x : z
  const rowLen = (alongZ ? r.d : r.w) - 2 * CROP_INSET
  const span = (alongZ ? r.w : r.d) - 2 * CROP_INSET
  const rows = alongZ ? round3(r.rot - Math.PI / 2) : r.rot
  const nRows = Math.max(1, Math.floor(span / ROW_GAP) + 1)
  const nPlants = Math.max(1, Math.floor(rowLen / PLANT_STEP) + 1)
  const r0 = -((nRows - 1) * ROW_GAP) / 2
  const p0 = -((nPlants - 1) * PLANT_STEP) / 2
  for (let i = 0; i < nRows; i++)
    for (let j = 0; j < nPlants; j++) {
      const p = add(r.c, add(scale(across, r0 + i * ROW_GAP), scale(along, p0 + j * PLANT_STEP)))
      into.push({ prefab: crop, seed: seedOf(draw(`${i}:${j}:plant`)), at: snap(p), rot: rows, role: "crop" })
    }
  return { poly: rectCorners(r).map(snap), crop, rows }
}

function orchardTrees(r: Rect, trees: readonly string[], draw: Roll, into: Placement[]): void {
  const { x, z } = axes(r.rot)
  const nx = Math.max(1, Math.floor((r.w - ORCHARD_STEP) / ORCHARD_STEP) + 1)
  const nz = Math.max(1, Math.floor((r.d - ORCHARD_STEP) / ORCHARD_STEP) + 1)
  const tree = at(trees, Math.floor(draw("tree") * trees.length))
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const p = add(
        r.c,
        add(scale(x, (i - (nx - 1) / 2) * ORCHARD_STEP), scale(z, (j - (nz - 1) / 2) * ORCHARD_STEP)),
      )
      const seed = seedOf(draw(`${i}:${j}:tree`))
      into.push({
        prefab: tree,
        seed,
        at: snap(p),
        rot: round3(2 * Math.PI * draw(`${i}:${j}:turn`)),
        role: "orchard",
      })
    }
}

/**
 * A farmstead in its yard (+z toward the road): the farmhouse front left, the barn set back on the
 * right, hay between them, and a fenced paddock across the back with animals in it.
 */
function farmstead(
  yard: Rect,
  house: PrefabMetaLike,
  barn: PrefabMetaLike | null,
  lib: FarmLibrary,
  draw: Roll,
  out: Farms,
  nextEdge: () => number,
): void {
  const { x, z } = axes(yard.rot)
  const local = (u: number, v: number): Vec2 => snap(add(yard.c, add(scale(x, u), scale(z, v))))
  const front = yard.d / 2
  const left = -yard.w / 2
  const houseAt = local(left + 2 + house.frontage / 2, front - 2 - house.depth / 2)
  out.placements.push({
    prefab: house.id,
    seed: seedOf(draw("house")),
    at: houseAt,
    rot: yard.rot,
    role: "farmhouse",
  })
  let back = front - 2 - house.depth
  let hayU = left + 2 + house.frontage + 2
  if (barn && house.frontage + barn.frontage + 7 <= yard.w) {
    const u = yard.w / 2 - 2 - barn.frontage / 2
    const v = front - 6 - barn.depth / 2
    out.placements.push({
      prefab: barn.id,
      seed: seedOf(draw("barn")),
      at: local(u, v),
      rot: yard.rot,
      role: "barn",
    })
    back = Math.min(back, front - 6 - barn.depth)
    hayU = Math.min(hayU, u - barn.frontage / 2 - 2)
  }
  const hay = lib.nature.hay
  if (hay.length > 0)
    for (let i = 0; i < 2 + Math.floor(3 * draw("hay")); i++) {
      const p = local(
        Math.min(hayU, yard.w / 2 - 2) + (i % 2) * 1.5 - 0.75,
        front - 3 - Math.floor(i / 2) * 1.6,
      )
      out.placements.push({
        prefab: at(hay, Math.floor(draw(`${i}:hay-id`) * hay.length)),
        seed: seedOf(draw(`${i}:hay-seed`)),
        at: p,
        rot: round3(yard.rot + 0.4 * (draw(`${i}:hay-turn`) - 0.5)),
        role: "hay",
      })
    }
  // The paddock fills the back of the yard behind the buildings, a metre in from the hedge.
  const top = back - 2
  const bottom = -yard.d / 2 + 1
  if (top - bottom < 8) return
  const pen: Rect = {
    c: local(0, (top + bottom) / 2),
    rot: yard.rot,
    w: round3(yard.w - 2),
    d: round3(top - bottom),
  }
  const id = nextEdge()
  out.edges.push(closedEdge(id, "fence", pen))
  out.stations.push({ id: `paddock:${id}`, kind: "field", at: pen.c, facing: yard.rot })
  const animals = lib.farm?.animals ?? []
  if (animals.length === 0) return
  const kind = at(animals, Math.floor(draw("herd") * animals.length))
  const inner = rectCorners({ ...pen, w: pen.w - 3, d: pen.d - 3 })
  const spots = poissonIn(inner, 3, (salt) => draw(`${salt}:herd`)).slice(
    0,
    3 + Math.floor(4 * draw("herd-size")),
  )
  spots.forEach((p, i) => {
    out.placements.push({
      prefab: kind,
      seed: seedOf(draw(`${i}:animal`)),
      at: p,
      rot: round3(2 * Math.PI * draw(`${i}:animal-turn`)),
      role: "animal",
    })
  })
}

type PrefabMetaLike = TownLibrary["prefabs"][number]

/** The first prefab of the first kind the library has (ids sorted, so the pick is stable). */
function pickPrefab(lib: TownLibrary, kinds: readonly string[]): PrefabMetaLike | null {
  for (const k of kinds) {
    const list = lib.prefabs.filter((p) => p.kind === k).sort((a, b) => (a.id < b.id ? -1 : 1))
    if (list[0]) return list[0]
  }
  return null
}

function cropGroups(lib: FarmLibrary): string[][] {
  const groups = lib.farm?.crops?.filter((g) => g.length > 0)
  return groups && groups.length > 0 ? groups : lib.nature.crops.map((c) => [c])
}

/** A placement seed from a draw in [0, 1). */
export const seedOf = (u: number): number => Math.floor(u * 2147483647)
