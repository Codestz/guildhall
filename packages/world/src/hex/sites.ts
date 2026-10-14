/**
 * Sites: the ground a big place is composed for (decisions.md "site-aware procedural buildings").
 *
 * A site is a connected set of dry land tiles, levelled, that a road reaches; water may border it, never
 * lie inside it. The Guildhall's castle and the town's core are reserved on the island before its water is
 * routed (island.ts `reserveSites`), from data that does not change as the island grows, so they stay put
 * and the rivers run round them. Scenes find theirs when they are placed (world.ts).
 */

import { hash2 } from "../geom/noise.ts"
import { pieceFootprint, pieceOutline, pieceSolids, solidDistance, solidKind } from "./collide.ts"
import type { HexGrid } from "./grid.ts"
import { HEX_TILE_SIZE, type PlacedPiece } from "./tiles.ts"

/** The island's reserved sites: tile lists, the first tile the heart (the town's square, the castle's keep). */
export interface IslandSites {
  /** The town's core: its square and the ring round it. */
  town: number[]
  /** The castle's whole site, in the order its tiers take it (`CASTLE_TILES`): the keep first. */
  castle: number[]
}

/**
 * The sites are chosen among the first SITE_REF tiles of the island's growth order (hexIsland's rank): the
 * land every island of that size or bigger has, so a growing island keeps them where they are.
 */
export const SITE_REF = 330

/** The castle's tiles at each tier (castleTier): a keep and its forecourt, a walled keep, wards and the great hall, a citadel. */
export const CASTLE_TILES = [2, 5, 9, 15] as const
export const CASTLE_SITE = 15
/** What a way pays to cross a side with a notch of the site's outline at its end, in steps. */
const NOTCHED = 0.5
/** ...and where the curtain cannot stand out over the notch: only where there is no other way. */
const CLOSED = 1000
/** How far below the best gate's score (steps) another gate is tried for a castle with no closed notch. */
const GATE_SLACK = 3

/** A tile's centre in hex-centre units. */
const centreOf = (g: HexGrid, i: number): [number, number] => {
  const q = g.q[i]!
  const r = g.r[i]!
  return [Math.sqrt(3) * (q + r / 2), 1.5 * r]
}

const steps = (g: HexGrid, a: number, b: number) => {
  const dq = g.q[a]! - g.q[b]!
  const dr = g.r[a]! - g.r[b]!
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/**
 * Reserves the town's core and the castle's site, from what does not move as the island grows: the
 * growth order (`rank`), the tiles' places, the hill field (`hill`, the massif's pull, 0–1) and the level
 * a tile has once well inland (`inlandLevel`), all the same at every size. Steps from the sea are counted
 * on the SITE_REF-tile island, so a site stays inland.
 *
 *   town    a low, flat tile near the island's middle, three steps inland or more, and its ring;
 *   castle  a keep on the hills' shoulder (high, not the bare peak) 5–9 steps from the town's square,
 *           its site grown from it toward the town (the keep stays at the back, the gate will face the
 *           town), compact, inland, never closer than three steps to the square.
 */
export function reserveSites(
  g: HexGrid,
  rank: Int32Array,
  seed: number,
  hill: (i: number) => number,
  inlandLevel: (i: number) => number,
): IslandSites {
  const N = g.size
  const inRef = (i: number) => rank[i]! >= 0 && rank[i]! < SITE_REF
  // steps from the sea of the SITE_REF-tile island
  const inland = new Int16Array(N).fill(32767)
  const queue: number[] = []
  for (let i = 0; i < N; i++)
    if (!inRef(i)) {
      inland[i] = 0
      queue.push(i)
    }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]!
    for (const j of g.neighbours(i))
      if (j >= 0 && inland[j]! > inland[i]! + 1) {
        inland[j] = inland[i]! + 1
        queue.push(j)
      }
  }
  const h = (k: number, i: number) => hash2(seed + 900 + k, g.q[i]!, g.r[i]!)
  /** How many of a tile's neighbours (two rings, weighted to the first) stand at its inland level: room to build. */
  const flat = (i: number): number => {
    const L = inlandLevel(i)
    let n = 0
    for (const j of g.neighbours(i)) {
      if (j < 0 || !inRef(j)) continue
      if (inlandLevel(j) === L) n++
      for (const k of g.neighbours(j)) if (k >= 0 && inRef(k) && inlandLevel(k) === L) n += 0.25
    }
    return n / 6
  }
  const best = (ok: (i: number) => boolean, score: (i: number) => number): number => {
    let out = -1
    let bs = -Infinity
    for (let i = 0; i < N; i++) {
      if (!inRef(i) || !ok(i)) continue
      const s = score(i)
      if (s > bs) {
        bs = s
        out = i
      }
    }
    return out
  }
  // ---- the town's square: low ground near the middle ----
  let square = -1
  for (const need of [3, 2, 1]) {
    square = best(
      (i) => inland[i]! >= need,
      (i) => flat(i) * 0.5 - inlandLevel(i) * 0.4 - hill(i) * 2 - g.ring(i) / 8 + h(1, i) * 0.4,
    )
    if (square >= 0) break
  }
  if (square < 0) return { town: [], castle: [] }
  const town = [square, ...[...g.neighbours(square)].filter((j) => j >= 0 && inRef(j))]
  const core = new Set(town)
  // ---- the castle's keep: the highest ground a short walk from the square ----
  let keep = -1
  for (const need of [3, 2, 1]) {
    keep = best(
      (i) => inland[i]! >= need && steps(g, i, square) >= 5 && steps(g, i, square) <= 9,
      (i) =>
        -Math.abs(hill(i) - 0.6) * 3 +
        flat(i) * 0.2 -
        Math.abs(steps(g, i, square) - 6) * 0.1 +
        h(2, i) * 0.3,
    )
    if (keep >= 0) break
  }
  if (keep < 0) return { town, castle: [] }
  // ---- its site, grown from the keep toward the town: compact, the keep at the back ----
  const toTown = steps(g, keep, square)
  const key = (i: number) => steps(g, i, keep) + 0.5 * (steps(g, i, square) - toTown) + h(3, i) * 0.1
  const fits = (i: number) => inRef(i) && inland[i]! >= 1 && !core.has(i) && steps(g, i, square) >= 3
  const castle = [keep]
  const taken = new Set(castle)
  while (castle.length < CASTLE_SITE) {
    let next = -1
    let nk = Infinity
    for (const t of castle)
      for (const j of g.neighbours(t)) {
        if (j < 0 || taken.has(j) || !fits(j) || steps(g, j, keep) > 3) continue
        const k = key(j)
        if (k < nk || (k === nk && j < next)) {
          nk = k
          next = j
        }
      }
    if (next < 0) break
    castle.push(next)
    taken.add(next)
  }
  return { town, castle }
}

