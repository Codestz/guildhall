/**
 * The numbers beside the map: what was generated, how dense it is against the Look bar (≥35% built),
 * how long the walls run and what each stage cost. Pure.
 */
import { area, type Block, type TownPlan, type Vec2 } from "@guildhall/world"
import type { MapData } from "./derive.ts"
import type { Timing } from "./generate.ts"
import type { Layer } from "./query.ts"

export interface PlanStats {
  seed: number
  tier: string
  radius: number
  harbour: string
  blocks: number
  blocksByUse: Partial<Record<Block["use"], number>>
  lots: number
  houses: number
  /** Built footprint over the lots blocks plus the squares, 0..1; null before anything is placed. */
  builtPct: number | null
  /** Lots blocks over the town's blocks, 0..1: how much of the town is buildable. */
  lotsShare: number
  /** Town edge (wall, hedge or fence) length in metres, castle curtain apart. */
  edgeKind: string
  edgeLength: number
  castleLength: number
  towers: number
  gates: number
  streetLength: Record<string, number>
  fields: number
  trees: number
  pois: number
  timings: Timing[]
  totalMs: number
}

const ringArea = (r: readonly Vec2[]) => Math.abs(area(r))

function runLength(run: readonly Vec2[]): number {
  let l = 0
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1] as Vec2
    const b = run[i] as Vec2
    l += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return l
}

export function planStats(map: MapData, timings: Timing[]): PlanStats {
  const plan: TownPlan = map.plan
  const blocksByUse: PlanStats["blocksByUse"] = {}
  for (const b of plan.blocks) blocksByUse[b.use] = (blocksByUse[b.use] ?? 0) + 1
  const lotsArea = plan.blocks.filter((b) => b.use === "lots").reduce((s, b) => s + ringArea(b.poly), 0)
  const allArea = plan.blocks.reduce((s, b) => s + ringArea(b.poly), 0)
  const squares = plan.plazas.reduce((s, p) => s + ringArea(p), 0)
  const footprint =
    map.houses.reduce((s, h) => s + h.w * h.d, 0) +
    map.rects.filter((r) => r.kind !== "pier").reduce((s, r) => s + r.w * r.d, 0)
  const placed = map.houses.length + map.rects.filter((r) => r.kind === "building").length

  const town = map.edges.filter((e) => !e.castle && !e.farm)
  const castle = map.edges.filter((e) => e.castle)
  const len = (list: typeof map.edges) =>
    list.reduce((s, e) => s + e.runs.reduce((t, r) => t + runLength(r), 0), 0)

  const streetLength: Record<string, number> = {}
  for (const e of plan.streets.edges) streetLength[e.cls] = (streetLength[e.cls] ?? 0) + runLength(e.points)

  const h = plan.spec.harbour
  return {
    seed: plan.spec.seed,
    tier: plan.spec.tier,
    radius: plan.spec.radius ?? 0,
    harbour: h ? `${Math.round(((((h.bearing * 180) / Math.PI) % 360) + 360) % 360)}°` : "none",
    blocks: plan.blocks.length,
    blocksByUse,
    lots: plan.lots.length,
    houses: map.houses.length,
    builtPct: placed > 0 && lotsArea + squares > 0 ? footprint / (lotsArea + squares) : null,
    lotsShare: allArea > 0 ? lotsArea / allArea : 0,
    edgeKind: town[0]?.kind ?? "none",
    edgeLength: len(town),
    castleLength: len(castle),
    towers: town.reduce((s, e) => s + e.towers.length, 0),
    gates: town.reduce((s, e) => s + e.gates.length, 0),
    streetLength,
    fields: plan.fields.length,
    trees: map.nature.length,
    pois: map.pois.length,
    timings,
    totalMs: timings.reduce((s, t) => s + t.ms, 0),
  }
}

/** How many things each layer would draw: 0 means the stage that fills it has not landed (or made none). */
export function layerCounts(map: MapData): Record<Layer, number> {
  const plan = map.plan
  return {
    streets: plan.streets.edges.length + map.trails.length,
    blocks: plan.blocks.length,
    lots: plan.lots.length,
    houses: map.houses.length + map.rects.filter((r) => r.kind === "building" || r.kind === "stall").length,
    walls: map.edges.filter((e) => !e.castle && !e.farm).length,
    castle: map.edges.filter((e) => e.castle).length + map.rects.filter((r) => r.kind === "keep").length,
    farms: plan.fields.length + map.edges.filter((e) => e.farm).length,
    nature: map.nature.length,
    harbour:
      plan.water.length +
      map.rects.filter((r) => r.kind === "pier").length +
      map.overlays.length +
      plan.blocks.filter((b) => b.use === "harbour").length,
    pois: map.pois.length,
    walk: plan.streets.nodes.length + map.trails.length,
    labels: map.labels.length,
  }
}
