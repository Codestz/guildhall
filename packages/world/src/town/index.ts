/**
 * The town generator (plan §4): spec → TownPlan, one pure stage after another, each drawing from its
 * own salted roll of the seed. Streets → blocks → lots and buildings (W3), the landmark special →
 * walls and the castle (W4) → farms, harbour (W5) → nature (W5) → the dressing of yards, gardens and
 * the square (interiors.ts) → stations → the walk graph. Farms lay out from the farmland beyond the
 * wall and keep clear of anything already built out there, so nothing is placed twice. Edge ids are
 * renumbered in order at the end, and the plan's hash fingerprints everything it holds.
 */
import type { PrefabMeta } from "@guildhall/assets"
import { DMath, fnv1a, roll } from "@guildhall/core"
import { ribbon } from "../geom/line.ts"
import { type Rect, rectsOverlap } from "../geom/obb.ts"
import { area, bbox, centroid } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, at, dist, round3, scale, snap, type Vec2 } from "../geom/vec.ts"
import { blocks as blockStage } from "./blocks.ts"
import { PLANT_ROLES } from "./dress.ts"
import { type EdgeKitProfile, edgeKits, layoutEdge, townEdgeKind, walls } from "./edges.ts"
import { farms } from "./farms.ts"
import { harbour } from "./harbour.ts"
import { furnish, type Plot } from "./interiors.ts"
import { landmark } from "./landmark.ts"
import type { PlanLibrary } from "./library.ts"
import { lots as lotStage, type TownLot } from "./lots.ts"
import { nature } from "./nature.ts"
import { place } from "./place.ts"
import { site } from "./site.ts"
import { normalizeSpec } from "./spec.ts"
import { stations } from "./stations.ts"
import { streets, sturdyClip } from "./streets.ts"
import type { Block, Edge, Lot, PieceInstance, Placement, TownPlan, TownSpecInput } from "./types.ts"
import { type WalkGraph, walkGraph } from "./walk.ts"

export {
  type DressInput,
  type DressKits,
  dressTown,
  PLANT_ROLES,
  recipeKey,
  townGround,
  townWater,
} from "./dress.ts"
export {
  CONTACT_MAX,
  CONTACT_REACH,
  contactShade,
  type GroundGeometry,
  groundGeometry,
  SKIRT_BOTTOM,
} from "./ground.ts"
export { PLOT_KINDS, type Plot } from "./interiors.ts"
export { type PlanLibrary, type PropKit, prefabLibrary } from "./library.ts"
export { type StageTimes, type TownReport, townMetrics } from "./metrics.ts"
export { stations } from "./stations.ts"
export {
  STATION_PAD,
  WALK_KINDS,
  WALK_RULES,
  type WalkEdge,
  type WalkGraph,
  type WalkKind,
  type WalkNode,
  walkGraph,
} from "./walk.ts"
export { type WaterGeometry, waterGeometry } from "./water.ts"

/**
 * The plan as generation leaves it: the pinned TownPlan plus what dressing and the metrics read
 * without the library. All of it is plain data (serialisable, worker-safe).
 */
export interface TownLayout extends TownPlan {
  lots: TownLot[]
  /** Interior ground with a job: gardens, allotments, yards, orchards (see interiors.ts). */
  plots: Plot[]
  /** Footprint `[w, d]` of every id placed: prefabs and catalog pieces. */
  sizes: Record<string, [w: number, d: number]>
  /** The one walk graph (walk.ts): streets, roads, paths to every station, piers and boat lanes. */
  walk: WalkGraph
}

/**
 * Generates the town. `times`, when given, receives each stage's milliseconds (the plan itself never
 * holds timings, so its hash is the same on every machine).
 */
