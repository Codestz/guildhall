/**
 * The island's regions (decisions.md "Seasons + regions"): a gentle few stretches of country that read
 * differently from the KayKit green the rest keeps. Two to four per island (more on a bigger one), each
 * one kind, chosen by the seed and the land:
 *
 * - highlands: the hills go grey with rock, the woods thin to pines, the peaks take a cap of snow;
 * - dry: a stretch of straw and ochre, bare trees and dry shrubs, fewer crops;
 * - autumn: a wood that has turned orange and red;
 * - marsh: low wet ground by the island's lake, dark and reedy, a mist lying on it;
 * - meadow: country in flower.
 *
 * Each region is a disc of tiles round its centre, its rim warped by noise and blended over a few tiles
 * (never a hard line), its weight gated by the land it suits (highlands only up the hills, a marsh only
 * near water) and kept off the town's core and the castle's site. The town, the castle and the places'
 * streets keep their look.
 *
 * Stable under growth: every centre is picked among the first tiles of the island's growth order (the
 * land every bigger island has) by fields that do not change with its size (the raw moisture, the hill
 * massifs, the nature lake, the reserved sites), and a region's tiles are a distance from it. A bigger
 * island adds a region; the ones it had stay where they were. Pure and deterministic.
 */
import { fbm, hash2, smoothstep } from "../geom/noise.ts"
import { hexCentre } from "./grid.ts"
import { type HexIsland, hexMassifs, kindOf, landTiles } from "./island.ts"
import { castleFoot } from "./sites.ts"
import type { HexZones } from "./zones.ts"

export const REGION_KINDS = ["highlands", "dry", "autumn", "marsh", "meadow"] as const
export type RegionKind = (typeof REGION_KINDS)[number]
const K = REGION_KINDS.length

export interface HexRegion {
  kind: RegionKind
  /** Its centre tile. */
  centre: number
  /** Its reach, in tile steps (the blend runs a little either side). */
  radius: number
}

export interface HexRegions {
  /** The island's regions, in the order they were chosen (a bigger island appends to it). */
  list: HexRegion[]
  /** Per tile, the strongest region's index in REGION_KINDS + 1, or 0 for none. */
  of: Uint8Array
  /**
   * Per tile and kind, how strongly the tile is that kind of country, 0–1: `weight[i * 5 + k]` for
   * REGION_KINDS[k]. Soft at the rims, 0 on the town's core and the castle's site.
   */
  weight: Float32Array
  /**
   * The level from which the highlands' tiles take snow, or null with no peak high enough (a small
   * island reaches only the foot of its hills).
   */
  snowLevel: number | null
}

/** The region of kind `k`'s weight on tile i. */
export const regionWeight = (r: HexRegions, i: number, kind: RegionKind): number =>
  r.weight[i * K + REGION_KINDS.indexOf(kind)] ?? 0

/** The strongest region on tile i and its weight, or null. */
export function regionOf(r: HexRegions, i: number): { kind: RegionKind; weight: number } | null {
  const k = r.of[i]!
  if (!k) return null
  return { kind: REGION_KINDS[k - 1]!, weight: r.weight[i * K + k - 1]! }
}

/**
 * Each slot's centre is chosen among this many first-grown tiles, so every island that has the slot
 * has the same centre for it (a slot a small island lacks is chosen among tiles a bigger one adds).
 */
const SLOT_REF = [520, 520, 1000, 1700] as const
/** Land tiles from which an island has a third and a fourth region. */
const THIRD = 900
const FOURTH = 1900
/** How many steps of blend each side of a region's radius (≥ 2 tiles in all). */
const BLEND = 1.4
const SQ3 = Math.sqrt(3)
/** How far apart two regions' centres stand at least, in steps (they may touch at their rims). */
const SPACING = 13

/** How many regions an island of `land` tiles has: 2, 3 from THIRD, 4 from FOURTH. */
export const regionCount = (land: number): number => (land >= FOURTH ? 4 : land >= THIRD ? 3 : 2)

/** A region's radius in steps for an island of `land` tiles: about a sixth to a seventh of the land each. */
export const regionRadius = (land: number): number => 2.4 + 0.115 * Math.sqrt(land)

