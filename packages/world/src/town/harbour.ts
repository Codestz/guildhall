/**
 * Stage 9 (plan §4): the harbour. Where the harbour street meets the shore (the `quay` node), the
 * strip of harbour block between the waterfront street and the water is the quay. Piers (2–4 by tier)
 * leave from it square to the shore, spaced along it either side of the quay node: each is a run of
 * deck pieces that starts on the quay and ends in open water. Boats lie moored alongside, a vignette
 * of cargo (crates, barrels, rope) stands at each pier's root, and a harbourmaster works the quay by
 * the first pier. Every placement stands at its footprint's centre, its +z along the pier, out to sea.
 */
import { DMath } from "@guildhall/core"
import { closest, distTo, length } from "../geom/line.ts"
import { type Rect, rectCorners, rectsOverlap } from "../geom/obb.ts"
import { area, contains, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, at, dist, norm, perp, round3, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { headingTo, pointAlong, seedOf } from "./farms.ts"
import { normalizeSpec } from "./spec.ts"
import { sturdyClip } from "./streets.ts"
import type { Block, Placement, Station, Tier, TownDraw, TownLibrary, TownPlan } from "./types.ts"

/** A piece with the footprint the harbour needs to keep it in the water: w across, d along. */
export interface SizedPiece {
  id: string
  w: number
  d: number
}

/**
 * What the harbour reads beyond the pinned library: the deck piece a pier is a run of (`d` metres of
 * pier each, `w` wide), boats, and cargo for the quay. Without a deck there are no piers.
 */
export interface HarbourExtras {
  deck?: SizedPiece
  boats?: SizedPiece[]
  cargo?: string[]
}
export type HarbourLibrary = TownLibrary & { harbour?: HarbourExtras }

export type HarbourInput = Pick<TownPlan, "spec" | "streets" | "blocks" | "water">

export interface Harbour {
  placements: Placement[]
  /** The quay round the harbour street's foot, in pieces (the street splits it); empty without a harbour. */
  quay: Vec2[][]
  overlays: TownDraw["ground"]["overlays"]
  /** The harbourmaster on the quay, and a fisher's place at each pier's end. */
  stations: Station[]
}

/** Piers per tier (plan: 2–4). */
export const PIERS: Readonly<Record<Tier, number>> = { hamlet: 2, village: 2, town: 3, city: 4, capital: 4 }
/** Metres of deck on the quay before the shore. */
export const ROOT = 2
/** A pier reaches this far past the shore, metres. */
const REACH = [10, 16] as const
/** Pier roots lie this far apart along the shore, at least, metres. */
const SPACING = 16
/** A pier's end keeps this far from any other shore, metres. */
const OPEN = 4
/** Boats keep this far off the deck and each other, metres. */
const BERTH = 0.5
/** Cargo keeps this far in from the quay's edge, metres. */
const CARGO_CLEAR = 0.7

export function harbour(plan: HarbourInput, lib: HarbourLibrary, roll: Roll): Harbour {
  const out: Harbour = { placements: [], quay: [], overlays: [], stations: [] }
  const strips = plan.blocks.filter((b) => b.use === "harbour")
  const node = plan.streets.nodes.find((n) => n.kind === "quay")
  for (const b of strips) out.overlays.push({ kind: "sand", poly: b.poly })
  if (!node || plan.water.length === 0 || strips.length === 0) return out

  const shore = nearestOnShore(plan.water, node.at)
  const ring = at(plan.water, shore.ring)
  const line = [...ring, at(ring, 0)]
  const total = length(line)
  const deck = lib.harbour?.deck
  const piers: { root: Vec2; out: Vec2; rect: Rect; reach: number }[] = []
  const want = PIERS[normalizeSpec(plan.spec).tier]
  for (let k = 0; deck && piers.length < want && k <= 12; k++) {
    const offset = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * (SPACING + 4 * roll(`${k}:spacing`))
    const s = (((shore.s + offset) % total) + total) % total
    const pier = tryPier(line, total, s, deck, plan.water, strips, roll(`${k}:reach`))
    if (!pier || piers.some((p) => dist(p.root, pier.root) < SPACING - 2 || rectsOverlap(p.rect, pier.rect)))
      continue
    piers.push(pier)
  }

  const boats: Rect[] = []
  piers.forEach((pier, i) => {
    const draw = (salt: string) => roll(`${i}:${salt}:pier`)
    const heading = headingTo(pier.out)
    const tiles = Math.round(pier.rect.d / (deck as SizedPiece).d)
    for (let t = 0; t < tiles; t++) {
      const c = add(pier.root, scale(pier.out, (deck as SizedPiece).d * (t + 0.5)))
      out.placements.push({
        prefab: (deck as SizedPiece).id,
        seed: i,
        at: snap(c),
        rot: heading,
        role: "pier",
      })
    }
    out.stations.push({
      id: `dock:${i}`,
      kind: "dock",
      at: snap(add(pier.root, scale(pier.out, pier.rect.d - 1.5))),
      facing: heading,
    })
    moor(
      pier,
      lib.harbour?.boats ?? [],
      piers.map((p) => p.rect),
      boats,
      plan.water,
      draw,
      out.placements,
    )
    cargo(pier, lib.harbour?.cargo ?? [], strips, draw, out.placements)
  })

  const first = piers[0]
  const side = first ? perp(first.out) : null
  const master = first && side ? add(first.root, scale(side, -((deck as SizedPiece).w / 2 + 1.5))) : shore.at
  out.stations.push({
    id: "dock:harbourmaster",
    kind: "dock",
    at: snap(master),
    facing: headingTo(first ? first.out : shore.out),
  })
  const reach = Math.max(30, ...piers.map((p) => dist(p.root, shore.at) + 12))
  out.quay = quayAround(strips, shore.at, reach)
  return out
}

/** The shore point nearest p: which water ring, its arc length round it, and the way out to sea. */
function nearestOnShore(water: readonly Ring[], p: Vec2): { ring: number; s: number; at: Vec2; out: Vec2 } {
  let best = { ring: 0, s: 0, at: p, out: [1, 0] as Vec2, d: Infinity }
  water.forEach((ring, ri) => {
    let s = 0
    for (let i = 0; i < ring.length; i++) {
      const a = at(ring, i)
      const b = at(ring, i + 1)
      const c = closest(p, a, b)
      if (c.d < best.d)
        best = { ring: ri, s: s + c.t * dist(a, b), at: c.at, out: perp(norm(sub(b, a))), d: c.d }
      s += dist(a, b)
    }
  })
  return best
}

/**
 * The pier rooted at arc length s of the shore (a closed line, water on its left), or null when it
 * does not fit: its root and both root corners must be on the quay, and every point of its deck past
 * the shore in the water, its end well clear of any other shore.
 */
function tryPier(
  line: Vec2[],
  total: number,
  s: number,
  deck: SizedPiece,
  water: readonly Ring[],
  strips: readonly Block[],
  u: number,
): { root: Vec2; out: Vec2; rect: Rect; reach: number } | null {
  const p = pointAlong(line, s)
  // The shore's direction over a few metres either side, so one short segment does not tilt the pier.
  const t = norm(sub(pointAlong(line, Math.min(total, s + 4)), pointAlong(line, Math.max(0, s - 4))))
  const outward = perp(t)
  const reach = REACH[0] + (REACH[1] - REACH[0]) * u
  const tiles = Math.ceil((ROOT + reach) / deck.d)
  const long = tiles * deck.d
  const root = add(p, scale(outward, -ROOT))
  const rect: Rect = {
    c: snap(add(root, scale(outward, long / 2))),
    rot: headingTo(outward),
    w: deck.w,
    d: round3(long),
  }
  const onQuay = (q: Vec2) => strips.some((b) => contains(b.poly, q, 0.01))
  const half = scale(t, deck.w / 2)
  if (![root, add(root, half), sub(root, half)].every(onQuay)) return null
  const wet = (q: Vec2) => water.some((w) => contains(w, q, 0))
  for (let a = ROOT + 1.5; a <= long; a += 1) {
    const c = add(root, scale(outward, a))
    if (!wet(c) || !wet(add(c, half)) || !wet(sub(c, half))) return null
  }
  const end = add(root, scale(outward, long))
  if (water.every((w) => distTo(end, w, true) < OPEN)) return null
  return { root: snap(root), out: outward, rect, reach }
}

/** One or two boats alongside the pier's outer half, each wholly in the water and clear of every pier and boat. */
function moor(
  pier: { root: Vec2; out: Vec2; rect: Rect },
  kinds: readonly SizedPiece[],
  piers: readonly Rect[],
  boats: Rect[],
  water: readonly Ring[],
  draw: Roll,
  into: Placement[],
): void {
  if (kinds.length === 0) return
  const count = 1 + Math.floor(2 * draw("boats"))
  const across = perp(pier.out)
  for (let k = 0; k < count; k++) {
    const boat = at(kinds, Math.floor(draw(`${k}:boat`) * kinds.length))
    const side = (k + Math.floor(2 * draw("side"))) % 2 === 0 ? 1 : -1
    const along = pier.rect.d - boat.d / 2 - 1 - Math.floor(k / 2) * (boat.d + 1)
    const c = add(
      add(pier.root, scale(pier.out, along)),
      scale(across, side * (pier.rect.w / 2 + BERTH + boat.w / 2)),
    )
    // Moored bow out, or (by draw) bow in.
    const heading = headingTo(draw(`${k}:bow`) < 0.7 ? pier.out : scale(pier.out, -1))
    const rect: Rect = { c: snap(c), rot: heading, w: boat.w, d: boat.d }
    const afloat = rectCorners(rect).every((q) =>
      water.some((w) => contains(w, q, 0) && distTo(q, w, true) > 0.3),
    )
    if (!afloat || piers.some((r) => rectsOverlap(r, rect)) || boats.some((r) => rectsOverlap(r, rect)))
      continue
    boats.push(rect)
    into.push({
      prefab: boat.id,
      seed: seedOf(draw(`${k}:boat-seed`)),
      at: rect.c,
      rot: heading,
      role: "boat",
    })
  }
}

/** Crates, barrels and rope piled either side of the pier's root, on the quay and off the deck. */
function cargo(
  pier: { root: Vec2; out: Vec2; rect: Rect },
  ids: readonly string[],
  strips: readonly Block[],
  draw: Roll,
  into: Placement[],
): void {
  if (ids.length === 0) return
  const across = perp(pier.out)
  const count = 3 + Math.floor(3 * draw("cargo"))
  for (let k = 0; k < count; k++) {
    const side = k % 2 === 0 ? 1 : -1
    const off = pier.rect.w / 2 + 1.2 + Math.floor(k / 2) * 1.3
    const p = add(add(pier.root, scale(across, side * off)), scale(pier.out, -0.6 * draw(`${k}:back`)))
    const ok = strips.some((b) => contains(b.poly, p, 0) && distTo(p, b.poly, true) >= CARGO_CLEAR)
    if (!ok) continue
    into.push({
      prefab: at(ids, Math.floor(draw(`${k}:cargo-id`) * ids.length)),
      seed: seedOf(draw(`${k}:cargo-seed`)),
      at: snap(p),
      rot: round3(2 * Math.PI * draw(`${k}:cargo-turn`)),
      role: "cargo",
    })
  }
}

/** The harbour strip within `reach` of the shore point: the quay's ground, piece by piece. */
function quayAround(strips: readonly Block[], c: Vec2, reach: number): Vec2[][] {
  const n = 24
  const disc: Ring = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n
    return snap([c[0] + reach * DMath.cos(a), c[1] + reach * DMath.sin(a)])
  })
  return strips
    .flatMap((b) => sturdyClip(b.poly, disc, "intersection").map((poly) => at(poly, 0)))
    .filter((ring) => area(ring) >= 1)
}