/**
 * Levels each site to its heart's level, and eases the land round it toward that level, a step a ring
 * for two rings, so a road can always climb to it and no wall of ground stands at its edge.
 */
export function levelSites(
  g: HexGrid,
  level: Int8Array,
  sites: readonly (readonly number[])[],
  isSea: (i: number) => boolean,
  foot: readonly number[] = [],
): void {
  const inSite = new Set(sites.flat())
  for (const site of sites) {
    const land = site.filter((i) => !isSea(i))
    if (!land.length) continue
    const L = level[land[0]!]!
    for (const i of land) level[i] = L
    const ring = new Map<number, number>(land.map((i) => [i, 0]))
    let frontier = land
    for (let d = 1; d <= 2; d++) {
      const next: number[] = []
      for (const i of frontier)
        for (const j of g.neighbours(i)) {
          if (j < 0 || ring.has(j) || isSea(j)) continue
          ring.set(j, d)
          next.push(j)
          if (!inSite.has(j)) level[j] = Math.max(0, Math.min(L + d, Math.max(L - d, level[j]!)))
        }
      frontier = next
    }
  }
  // the castle's foot at its level, so its curtain may stand out over it (castleFoot)
  const castle = sites[sites.length - 1]
  const L = castle?.find((i) => !isSea(i))
  if (L !== undefined) for (const i of foot) if (!isSea(i) && !inSite.has(i)) level[i] = level[L]!
}

/**
 * The castle's foot: the tiles off its site in the notches of its outline, where two of their
 * neighbours side by side stand on it. The curtain's line turns inward at such a notch; where a way
 * crosses the site's side there, the wall stands out over the foot (curtain.ts OUTER_INSET), so the
 * foot is kept open ground at the castle's level (island.ts, zones.ts).
 */
export function castleFoot(g: HexGrid, site: readonly number[]): number[] {
  const S = new Set(site)
  const out = new Set<number>()
  for (const i of site)
    for (const j of g.neighbours(i)) {
      if (j < 0 || S.has(j) || out.has(j)) continue
      const nb = g.neighbours(j)
      if ([0, 1, 2, 3, 4, 5].some((d) => S.has(nb[d]!) && S.has(nb[(d + 1) % 6]!))) out.add(j)
    }
  return [...out].sort((a, b) => a - b)
}

/** What a castle tile is (composeCastle): its keep, its great hall, a tower, the barracks, open yard or the paved way. */
export type CastleRole = "keep" | "hall" | "tower" | "barracks" | "yard" | "court"

/** A castle composed for its site (`composeCastle`). */
export interface CastlePlan {
  tier: number
  /** The site's tiles at this tier, the keep first. */
  tiles: number[]
  keep: number
  /** The great hall's tile (tier 3 up), else −1. */
  hall: number
  /** The tile the road comes in on: a court tile on the site's edge (tier 1: the keep's forecourt). */
  gate: number
  /** The side of `gate` the road comes in through: the gatehouse stands on it (tier 2 up). */
  gateSide: number
  /** The tile outside the gate the road arrives from (a river tile there is a bridge over the moat); −1 none. */
  entry: number
  /**
   * The postern (tier 2 up, where a side fits): a second gate in the curtain on the far side from the
   * gate, so a walk out to a place behind the castle need not go round it. −1 none; its side and the
   * dry tile outside it as the gate's.
   */
  postern: number
  posternSide: number
  posternEntry: number
  /** The inner yard in front of the hall (the keep below tier 3): the castle's heart, where agents gather. */
  heart: number
  role: Map<number, CastleRole>
  /** Each building tile's door side, onto a yard or court tile. */
  door: Map<number, number>
  /** The paved ways: tile paths from the gate to the heart and on to each door's court. */
  ways: number[][]
  /** The curtain wall (tier 2 up): per yard or court tile, the sides that face out of the site. */
  walls: Map<number, number[]>
  /**
   * The tiles off the site the curtain stands out over (castleFoot): the notches at the ends of the
   * sides a way or a door crosses. Kept open: no road over them.
   */
  foot: number[]
}