export function generateTown(
  spec: TownSpecInput,
  lib: PlanLibrary,
  times?: Record<string, number>,
): TownLayout {
  const s = normalizeSpec(spec)
  const stage =
    (name: string): Roll =>
    (salt) =>
      roll(s.seed, `${salt}:${name}`)
  let mark = performance.now()
  const lap = (name: string) => {
    const now = performance.now()
    if (times) times[name] = round3(now - mark)
    mark = now
  }

  const ground = site(s)
  const graph = streets(ground, s, stage("streets"))
  lap("streets")
  const cut = blockStage(graph, ground, s, stage("blocks"))
  lap("blocks")

  const plan: TownLayout = {
    spec: s,
    bounds: ground.bounds,
    water: ground.water,
    plazas: [ground.plaza],
    streets: cut.graph,
    blocks: cut.blocks,
    lots: [],
    placements: [],
    edges: [],
    fields: [],
    nature: [],
    stations: [],
    plots: [],
    walk: { nodes: [], edges: [] },
    sizes: {},
    hash: "",
  }
  // The town's edge runs just outside the wall street, so through the suburb blocks beyond it: their
  // lots are laid with its ground cut out, and no house stands under the wall, hedge or fence.
  plan.edges.push(...walls(plan, s, stage("walls")))
  plan.blocks = clearOf(plan.blocks, plan.edges, edgeKits(s.tier)[townEdgeKind(s)], "lots")
  lap("walls")
  plan.lots = lotStage(plan.blocks, cut.graph, lib, stage("lots"), s.tier)
  lap("lots")
  const lotList = plan.lots
  plan.placements = special(
    place(lotList, lib, s, stage("place")),
    lotList,
    lib,
    s,
    ground.plaza,
    stage("special"),
  )
  lap("place")
  const castle = landmark(plan, s, lib, stage("landmark"))
  plan.placements.push(...castle.placements)
  plan.edges.push(...castle.edges)
  lap("landmark")

  // Farms keep clear of what is built on the farmland; lot buildings stand on lots blocks, so only a
  // lot on a green block (none today) or a piece outside the lots could be in their way.
  const green = new Set(cut.blocks.filter((b) => b.use === "green").map((b) => b.id))
  const onGreen = new Set(lotList.filter((l) => green.has(l.block)).map((l) => l.id))
  // The wall stands on the farmland too (just outside the wall street): its runs and corner towers go
  // in as footprints for farms to keep clear of, and are not kept.
  const kit = edgeKits(s.tier).wall
  const wall = wallGround(plan.edges, kit)
  const farmed = farms(
    {
      ...plan,
      blocks: clearOf(
        plan.blocks,
        plan.edges.filter((e) => e.kind === "wall"),
        kit,
        "green",
      ),
      placements: [
        ...plan.placements.filter((p) => p.lot === undefined || onGreen.has(p.lot)),
        ...wall.placements,
      ],
    },
    s,
    { ...lib, prefabs: [...lib.prefabs, ...wall.metas] },
    stage("farms"),
  )
  plan.fields.push(...farmed.fields)
  plan.placements.push(...farmed.placements)
  plan.edges.push(...farmed.edges)
  lap("farms")
  const port = harbour(plan, lib, stage("harbour"))
  plan.placements.push(...apart(port.placements, lib))
  lap("harbour")

  // Nature grows on the green only: of what is built, it need only see what stands out there (the
  // farms, and every edge so far), not the thousands of pieces inside the town.
  const outside = { ...plan, placements: farmed.placements }
  plan.nature.push(...nature(outside, lib, stage("nature")))
  lap("nature")
  const dressed = furnish(plan, lib, stage("furnish"))
  plan.placements.push(...dressed.placements)
  plan.edges.push(...dressed.edges)
  plan.plots.push(...dressed.plots)
  lap("furnish")

  plan.edges = plan.edges.map((e, id) => ({ ...e, id }))
  plan.sizes = usedSizes(plan, lib)
  plan.stations = stations(plan, lib, [...farmed.stations, ...port.stations])
  plan.walk = walkGraph(plan.streets, plan.stations)
  plan.hash = planHash(plan)
  lap("finish")
  return plan
}

/**
 * A wall's ground as placements of made-up prefabs (one per laid-out piece), for a stage
 * that keeps clear of placed footprints: runs and gates as wide as the wall, towers square.
 */
function wallGround(
  edges: readonly Edge[],
  kit: EdgeKitProfile,
): { metas: PrefabMeta[]; placements: Placement[] } {
  const metas: PrefabMeta[] = []
  const placements: Placement[] = []
  const put = (w: number, d: number, at: Vec2, rot: number): void => {
    const id = `wall-ground:${metas.length}`
    metas.push({
      id,
      kind: "landmark",
      frontage: w,
      depth: d,
      height: 0,
      door: [0, 0],
      stations: [],
      fits: {},
      tags: [],
    })
    placements.push({ prefab: id, seed: 0, at, rot })
  }
  // The pieces as the kit lays them out: a run's length along its own axis, the wall's thickness across.
  const along = (p: PieceInstance, length: number) =>
    kit.along === "x"
      ? put(length * p.scale, kit.thickness, [p.x, p.z], p.rot)
      : put(kit.thickness, length * p.scale, [p.x, p.z], p.rot)
  for (const e of edges) {
    if (e.kind !== "wall") continue
    const l = layoutEdge(e, kit)
    for (const p of l.segments) along(p, kit.length)
    for (const p of l.gates) along(p, kit.gateLength ?? kit.length)
    for (const p of l.towers)
      put(kit.towerSize ?? kit.thickness, kit.towerSize ?? kit.thickness, [p.x, p.z], p.rot)
  }
  return { metas, placements }
}

/**
 * The blocks of one use with the edges' ground cut out of them (a strip as wide as the kit's towers,
 * and a metre each side, along every run): farms laid out from the farmland's edge start beyond the
 * wall, and lots on a suburb block stop short of it. A green block keeps every piece the cut leaves; a
 * lots block keeps its largest, so its id still names one block for the lots and plots on it.
 */
