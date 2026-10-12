/**
 * Dressing the town's ground (Look bar #3: no ground without a job). Lots are a building and its yard;
 * the yard behind each building gets the vignette of its trade (a smithy's anvil, firewood and
 * barrels; a tavern's benches and barrels; a shop's crates and sacks), and a fence along its back
 * where it meets the gardens. A lot with no building is a hedged garden. What the lots leave of a
 * block (its interior: houses are at most ~7 m deep, blocks up to 44 m) is tiled by a quadtree of
 * plots square to the block, 8 m then 4 m then 2 m, and each plot is given a job by its district:
 * a garden with a tree, an allotment of crop rows, a yard with an outbuilding, woodpile and barrels,
 * or a little orchard. The market square gets rows of stalls facing its axis, with crates and carts
 * between them, round a fountain (or a well in smaller towns). Every piece stands at its footprint's
 * centre, turned square to its lot, plot or square, and no two footprints overlap.
 */
import { axes, obb, type Rect, rectCorners, rectInPoly, rectsOverlap } from "../geom/obb.ts"
import { bbox, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, at, dot, round3, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import type { SizedPiece } from "./harbour.ts"
import type { PlanLibrary, PropKit } from "./library.ts"
import { lotRect, type TownLot } from "./lots.ts"
import { normalizeSpec } from "./spec.ts"
import type { Block, DistrictKind, Edge, Placement, TownPlan } from "./types.ts"

export const PLOT_KINDS = ["garden", "allotment", "yard", "orchard"] as const
export type PlotKind = (typeof PLOT_KINDS)[number]

/** A piece of ground given a job: its outline (a rect, CCW) and the block it lies in. */
export interface Plot {
  kind: PlotKind
  poly: Vec2[]
  block: number
}

export type FurnishInput = Pick<TownPlan, "spec" | "blocks" | "placements"> & { lots: readonly TownLot[] }

export interface Furnished {
  placements: Placement[]
  edges: Edge[]
  plots: Plot[]
}

/** Plot sides, largest first: the quadtree's levels, metres. */
const CELLS = [8, 4, 2] as const
/** Plots keep this far from the lots (a lot's back fence and the walk behind it), metres. */
const LOT_CLEAR = 0.6
/** A plot's content keeps this far in from its sides, metres. */
const GUTTER = 0.35
/** Pieces in one yard or plot keep this far apart, metres. */
const SPACE = 0.25
/** A yard's content keeps this far from the lot's back and from the building, metres. */
const YARD_CLEAR = 0.35
/** Crop rows in an allotment lie this far apart, plants this far apart along a row, metres. */
const ROW = 1.6
const PLANT = 1.4
/** Tries per piece when packing a yard or a plot. */
const TRIES = 14
/** The square's stalls keep this far from its edge, and from the fountain, metres. */
const SQUARE_EDGE = 1.5
const FOUNTAIN_CLEAR = 3
/** Between two rows of stalls facing each other, and between two back to back; along a row, metres. */
const AISLE = 3.5
const BACK_TO_BACK = 0.8
const STALL_GAP = 1.8
/** The chance a stall's place in a row is taken. */
const STALL_ODDS = 0.7
/** A yard shallower than this gets no back fence, metres. */
const FENCE_ROOM = 0.5
/** A tree's trunk and the ground kept clear round it, metres. */
const TRUNK = 1.2

/** What each district does with its back land, by plot kind, as weights (8 m plots; smaller ones garden more). */
const JOBS: Readonly<Record<DistrictKind, Readonly<Record<PlotKind, number>>>> = {
  residential: { garden: 4, allotment: 3, orchard: 1.5, yard: 2.5 },
  market: { garden: 3, allotment: 1, orchard: 1, yard: 5 },
  craft: { garden: 2, allotment: 2, orchard: 1, yard: 6 },
  harbour: { garden: 3, allotment: 2, orchard: 1, yard: 4 },
  castle: { garden: 4, allotment: 2, orchard: 2, yard: 2 },
  farm: { garden: 2, allotment: 5, orchard: 2, yard: 2 },
}

export function furnish(plan: FurnishInput, lib: PlanLibrary, roll: Roll): Furnished {
  const out: Furnished = { placements: [], edges: [], plots: [] }
  const props = lib.props
  const sizes = lib.sizes
  const byLot = new Map<number, Placement>()
  for (const p of plan.placements) if (p.lot !== undefined) byLot.set(p.lot, p)
  const lotsOf = new Map<number, TownLot[]>()
  for (const l of plan.lots) lotsOf.set(l.block, [...(lotsOf.get(l.block) ?? []), l])
  const edge = (kind: Edge["kind"], points: Vec2[], gaps: Edge["gaps"] = []) =>
    out.edges.push({ id: out.edges.length, kind, points: points.map(snap), closed: false, gaps })

  for (const lot of plan.lots) {
    const draw: Roll = (salt) => roll(`${lot.id}:${salt}:lot`)
    const building = byLot.get(lot.id)
    const size = building ? sizes[building.prefab] : undefined
    if (!building || !size) {
      garden(lot, props, draw, out, edge)
      continue
    }
    // A building reaching the lot's back (a corner lot has no yard) leaves no room for a fence.
    if (yard(lot, building, size, props, draw, out.placements) >= FENCE_ROOM)
      backFence(lot, lotsOf.get(lot.block) ?? [], edge)
  }

  const { tier } = normalizeSpec(plan.spec)
  for (const block of plan.blocks) {
    const draw: Roll = (salt) => roll(`${block.id}:${salt}:block`)
    if (block.use === "lots") interior(block, lotsOf.get(block.id) ?? [], props, draw, out)
    if (block.use === "plaza")
      square(block, props, tier !== "hamlet" && tier !== "village", draw, out.placements)
  }
  return out
}

/** A lot's local frame: its centre, its axes (+z to the street) and its rect. */
const frame = (lot: TownLot) => ({ ...axes(lot.rot), c: lot.origin, rect: lotRect(lot) })

/** The point at (u, v) in a rect's frame. */
const local = (r: Rect, u: number, v: number): Vec2 => {
  const { x, z } = axesOf(r.rot)
  return add(r.c, add(scale(x, u), scale(z, v)))
}

/** `axes`, remembering the last turn asked for: a plot's pieces all share one (DMath's trig is slow). */
let lastTurn = Number.NaN
let lastAxes = axes(0)
function axesOf(rot: number): { x: Vec2; z: Vec2 } {
  if (rot !== lastTurn) {
    lastTurn = rot
    lastAxes = axes(rot)
  }
  return lastAxes
}

/** A footprint in an area's own frame: centre (u, v) and half extents. Pieces turn by quarters, so it is a box. */
type Box = { u: number; v: number; hw: number; hd: number }

/**
 * Pieces packed into the area (a rect), each at a drawn spot and quarter turn where it fits clear of
 * what is already there (`taken`, boxes in the area's frame, which it adds to): a piece that cannot
 * be fitted after a few tries is left out.
 */
function pack(
  area: Rect,
  items: readonly { piece: SizedPiece; role: string }[],
  draw: Roll,
  into: Placement[],
  taken: Box[] = [],
): void {
  items.forEach(({ piece, role }, k) => {
    for (let t = 0; t < TRIES; t++) {
      const quarter = draw(`${k}:${t}:turn`) < 0.5
      const w = quarter ? piece.d : piece.w
      const d = quarter ? piece.w : piece.d
      if (w > area.w || d > area.d) continue
      const box: Box = {
        u: (draw(`${k}:${t}:u`) - 0.5) * (area.w - w),
        v: (draw(`${k}:${t}:v`) - 0.5) * (area.d - d),
        hw: w / 2,
        hd: d / 2,
      }
      const clash = taken.some(
        (o) => Math.abs(o.u - box.u) < o.hw + box.hw + SPACE && Math.abs(o.v - box.v) < o.hd + box.hd + SPACE,
      )
      if (clash) continue
      taken.push(box)
      const rot = round3(area.rot + (quarter ? Math.PI / 2 : 0))
      into.push({
        prefab: piece.id,
        seed: seedFrom(draw(`${k}:seed`)),
        at: snap(local(area, box.u, box.v)),
        rot,
        role,
      })
      return
    }
  })
}

const seedFrom = (u: number): number => Math.floor(u * 2147483647)
const any = (list: readonly SizedPiece[], u: number): SizedPiece | undefined =>
  list[Math.floor(u * list.length)]
/** Up to n draws from the list, as pack items with one role. */
function some(list: readonly SizedPiece[], n: number, role: string, draw: Roll, salt: string) {
  const out: { piece: SizedPiece; role: string }[] = []
  for (let i = 0; i < n; i++) {
    const piece = any(list, draw(`${i}:${salt}`))
    if (piece) out.push({ piece, role })
  }
  return out
}

/**
 * The yard behind a building: the strip from the lot's back to the building's back, holding its
 * trade's vignette (the rest stays a kitchen garden: a bush or a barrel).
 */
function yard(
  lot: TownLot,
  building: Placement,
  [, bd]: [number, number],
  props: PropKit,
  draw: Roll,
  into: Placement[],
): number {
  const f = frame(lot)
  const zc = dot(sub(building.at, f.c), f.z)
  const back = zc - bd / 2
  const yardDepth = back + lot.depth / 2
  const depth = yardDepth - 2 * YARD_CLEAR
  if (depth < 0.8) return yardDepth
  const area: Rect = {
    c: snap(add(f.c, scale(f.z, (back - lot.depth / 2) / 2))),
    rot: lot.rot,
    w: round3(lot.w - 2 * YARD_CLEAR),
    d: round3(depth),
  }
  const role = building.role ?? "house"
  const items =
    role === "forge"
      ? [
          ...some(props.anvils, 1, "anvil", draw, "anvil"),
          ...some(props.firewood, 1, "firewood", draw, "wood"),
          ...some(props.barrels, 2, "barrel", draw, "barrel"),
        ]
      : role === "tavern"
        ? [
            ...some(props.benches, 2, "bench", draw, "bench"),
            ...some(props.barrels, 3, "barrel", draw, "barrel"),
          ]
        : role === "shop"
          ? [
              ...some(props.crates, 2, "crate", draw, "crate"),
              ...some(props.sacks, 1, "sack", draw, "sack"),
              ...(lot.district === "market" ? some(props.carts, 1, "cart", draw, "cart") : []),
            ]
          : role === "chapel" || role === "hall"
            ? some(props.benches, 2, "bench", draw, "bench")
            : draw("chore") < 0.55
              ? [
                  ...some(props.firewood, 1, "firewood", draw, "wood"),
                  ...some(props.barrels, 1, "barrel", draw, "barrel"),
                ]
              : [
                  ...some(props.buckets, 1, "bucket", draw, "bucket"),
                  ...some(props.barrels, 1, "barrel", draw, "barrel"),
                ]
  pack(area, items, draw, into)
  return yardDepth
}

/** The fence along a lot's back, unless the lot behind (back to back) already draws it. */
function backFence(
  lot: TownLot,
  neighbours: readonly TownLot[],
  edge: (k: Edge["kind"], p: Vec2[]) => void,
): void {
  const f = frame(lot)
  const behind = add(f.c, scale(f.z, -lot.depth / 2 - 1.2))
  const other = neighbours.find((n) => n.id !== lot.id && inRect(lotRect(n), behind))
  if (other && other.id < lot.id) return
  const v = -lot.depth / 2 + 0.15
  edge("fence", [local(f.rect, -lot.w / 2 + 0.2, v), local(f.rect, lot.w / 2 - 0.2, v)])
}

const inRect = (r: Rect, p: Vec2): boolean => {
  const { x, z } = axes(r.rot)
  const d = sub(p, r.c)
  return Math.abs(dot(d, x)) <= r.w / 2 && Math.abs(dot(d, z)) <= r.d / 2
}

/** A lot left without a building: a garden behind a hedge (a gap for the gate), a tree, bushes and flowers. */
function garden(
  lot: TownLot,
  props: PropKit,
  draw: Roll,
  out: Furnished,
  edge: (k: Edge["kind"], p: Vec2[], g?: Edge["gaps"]) => void,
): void {
  const f = frame(lot)
  out.plots.push({ kind: "garden", poly: rectCorners(f.rect).map(snap), block: lot.block })
  // The hedge stands back from the street so its width (1.4 m) stays on the lot.
  const v = lot.depth / 2 - 0.9
  const run = lot.w - 1.2
  if (run > 4)
    edge(
      "hedge",
      [local(f.rect, -run / 2, v), local(f.rect, run / 2, v)],
      [{ s: round3(run / 2 - 0.9), width: 1.8, kind: "gap" }],
    )
  const area: Rect = {
    c: snap(local(f.rect, 0, -0.9)),
    rot: lot.rot,
    w: lot.w - 2 * GUTTER,
    d: lot.depth - 1.8 - 2 * GUTTER,
  }
  plant(area, props, draw, out.placements, 1 + Math.floor(lot.w / 10))
}

/** Garden planting: trees (their trunks kept clear), then bushes and flowers round them. */
function plant(area: Rect, props: PropKit, draw: Roll, into: Placement[], trees: number): void {
  const taken: Box[] = []
  const trunk = (p: SizedPiece): SizedPiece => ({
    ...p,
    w: Math.min(p.w, TRUNK + 1),
    d: Math.min(p.d, TRUNK + 1),
  })
  pack(
    area,
    some(props.trees, trees, "tree", draw, "tree").map((i) => ({ ...i, piece: trunk(i.piece) })),
    draw,
    into,
    taken,
  )
  pack(area, [...some(props.stumps, draw("stump") < 0.3 ? 1 : 0, "stump", draw, "stump")], draw, into, taken)
  const small = Math.max(1, Math.floor((area.w * area.d) / 12))
  pack(area, gardenPlants(props, small, draw), draw, into, taken)
}

/** Bushes and flowers, about half and half. */
function gardenPlants(props: PropKit, n: number, draw: Roll) {
  return [
    ...some(props.bushes, Math.ceil(n / 2), "bush", draw, "bush"),
    ...some(props.flowers, Math.floor(n / 2), "flower", draw, "flower"),
  ]
}

/**
 * A block's interior: what its lots leave, tiled by plots square to the block (8, 4, then 2 m), each
 * a garden, allotment, yard or orchard by the district's mix.
 */
function interior(block: Block, lots: readonly TownLot[], props: PropKit, draw: Roll, out: Furnished): void {
  const box = obb(block.poly)
  // Cells are square to the block, so the tests run in its frame, where a cell is a box.
  const { x, z } = axes(box.rot)
  const toLocal = (p: Vec2): Vec2 => {
    const d = sub(p, box.c)
    return [dot(d, x), dot(d, z)]
  }
  const ring = block.poly.map(toLocal)
  const avoid = lots.map((l) => {
    const rect = { ...lotRect(l), w: l.w + 2 * LOT_CLEAR, d: l.depth + 2 * LOT_CLEAR }
    const corners = rectCorners(rect).map(toLocal)
    const [lo, hi] = bbox(corners)
    // The lot's own axes in the block's frame, for the other half of the separating-axis test.
    const ax = sub(at(corners, 1), at(corners, 0))
    const az = sub(at(corners, 3), at(corners, 0))
    return {
      lo,
      hi,
      c: toLocal(rect.c),
      ax: scale(ax, 1 / rect.w),
      az: scale(az, 1 / rect.d),
      hw: rect.w / 2,
      hd: rect.d / 2,
    }
  })
  /** Whether the box lo..hi overlaps the lot (more than a millimetre): its AABB, then its own axes. */
  const hits = (a: (typeof avoid)[number], lo: Vec2, hi: Vec2): boolean => {
    const e = 1e-3
    if (!(a.lo[0] < hi[0] - e && a.hi[0] > lo[0] + e && a.lo[1] < hi[1] - e && a.hi[1] > lo[1] + e))
      return false
    const c: Vec2 = [(lo[0] + hi[0]) / 2 - a.c[0], (lo[1] + hi[1]) / 2 - a.c[1]]
    const h: Vec2 = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2]
    for (const [axis, half] of [
      [a.ax, a.hw],
      [a.az, a.hd],
    ] as const) {
      const reach = Math.abs(axis[0]) * h[0] + Math.abs(axis[1]) * h[1]
      if (Math.abs(dot(c, axis)) >= half + reach - e) return false
    }
    return true
  }
  const jitter: Vec2 = [draw("jitter-u") * CELLS[0], draw("jitter-v") * CELLS[0]]
  const cols = Math.ceil(box.w / CELLS[0]) + 1
  const rows = Math.ceil(box.d / CELLS[0]) + 1
  // A cell's children can only be crossed by the sides, and blocked by the lots, that reach the cell.
  type Cell = { u: number; v: number; size: number; sides: number[]; lots: number[] }
  const allSides = ring.map((_, i) => i)
  const allLots = avoid.map((_, i) => i)
  const queue: Cell[] = []
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++)
      queue.push({
        u: -box.w / 2 - jitter[0] + (i + 0.5) * CELLS[0],
        v: -box.d / 2 - jitter[1] + (j + 0.5) * CELLS[0],
        size: CELLS[0],
        sides: allSides,
        lots: allLots,
      })
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q] as Cell
    const h = cell.size / 2
    const lo: Vec2 = [cell.u - h, cell.v - h]
    const hi: Vec2 = [cell.u + h, cell.v + h]
    const sides = cell.sides.filter((i) => segmentHitsBox(at(ring, i), at(ring, i + 1), lo, hi))
    // Crossed by no side, the cell is wholly in the block or wholly out of it.
    if (sides.length === 0 && !inside(ring, [cell.u, cell.v])) continue
    const lots = cell.lots.filter((k) => hits(avoid[k] as (typeof avoid)[number], lo, hi))
    if (sides.length === 0 && lots.length === 0) {
      const rect: Rect = { c: snap(local(box, cell.u, cell.v)), rot: box.rot, w: cell.size, d: cell.size }
      job(rect, block, props, (salt) => draw(`${q}:${salt}`), out)
      continue
    }
    const half = cell.size / 2
    if (half < (CELLS[CELLS.length - 1] as number)) continue
    for (const [du, dv] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const)
      queue.push({ u: cell.u + (du * half) / 2, v: cell.v + (dv * half) / 2, size: half, sides, lots })
  }
}