/**
 * Composes the Guildhall's castle on its site (decisions.md "site-aware procedural buildings"), at a tier:
 *
 *   the site     the first CASTLE_TILES[tier − 1] tiles of the reserved site that are dry land joined to the keep;
 *   the gate     on the site's edge, the side the road can come in by (open ground or a river to bridge, no
 *                more than a step off the site's level) furthest from the keep and nearest the town;
 *   buildings    the great hall (tier 3 up) beside the keep, on the edge, so its back closes the wall; towers
 *                at the site's corners and the barracks on its edge (tier 3 up); none may cut the yard in two,
 *                and each keeps a yard tile in front for its door;
 *   the yard     every other tile, all joined; the ways from the gate to the heart and to each door are paved
 *                and kept clear (court), the rest is yard (props, drill);
 *   the walls    along every yard side that faces out of the site (a building on the edge closes its own
 *                side), the gatehouse on the gate side;
 *   the postern  (tier 2 up, with `posternOpen`) a second gatehouse on a paved court's outer side, away
 *                from the gate past the heart, onto dry ground a step off at most, where it crosses no notch
 *                the curtain cannot stand out over: a walk out to a place behind the castle goes through it.
 *
 * `open(from, to)` says whether a road may come from tile `to`, outside the site, into tile `from` on it.
 */
