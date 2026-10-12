/**
 * Stage 4 (plan §4): lots. Every lots block is walked along its sides, cut into frontage runs at its
 * corners (a turn over 30°), and each run is packed with lots whose widths are the frontages the
 * block's district can build, weighted toward its mix, with the district's and tier's gaps between
 * them. A lot is an oriented rectangle whose front runs square (within 1°) to the street's own run
 * past it, from the block side (or just behind it where the side bows in), and whose depth is the
 * deepest house that fits plus a 2–5 m yard, cut at the block's spine (half the inward ray to the far
 * side). The busier streets are packed first, so the lot at a convex corner belongs to the busier
 * street and is a `corner` lot (no yard: its side is the cross street's frontage); the cross street's
 * lots start past it. A lot never fronts a sharp bend of its street, a run's bend over 30°, or a side
 * bowing in over 1.5 m. What the lots leave is the block's interior: back gardens and yards
 * (nature.ts, as the block minus `lotRect`s).
 */
import type { PrefabKind, PrefabMeta } from "@guildhall/assets"
import { DMath } from "@guildhall/core"
import { closest, distTo, intersect } from "../geom/line.ts"
import { frontRect, type Rect, rectCorners, rectInPoly, rectsOverlap } from "../geom/obb.ts"
import { bbox, contains, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import {
  add,
  at,
  cross,
  dist,
  dot,
  EPS,
  len,
  lerp,
  norm,
  perp,
  round3,
  scale,
  sub,
  type Vec2,
} from "../geom/vec.ts"
import type { Block, DistrictKind, Lot, StreetEdge, StreetGraph, Tier, TownLibrary } from "./types.ts"

/** A lot with the district of its block, which placement picks its building by. */
export interface TownLot extends Lot {
  district: DistrictKind
}

/**
 * What each district builds on its lots, by prefab kind, as relative weights. The lot widths are
 * drawn from the same mix, so a market street gets shop and tavern frontages.
 */
export const DISTRICT_MIX: Readonly<Record<DistrictKind, Partial<Record<PrefabKind, number>>>> = {
  market: { shop: 4, tavern: 1, house: 2 },
  residential: { house: 8, shop: 1 },
  craft: { forge: 2, shop: 2, house: 4 },
  harbour: { house: 4, shop: 1, tavern: 1 },
  castle: { house: 1 },
  farm: { house: 1 },
}

/** A side turning more than this is a corner: the frontage runs end there, radians (30°). */
const CORNER = Math.PI / 6
/** A lot's side turns no more than this in all along its frontage, radians (30°). */
const BEND = Math.PI / 6
/** A frontage run shorter than this holds no lot, metres. */
const MIN_RUN = 6
/** The yard behind the house, metres: drawn per lot in this range. */
const YARD: readonly [number, number] = [2, 5]
/** Lots within this of either end of their run keep no yard, metres. */
const CORNER_ZONE = 12
/**
 * The least space between two lots, metres: a party wall's centimetre, so lots that share a side are
 * apart by more than rounding and the buildings in them (a hair wider, at kit units) never touch.
 */
const PARTY = 0.01
/** The cursor's step when a lot does not fit where it is, metres. */
const STEP = 0.5
/** How far a lot is moved inward, at most, when a bowed side leaves its front corners outside. */
const SHIFTS = [0, 0.25, 0.5, 1] as const
/** The cosine of the most a lot's front may turn from its street's run past it (1°). */
const SQUARE = DMath.cos((0.8 * Math.PI) / 180)
/** A lot's frame is turned toward its street's run until they agree this well (0.25°), or tries out. */
const SQUARE_TIGHT = DMath.cos(Math.PI / 720)
const FRAME_TRIES = 5
/** Two stretches of a street within this of each other both count as the one a lot corner faces (rounding of the corner can tip it either way), metres. */
const TIE = 0.02
/** The most a lot's front stands behind the block side where that side bows in, metres. */
const MAX_BOW = 1.5
/**
 * The most a lot's front stands off its street's edge, metres: the kerb, a bowed side, a nudge. A
 * block side further off than this (a suburb block's back) fronts no street and gets no lots.
 */
const MAX_GAP = 2.5
/** Street classes, busiest first: their frontages are packed first and keep the corners. */
const RANK = { main: 0, street: 1, road: 2, lane: 3 } as const
/** The chance a lot is left as a garden, by tier: villages breathe, cities are packed. */
const GARDEN_ODDS: Readonly<Record<Tier, number>> = {
  hamlet: 0.3,
  village: 0.15,
  town: 0.04,
  city: 0.02,
  capital: 0.02,
}

/** The prefabs a district may put on a lot, at a tier when it is known. */
export function lotPrefabs(lib: TownLibrary, district: DistrictKind, tier?: Tier): PrefabMeta[] {
  const fits = (mix: Partial<Record<PrefabKind, number>>) =>
    lib.prefabs.filter(
      (p) =>
        (mix[p.kind] ?? 0) > 0 &&
        (!p.fits.districts?.length || p.fits.districts.includes(district)) &&
        (!tier || !p.fits.tiers?.length || p.fits.tiers.includes(tier)),
    )
  const own = fits(DISTRICT_MIX[district])
  // A district with no houses of its own at this tier borrows the residential ones, so its lots never
  // wait on a capped tavern or forge.
  if (own.some((p) => p.kind === "house") || district === "residential") return own
  const homes = lib.prefabs.filter(
    (p) =>
      p.kind === "house" &&
      !own.includes(p) &&
      (!p.fits.districts?.length || p.fits.districts.includes("residential")) &&
      (!tier || !p.fits.tiers?.length || p.fits.tiers.includes(tier)),
  )
  return [...own, ...homes]
}

/** The lot as a rectangle: `origin` is its centre, and its local +z faces the street. */
export const lotRect = (l: Lot): Rect => ({ c: l.origin, rot: l.rot, w: l.w, d: l.depth })

/**
 * The lots of every lots block, in order along each frontage (neighbours have consecutive ids).
 * `tier` sets the gaps and garden odds; without it the lots are packed as a town's.
 */
export function lots(
  blocks: readonly Block[],
  graph: StreetGraph,
  lib: TownLibrary,
  roll: Roll,
  tier: Tier = "town",
): TownLot[] {
  const out: TownLot[] = []
  for (const block of blocks) {
    if (block.use !== "lots") continue
    const prefabs = lotPrefabs(lib, block.district, tier)
    if (prefabs.length === 0) continue
    const draw: Roll = (salt) => roll(`${salt}:${block.id}:lots`)
    const taken: Rect[] = []
    const ranked = frontageRuns(block.poly)
      .map((run) => ({ run, rank: RANK[nearestStreet(graph.edges, pointAt(run, run.length / 2)).cls] }))
      .sort((a, b) => a.rank - b.rank || b.run.length - a.run.length)
    ranked.forEach(({ run }, ri) => {
      const near = streetsNear(graph, run.line)
      if (near.length === 0) return
      const packed = packRun(run, block, prefabs, near, taken, tier, (salt) => draw(`${ri}:${salt}`))
      for (const lot of packed)
        out.push({ ...lot, id: out.length, block: block.id, district: block.district })
    })
  }
  return out
}

interface Run {
  line: Vec2[]
  length: number
  /** Whether the block turns left (a convex corner) at the run's start and end. */
  convex: [boolean, boolean]
  /** The arc length at each point of `line`. */
  arcs: number[]
  /** The turn at each point of `line` (0 at its ends), radians. */
  turns: number[]
}

/** The block's sides as runs between its corners. A ring with no corner is one run round it. */
function frontageRuns(poly: Ring): Run[] {
  const n = poly.length
  const turn = (i: number) => {
    const u = sub(at(poly, i), at(poly, i - 1))
    const v = sub(at(poly, i + 1), at(poly, i))
    return DMath.atan2(cross(u, v), dot(u, v))
  }
  const corners = poly.map((_, i) => i).filter((i) => Math.abs(turn(i)) > CORNER)
  const starts = corners.length > 0 ? corners : [0]
  const out: Run[] = []
  starts.forEach((s, k) => {
    const e = corners.length > 0 ? at(starts, k + 1) : s
    const line: Vec2[] = [at(poly, s)]
    for (let i = s + 1; ; i++) {
      line.push(at(poly, i))
      if ((i - e) % n === 0) break
    }
    const arcs = [0]
    const turns = [0]
    for (let i = 1; i < line.length; i++) {
      arcs.push(at(arcs, i - 1) + dist(at(line, i - 1), at(line, i)))
      turns.push(i + 1 < line.length ? Math.abs(turn(s + i)) : 0)
    }
    const length = at(arcs, arcs.length - 1)
    if (length >= MIN_RUN)
      out.push({ line, length, arcs, turns, convex: [turn(s) > CORNER, turn(e) > CORNER] })
  })
  return out
}

type Packed = Omit<TownLot, "id" | "block" | "district">

/**
 * Lots along one run, left to right: each lot a frontage drawn by the district's mix, placed at the
 * cursor if it fits (in the block, clear of the lots already taken), else a narrower one, else the
 * cursor steps on. `taken` gains every lot.
 */
function packRun(
  run: Run,
  block: Block,
  prefabs: readonly PrefabMeta[],
  near: readonly StreetEdge[],
  taken: Rect[],
  tier: Tier,
  draw: Roll,
): Packed[] {
  const mix = DISTRICT_MIX[block.district]
  const weight = new Map<number, number>()
  for (const p of prefabs) weight.set(p.frontage, (weight.get(p.frontage) ?? 0) + (mix[p.kind] ?? 1))
  const widths = [...weight.keys()].sort((a, b) => b - a)
  const depthsFor = (w: number) =>
    [...new Set(prefabs.filter((p) => p.frontage <= w + EPS).map((p) => p.depth))].sort((a, b) => b - a)
  const [gapLo, gapHi] = gapRange(block.district, tier)

  const out: Packed[] = []
  let s = 0
  for (let k = 0; s + Math.min(...widths) <= run.length + EPS; k++) {
    const pick = pickWidth(widths, weight, run.length - s, draw(`${k}:width`))
    const tries = widths.filter((w) => w <= pick && s + w <= run.length + EPS)
    let placed: { rect: Rect; street: number; w: number } | null = null
    for (const w of tries) {
      const fit = fitLot(run, s, w, block.poly, near, depthsFor(w), taken, draw(`${k}:yard`))
      if (fit) {
        placed = { ...fit, w }
        break
      }
    }
    if (!placed) {
      s += STEP
      continue
    }
    const { rect, street } = placed
    taken.push(rect)
    const end = arcAfter(run, s, placed.w)
    const corner = atCorner(run, s, end)
    const garden = !corner && draw(`${k}:garden`) < GARDEN_ODDS[tier]
    out.push({
      street,
      origin: rect.c,
      rot: rect.rot,
      w: round3(rect.w),
      depth: round3(rect.d),
      status: corner ? "corner" : garden ? "garden" : "built",
    })
    s = end + PARTY + gapLo + (gapHi - gapLo) * draw(`${k}:gap`)
  }
  return out
}

/** Whether the lot from arc length s to `end` stands at a convex corner of its block. */
const atCorner = (run: Run, s: number, end: number): boolean =>
  (run.convex[0] && s <= STEP) || (run.convex[1] && end >= run.length - STEP)

/** A frontage, weighted by the district's mix, among those that fit what is left of the run. */
function pickWidth(widths: readonly number[], weight: Map<number, number>, left: number, u: number): number {
  const fit = widths.filter((w) => w <= left + EPS)
  const pool = fit.length > 0 ? fit : widths.slice(-1)
  const total = pool.reduce((sum, w) => sum + (weight.get(w) ?? 0), 0)
  let x = u * total
  for (const w of pool) {
    x -= weight.get(w) ?? 0
    if (x < 0) return w
  }
  return at(pool, pool.length - 1)
}

/** Gaps between neighbouring lots, metres: shoulder to shoulder in trade streets, looser in the country. */
function gapRange(district: DistrictKind, tier: Tier): [number, number] {
  if (tier === "hamlet") return [2, 4]
  if (tier === "village") return [1, 3]
  if (district === "market" || district === "craft") return [0, 0]
  return [0, 0.5]
}

/**
 * The lot of frontage `w` from arc length `s`, and the street it fronts. Its front runs square to that
 * street (along the street's own chord past the lot), starting where the block side does, or behind
 * it where the side bows in. It is as deep as the yard allows, down to the shallowest house of that
 * width: or null when none of those fits in the block clear of `taken`.
 */
function fitLot(
  run: Run,
  s: number,
  width: number,
  poly: Ring,
  near: readonly StreetEdge[],
  depths: readonly number[],
  taken: readonly Rect[],
  u: number,
): { rect: Rect; street: number } | null {
  // On the stored grid already, so the lot kept is exactly the one checked.
  const w = round3(width)
  const end = arcAfter(run, s, w)
  const inside = (i: number) => at(run.arcs, i) > s && at(run.arcs, i) < end
  if (run.turns.reduce((sum, t, i) => (inside(i) ? sum + t : sum), 0) > BEND) return null
  const a = pointAt(run, s)
  const b = pointAt(run, end)
  const street = nearestStreet(near, lerp(a, b, 0.5))
  const chord = sub(onStreet(street, b), onStreet(street, a))
  // Round the outside of a street's bend the lot's ends meet the street at nearly one point: it
  // fronts no stretch of it.
  if (len(chord) < w / 2 || dot(chord, sub(b, a)) <= 0) return null
  const between = run.line.filter((_, i) => inside(i))
  // The lot's frame along `t`: the side between its ends may lie inside its front line, so the front
  // starts behind that (`bow`), and `shift` further in.
  const frameOf = (t: Vec2, shift: number) => {
    const inward = perp(t)
    let bow = 0
    for (const p of [b, ...between]) bow = Math.max(bow, dot(sub(p, a), inward))
    return { t, inward, bow, front: add(a, scale(inward, bow + shift)) }
  }
  const first = frameOf(norm(chord), 0)
  // A side that leaves the street's line this far does not front it (a junction's rounded corner).
  if (first.bow > MAX_BOW) return null
  const spine = rayTo(poly, lerp(a, b, 0.5), first.inward) / 2
  const deepest = at(depths, 0)
  // A lot near either end of its run keeps no yard: its back would take the cross street's frontage
  // (a corner lot's side is that frontage).
  const byCorner = s < CORNER_ZONE || end > run.length - CORNER_ZONE
  const yard = byCorner ? 0 : YARD[0] + (YARD[1] - YARD[0]) * u
  const wanted = round3(Math.min(deepest + yard, Math.max(spine, at(depths, depths.length - 1))))
  const options = [...new Set([wanted, ...depths.filter((d) => d < wanted).map(round3)])]
  for (const shift of SHIFTS) {
    // Square to the street's run past the lot's own front corners: the chord between the points of
    // the street they face. A wandering street's run turns with the lot, so the frame is turned to
    // it until the two agree (or they straddle a sharp bend of the street, and there is no lot).
    let f = frameOf(first.t, shift)
    // Every reading of it, where a corner stands as near two stretches of the street (inside a bend).
    const runsOf = (g: typeof f): Vec2[] | null => {
      const out: Vec2[] = []
      for (const from of facing(street, g.front))
        for (const to of facing(street, add(g.front, scale(g.t, w)))) {
          if (dist(from, to) < w / 2) return null
          out.push(norm(sub(to, from)))
        }
      return out
    }
    let runs = runsOf(f)
    for (let i = 0; runs && i < FRAME_TRIES && dot(at(runs, 0), f.t) < SQUARE_TIGHT; i++) {
      f = frameOf(at(runs, 0), shift)
      runs = runsOf(f)
    }
    if (!runs || f.bow > MAX_BOW || runs.some((run) => dot(run, f.t) < SQUARE)) continue
    const { t, front } = f
    // A side set back from its street (a suburb block's back, a side along the green) fronts none.
    const mid = add(front, scale(t, w / 2))
    if (dist(mid, onStreet(street, mid)) - street.width / 2 > MAX_GAP) break
    for (const d of options) {
      const rect = frontRect(front, add(front, scale(t, w)), 0, w, d)
      if (
        !taken.some((o) => near2(rect, o) && rectsOverlap(rect, o, 0)) &&
        rectInPoly(rect, poly) &&
        clearOfStreets(rect, near)
      )
        return { rect, street: street.id }
    }
  }
  return null
}

/**
 * Whether the rect keeps off every street's ribbon: a block can still reach into one where its
 * carving left a sliver (a street ending on another at a slant, or bending in past a block side).
 */
function clearOfStreets(rect: Rect, near: readonly StreetEdge[]): boolean {
  const ring = rectCorners(rect)
  const [lo, hi] = bbox(ring)
  for (const e of near) {
    const reach = e.width / 2 + PARTY
    const [elo, ehi] = bbox(e.points)
    if (elo[0] > hi[0] + reach || ehi[0] < lo[0] - reach || elo[1] > hi[1] + reach || ehi[1] < lo[1] - reach)
      continue
    if (ring.some((c) => distTo(c, e.points) <= reach)) return false
    // The street's own line, wherever it comes within its half-width of the rect's sides or inside.
    for (let i = 0; i + 1 < e.points.length; i++) {
      const p = at(e.points, i)
      const q = at(e.points, i + 1)
      if (contains(ring, p, 0) || distTo(p, ring, true) <= reach) return false
      for (let j = 0; j < 4; j++) if (intersect(p, q, at(ring, j), at(ring, j + 1))) return false
    }
    const last = at(e.points, e.points.length - 1)
    if (distTo(last, ring, true) <= reach) return false
  }
  return true
}

/** Whether two rects are close enough to overlap at all (their bounding circles meet). */
const near2 = (a: Rect, b: Rect): boolean =>
  dist(a.c, b.c) <= (Math.sqrt(a.w * a.w + a.d * a.d) + Math.sqrt(b.w * b.w + b.d * b.d)) / 2

/** The arc length past `s` at which the chord from `s` is `w` long (the curve is longer than its chord). */
function arcAfter(run: Run, s: number, w: number): number {
  const a = pointAt(run, s)
  let e = s + w
  for (let i = 0; i < 4 && e < run.length; i++) {
    const short = w - dist(a, pointAt(run, e))
    if (short < 1e-4) break
    e += short
  }
  return e
}

/** The point at arc length s along the run (clamped to its ends). */
function pointAt(run: Run, s: number): Vec2 {
  let left = Math.max(0, s)
  for (let i = 0; i + 1 < run.line.length; i++) {
    const p = at(run.line, i)
    const q = at(run.line, i + 1)
    const l = dist(p, q)
    if (left <= l) return lerp(p, q, l === 0 ? 0 : left / l)
    left -= l
  }
  return at(run.line, run.line.length - 1)
}

/** The distance from p along dir to the ring's far side (ignoring the side p stands on). */
function rayTo(poly: Ring, p: Vec2, dir: Vec2): number {
  const reach = 1000
  const from = add(p, scale(dir, 0.01))
  const to = add(p, scale(dir, reach))
  let best = reach
  for (let i = 0; i < poly.length; i++) {
    const hit = intersect(from, to, at(poly, i), at(poly, i + 1))
    if (hit) best = Math.min(best, hit.t * reach)
  }
  return best
}

/** The streets that pass within a block's depth of the line: the ones its lots may front. */
function streetsNear(graph: StreetGraph, line: readonly Vec2[]): StreetEdge[] {
  const [min, max] = bbox(line)
  const reach = 20
  return graph.edges.filter((e) => {
    const [lo, hi] = bbox(e.points)
    return (
      lo[0] <= max[0] + reach && hi[0] >= min[0] - reach && lo[1] <= max[1] + reach && hi[1] >= min[1] - reach
    )
  })
}

/** The point of the street's centre line nearest p. */
function onStreet(e: StreetEdge, p: Vec2): Vec2 {
  let best = { d: Infinity, at: p }
  for (let i = 0; i + 1 < e.points.length; i++) {
    const c = closest(p, at(e.points, i), at(e.points, i + 1))
    if (c.d < best.d) best = c
  }
  return best.at
}

/**
 * The points of the street p faces: its nearest, and any on another stretch about as near (p stands
 * inside a bend): a lot whose run differs between them is not square to its street.
 */
function facing(e: StreetEdge, p: Vec2): Vec2[] {
  const near = e.points.slice(0, -1).map((a, i) => closest(p, a, at(e.points, i + 1)))
  const best = Math.min(...near.map((c) => c.d))
  const out: Vec2[] = []
  for (const c of near) if (c.d - best <= TIE && !out.some((q) => dist(q, c.at) < EPS)) out.push(c.at)
  return out
}

/** The street whose centre line is nearest p. */
function nearestStreet(edges: readonly StreetEdge[], p: Vec2): StreetEdge {
  let best = at(edges, 0)
  let bestD = Infinity
  for (const e of edges) {
    for (let i = 0; i + 1 < e.points.length; i++) {
      const d = closest(p, at(e.points, i), at(e.points, i + 1)).d
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
  }
  return best
}