/** One plot's job, drawn by its size and the district's mix, and what stands on it. */
function job(cell: Rect, block: Block, props: PropKit, draw: Roll, out: Furnished): void {
  const mix = JOBS[block.district]
  const kinds = PLOT_KINDS.filter((k) => cell.w >= 8 || k !== "orchard")
  const weights = kinds.map((k) =>
    cell.w >= 8
      ? mix[k]
      : cell.w >= 4
        ? k === "garden"
          ? 4
          : k === "yard"
            ? 2
            : 1.5
        : k === "garden"
          ? 1
          : 0,
  )
  let u = draw("job") * weights.reduce((a, b) => a + b, 0)
  const kind =
    kinds.find((_, i) => {
      u -= weights[i] as number
      return u < 0
    }) ?? "garden"
  out.plots.push({ kind, poly: rectCorners(cell).map(snap), block: block.id })
  const area: Rect = { ...cell, w: cell.w - 2 * GUTTER, d: cell.d - 2 * GUTTER }
  const trees = cell.w >= 8 ? 1 + Math.floor(2 * draw("trees")) : cell.w >= 4 && draw("tree") < 0.5 ? 1 : 0
  if (kind === "garden") plant(area, props, draw, out.placements, trees)
  else if (kind === "allotment") rows(area, props, draw, out.placements)
  else if (kind === "orchard") orchard(area, props, draw, out.placements)
  else {
    const big = cell.w >= 8
    const items = [
      ...(big
        ? some(
            props.sheds.filter((s) => s.w <= area.w && s.d <= area.d),
            1,
            "shed",
            draw,
            "shed",
          )
        : []),
      ...some(props.firewood, 1, "firewood", draw, "wood"),
      ...some(props.barrels, big ? 2 : 1, "barrel", draw, "barrel"),
      ...(big ? some(props.crates, 1, "crate", draw, "crate") : []),
    ]
    pack(area, items, draw, out.placements)
  }
}