export function composeCastle(
  g: HexGrid,
  site: readonly number[],
  tier: number,
  opts: {
    town: number
    seed: number
    usable: (i: number) => boolean
    open: (from: number, to: number) => boolean
    /** Whether a postern on tile `from` may open onto tile `to` outside the site (none without it). */
    posternOpen?: (from: number, to: number) => boolean
    /** Whether a tile off the site may take the curtain's outer half (its foot, open at its level). */
    foot?: (j: number) => boolean
  },
): CastlePlan | null {
  const first = site[0]
  if (first === undefined || !opts.usable(first)) return null
  const keep: number = first
  // the tier's tiles, dry and joined to the keep
  const want = new Set(site.slice(0, CASTLE_TILES[Math.max(0, Math.min(3, tier - 1))]).filter(opts.usable))
  const tiles = [keep]
  const S = new Set(tiles)
  for (let k = 0; k < tiles.length; k++)
    for (const j of g.neighbours(tiles[k]!))
      if (j >= 0 && want.has(j) && !S.has(j)) {
        S.add(j)
        tiles.push(j)
      }
  tiles.sort((a, b) => site.indexOf(a) - site.indexOf(b))
  const nb = (i: number) => g.neighbours(i)
  const outside = (i: number) => [0, 1, 2, 3, 4, 5].filter((d) => nb(i)[d]! < 0 || !S.has(nb(i)[d]!))
  const hh = (k: number, i: number) => hash2(opts.seed + 950 + k, g.q[i]!, g.r[i]!)
  // ---- the gate: furthest from the keep, nearest the town, where a road can come in (the best
  // that composes with no way across a notch the curtain cannot stand out over) ----
  let gates: { t: number; d: number; s: number }[] = []
  for (const strict of [true, false]) {
    for (const t of tiles) {
      if (t === keep && tiles.length > 1) continue
      for (const d of outside(t)) {
        const o = nb(t)[d]!
        if (o < 0 || (strict && !opts.open(t, o))) continue
        gates.push({ t, d, s: steps(g, t, keep) * 2 - steps(g, o, opts.town) + hh(1, o) * 0.2 })
      }
    }
    if (gates.length) break
  }
  if (!gates.length) return null
  gates.sort((a, b) => b.s - a.s || a.t - b.t || a.d - b.d)
  // (a gate scoring more than GATE_SLACK below the best is not tried)
  gates = gates.filter((q) => q.s >= gates[0]!.s - GATE_SLACK)
  let best: { plan: CastlePlan; closed: number } | null = null
  for (const q of gates) {
    const made = composeAt(q.t, q.d)
    if (!best || made.closed < best.closed) best = made
    if (made.closed === 0) break
  }
  return best!.plan

  /** The castle with its gate on side `gateSide` of `gate`, and how many of its ways cross a closed notch. */
  function composeAt(
    gate: number,
    gateSide: number,
    withPostern = true,
  ): { plan: CastlePlan; closed: number } {
    const entry = nb(gate)[gateSide]!
    const role = new Map<number, CastleRole>(tiles.map((i) => [i, "yard"]))
    role.set(keep, "keep")
    // ---- buildings, never cutting the yard ----
    const isBuilt = (r: CastleRole | undefined) =>
      r === "keep" || r === "hall" || r === "tower" || r === "barracks"
    /** Whether the open tiles stay one piece with the gate in it and every building keeps an open tile beside it. */
    const sound = (): boolean => {
      const open = tiles.filter((i) => !isBuilt(role.get(i)))
      if (!open.includes(gate)) return false
      const seen = new Set([gate])
      const queue = [gate]
      for (let k = 0; k < queue.length; k++)
        for (const j of nb(queue[k]!))
          if (j >= 0 && S.has(j) && !seen.has(j) && !isBuilt(role.get(j))) {
            seen.add(j)
            queue.push(j)
          }
      if (seen.size !== open.length) return false
      return tiles.every(
        (i) => !isBuilt(role.get(i)) || nb(i).some((j) => j >= 0 && S.has(j) && !isBuilt(role.get(j))),
      )
    }
    const place = (r: CastleRole, score: (i: number) => number): number => {
      const free = tiles
        .filter((i) => role.get(i) === "yard" && i !== gate)
        .sort((a, b) => score(b) - score(a) || a - b)
      for (const i of free) {
        if (score(i) === -Infinity) break
        role.set(i, r)
        if (sound()) return i
        role.set(i, "yard")
      }
      return -1
    }
    const edge = (i: number) => outside(i).length
    let hall = -1
    if (tier >= 3)
      hall = place("hall", (i) =>
        steps(g, i, keep) <= 2 ? -steps(g, i, keep) * 2 + edge(i) * 0.5 : -Infinity,
      )
    if (tier >= 3)
      place("barracks", (i) => (edge(i) ? edge(i) - steps(g, i, gate) * 0.2 + hh(2, i) : -Infinity))
    if (tier >= 4)
      for (let k = 0; k < 2; k++)
        place("tower", (i) => (edge(i) >= 3 ? edge(i) + steps(g, i, gate) * 0.3 + hh(3 + k, i) : -Infinity))
    // ---- doors and the ways: cheapest first over the open tiles from the gate ----
    // A side whose end is a notch in the site's outline (the tile at that corner off the site) has the
    // curtain's inward corner at it, which would reach the middle of the side: a way crosses it where
    // the wall can stand out over the notch (its foot), else only where it has no other way (CLOSED)
    const notches = (i: number, d: number) =>
      [d + 5, d + 1].map((e) => nb(i)[e % 6]!).filter((k) => k < 0 || !S.has(k))
    const footed = (k: number) => k >= 0 && k !== entry && !!opts.foot?.(k)
    const step = (i: number, d: number) => {
      if (tier < 2) return 1
      const n = notches(i, d)
      return n.length === 0 ? 1 : n.every(footed) ? 1 + NOTCHED : CLOSED
    }
    const prev = new Map<number, number>([[gate, -1]])
    const cost = new Map<number, number>([[gate, 0]])
    const done = new Set<number>()
    for (;;) {
      let at = -1
      for (const [i, c] of cost)
        if (!done.has(i) && (at < 0 || c < cost.get(at)! || (c === cost.get(at)! && i < at))) at = i
      if (at < 0) break
      done.add(at)
      for (let d = 0; d < 6; d++) {
        const j = nb(at)[d]!
        if (j < 0 || !S.has(j) || done.has(j) || isBuilt(role.get(j))) continue
        const c = cost.get(at)! + step(at, d)
        if (!cost.has(j) || c < cost.get(j)!) {
          cost.set(j, c)
          prev.set(j, at)
        }
      }
    }
    const door = new Map<number, number>()
    for (const i of tiles) {
      if (!isBuilt(role.get(i))) continue
      // the open side nearest the gate (a notched one only where it must)
      let best = -1
      let bc = Infinity
      for (let d = 0; d < 6; d++) {
        const j = nb(i)[d]!
        if (j < 0 || !prev.has(j)) continue
        const c = cost.get(j)! + step(i, d)
        if (c < bc) {
          bc = c
          best = d
        }
      }
      if (best >= 0) door.set(i, best)
    }
    const front = (i: number) => (door.has(i) ? nb(i)[door.get(i)!]! : gate)
    const heart = front(hall >= 0 ? hall : keep)
    const wayTo = (t: number) => {
      const out = [t]
      for (let k = t; prev.get(k)! >= 0; k = prev.get(k)!) out.push(prev.get(k)!)
      return out.reverse()
    }
    const ways: number[][] = []
    // a way to the heart, then on to every door's court (a way only adds what the ones before lack)
    const paved = new Set<number>()
    for (const t of [heart, ...tiles.filter((i) => door.has(i)).map(front)]) {
      const w = wayTo(t)
      let k = w.length - 1
      while (k > 0 && !paved.has(w[k]!)) k--
      const add = w.slice(k)
      if (add.length > 1) ways.push(add)
      for (const i of w) paved.add(i)
    }
    if (gate === keep) door.set(keep, gateSide)
    else paved.add(gate)
    // ---- the postern (tier 2 up): a gate on the far side, on a court the ways already pave (so the
    // yard keeps every tile it had: its trades, its gathering, the notice board) ----
    let postern = -1
    let posternSide = -1
    let posternEntry = -1
    if (withPostern && opts.posternOpen && tier >= 2 && gate !== keep) {
      const [gx, gz] = centreOf(g, gate)
      const [kx, kz] = centreOf(g, heart)
      let bestScore = -Infinity
      for (const t of tiles) {
        if (isBuilt(role.get(t)) || t === gate || !paved.has(t) || !prev.has(t) || cost.get(t)! >= CLOSED)
          continue
        for (const d of outside(t)) {
          const o = nb(t)[d]!
          // a side whose ends turn the same way (no lone notch: neither flank in the way through), to dry
          // open ground no more than a step off, not the gate's own approach nor the curtain's foot
          if (o < 0 || o === entry || !opts.posternOpen(t, o) || notches(t, d).length === 1) continue
          const [ox, oz] = centreOf(g, o)
          // out the far side: away from the gate, past the heart
          const away = Math.hypot(ox - gx, oz - gz) - Math.hypot(ox - kx, oz - kz) * 0.5
          const sc = away - cost.get(t)! * 0.3 + hh(5, o) * 0.1
          if (sc > bestScore && steps(g, t, gate) >= 2) {
            bestScore = sc
            postern = t
            posternSide = d
            posternEntry = o
          }
        }
      }
    }
    for (const i of paved) if (!isBuilt(role.get(i))) role.set(i, "court")
    // ---- the curtain wall (tier 2 up) ----
    const walls = new Map<number, number[]>()
    const foot = new Set<number>()
    // a gate side the line turns outward at one end and inward at the other: neither does its flank
    // keep clear of the way through standing level with it, nor set back (curtain.ts GATE_RECESS)
    let closed = tier >= 2 && gate !== keep && notches(gate, gateSide).length === 1 ? 1 : 0
    if (tier >= 2) {
      for (const i of tiles) {
        if (isBuilt(role.get(i))) continue
        const out = outside(i)
        if (out.length) walls.set(i, out)
      }
      // the notches at the ends of the sides the ways and the doors cross
      const cross = (i: number, d: number) => {
        for (const k of notches(i, d)) {
          if (k >= 0) foot.add(k)
          if (!footed(k)) closed++
        }
      }
      for (const w of ways) for (let k = 1; k < w.length; k++) cross(w[k - 1]!, nb(w[k - 1]!).indexOf(w[k]!))
      for (const [i, d] of door) if (i !== gate) cross(i, d)
    }
    // a postern whose way crosses a notch the curtain cannot stand out over (or whose approach the
    // curtain stands out over) is not made
    if (postern >= 0) {
      const plain = composeAt(gate, gateSide, false)
      if (closed > plain.closed || foot.has(posternEntry)) return plain
    }
    const plan: CastlePlan = {
      tier,
      tiles,
      keep,
      hall,
      gate,
      gateSide,
      entry,
      postern,
      posternSide,
      posternEntry,
      heart,
      role,
      door,
      ways,
      walls,
      foot: [...foot].sort((a, b) => a - b),
    }
    return { plan, closed }
  }
}

