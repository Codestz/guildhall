/**
 * The town's numbers against the Look bar. `builtPct` is the plan's (§4 step 10): lot buildings'
 * footprints over the lots blocks and the square, target ≥ 35%. Because houses are shallow (≤ 7 m)
 * and blocks deep, the same footprints over the whole walled town (blocks and their streets) read
 * lower: `walledBuiltPct`. What carries the rest is dressing: `dressedPct` is the share of the walled
 * town with a job (a street, the square, the ward, a lot, a plot), and `maxBare` the largest patch of
 * block ground without one, measured on a 1 m raster with slivers under ~2 m wide ignored.
 */
import { ribbon } from "../geom/line.ts"
import { axes, type Rect } from "../geom/obb.ts"
import { area, bbox, type Ring } from "../geom/poly.ts"
import { at, dot, round3, sub, type Vec2 } from "../geom/vec.ts"
import type { DressInput } from "./dress.ts"
import { lotRect } from "./lots.ts"
import type { Lot, TownDraw, TownMetrics } from "./types.ts"

/** Milliseconds per generation stage (generateTown's `times`). */
export type StageTimes = Record<string, number>

export interface TownReport extends TownMetrics {
  /** Lot buildings and the keep over the walled town with its streets. */
  walledBuiltPct: number
  /** Share of the walled town with a job. */
  dressedPct: number
  /** The largest bare patch in a block, m². */
  maxBare: number
  placements: number
  plants: number
  plots: number
  edges: number
  stations: number
  ms?: StageTimes
  totalMs?: number
}

/** A lot's ground reaches this far past its rect: its back fence and the walk along it, metres. */
const LOT_REACH = 0.7

export function townMetrics(
  plan: DressInput,
  extra: { draw?: TownDraw; tris?: Record<string, number>; ms?: StageTimes } = {},
): TownReport {
  const size = (id: string): [number, number] | undefined => plan.sizes?.[id]
  const lotBuildings = plan.placements.filter((p) => p.lot !== undefined)
  const foot = (list: typeof lotBuildings) =>
    list.reduce((s, p) => {
      const sz = size(p.prefab)
      return s + (sz ? sz[0] * sz[1] : 0)
    }, 0)
  const built = foot(lotBuildings)
  const keep = foot(plan.placements.filter((p) => p.role === "keep"))
  const blockArea = (uses: readonly string[]) =>
    plan.blocks.filter((b) => uses.includes(b.use)).reduce((s, b) => s + Math.abs(area(b.poly)), 0)
  const lotsAndSquare = blockArea(["lots", "plaza"])
  const streets = plan.streets.edges
    .filter((e) => e.cls !== "road")
    .reduce((s, e) => s + Math.abs(area(ribbon(e.points, e.width))), 0)
  const walled = blockArea(["lots", "plaza", "castle"]) + streets
  const bare = bareGround(plan)
  const lotW = plan.lots.reduce((s, l) => s + l.w, 0)
  const frontage = lotBuildings.reduce((s, p) => s + (size(p.prefab)?.[0] ?? 0), 0)
  const tris = extra.tris
  const ms = extra.ms
  return {
    builtPct: pct(built, lotsAndSquare),
    walledBuiltPct: pct(built + keep, walled),
    dressedPct: pct(walled - bare.total, walled),
    maxBare: bare.largest,
    houses: lotBuildings.length,
    frontageFill: pct(frontage, lotW),
    lots: plan.lots.length,
    placements: plan.placements.length,
    plants: plan.nature.length,
    plots: plan.plots?.length ?? 0,
    edges: plan.edges.length,
    stations: plan.stations.length,
    pieces: extra.draw?.pieces.length ?? 0,
    estTris: extra.draw && tris ? extra.draw.pieces.reduce((s, p) => s + (tris[p.piece] ?? 0), 0) : 0,
    ...(ms ? { ms, totalMs: round3(Object.values(ms).reduce((a, b) => a + b, 0)) } : {}),
  }
}

const pct = (part: number, whole: number) => (whole > 0 ? round3(part / whole) : 0)

/**
 * Bare block ground on a 1 m raster: every sample in a lots block that is in no lot (or its reach)
 * and no plot. `largest` is the biggest 4-connected patch of samples bare with all eight neighbours
 * bare too, so the slivers left along kerbs and between plots do not count as patches.
 */
function bareGround(plan: DressInput): { total: number; largest: number } {
  const lotsOf = new Map<number, Lot[]>()
  for (const l of plan.lots) lotsOf.set(l.block, [...(lotsOf.get(l.block) ?? []), l])
  const plotsOf = new Map<number, Ring[]>()
  for (const p of plan.plots ?? []) plotsOf.set(p.block, [...(plotsOf.get(p.block) ?? []), p.poly])
  let total = 0
  let largest = 0
  for (const b of plan.blocks) {
    if (b.use !== "lots") continue
    const rects = (lotsOf.get(b.id) ?? []).map((l) => grow(lotRect(l), LOT_REACH))
    const plots = plotsOf.get(b.id) ?? []
    const [lo, hi] = bbox(b.poly)
    const cols = Math.ceil(hi[0] - lo[0])
    const rows = Math.ceil(hi[1] - lo[1])
    const bareAt = new Uint8Array(cols * rows)
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const p: Vec2 = [lo[0] + i + 0.5, lo[1] + j + 0.5]
        if (!inside(b.poly, p) || rects.some((r) => inRect(r, p)) || plots.some((r) => inside(r, p))) continue
        bareAt[j * cols + i] = 1
        total++
      }
    largest = Math.max(largest, deepPatch(bareAt, cols, rows))
  }
  return { total, largest }
}

const grow = (r: Rect, d: number): Rect => ({ ...r, w: r.w + 2 * d, d: r.d + 2 * d })

/** The largest 4-connected group of cells that are bare with all eight neighbours bare. */
function deepPatch(bare: Uint8Array, cols: number, rows: number): number {
  const deep = new Uint8Array(cols * rows)
  for (let i = 1; i + 1 < cols; i++)
    for (let j = 1; j + 1 < rows; j++) {
      let all = true
      for (let di = -1; di <= 1 && all; di++)
        for (let dj = -1; dj <= 1 && all; dj++) if (!bare[(j + dj) * cols + i + di]) all = false
      if (all) deep[j * cols + i] = 1
    }
  let best = 0
  const stack: number[] = []
  for (let k = 0; k < deep.length; k++) {
    if (!deep[k]) continue
    let n = 0
    deep[k] = 0
    stack.push(k)
    while (stack.length > 0) {
      const c = stack.pop() as number
      n++
      const i = c % cols
      for (const m of [c - 1, c + 1, c - cols, c + cols]) {
        if (m < 0 || m >= deep.length || !deep[m]) continue
        if ((m === c - 1 && i === 0) || (m === c + 1 && i === cols - 1)) continue
        deep[m] = 0
        stack.push(m)
      }
    }
    best = Math.max(best, n)
  }
  return best
}

const inRect = (r: Rect, p: Vec2): boolean => {
  const { x, z } = axes(r.rot)
  const d = sub(p, r.c)
  return Math.abs(dot(d, x)) <= r.w / 2 && Math.abs(dot(d, z)) <= r.d / 2
}

function inside(ring: Ring, p: Vec2): boolean {
  let odd = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = at(ring, i)
    const b = at(ring, j)
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      odd = !odd
  }
  return odd
}