/** Crop rows across the plot, one crop to it. */
function rows(area: Rect, props: PropKit, draw: Roll, into: Placement[]): void {
  const crop = any(props.crops, draw("crop"))
  if (!crop) return
  const nu = Math.max(1, Math.floor((area.w - crop.w) / PLANT) + 1)
  const nv = Math.max(1, Math.floor((area.d - crop.d) / ROW) + 1)
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const p = local(area, (i - (nu - 1) / 2) * PLANT, (j - (nv - 1) / 2) * ROW)
      into.push({
        prefab: crop.id,
        seed: seedFrom(draw(`${i}:${j}:plant`)),
        at: snap(p),
        rot: area.rot,
        role: "crop",
      })
    }
}

/** Four fruit trees on a square, or one where the plot is small. */
function orchard(area: Rect, props: PropKit, draw: Roll, into: Placement[]): void {
  const tree = any(props.trees, draw("orchard"))
  if (!tree) return
  const step = area.w / 2
  for (const [i, j] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    into.push({
      prefab: tree.id,
      seed: seedFrom(draw(`${i}:${j}:fruit`)),
      at: snap(local(area, (i * step) / 2, (j * step) / 2)),
      rot: round3(2 * Math.PI * draw(`${i}:${j}:fruit-turn`)),
      role: "orchard",
    })
  }
}