/**
 * The solid pieces whose footprint a site settles: KayKit hex buildings and walls. Their outlines are the
 * collision layer's (collide.ts, read off each model): the one footprint table the world has.
 */
const settled = (piece: string) => {
  const kind = solidKind(piece)
  return (kind === "building" || kind === "wall") && piece.startsWith("kaykit-hexagon/")
}

/** A solid piece's footprint as imported (x by z, metres: its outline's box), or undefined for none. */
export function pieceSize(piece: string): [number, number] | undefined {
  if (!settled(piece)) return undefined
  const o = pieceOutline(piece)
  if (!o) return undefined
  let x0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let z0 = Number.POSITIVE_INFINITY
  let z1 = Number.NEGATIVE_INFINITY
  for (let k = 0; k < o.foot.length; k += 2) {
    x0 = Math.min(x0, o.foot[k]!)
    x1 = Math.max(x1, o.foot[k]!)
    z0 = Math.min(z0, o.foot[k + 1]!)
    z1 = Math.max(z1, o.foot[k + 1]!)
  }
  return [x1 - x0, z1 - z0]
}

/** A placed piece, as much of it as its footprint needs. */
interface Placed {
  piece: string
  x: number
  z: number
  rot: number
  scale: number
  /** Stretch along the piece's own x (a curtain wall piece fitted to its run). */
  stretch?: number
}

const isWallPiece = (piece: string) => piece.startsWith("kaykit-hexagon/wall-")

/**
 * The ground a solid piece needs, as points (metres): its centre and its outline's corners and sides'
 * middles a little inside (the collision layer's outline, as placed). Null for a piece not settled
 * (props, nature, a bridge).
 */
export function footprint(p: Placed): [number, number][] | null {
  if (!pieceSize(p.piece) || p.piece.startsWith("kaykit-hexagon/building-bridge")) return null
  const s = pieceFootprint({ ...p, y: 0 })
  if (!s) return null
  const out: [number, number][] = [[p.x, p.z]]
  const n = s.pts.length / 2
  for (let k = 0; k < n; k++) {
    const ax = s.pts[k * 2]!
    const az = s.pts[k * 2 + 1]!
    const bx = s.pts[((k + 1) % n) * 2]!
    const bz = s.pts[((k + 1) % n) * 2 + 1]!
    for (const [x, z] of [
      [ax, az],
      [(ax + bx) / 2, (az + bz) / 2],
    ] as const)
      out.push([p.x + (x - p.x) * INSET, p.z + (z - p.z) * INSET])
  }
  return out
}
/** A footprint's points stand this share of the way out to its outline (rounding, a porch's lip). */
const INSET = 0.9

/** A solid piece's body for overlaps: the circle inside its hexagon (its outline's width), a little shrunk. */
export function bodyRadius(p: Placed): number {
  const s = pieceSize(p.piece)
  return s && !isWallPiece(p.piece) ? (s[0] / 2) * p.scale * (Math.sqrt(3) / 2) * 0.9 : 0
}

/**
 * Settles a tile's solid pieces on their floor (decisions.md "site-aware procedural buildings": every
 * building stands on dry ground at its base level): a building piece whose footprint reaches over water,
 * over a lower tile or into a building already standing (`bodies`) is drawn in toward the tile's centre
 * and made smaller, a step at a time, until it fits (at most to MIN_FIT of its size). Each settled
 * building joins `bodies`.
 */