function clearOf(
  blocks: readonly Block[],
  edges: readonly Edge[],
  kit: EdgeKitProfile,
  use: "green" | "lots",
): Block[] {
  const width = Math.max(kit.thickness, kit.towerSize ?? 0) + 2
  const strips = edges.map((e) => ribbon(e.closed ? [...e.points, e.points[0] as Vec2] : e.points, width))
  if (strips.length === 0) return [...blocks]
  return blocks.flatMap((b) => {
    if (b.use !== use) return [b]
    const [lo, hi] = bbox(b.poly)
    const near = strips.filter((r) => {
      const [a, z] = bbox(r)
      return a[0] <= hi[0] && z[0] >= lo[0] && a[1] <= hi[1] && z[1] >= lo[1]
    })
    if (near.length === 0) return [b]
    const left = sturdyClip(
      b.poly,
      near.map((r) => [r]),
      "difference",
    )
      .map((poly) => at(poly, 0))
      .filter((ring) => Math.abs(area(ring)) > 1)
      .sort((p, q) => Math.abs(area(q)) - Math.abs(area(p)))
    return (use === "lots" ? left.slice(0, 1) : left).map((poly) => ({ ...b, poly }))
  })
}

/** The placements with any whose footprint overlaps one kept before it left out (plants always kept). */
function apart(list: readonly Placement[], lib: PlanLibrary): Placement[] {
  const kept: Rect[] = []
  return list.filter((p) => {
    const size = lib.sizes[p.prefab]
    if (!size || PLANT_ROLES.has(p.role ?? "")) return true
    const r: Rect = { c: p.at, rot: p.rot, w: size[0], d: size[1] }
    if (kept.some((o) => rectsOverlap(o, r))) return false
    kept.push(r)
    return true
  })
}

/** The sizes of every id the plan places, sorted by id (the plan carries no more than it uses). */
function usedSizes(plan: TownPlan, lib: PlanLibrary): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  const ids = new Set([...plan.placements, ...plan.nature].map((p) => p.prefab))
  for (const id of [...ids].sort()) {
    const size = lib.sizes[id] ?? sizeOf(lib.prefabs.find((m) => m.id === id))
    if (size) out[id] = size
  }
  return out
}

const sizeOf = (m: PrefabMeta | undefined): [number, number] | undefined =>
  m ? [m.frontage, m.depth] : undefined

/** 8 hex digits over the whole plan (everything but the hash itself), numbers as JSON writes them. */
export function planHash(plan: TownPlan): string {
  const { hash: _, ...rest } = plan
  return fnv1a(JSON.stringify(rest)).toString(16).padStart(8, "0")
}

/**
 * The landmark a lot stands for (plan §4, "specials first"): a chapel takes a lot on a street a
 * little way out from the square, a guildhall the best lot on the square itself. The building on
 * that lot is replaced, centred on the lot's width with its front on the street; a town without a
 * prefab of the kind, or a lot it fits, keeps its houses. The castle is landmark.ts's.
 */
function special(
  placed: Placement[],
  lots: readonly TownLot[],
  lib: PlanLibrary,
  spec: ReturnType<typeof normalizeSpec>,
  plaza: Vec2[],
  draw: Roll,
): Placement[] {
  const want = spec.landmark
  if (want !== "chapel" && want !== "guildhall") return placed
  const metas = lib.prefabs.filter((m) =>
    want === "chapel" ? m.kind === "chapel" : m.kind === "landmark" || m.tags.includes("hall"),
  )
  const centre = centroid(plaza)
  const byLot = new Map(placed.map((p, i) => [p.lot, i]))
  type Choice = { lot: Lot; meta: PrefabMeta; score: number }
  const choices: Choice[] = []
  for (const lot of lots) {
    const i = byLot.get(lot.id)
    if (i === undefined || lot.district === "castle") continue
    const far = dist(lot.origin, centre)
    // A guildhall wants the square; a chapel a quieter street 0.25–0.6 r out.
    const score =
      want === "guildhall" ? far : Math.abs(far - 0.4 * spec.radius) + (far < 0.2 * spec.radius ? 1e3 : 0)
    for (const meta of metas)
      if (meta.frontage <= lot.w + 1e-3 && meta.depth <= lot.depth + 1e-3)
        choices.push({ lot, meta, score: score - meta.frontage })
  }
  choices.sort((a, b) => a.score - b.score || a.lot.id - b.lot.id || (a.meta.id < b.meta.id ? -1 : 1))
  const top = choices.slice(0, 3)
  const pick = top[Math.floor(draw("lot") * top.length)]
  if (!pick) return placed
  const { lot, meta } = pick
  const z: Vec2 = [DMath.sin(lot.rot), DMath.cos(lot.rot)]
  const at = snap(add(lot.origin, scale(z, lot.depth / 2 - meta.depth / 2)))
  const out = [...placed]
  out[byLot.get(lot.id) as number] = {
    prefab: meta.id,
    seed: Math.floor(draw("seed") * 0x7fffffff),
    at,
    rot: lot.rot,
    lot: lot.id,
    role: want === "guildhall" ? "hall" : "chapel",
  }
  return out
}