/** Breadth-first steps from every tile `src` accepts (32767 where none reaches). */
function steps(h: HexIsland, src: (i: number) => boolean): Int16Array {
  const g = h.grid
  const d = new Int16Array(g.size).fill(32767)
  const queue: number[] = []
  for (let i = 0; i < g.size; i++)
    if (src(i)) {
      d[i] = 0
      queue.push(i)
    }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!
    for (const j of g.neighbours(i))
      if (j >= 0 && d[j]! > d[i]! + 1) {
        d[j] = d[i]! + 1
        queue.push(j)
      }
  }
  return d
}

/**
 * The island's regions. `z`, when given, keeps them off the places as well: off the town's, the
 * castle's, the harbour's and the market's tiles altogether and half off the villages' (a meadow keeps
 * its flowers round a farm).
 */
export function hexRegions(h: HexIsland, z?: HexZones): HexRegions {
  const g = h.grid
  const N = g.size
  const seed = h.spec.seed
  const land = h.stats.land
  const at = (i: number) => hexCentre({ q: g.q[i]!, r: g.r[i]! })
  const stepsBetween = (a: number, b: number) => {
    const [ax, ay] = at(a)
    const [bx, by] = at(b)
    return Math.hypot(ax - bx, ay - by) / SQ3
  }
  // the fields the centres are chosen by: none of them changes as the island grows
  const raw = new Float32Array(N).fill(Number.NaN)
  const moist = (i: number) => {
    let m = raw[i]!
    if (Number.isNaN(m)) {
      const [x, y] = at(i)
      m = fbm(seed + 41, x / 13, y / 13, 2)
      raw[i] = m
    }
    return m
  }
  const core = new Set<number>([...h.sites.town, ...h.sites.castle, ...castleFoot(g, h.sites.castle)])
  const fromCore = steps(h, (i) => core.has(i))
  /** A stretch's moisture: the tile and its two rings, as the nature lake reads it. */
  const stretched = new Float32Array(N).fill(Number.NaN)
  const stretch = (i: number) => {
    if (!Number.isNaN(stretched[i]!)) return stretched[i]!
    let sum = moist(i)
    let n = 1
    for (const j of g.neighbours(i))
      if (j >= 0)
        for (const k of g.neighbours(j))
          if (k >= 0) {
            sum += moist(k)
            n++
          }
    stretched[i] = sum / n
    return sum / n
  }
  const radius = regionRadius(landTiles(h.spec.files))
  const count = regionCount(land)
  // the kinds in the seed's order, the land's fit nudging it: hills make highlands likelier, a lake a marsh
  const bonus: Record<RegionKind, number> = {
    highlands: 0.12 * Math.min(1, h.spec.hills / 5) - (h.spec.hills < 2 ? 2 : 0),
    dry: 0.05,
    autumn: 0.15,
    marsh: h.lake.length ? 0.1 : -2,
    meadow: 0.1,
  }
  const order = [...REGION_KINDS]
    .map((kind, k) => ({ kind, score: hash2(seed + 977, k, 13) + bonus[kind] }))
    .filter((c) => c.score > -1)
    .sort((a, b) => b.score - a.score)
    .map((c) => c.kind)
  const list: HexRegion[] = []
  for (const kind of order) {
    if (list.length >= count) break
    const slot = list.length
    const ref = Math.min(land, SLOT_REF[slot]!)
    const early = (i: number) => h.rank[i]! >= 0 && h.rank[i]! < ref
    // clear of the regions before it (by a fixed spacing, so a bigger island's wider regions do not
    // move a centre) and of the town's core
    const clear = (i: number) => fromCore[i]! >= 3 && list.every((r) => stepsBetween(i, r.centre) >= SPACING)
    let best = -1
    let bestScore = Number.NEGATIVE_INFINITY
    const consider = (i: number, score: number) => {
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    if (kind === "highlands") {
      // on the main massif: the early tile nearest its crest
      const [[mx, my]] = hexMassifs(seed)
      for (let i = 0; i < N; i++) {
        if (!early(i) || !clear(i)) continue
        const [x, y] = at(i)
        consider(i, -Math.hypot(x - mx, y - my))
      }
    } else if (kind === "marsh") {
      // round the nature lake (every island has one, and keeps it as it grows)
      const lake = h.lake[0]
      if (lake !== undefined && clear(lake)) best = lake
    } else {
      for (let i = 0; i < N; i++) {
        if (!early(i) || !clear(i)) continue
        const [, y] = at(i)
        const jitter = hash2(seed + 983, g.q[i]!, g.r[i]!) * 0.08
        // autumn: the wettest stretch (where the woods grow), away from the lake's own
        if (kind === "autumn") {
          const lake = h.lake[0]
          if (lake !== undefined && stepsBetween(i, lake) < SPACING) continue
          consider(i, stretch(i) + jitter)
        }
        // dry: the driest stretch, toward the south (down the screen)
        else if (kind === "dry") consider(i, -stretch(i) + y / 60 + jitter)
        // meadow: open, middling ground a short walk out of the town
        else consider(i, -Math.abs(stretch(i) - 0.1) - Math.abs(fromCore[i]! - 7) * 0.04 + jitter)
      }
    }
    if (best >= 0) list.push({ kind, centre: best, radius })
  }

  // ---- the weights: each region's disc, warped, blended at its rim, gated by the land it suits ----
  const water = steps(h, (i) => {
    const k = kindOf(h, i)
    return k === "river" || k === "lake"
  })
  const weight = new Float32Array(N * K)
  for (const [n, r] of list.entries()) {
    const k = REGION_KINDS.indexOf(r.kind)
    const [cx, cy] = at(r.centre)
    for (let i = 0; i < N; i++) {
      const kind = kindOf(h, i)
      if (kind === "sea" || kind === "shallows") continue
      const [x, y] = at(i)
      const warp = 1 + 0.38 * fbm(seed + 1201 + n * 17, x / 9, y / 9, 2)
      const d = (Math.hypot(x - cx, y - cy) / SQ3) * warp
      let w = 1 - smoothstep(r.radius - BLEND, r.radius + BLEND, d)
      if (w <= 0) continue
      const L = h.level[i]!
      if (r.kind === "highlands") w *= kind === "rock" || kind === "cliff" ? 1 : smoothstep(1.5, 3.5, L)
      else if (r.kind === "marsh")
        // the wet ground round its water: near it, and no more than a step or two above it
        w *= (1 - smoothstep(3, 5.5, water[i]!)) * (1 - smoothstep(1, 3.2, L - h.level[r.centre]!))
      else if (r.kind === "dry") w *= 0.35 + 0.65 * smoothstep(0.5, 2.5, water[i]!)
      else if (r.kind === "meadow") w *= 1 - smoothstep(3.5, 5.5, L)
      // never on the town's core or the castle's site, and only half on the ring round them
      w *= smoothstep(1, 3, fromCore[i]!)
      weight[i * K + k] = Math.max(weight[i * K + k]!, w)
    }
  }
  if (z) {
    // the places keep their look: off the town's, the castle's, the harbour's and the market's tiles,
    // half off a village's (a meadow keeps its flowers by the farms); softened a ring out
    const hold = new Float32Array(N).fill(1)
    for (let i = 0; i < N; i++) {
      const zi = z.zoneOf[i]!
      if (!zi) continue
      const kind = z.zones[zi - 1]!.kind
      hold[i] = kind === "town" || kind === "castle" || kind === "harbour" || kind === "market" ? 0 : 0.5
    }
    const soft = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      let sum = hold[i]! * 2
      let n = 2
      for (const j of g.neighbours(i))
        if (j >= 0) {
          sum += hold[j]!
          n++
        }
      soft[i] = Math.min(hold[i]!, sum / n)
    }
    const meadow = REGION_KINDS.indexOf("meadow")
    for (let i = 0; i < N; i++)
      for (let k = 0; k < K; k++) {
        const s = k === meadow && soft[i]! > 0 ? Math.max(soft[i]!, 0.8) : soft[i]!
        weight[i * K + k] = weight[i * K + k]! * s
      }
  }
  const of = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    let bestK = -1
    let bestW = 0.02
    for (let k = 0; k < K; k++)
      if (weight[i * K + k]! > bestW) {
        bestW = weight[i * K + k]!
        bestK = k
      }
    of[i] = bestK + 1
  }
  // snow on the highlands' peaks: the top level or two of its tiles, from level 4 up
  let snowLevel: number | null = null
  const hk = REGION_KINDS.indexOf("highlands")
  let top = -1
  for (let i = 0; i < N; i++) if (weight[i * K + hk]! > 0.5) top = Math.max(top, h.level[i]!)
  if (top >= 4) snowLevel = Math.max(4, top - 1)
  return { list, of, weight, snowLevel }
}