export function settlePieces(
  placed: Placed[],
  centre: [number, number],
  floor: (x: number, z: number) => boolean,
  bodies: {
    near(x: number, z: number): readonly [number, number, number][]
    add(x: number, z: number, r: number): void
  },
): void {
  for (const p of placed) {
    if (!footprint(p) || isWallPiece(p.piece)) continue
    const s0 = p.scale
    const ox = p.x - centre[0]
    const oz = p.z - centre[1]
    const fits = () =>
      footprint(p)!.every(([x, z]) => floor(x, z)) &&
      bodies.near(p.x, p.z).every(([x, z, r]) => Math.hypot(x - p.x, z - p.z) >= r + bodyRadius(p) - 0.05)
    for (let k = 1; k <= FIT_STEPS && !fits(); k++) {
      const f = MIN_FIT ** (k / FIT_STEPS)
      p.scale = s0 * f
      p.x = centre[0] + ox * f
      p.z = centre[1] + oz * f
    }
    // still not: on the tile's middle, smaller again
    for (const f of [MIN_FIT, 0.6, 0.5]) {
      if (fits()) break
      p.scale = s0 * f
      p.x = centre[0]
      p.z = centre[1]
    }
    bodies.add(p.x, p.z, bodyRadius(p))
  }
}
const FIT_STEPS = 6
const MIN_FIT = 0.7

// ─────────────────────────── the shows' sites (render shows/) ───────────────────────────

/** Where the dragon circles: the middle of the island's peaks on top, and how far they spread (metres). */
export interface PeakSite {
  at: [number, number, number]
  reach: number
}

/** How far from the highest rock the peaks' cluster reaches, metres. */
const PEAK_REACH = 40

/**
 * The island's peaks (pure): the highest rock tile and the rock round it, their middle (x, z), weighted
 * to the high ground, their top and how far they spread. Null on an island with no rock.
 */
export function peakSite(
  tiles: readonly { i: number; x: number; z: number; top: number }[],
  rock: (i: number) => boolean,
): PeakSite | null {
  let high: (typeof tiles)[number] | null = null
  for (const t of tiles) if (rock(t.i) && (!high || t.top > high.top)) high = t
  if (!high) return null
  const peak = high
  const near = tiles.filter((t) => rock(t.i) && Math.hypot(t.x - peak.x, t.z - peak.z) <= PEAK_REACH)
  let w = 0
  let x = 0
  let z = 0
  for (const t of near) {
    const k = 1 + Math.max(0, t.top - peak.top + 4)
    w += k
    x += t.x * k
    z += t.z * k
  }
  x /= w
  z /= w
  let reach = 0
  for (const t of near) reach = Math.max(reach, Math.hypot(t.x - x, t.z - z))
  return { at: [x, peak.top, z], reach }
}

/** A festival's poles round a square and the cords strung between them (render shows/festival.ts). */
export interface SquareSite {
  /** The square's middle, on top. */
  at: [number, number, number]
  /** Each pole's foot (x, ground, z). */
  poles: [number, number, number][]
  /** Cords between two poles (indices): pennants round the square and across its ways, lanterns along them. */
  cords: { a: number; b: number; hang: "pennants" | "lanterns" }[]
}

/** How far a pole stands from any solid piece's outline, metres. */
const POLE_CLEAR = 0.35
/** Two ways' poles closer than this are one pole, metres. */
const POLE_SHARE = 1.6

/**
 * The pole spots round a square (pure): one at each corner of its tile, moved in or out until clear of
 * every solid piece, and a pair flanking each way that leaves it (`avenue`: a road or a square on that
 * side), most of a tile down it. Pennants hang round the square and across each way, lanterns along the
 * ways, from the nearer corner of the square to each of the pair. A spot with no clear ground is left
 * out, and its cords with it.
 */
