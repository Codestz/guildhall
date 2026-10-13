/**
 * Sites: the ground a big place is composed for (decisions.md "site-aware procedural buildings").
 *
 * A site is a connected set of dry land tiles, levelled, that a road reaches; water may border it, never
 * lie inside it. The Guildhall's castle and the town's core are reserved on the island before its water is
 * routed (island.ts `reserveSites`), from data that does not change as the island grows, so they stay put
 * and the rivers run round them. Scenes find theirs when they are placed (world.ts).
 */

import { hash2 } from "../geom/noise.ts"
import type { HexGrid } from "./grid.ts"

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
  /** The inner yard in front of the hall (the keep below tier 3): the castle's heart, where agents gather. */
  heart: number
  role: Map<number, CastleRole>
  /** Each building tile's door side, onto a yard or court tile. */
  door: Map<number, number>
  /** The paved ways: tile paths from the gate to the heart and on to each door's court. */
  ways: number[][]
  /** The curtain wall (tier 2 up): per yard or court tile, the sides that face out of the site. */
  walls: Map<number, number[]>
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
 *                side), the gatehouse on the gate side.
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
  },
): CastlePlan | null {
  const keep = site[0]
  if (keep === undefined || !opts.usable(keep)) return null
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
  // ---- the gate: furthest from the keep, nearest the town, where a road can come in ----
  let gate = -1
  let gateSide = -1
  let bs = -Infinity
  for (const strict of [true, false]) {
    for (const t of tiles) {
      if (t === keep && tiles.length > 1) continue
      for (const d of outside(t)) {
        const o = nb(t)[d]!
        if (o < 0 || (strict && !opts.open(t, o))) continue
        const s = steps(g, t, keep) * 2 - steps(g, o, opts.town) + hh(1, o) * 0.2
        if (s > bs) {
          bs = s
          gate = t
          gateSide = d
        }
      }
    }
    if (gate >= 0) break
  }
  if (gate < 0) return null
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
    hall = place("hall", (i) => (steps(g, i, keep) <= 2 ? -steps(g, i, keep) * 2 + edge(i) * 0.5 : -Infinity))
  if (tier >= 3)
    place("barracks", (i) => (edge(i) ? edge(i) - steps(g, i, gate) * 0.2 + hh(2, i) : -Infinity))
  if (tier >= 4)
    for (let k = 0; k < 2; k++)
      place("tower", (i) => (edge(i) >= 3 ? edge(i) + steps(g, i, gate) * 0.3 + hh(3 + k, i) : -Infinity))
  // ---- doors and the ways: breadth first over the open tiles from the gate ----
  const prev = new Map<number, number>([[gate, -1]])
  const queue = [gate]
  for (let k = 0; k < queue.length; k++)
    for (const j of nb(queue[k]!))
      if (j >= 0 && S.has(j) && !prev.has(j) && !isBuilt(role.get(j))) {
        prev.set(j, queue[k]!)
        queue.push(j)
      }
  const depth = (i: number) => {
    let n = 0
    for (let k = i; prev.get(k)! >= 0; k = prev.get(k)!) n++
    return n
  }
  const door = new Map<number, number>()
  for (const i of tiles) {
    if (!isBuilt(role.get(i))) continue
    // the open side nearest the gate
    let best = -1
    for (let d = 0; d < 6; d++) {
      const j = nb(i)[d]!
      if (j < 0 || !prev.has(j)) continue
      if (best < 0 || depth(j) < depth(nb(i)[best]!)) best = d
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
  for (const i of paved) if (!isBuilt(role.get(i))) role.set(i, "court")
  // ---- the curtain wall (tier 2 up) ----
  const walls = new Map<number, number[]>()
  if (tier >= 2)
    for (const i of tiles) {
      if (isBuilt(role.get(i))) continue
      const out = outside(i)
      if (out.length) walls.set(i, out)
    }
  return { tier, tiles, keep, hall, gate, gateSide, entry, heart, role, door, ways, walls }
}

/**
 * Footprints of the solid pieces, metres as the library imports them (catalog `size`, x by z), by name
 * without its colour: what a placed piece covers, scaled and turned (`pieceSize`).
 */
const SIZES: Record<string, [number, number]> = {
  "kaykit-hexagon/building-archeryrange": [13.36, 12.41],
  "kaykit-hexagon/building-barracks": [11.52, 12.53],
  "kaykit-hexagon/building-blacksmith": [10.3, 9.96],
  "kaykit-hexagon/building-castle": [15.8, 18.05],
  "kaykit-hexagon/building-church": [8.23, 9.24],
  "kaykit-hexagon/building-destroyed": [12.31, 10.45],
  "kaykit-hexagon/building-home-a": [6.34, 6.83],
  "kaykit-hexagon/building-home-b": [7, 8.79],
  "kaykit-hexagon/building-lumbermill": [10.94, 9.51],
  "kaykit-hexagon/building-market": [14.4, 10.53],
  "kaykit-hexagon/building-mine": [12.85, 15.36],
  "kaykit-hexagon/building-scaffolding": [15.2, 16.87],
  "kaykit-hexagon/building-stage-a": [8.37, 7],
  "kaykit-hexagon/building-stage-b": [8.16, 9.04],
  "kaykit-hexagon/building-stage-c": [9.28, 9.02],
  "kaykit-hexagon/building-tavern": [9.37, 10.66],
  "kaykit-hexagon/building-tower-a": [7.95, 9.23],
  "kaykit-hexagon/building-tower-b": [9.58, 11.06],
  "kaykit-hexagon/building-tower-base": [7.44, 8.89],
  "kaykit-hexagon/building-tower-catapult": [7.44, 10.43],
  "kaykit-hexagon/building-watermill": [8.4, 9.89],
  "kaykit-hexagon/building-well": [5.21, 6.01],
  "kaykit-hexagon/building-windmill": [9.01, 6.53],
  "kaykit-hexagon/wall-corner-a-gate": [7.39, 6.44],
  "kaykit-hexagon/wall-corner-a-inside": [7.75, 5.95],
  "kaykit-hexagon/wall-corner-a-outside": [7.39, 6.01],
  "kaykit-hexagon/wall-corner-b-inside": [4.04, 6.16],
  "kaykit-hexagon/wall-corner-b-outside": [4.05, 5.67],
  "kaykit-hexagon/wall-straight": [8.4, 3.36],
  "kaykit-hexagon/wall-straight-gate": [8.4, 3.76],
}

/** A solid piece's footprint as imported (x by z, metres), or undefined for one not listed. */
export function pieceSize(piece: string): [number, number] | undefined {
  return SIZES[piece] ?? SIZES[piece.replace(/-(red|blue|green|yellow)$/, "")]
}

/** A placed piece, as much of it as its footprint needs. */
interface Placed {
  piece: string
  x: number
  z: number
  rot: number
  scale: number
}

const isWallPiece = (piece: string) => piece.startsWith("kaykit-hexagon/wall-")

/**
 * The ground a solid piece needs, as points (metres): its centre and its outline a little inside. A KayKit
 * hex building stands on a hexagon its width across the corners (corners on its own ±x, as a tile's);
 * a wall on its box. Null for a piece with no listed size (props, nature).
 */
export function footprint(p: Placed): [number, number][] | null {
  const s = pieceSize(p.piece)
  if (!s || p.piece.startsWith("kaykit-hexagon/building-bridge")) return null
  const c = Math.cos(p.rot)
  const n = Math.sin(p.rot)
  const local: [number, number][] = []
  if (isWallPiece(p.piece)) {
    const hw = (s[0] / 2) * p.scale * 0.9
    const hd = (s[1] / 2) * p.scale * 0.8
    for (const [a, b] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
      [0, 1],
      [0, -1],
    ] as const)
      local.push([a * hw, b * hd])
  } else {
    const r = (s[0] / 2) * p.scale * 0.92
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6
      // the hexagon's corners (even k) and the middles of its sides (odd k)
      const m = k % 2 ? r * (Math.sqrt(3) / 2) : r
      local.push([Math.cos(a) * m, Math.sin(a) * m])
    }
  }
  return [
    [p.x, p.z],
    ...local.map(([lx, lz]): [number, number] => [p.x + lx * c + lz * n, p.z - lx * n + lz * c]),
  ]
}

/** A solid piece's body for overlaps: the circle inside its hexagon, a little shrunk (0 for none). */
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
