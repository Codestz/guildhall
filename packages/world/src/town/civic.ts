/**
 * Stage 5a (plan §4, "specials first"): the civic, working and open-space lots, claimed before any
 * house is placed. The town's library holds authored civic recipes (tagged `civic` plus what they
 * are: `guildhall`, `chapel`, `inn`, …); each tier asks for so many of each, and each has a site
 * rule: the guildhall and the market hall on the market square, the chapel on its square (else a
 * quieter street out from the market), an inn by the main gate (a second on the inn square), the
 * stables by another gate, warehouses and the watermill along the harbour, the works yard and the
 * bakery in the craft quarter, towers on corners of main streets halfway out, the windmill at the
 * town's edge, and small squares and greens (a well, a fountain, an old tree) in the dense quarters,
 * well apart. A civic building is wider and deeper than a house: it takes a run of neighbouring lots
 * on one frontage, merged into one lot, and that lot is deepened into the block's interior as far as
 * the building needs, never past the block or into another lot. Claimed lots carry their prefab and
 * seed; placement (place.ts) stands the building on them, its front on the street.
 */
import type { PrefabMeta } from "@guildhall/assets"
import { DMath } from "@guildhall/core"
import { distTo } from "../geom/line.ts"
import { axes, type Rect, rectInPoly, rectsOverlap } from "../geom/obb.ts"
import { centroid, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, at, dist, dot, EPS, round3, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { lotRect, type TownLot } from "./lots.ts"
import { normalizeSpec } from "./spec.ts"
import type { Block, DistrictKind, StreetGraph, Tier, TownLibrary, TownSpecInput } from "./types.ts"

/** What the civic stage reads of the town besides its lots. */
export interface CivicSite {
  /** The market square. */
  plaza: Ring
  graph: StreetGraph
  blocks: readonly Block[]
}

/** The civic kinds, by the tag their recipes carry, and the placement role (stations read it). */
export const CIVIC_ROLES = {
  guildhall: "hall",
  "market-hall": "shop",
  chapel: "chapel",
  inn: "tavern",
  warehouse: "warehouse",
  stables: "stables",
  "works-yard": "forge",
  bakery: "shop",
  tower: "tower",
  windmill: "mill",
  watermill: "mill",
  open: "well",
} as const
export type CivicKind = keyof typeof CIVIC_ROLES

/** The civic kind a prefab is (its tags), or null for a house and for the keep (landmark.ts places it). */
export function civicKind(meta: Pick<PrefabMeta, "tags">): CivicKind | null {
  if (!meta.tags.includes("civic") || meta.tags.includes("keep")) return null
  for (const kind of Object.keys(CIVIC_ROLES) as CivicKind[]) if (meta.tags.includes(kind)) return kind
  return null
}

/** How many of each a town claims, by tier; harbour kinds only where there is a harbour. */
const COUNTS: Readonly<Record<CivicKind, Readonly<Record<Tier, number>>>> = {
  guildhall: { hamlet: 0, village: 0, town: 1, city: 1, capital: 1 },
  "market-hall": { hamlet: 0, village: 0, town: 1, city: 1, capital: 2 },
  chapel: { hamlet: 0, village: 1, town: 1, city: 1, capital: 2 },
  inn: { hamlet: 0, village: 1, town: 1, city: 2, capital: 2 },
  warehouse: { hamlet: 0, village: 1, town: 2, city: 3, capital: 4 },
  stables: { hamlet: 0, village: 0, town: 1, city: 1, capital: 2 },
  "works-yard": { hamlet: 0, village: 0, town: 1, city: 1, capital: 2 },
  bakery: { hamlet: 0, village: 1, town: 1, city: 2, capital: 2 },
  tower: { hamlet: 0, village: 0, town: 1, city: 2, capital: 2 },
  windmill: { hamlet: 0, village: 1, town: 1, city: 1, capital: 1 },
  watermill: { hamlet: 0, village: 1, town: 1, city: 0, capital: 0 },
  open: { hamlet: 1, village: 1, town: 2, city: 3, capital: 3 },
}
/** Claimed in this order: the most particular sites first. */
const ORDER: readonly CivicKind[] = [
  "guildhall",
  "market-hall",
  "chapel",
  "inn",
  "warehouse",
  "watermill",
  "stables",
  "works-yard",
  "bakery",
  "tower",
  "windmill",
  "open",
]
/** The districts a civic building stands in unless its kind says otherwise: inside the town. */
const ANY: readonly DistrictKind[] = ["market", "residential", "craft", "harbour"]
/** The districts each kind may stand in, where it is not ANY: the mill and stables go out to the farms. */
const DISTRICTS: Readonly<Partial<Record<CivicKind, readonly DistrictKind[]>>> = {
  stables: [...ANY, "farm"],
  windmill: [...ANY, "farm"],
  "works-yard": ["craft", "residential"],
  bakery: ["craft", "residential", "market"],
  open: ["residential", "craft", "market"],
}
/** The most lots one civic building takes on a frontage. */
const MAX_RUN = 6
/** Lots of one run turn no more than this from its first, radians (~9°). */
const RUN_TURN = 0.15
/** A merged lot is at most this much wider than its building, metres. */
const SIDE = 2
/** How far behind the run's front a site may stand (a bending street's kerb), metres, tried in turn. */
const INSETS = [0, 0.75, 1.5] as const
/** Two civic buildings of one kind stand at least this far apart, metres. */
const APART = 30
/** Open squares stand this far from each other, the market and the street squares, at the least. */
const OPEN_APART = 45
/** Warehouses and the watermill stand no further from the quay than this, metres. */
const WATERSIDE = 35
/** A block side whose middle is this near the market square runs along it, metres (its street and kerb). */
const ON_MARKET = 20
/** A side that strays no further than this from its chord is straight, metres. */
const STRAIGHT = 0.6
/** The most lots off its own frontage a civic building may take (the ones its back or side reaches). */
const REACH = 3
/** Overlaps and overhangs under this are rounding, not a clash, metres. */
const TOUCH = 0.05
/** Among the best few sites one is drawn, so seeds differ. */
const BEST = 3

/** A site for a building: lots merged into one, deepened to fit it. */
interface Site {
  lots: TownLot[]
  rect: Rect
}

/**
 * The lots with the civic ones claimed: each claimed run merged into one lot (the first lot's id,
 * district and street) carrying `prefab` and `seed`. Lots not claimed come back as they were.
 */
export function claimCivic(
  lots: readonly TownLot[],
  lib: TownLibrary,
  spec: TownSpecInput,
  site: CivicSite,
  roll: Roll,
): TownLot[] {
  const s = normalizeSpec(spec)
  const r = s.radius
  const plaza = site.plaza
  const centre = centroid(plaza)
  const blocks = new Map(site.blocks.map((b) => [b.id, b]))
  const streets = new Map(site.graph.edges.map((e) => [e.id, e]))
  const gates = site.graph.nodes.filter((n) => n.kind === "gate").map((n) => n.at)
  const quays = site.graph.nodes.filter((n) => n.kind === "quay").map((n) => n.at)
  // The quay strip along the water (harbour blocks): warehouses line the street beside it.
  const shore = site.blocks.filter((b) => b.use === "harbour").map((b) => b.poly)
  const toWater = (p: Vec2) =>
    Math.min(
      nearest(p, quays),
      shore.reduce((m, ring) => Math.min(m, distTo(p, ring, true)), Number.POSITIVE_INFINITY),
    )
  // The main gate is the one nearest the market (the main street's); an inn takes it first.
  const byNear = [...gates].sort((a, b) => dist(a, centre) - dist(b, centre))
  const squares = site.graph.squares ?? []
  const want = counts(s.tier, s.landmark, s.harbour !== null)

  const kinds = new Map<CivicKind, PrefabMeta[]>()
  for (const m of lib.prefabs) {
    const kind = civicKind(m)
    if (kind && (!m.fits.tiers?.length || m.fits.tiers.includes(s.tier)))
      kinds.set(kind, [...(kinds.get(kind) ?? []), m])
  }

  const free = new Set(lots.map((l) => l.id))
  const byBlock = new Map<number, TownLot[]>()
  for (const l of lots) byBlock.set(l.block, [...(byBlock.get(l.block) ?? []), l])
  const claimed: { kind: CivicKind; lot: TownLot; c: Vec2; rect: Rect }[] = []
  const usedGates = new Set<number>()

  const nearestGate = (p: Vec2, skip = usedGates) => {
    let best = { i: -1, d: Number.POSITIVE_INFINITY }
    byNear.forEach((g, i) => {
      const d = dist(p, g)
      if (!skip.has(i) && d < best.d) best = { i, d }
    })
    return best
  }

  /** Lower is better; Infinity rules the site out. */
  const score = (kind: CivicKind, site: Site, n: number): number => {
    const c = site.rect.c
    const first = at(site.lots, 0)
    const d = dist(c, centre)
    const same = claimed.filter((x) => x.kind === kind).map((x) => x.c)
    if (nearest(c, same) < (kind === "open" ? OPEN_APART : APART)) return Number.POSITIVE_INFINITY
    // Inside the gates, but for the mill and the stables, which may stand out on the farms' road.
    if (d > r && kind !== "windmill" && kind !== "stables") return Number.POSITIVE_INFINITY
    // Civic buildings spread out a little, so no quarter is all of them.
    const crowd = claimed.filter((x) => dist(x.c, c) < 20).length * 15
    const cls = streets.get(first.street)?.cls
    switch (kind) {
      case "guildhall":
      case "market-hall":
        // Fronting the market square: the nearer its edge, the better.
        return distTo(c, plaza, true) + crowd
      case "chapel": {
        const sq = squares.find((q) => q.kind === "chapel")
        if (sq && n === 0) return dist(c, sq.at) + crowd
        return Math.abs(d - 0.4 * r) + (d < 0.2 * r ? 1e3 : 0) + crowd
      }
      case "inn": {
        const sq = squares.find((q) => q.kind === "inn")
        if (n === 0 && byNear.length > 0) return nearestGate(c).d + crowd
        return (sq ? dist(c, sq.at) : nearestGate(c).d) + crowd
      }
      case "stables":
        return byNear.length > 0 ? nearestGate(c).d + crowd : -d
      case "warehouse":
      case "watermill": {
        // Along the quay and the harbour street down to it, the harbour quarter first.
        const q = toWater(c)
        if (q > WATERSIDE) return Number.POSITIVE_INFINITY
        return q + (first.district === "harbour" ? 0 : 20) + crowd
      }
      case "works-yard":
        return Math.abs(d - 0.6 * r) + (first.district === "craft" ? 0 : 40) + crowd
      case "bakery":
        return Math.abs(d - 0.45 * r) + (first.district === "craft" ? 0 : 15) + crowd
      case "tower":
        return (
          Math.abs(d - 0.55 * r) +
          (first.status === "corner" ? 0 : 25) +
          (cls === "main" ? 0 : 15) -
          Math.min(40, nearest(c, same)) / 2 +
          crowd
        )
      case "windmill":
        return -d + crowd
      case "open": {
        if (d > 0.8 * r) return Number.POSITIVE_INFINITY
        const away = Math.min(
          d,
          nearest(
            c,
            squares.map((q) => q.at),
          ),
          nearest(
            c,
            claimed.map((x) => x.c),
          ),
        )
        return -Math.min(away, 80) + crowd / 3
      }
    }
  }

  for (const kind of ORDER) {
    const metas = kinds.get(kind) ?? []
    for (let n = 0; n < want[kind]; n++) {
      const draw: Roll = (salt) => roll(`${kind}:${n}:${salt}`)
      // The kind's recipes from a drawn one round: the first with a site wins.
      const start = Math.floor(draw("prefab") * metas.length)
      let found: { meta: PrefabMeta; site: Site } | null = null
      for (let k = 0; k < metas.length && !found; k++) {
        const meta = at(metas, (start + k) % metas.length)
        const choices: { site: Site; score: number }[] = []
        const market = kind === "guildhall" || kind === "market-hall"
        const found2 = [
          ...sites(lots, free, byBlock, blocks, claimed, meta),
          ...(market ? marketSites(plaza, free, byBlock, blocks, claimed, meta) : []),
        ]
        for (const site of found2) {
          const d = at(site.lots, 0).district
          if (d === "castle" || !(DISTRICTS[kind] ?? ANY).includes(d)) continue
          const v = score(kind, site, n)
          if (Number.isFinite(v)) choices.push({ site, score: v })
        }
        choices.sort((a, b) => a.score - b.score || at(a.site.lots, 0).id - at(b.site.lots, 0).id)
        // The market's halls take the best site there is; the rest one of the best few.
        const top = choices.slice(0, market ? 1 : BEST)
        const pick = top[Math.floor(draw(`site:${k}`) * top.length)]
        if (pick) found = { meta, site: pick.site }
      }
      if (!found) break
      const { meta } = found
      const pick = found
      const first = at(pick.site.lots, 0)
      const lot: TownLot = {
        ...first,
        origin: snap(pick.site.rect.c),
        rot: pick.site.rect.rot,
        w: round3(pick.site.rect.w),
        depth: round3(pick.site.rect.d),
        status: "built",
        prefab: meta.id,
        seed: Math.floor(draw("seed") * 0x7fffffff),
      }
      for (const l of pick.site.lots) free.delete(l.id)
      claimed.push({ kind, lot, c: pick.site.rect.c, rect: pick.site.rect })
      if ((kind === "inn" || kind === "stables") && byNear.length > 0)
        usedGates.add(nearestGate(lot.origin).i)
    }
  }

  const merged = new Map(claimed.map((x) => [x.lot.id, x.lot]))
  return lots.flatMap((l) => merged.get(l.id) ?? (free.has(l.id) ? [l] : []))
}

/** The distance from p to the nearest point of the list (Infinity when it is empty). */
const nearest = (p: Vec2, list: readonly Vec2[]): number =>
  list.reduce((m, q) => Math.min(m, dist(p, q)), Number.POSITIVE_INFINITY)

/** How many of each kind the town wants: the tier's counts, its landmark at least once, harbour kinds by the water. */
function counts(tier: Tier, landmark: string | null, harbour: boolean): Record<CivicKind, number> {
  const out = {} as Record<CivicKind, number>
  for (const k of ORDER) out[k] = COUNTS[k][tier]
  if (landmark === "chapel") out.chapel = Math.max(1, out.chapel)
  if (landmark === "guildhall") out.guildhall = Math.max(1, out.guildhall)
  if (!harbour) {
    out.warehouse = 0
    out.watermill = 0
  }
  return out
}

/** An angle wrapped to (-π, π]. */
const turn = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Every site the prefab fits: for each free lot, the shortest run of free neighbours from it on the
 * same frontage wide enough, merged and deepened behind its front as far as the prefab needs, inside
 * the block and clear of every other lot and of what is claimed.
 */
function sites(
  lots: readonly TownLot[],
  free: ReadonlySet<number>,
  byBlock: ReadonlyMap<number, TownLot[]>,
  blocks: ReadonlyMap<number, Block>,
  claimed: readonly { rect: Rect }[],
  meta: PrefabMeta,
): Site[] {
  const out: Site[] = []
  const index = new Map(lots.map((l, i) => [l.id, i]))
  for (const first of lots) {
    if (!free.has(first.id)) continue
    const block = blocks.get(first.block)
    if (!block) continue
    const { x, z } = axes(first.rot)
    const run: TownLot[] = []
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    let front = Number.POSITIVE_INFINITY
    for (let k = index.get(first.id) as number; k < lots.length && run.length < MAX_RUN; k++) {
      const l = at(lots, k)
      const prev = run[run.length - 1]
      if (prev && !(l.id === prev.id + 1 && l.block === first.block && l.street === first.street)) break
      if (!free.has(l.id) || Math.abs(turn(l.rot - first.rot)) > RUN_TURN) break
      run.push(l)
      const u = dot(sub(l.origin, first.origin), x)
      const v = dot(sub(l.origin, first.origin), z)
      lo = Math.min(lo, u - l.w / 2)
      hi = Math.max(hi, u + l.w / 2)
      front = Math.min(front, v + l.depth / 2)
      if (hi - lo + EPS < meta.frontage) continue
      // Wide enough: centred on the run (what it leaves either side is the block's to garden), its
      // front on the street or a little behind it where the street bends, as deep as the building
      // or the lots.
      const w = Math.min(hi - lo, meta.frontage + SIDE)
      const depth = Math.max(meta.depth, Math.min(...run.map((m) => m.depth)))
      // Lots of the block it reaches into (behind, or round the corner) are taken too, a few at most.
      const others = (byBlock.get(first.block) ?? []).filter((o) => free.has(o.id) && !run.includes(o))
      for (const inset of INSETS) {
        const c = add(first.origin, add(scale(x, (lo + hi) / 2), scale(z, front - inset - depth / 2)))
        const rect: Rect = { c, rot: first.rot, w, d: depth }
        if (!rectInPoly(rect, block.poly, TOUCH) || claimed.some((o) => rectsOverlap(rect, o.rect, TOUCH)))
          continue
        const reached = others.filter((o) => rectsOverlap(rect, lotRect(o), TOUCH))
        if (reached.length > REACH) continue
        out.push({ lots: [...run, ...reached], rect })
        break
      }
      break
    }
  }
  return out
}

/**
 * Sites facing the market square: on every side of a block that runs along the square (its middle
 * within a street's width and a kerb of it), the building centred on that side with its front to the
 * square, inside the block, taking the lots it covers (at least one, since the merged lot keeps the
 * first one's id) and clear of what is claimed.
 */
function marketSites(
  plaza: Ring,
  free: ReadonlySet<number>,
  byBlock: ReadonlyMap<number, TownLot[]>,
  blocks: ReadonlyMap<number, Block>,
  claimed: readonly { rect: Rect }[],
  meta: PrefabMeta,
): Site[] {
  const out: Site[] = []
  for (const block of blocks.values()) {
    if (block.use !== "lots") continue
    const ring = block.poly
    for (let i = 0; i < ring.length; i++) {
      // The side from this corner: the longest chord the ring stays near (its rounded corners and
      // kinks are many short edges).
      const n = ring.length
      const a = at(ring, i)
      let j = i + 1
      while (j + 1 - i < n) {
        const next = at(ring, (j + 1) % n)
        let straight = true
        for (let k = i + 1; k <= j && straight; k++) straight = distTo(at(ring, k % n), [a, next]) < STRAIGHT
        if (!straight) break
        j++
      }
      const b = at(ring, j % n)
      const side = dist(a, b)
      const mid = scale(add(a, b), 0.5)
      if (side < meta.frontage + 1) continue
      if (distTo(mid, plaza, true) > ON_MARKET) continue
      // The side's normal toward the square is the building's front.
      const along = scale(sub(b, a), 1 / side)
      const right: Vec2 = [along[1], -along[0]]
      const front: Vec2 = dot(right, sub(centroid(plaza), mid)) >= 0 ? right : scale(right, -1)
      const rot = round3(DMath.atan2(front[0], front[1]))
      const fits = INSETS.map((inset) => ({
        c: sub(mid, scale(front, meta.depth / 2 + STRAIGHT + inset)),
        rot,
        w: meta.frontage,
        d: meta.depth,
      })).find((r) => rectInPoly(r, ring, TOUCH) && !claimed.some((o) => rectsOverlap(r, o.rect, TOUCH)))
      if (!fits) continue
      const taken = (byBlock.get(block.id) ?? []).filter((l) => rectsOverlap(fits, lotRect(l), TOUCH))
      if (taken.length === 0 || taken.some((l) => !free.has(l.id))) continue
      taken.sort((p, q) => p.id - q.id)
      out.push({ lots: taken, rect: fits })
    }
  }
  return out
}