export function squareSite(
  g: HexGrid,
  square: number,
  top: (i: number) => number | undefined,
  avenue: (i: number) => boolean,
  pieces: readonly PlacedPiece[],
): SquareSite | null {
  const R = HEX_TILE_SIZE
  const SQ3 = Math.sqrt(3)
  const centre = (i: number): [number, number] => [SQ3 * (g.q[i]! + g.r[i]! / 2) * R, 1.5 * g.r[i]! * R]
  const h = top(square)
  if (h === undefined) return null
  const [cx, cz] = centre(square)
  const solids = pieces.filter((p) => Math.hypot(p.x - cx, p.z - cz) < R * 5).flatMap((p) => pieceSolids(p))
  const clear = (x: number, z: number) => solids.every((s) => solidDistance(s, x, z) >= POLE_CLEAR)
  const poles: [number, number, number][] = []
  /** The first clear spot of `tries`, as a pole's index (a pole already standing near it); -1 when none is. */
  const place = (tries: [number, number][], y: number): number => {
    for (const [x, z] of tries)
      if (clear(x, z)) {
        const near = poles.findIndex((p) => Math.hypot(p[0] - x, p[2] - z) < POLE_SHARE)
        if (near >= 0) return near
        poles.push([x, y, z])
        return poles.length - 1
      }
    return -1
  }
  // the square's corners (pointy-top: at 30° + 60° k), at the tile's edge, then inward, then a little out
  const cornerAngle = (k: number) => Math.PI / 6 + (Math.PI / 3) * k
  const corners = [0, 1, 2, 3, 4, 5].map((k) =>
    place(
      [0.95, 0.85, 1.05, 0.75].map(
        (f) =>
          [cx + Math.cos(cornerAngle(k)) * R * f, cz + Math.sin(cornerAngle(k)) * R * f] as [number, number],
      ),
      h,
    ),
  )
  const cords: SquareSite["cords"] = []
  const cord = (a: number, b: number, hang: "pennants" | "lanterns") => {
    if (a >= 0 && b >= 0 && a !== b) cords.push({ a, b, hang })
  }
  for (let k = 0; k < 6; k++) cord(corners[k]!, corners[(k + 1) % 6]!, "pennants")
  const around = g.neighbours(square)
  for (let d = 0; d < 6; d++) {
    const n = around[d] ?? -1
    if (n < 0 || !avenue(n)) continue
    const ny = top(n)
    if (ny === undefined) continue
    const [nx, nz] = centre(n)
    const ux = (nx - cx) / (SQ3 * R)
    const uz = (nz - cz) / (SQ3 * R)
    const mx = cx + (nx - cx) * 0.8
    const mz = cz + (nz - cz) * 0.8
    const pair = [1, -1].map((s) =>
      place(
        [0.95, 0.8, 1.1].map((f) => [mx - uz * s * R * f, mz + ux * s * R * f] as [number, number]),
        ny,
      ),
    )
    cord(pair[0]!, pair[1]!, "pennants")
    // the square's two corners either side of this way (30° off its heading)
    const heading = Math.atan2(nz - cz, nx - cx)
    const flank = [0, 1, 2, 3, 4, 5].filter((k) => {
      const a = cornerAngle(k) - heading
      return corners[k]! >= 0 && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < Math.PI / 4
    })
    for (const p of pair) {
      if (p < 0) continue
      const [px, , pz] = poles[p]!
      let best = -1
      let bd = Number.POSITIVE_INFINITY
      for (const k of flank) {
        const q = poles[corners[k]!]!
        const dd = Math.hypot(q[0] - px, q[2] - pz)
        if (dd < bd) {
          bd = dd
          best = corners[k]!
        }
      }
      cord(best, p, "lanterns")
    }
  }
  return poles.length >= 3 ? { at: [cx, h, cz], poles, cords } : null
}

// ==== Sea routes (world events, Task D "sea life"): the merchants' laps and the lanes out to sea ====
//
// Pure geometry on the grid, metres (xz), for the sea's ships (render sea/). `solid` is whatever a hull
// must keep off: land, inland water, a pier's tile. Kept apart from the sites above, which are land.

/** A closed ring round the island, its points in order round `centre` (the last joins the first). */
export interface SeaRing {
  centre: [number, number]
  points: [number, number][]
}

/**
 * A lap round the island: a closed ring `clear` metres or more off every solid tile (a tile taken as the
 * disc round its corners, radius `size`). Built from the island's outline seen from its middle: at each
 * of `samples` bearings the farthest point of any tile's disc grown by `clear`, eased round so the ring
 * swings wide of a cape and straight across a bay, never in. A ray from `centre` out through the ring meets no
 * solid tile beyond it, so a straight run out from any point on a ring is open sea too.
 */
export function seaRing(
  g: HexGrid,
  solid: (i: number) => boolean,
  opts: { size: number; clear: number; samples?: number },
): SeaRing {
  const N = opts.samples ?? 256
  const R = opts.size
  const tiles: [number, number][] = []
  for (let i = 0; i < g.size; i++)
    if (solid(i)) tiles.push([Math.sqrt(3) * (g.q[i]! + g.r[i]! / 2) * R, 1.5 * g.r[i]! * R])
  let cx = 0
  let cz = 0
  for (const [x, z] of tiles) {
    cx += x
    cz += z
  }
  if (tiles.length) {
    cx /= tiles.length
    cz /= tiles.length
  }
  // the farthest point at each bearing of any solid tile's disc grown by the clearance: a ray out
  // past it meets no grown disc, so a point there is `clear` off every tile
  const reach = new Float64Array(N)
  const step = (Math.PI * 2) / N
  const grown = R + opts.clear
  for (const [x, z] of tiles) {
    const d = Math.hypot(x - cx, z - cz)
    const out = d + grown
    const half = d <= grown ? Math.PI : Math.asin(grown / d)
    const at = Math.atan2(z - cz, x - cx)
    const k0 = Math.floor((at - half) / step)
    const k1 = Math.ceil((at + half) / step)
    for (let k = k0; k <= k1; k++) {
      const j = ((k % N) + N) % N
      if (reach[j]! < out) reach[j] = out
    }
  }
  // the widest over a window, then eased over as wide a one: the mean of maxima that all cover the
  // bearing itself, so never in from it
  const W = Math.max(1, Math.round(N / 50))
  const H = W
  const wide = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    let m = 0
    for (let j = -W; j <= W; j++) m = Math.max(m, reach[(k + j + N) % N]!)
    wide[k] = m
  }
  const points: [number, number][] = []
  for (let k = 0; k < N; k++) {
    let s = 0
    for (let j = -H; j <= H; j++) s += wide[(k + j + N) % N]!
    const r = s / (2 * H + 1)
    points.push([cx + Math.cos(k * step) * r, cz + Math.sin(k * step) * r])
  }
  return { centre: [cx, cz], points }
}