/**
 * The market square: a fountain (a well in a village) at its middle, rows of stalls either side of
 * its long axis facing it, crates and barrels beside them and a cart at a row's end.
 */
function square(block: Block, props: PropKit, fountain: boolean, draw: Roll, into: Placement[]): void {
  const box = obb(block.poly)
  const taken: Rect[] = []
  const fits = (r: Rect, margin: number) =>
    rectInPoly({ ...r, w: r.w + 2 * margin, d: r.d + 2 * margin }, block.poly)
  const middle = fountain ? any(props.fountains, draw("fountain")) : undefined
  const centre = middle ?? any(props.wells, draw("well"))
  if (centre) {
    const r: Rect = { c: box.c, rot: box.rot, w: centre.w, d: centre.d }
    if (fits(r, SQUARE_EDGE)) {
      into.push({
        prefab: centre.id,
        seed: seedFrom(draw("centre-seed")),
        at: r.c,
        rot: r.rot,
        role: middle ? "fountain" : "well",
      })
      taken.push({ ...r, w: r.w + 2 * FOUNTAIN_CLEAR, d: r.d + 2 * FOUNTAIN_CLEAR })
    }
  }
  const stall = props.stalls
  if (stall.length === 0) return
  const depth = Math.max(...stall.map((s) => s.d))
  // Rows across the square's short side, in pairs facing a shared aisle, back to back between pairs.
  const rows: { v: number; facing: 1 | -1 }[] = []
  for (let v = -box.d / 2 + SQUARE_EDGE + depth / 2, k = 0; v <= box.d / 2 - SQUARE_EDGE - depth / 2; k++) {
    rows.push({ v, facing: k % 2 === 0 ? 1 : -1 })
    v += depth + (k % 2 === 0 ? AISLE : BACK_TO_BACK)
  }
  for (const [ri, row] of rows.entries()) {
    let u = -box.w / 2 + SQUARE_EDGE
    for (let k = 0; u < box.w / 2 - SQUARE_EDGE; k++) {
      const salt = `${ri}:${k}`
      const piece = any(stall, draw(`${salt}:stall`)) as SizedPiece
      const step = piece.w + STALL_GAP
      const open = draw(`${salt}:open`) < STALL_ODDS
      // The stall's front (+z) faces its aisle.
      const r: Rect = {
        c: snap(local(box, u + piece.w / 2, row.v)),
        rot: round3(box.rot + (row.facing > 0 ? 0 : Math.PI)),
        w: piece.w,
        d: piece.d,
      }
      u += step
      if (
        !open ||
        !fits(r, SQUARE_EDGE) ||
        taken.some((o) => rectsOverlap({ ...r, w: r.w + 1, d: r.d + 1 }, o))
      )
        continue
      into.push({
        prefab: piece.id,
        seed: seedFrom(draw(`${salt}:stall-seed`)),
        at: r.c,
        rot: r.rot,
        role: "stall",
      })
      taken.push(r)
      // Goods in the gap after it: a crate or a barrel.
      const goods = any([...props.crates, ...props.barrels], draw(`${salt}:goods`))
      if (!goods || goods.w > STALL_GAP - 0.4 || draw(`${salt}:has-goods`) >= 0.5) continue
      const g: Rect = { c: snap(local(box, u - STALL_GAP / 2, row.v)), rot: r.rot, w: goods.w, d: goods.d }
      if (fits(g, SQUARE_EDGE) && !taken.some((o) => rectsOverlap({ ...g, w: g.w + 0.4, d: g.d + 0.4 }, o))) {
        into.push({
          prefab: goods.id,
          seed: seedFrom(draw(`${salt}:goods-seed`)),
          at: g.c,
          rot: g.rot,
          role: "crate",
        })
        taken.push(g)
      }
    }
  }
  const cart = any(props.carts, draw("cart"))
  if (cart)
    for (const end of [-1, 1] as const) {
      const r: Rect = {
        c: snap(local(box, end * (box.w / 2 - SQUARE_EDGE - cart.d / 2 - 1), 0)),
        rot: round3(box.rot + Math.PI / 2),
        w: cart.w,
        d: cart.d,
      }
      if (
        fits(r, SQUARE_EDGE) &&
        !taken.some((o) => rectsOverlap({ ...r, w: r.w + 1, d: r.d + 1 }, o)) &&
        draw(`${end}:cart`) < 0.7
      ) {
        into.push({
          prefab: cart.id,
          seed: seedFrom(draw(`${end}:cart-seed`)),
          at: r.c,
          rot: r.rot,
          role: "cart",
        })
        taken.push(r)
      }
    }
}

/**
 * Whether segment a→b passes through the open box lo..hi (cut back by a millimetre, so a side lying
 * along the box does not count): Liang–Barsky clipping.
 */
function segmentHitsBox(a: Vec2, b: Vec2, lo: Vec2, hi: Vec2): boolean {
  const e = 1e-3
  let t0 = 0
  let t1 = 1
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]]
  for (const [p, q] of [
    [-d[0], a[0] - (lo[0] + e)],
    [d[0], hi[0] - e - a[0]],
    [-d[1], a[1] - (lo[1] + e)],
    [d[1], hi[1] - e - a[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return true
}

/** Point in ring by crossings (cheap; the quadtree asks often). */
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