/** How far out a ring lies at a bearing (radians about its centre, atan2(z, x)): between its two points there. */
export function ringRadius(ring: SeaRing, bearing: number): number {
  const N = ring.points.length
  const step = (Math.PI * 2) / N
  const f = (((bearing / step) % N) + N) % N
  const k = Math.floor(f)
  const a = ring.points[k]!
  const b = ring.points[(k + 1) % N]!
  const [cx, cz] = ring.centre
  const ra = Math.hypot(a[0] - cx, a[1] - cz)
  const rb = Math.hypot(b[0] - cx, b[1] - cz)
  return ra + (rb - ra) * (f - k)
}

/**
 * The way out from the sea tile `from` past `ring`, then straight on `beyond` metres: tile centres over
 * open water (each step costs more the nearer land it runs, so it keeps to the middle of a channel),
 * from the first tile outside the ring straight out from the ring's centre, eased with Chaikin's corner
 * cutting. Its first point is `from`'s centre. Null when no water way leads out.
 */
export function seaLane(
  g: HexGrid,
  solid: (i: number) => boolean,
  from: number,
  ring: SeaRing,
  opts: { size: number; beyond: number },
): [number, number][] | null {
  const R = opts.size
  const centre = (i: number): [number, number] => [
    Math.sqrt(3) * (g.q[i]! + g.r[i]! / 2) * R,
    1.5 * g.r[i]! * R,
  ]
  const water = (i: number) => i >= 0 && !solid(i)
  if (!water(from)) return null
  const near = stepsFromSolid(g, solid)
  const [cx, cz] = ring.centre
  const outside = (i: number) => {
    const [x, z] = centre(i)
    return Math.hypot(x - cx, z - cz) > ringRadius(ring, Math.atan2(z - cz, x - cx)) + R
  }
  // the cheapest way to a tile outside the ring (or to the map's edge, open sea all round)
  const cost = new Float64Array(g.size).fill(Number.POSITIVE_INFINITY)
  const prev = new Int32Array(g.size).fill(-1)
  const done = new Uint8Array(g.size)
  cost[from] = 0
  // a binary heap of tiles by their cost when pushed (a tile pushed again, cheaper, is popped first)
  const heap: [number, number][] = [[0, from]]
  const push = (c: number, i: number) => {
    heap.push([c, i])
    for (let k = heap.length - 1; k > 0; ) {
      const up = (k - 1) >> 1
      if (heap[up]![0] <= heap[k]![0]) break
      ;[heap[up], heap[k]] = [heap[k]!, heap[up]!]
      k = up
    }
  }
  const pop = (): number => {
    const top = heap[0]![1]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      for (let k = 0; ; ) {
        const a = 2 * k + 1
        const b = a + 1
        let m = k
        if (a < heap.length && heap[a]![0] < heap[m]![0]) m = a
        if (b < heap.length && heap[b]![0] < heap[m]![0]) m = b
        if (m === k) break
        ;[heap[m], heap[k]] = [heap[k]!, heap[m]!]
        k = m
      }
    }
    return top
  }
  let end = -1
  while (heap.length) {
    const at = pop()
    if (done[at]) continue
    done[at] = 1
    const edge = g.neighbours(at).some((j) => j < 0)
    if (outside(at) || edge) {
      end = at
      break
    }
    for (const j of g.neighbours(at)) {
      if (!water(j) || done[j]) continue
      const c = cost[at]! + 1 + 4 / Math.max(1, near[j]!) ** 2
      if (c < cost[j]!) {
        cost[j] = c
        prev[j] = at
        push(c, j)
      }
    }
  }
  if (end < 0) return null
  const tiles: number[] = []
  for (let i = end; i >= 0; i = prev[i]!) tiles.push(i)
  tiles.reverse()
  const points = tiles.map(centre)
  const [lx, lz] = points[points.length - 1]!
  const out = Math.atan2(lz - cz, lx - cx)
  const steps = Math.max(1, Math.ceil(opts.beyond / (R * 4)))
  for (let s = 1; s <= steps; s++) {
    const d = (opts.beyond * s) / steps
    points.push([lx + Math.cos(out) * d, lz + Math.sin(out) * d])
  }
  return chaikin(points)
}

/** Steps from anything solid, per tile: made once per grid and `solid` (the lanes of one island share it). */
const NEAR = new WeakMap<HexGrid, WeakMap<(i: number) => boolean, Int16Array>>()
function stepsFromSolid(g: HexGrid, solid: (i: number) => boolean): Int16Array {
  const byGrid = NEAR.get(g) ?? new WeakMap()
  NEAR.set(g, byGrid)
  const known = byGrid.get(solid)
  if (known) return known
  const near = new Int16Array(g.size).fill(-1)
  const queue: number[] = []
  for (let i = 0; i < g.size; i++)
    if (solid(i)) {
      near[i] = 0
      queue.push(i)
    }
  for (let k = 0; k < queue.length; k++)
    for (const j of g.neighbours(queue[k]!))
      if (j >= 0 && near[j] === -1) {
        near[j] = near[queue[k]!]! + 1
        queue.push(j)
      }
  byGrid.set(solid, near)
  return near
}

/** Chaikin's corner cutting, twice, the ends kept. */
function chaikin(points: [number, number][]): [number, number][] {
  let p = points
  for (let pass = 0; pass < 2 && p.length > 2; pass++) {
    const out: [number, number][] = [p[0]!]
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i]!
      const b = p[i + 1]!
      if (i > 0) out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      if (i + 2 < p.length) out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    out.push(p[p.length - 1]!)
    p = out
  }
  return p
}
