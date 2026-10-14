/**
 * How much nature the hex island has and how big it stands (plan-hex "Nature pass"): code-level knobs
 * over the authored tile prefabs, for side-by-side comparisons (`?tree= ?pine= ?bush= ?rock= ?grass=
 * ?flower= ?woods= ?wild=` on `/town/<seed>`). Every knob is a multiplier and 1 is today's island:
 * the defaults change nothing.
 *
 * Sizes: each nature piece is scaled by its family's multiplier, but never grown into a road, a square,
 * a building or a castle further than it already reaches today (`growNature`): a tree by a street keeps
 * its size, the wood behind it grows.
 */
import { hash2 } from "../geom/noise.ts"
import type { RegionKind } from "./regions.ts"
import { HEX_TILE_SIZE, type PlacedPiece, type TilePiece, type TilePrefab } from "./tiles.ts"

export interface HexNature {
  /** Leaf trees (KayKit forest tree-1/2/3 and bare trees), a scale multiplier. */
  tree?: number
  /** Pines (tree-4), a scale multiplier; the `tree` one when left out. */
  pine?: number
  /** Bushes, a scale multiplier. */
  bush?: number
  /** Rocks and boulders, a scale multiplier. */
  rock?: number
  /** Grass tufts and reeds, a scale multiplier. */
  grass?: number
  /** Flowers, a scale multiplier. */
  flower?: number
  /** Trees per wooded tile (woods, pines, hillside), a multiplier on each tree's odds: < 1 thins, > 1 fills in the optional ones. */
  woods?: number
  /** The countryside's wooded share (woods vs open ground), a multiplier on the island's forest share. */
  wild?: number
}

/**
 * The island's chosen nature (user, 2026-10-12, preset "C + small ground" from the nature board): trees
 * stand over the cottages (an oak about 3× the eave), woods are fewer trees but a little more of the
 * countryside, and the ground cover shrinks to knee height. The Studio builds with it; any knob in
 * the query overrides its value.
 */
export const NATURE_CHOSEN: Readonly<HexNature> = {
  tree: 1.6,
  bush: 0.8,
  grass: 0.6,
  flower: 0.6,
  woods: 0.6,
  wild: 1.15,
}

export type NatureFamily = "tree" | "pine" | "bush" | "rock" | "grass" | "flower"

/** The nature family a catalog piece belongs to, or null (a building, a crop, a fence). */
export function natureFamily(piece: string): NatureFamily | null {
  if (piece.startsWith("kaykit-forest/")) {
    const n = piece.slice(14)
    if (n.startsWith("tree-4-")) return "pine"
    if (n.startsWith("tree-")) return "tree"
    if (n.startsWith("bush-")) return "bush"
    if (n.startsWith("rock-")) return "rock"
    if (n.startsWith("grass-")) return "grass"
    return null
  }
  if (piece.startsWith("kenney-nature/")) {
    const n = piece.slice(14)
    if (n.startsWith("flower-")) return "flower"
    if (n.startsWith("plant-bush")) return "bush"
    if (n.startsWith("rock-") || n.startsWith("stone-")) return "rock"
    if (n.startsWith("grass")) return "grass"
  }
  return null
}

/** The multiplier `nature` gives a family. */
function natureScale(nature: HexNature, family: NatureFamily): number {
  if (family === "pine") return nature.pine ?? nature.tree ?? 1
  return nature[family] ?? 1
}

/** Whether `nature` is today's island (every knob 1 or left out). */
export function isDefaultNature(nature: HexNature | undefined): boolean {
  return !nature || Object.values(nature).every((v) => v === undefined || v === 1)
}

/**
 * Half the footprint of KayKit's forest pieces as imported, metres (catalog sizes): a tree's canopy
 * radius at scale 1. A piece missing here takes its family's FALLBACK_REACH.
 */
const REACH: Record<string, number> = {
  "bush-1-c": 0.6,
  "bush-2-c": 0.66,
  "rock-3-e": 0.59,
  "rock-3-f": 0.59,
  "rock-3-g": 0.93,
  "rock-3-h": 0.97,
  "rock-3-i": 0.96,
  "rock-3-j": 0.98,
  "rock-3-k": 1.3,
  "rock-3-m": 1.72,
  "rock-3-n": 1.71,
  "rock-3-o": 1.74,
  "tree-1-a": 1.62,
  "tree-1-b": 2,
  "tree-1-c": 3.35,
  "tree-2-a": 1.3,
  "tree-2-b": 1.85,
  "tree-2-c": 2.3,
  "tree-2-d": 2.37,
  "tree-2-e": 3.02,
  "tree-3-a": 1.54,
  "tree-3-b": 2.06,
  "tree-3-c": 2.81,
  "tree-4-a": 1,
  "tree-4-b": 1.28,
  "tree-4-c": 1.87,
  "tree-bare-1-c": 1.87,
}
const FALLBACK_REACH: Record<NatureFamily, number> = {
  tree: 2,
  pine: 1.3,
  bush: 0.7,
  rock: 0.8,
  grass: 0.5,
  flower: 0.25,
}

/** How far a nature piece reaches round its trunk at scale 1, metres. */
export function natureReach(piece: string): number {
  const fam = natureFamily(piece)
  const m = /^kaykit-forest\/(.+)-color1$/.exec(piece)
  return (m ? REACH[m[1]!] : undefined) ?? (fam ? FALLBACK_REACH[fam] : 0)
}

/** A KayKit hex building's footprint radius at scale 1 (they are hexes about 6.9 m across as imported). */
export const BUILDING_REACH = 3.45
/** The pieces nature must not grow into on its own tile: KayKit hex buildings and castle pieces. */
export const isBuildingPiece = (piece: string): boolean =>
  piece.startsWith("kaykit-hexagon/building-") || piece.startsWith("kaykit-hexagon/wall")

/** The tile prefabs that are wooded ground: `woods` thins or fills their trees. */
export const WOODED = new Set(["woods", "woods-dense", "woods-light", "woods-clearing", "pines", "hillside"])

/**
 * The odds multiplier `placeTile` gives a piece of `prefab` (the variant it resolved to): `woods` for the
 * trees of a wooded tile, 1 for everything else.
 */
export function natureOdds(
  nature: HexNature | undefined,
): ((q: TilePiece, p: TilePrefab) => number) | undefined {
  const woods = nature?.woods ?? 1
  if (woods === 1) return undefined
  return (q, p) => {
    if (!WOODED.has(p.id)) return 1
    const f = natureFamily(q.piece)
    return f === "tree" || f === "pine" ? woods : 1
  }
}

const SQ3 = Math.sqrt(3)

/** The distance from (x, z) to the hex of tile size `size` centred at (cx, cz) (pointy top), 0 inside. */
export function hexDistance2D(x: number, z: number, cx: number, cz: number, size = HEX_TILE_SIZE): number {
  // the corners at 30° + 60°·k: sides with normals at 0°, 60°… at the apothem
  const a = (size * SQ3) / 2
  const dx = x - cx
  const dz = z - cz
  let outside = false
  for (let k = 0; k < 6 && !outside; k++) {
    const t = (Math.PI / 3) * k
    outside = dx * Math.cos(t) + dz * Math.sin(t) > a
  }
  if (!outside) return 0
  // outside: the nearest point of its six sides
  let best = Number.POSITIVE_INFINITY
  for (let k = 0; k < 6; k++) {
    const t0 = Math.PI / 6 + (Math.PI / 3) * k
    const t1 = t0 + Math.PI / 3
    const ax = Math.cos(t0) * size
    const az = Math.sin(t0) * size
    const lx = Math.cos(t1) * size - ax
    const lz = Math.sin(t1) * size - az
    const f = Math.max(0, Math.min(1, ((dx - ax) * lx + (dz - az) * lz) / (lx * lx + lz * lz)))
    best = Math.min(best, Math.hypot(dx - ax - lx * f, dz - az - lz * f))
  }
  return best
}

/** What nature may not grow into: hard tiles (roads, squares, buildings…) and building discs. */
export interface NatureObstacles {
  /** The hard tiles near a point (their centres), and whether a point's own tile is hard. */
  hardNear(x: number, z: number): { own: boolean; tiles: [number, number][] }
  /** Building discs near a point: x, z, radius. */
  buildingsNear(x: number, z: number): [number, number, number][]
}

/**
 * Scales every nature piece in `pieces` (in place) by its family's multiplier, a grown piece kept from
 * reaching into a hard tile or a building further than it does at its authored size. Shrinking is never
 * held back. Returns how many pieces grew and how many were held back (fully or in part).
 */
export function growNature(
  pieces: PlacedPiece[],
  nature: HexNature,
  obstacles: NatureObstacles,
): { grown: number; held: number } {
  let grown = 0
  let held = 0
  for (const p of pieces) {
    const fam = natureFamily(p.piece)
    if (!fam) continue
    const m = natureScale(nature, fam)
    if (m === 1) continue
    if (m < 1) {
      p.scale *= m
      continue
    }
    const unit = natureReach(p.piece)
    const r0 = unit * p.scale
    const near = obstacles.hardNear(p.x, p.z)
    let free = near.own ? 0 : Number.POSITIVE_INFINITY
    for (const [cx, cz] of near.tiles) free = Math.min(free, hexDistance2D(p.x, p.z, cx, cz))
    for (const [bx, bz, br] of obstacles.buildingsNear(p.x, p.z))
      free = Math.min(free, Math.max(0, Math.hypot(p.x - bx, p.z - bz) - br))
    const allowed = Math.max(r0, free)
    const want = p.scale * m
    const scale = unit > 0 ? Math.min(want, allowed / unit) : want
    if (scale < want - 1e-9) held++
    if (scale > p.scale + 1e-9) {
      grown++
      p.scale = scale
    }
  }
  return { grown, held }
}

// ---- the regions' nature (regions.ts): the same tiles, dressed for their stretch of country ----

/**
 * Foliage tones (palette swatch → swatch, over KayKit's leaf and grass greens and pine) the regions lay
 * over their nature: the KayKit palette's own autumn, orange and dry-grass ramps, so a turned wood is
 * still the house style.
 */
export const REGION_TONES = {
  /** An autumn wood: rust and orange. */
  rust: { 0: 27, 1: 36, 2: 37, 33: 27, 34: 36, 35: 37 },
  /** An autumn wood: orange. */
  orange: { 0: 36, 1: 37, 2: 56, 33: 36, 34: 37, 35: 55 },
  /** An autumn wood: gold. */
  gold: { 0: 4, 1: 55, 2: 56, 33: 3, 34: 54, 35: 56 },
  /** The dry south: straw and ochre. */
  dry: { 0: 3, 1: 4, 2: 5, 33: 3, 34: 4, 35: 5 },
  /** The highlands' pines: deep and dark. */
  pine: { 0: 33, 1: 34, 2: 34, 34: 33 },
  /** The highlands' and the marsh's ground cover: olive and moss. */
  olive: { 0: 34, 1: 35, 2: 35, 34: 34 },
  /** The marsh's reeds: olive with straw tips. */
  reed: { 0: 34, 1: 35, 2: 4, 34: 35 },
} satisfies Record<string, Record<number, number>>

/** `tone` laid over a piece's own re-tint: each swatch goes through its map, then through the tone. */
export function overTone(
  map: Record<number, number> | undefined,
  tone: Record<number, number>,
): Record<number, number> {
  const out: Record<number, number> = {}
  const from = new Set([...Object.keys(map ?? {}), ...Object.keys(tone)].map(Number))
  for (const s of [...from].sort((a, b) => a - b)) {
    const mid = map?.[s] ?? s
    out[s] = tone[mid] ?? mid
  }
  return out
}

/** Heights of the KayKit trees as imported (catalog sizes), metres at scale 1: a swap keeps a tree's height. */
const TREE_HEIGHT: Record<string, number> = {
  "tree-1-a": 4.16,
  "tree-1-b": 4.93,
  "tree-1-c": 7.81,
  "tree-2-a": 4.67,
  "tree-2-b": 6.04,
  "tree-2-c": 6.92,
  "tree-2-d": 8.09,
  "tree-2-e": 8.79,
  "tree-3-a": 3.51,
  "tree-3-b": 4.35,
  "tree-3-c": 5.79,
  "tree-4-a": 5.27,
  "tree-4-b": 6.94,
  "tree-4-c": 10.77,
  "tree-bare-1-b": 3.25,
  "tree-bare-1-c": 5.26,
  "tree-bare-2-b": 5.54,
}
const kaykitName = (piece: string) => /^kaykit-forest\/(.+)-color1$/.exec(piece)?.[1]
const KF = (name: string) => `kaykit-forest/${name}-color1`

/**
 * `p` as another KayKit tree of about its height (`k` of it), never reaching further round its trunk
 * than it did: a leaf tree as a pine on the hills, as a bare one in the dry south.
 */
function swapTree(p: PlacedPiece, to: string, k: number): PlacedPiece {
  const from = kaykitName(p.piece)
  const h0 = (from && TREE_HEIGHT[from]) || 5
  const h1 = TREE_HEIGHT[to] ?? 5
  const reach = natureReach(p.piece) * p.scale
  let scale = (p.scale * h0 * k) / h1
  const unit = natureReach(KF(to))
  if (unit > 0) scale = Math.min(scale, reach / unit)
  const { swatchMap: _, ...rest } = p
  return { ...rest, piece: KF(to), scale }
}

/** One tile of a region, as `dressRegion` dresses it. */
export interface RegionTile {
  kind: RegionKind
  /** How strongly the tile is its region's country, 0–1 (regions.ts). */
  weight: number
  /** The tile's index (its draws' seed) and centre. */
  i: number
  at: [number, number]
  /** Its top. */
  y: number
  /** A lake tile: the marsh lays lilies on it. */
  lake: boolean
  /** Open dry ground with no way over it: it may take new ground cover (reeds, flowers). */
  open: boolean
}

/** How far under its tile's top a lily floats: the inland water's surface (the Studio's SURFACE_DROP), a hair over it. */
export const LILY_DROP = 0.13

/** A point `k` of the way out from a tile's centre toward its rim, at angle `a`. */
const rimAt = (t: RegionTile, k: number, a: number): [number, number] => {
  const r = HEX_TILE_SIZE * (SQ3 / 2) * k
  return [t.at[0] + Math.cos(a) * r, t.at[1] + Math.sin(a) * r]
}

const AUTUMN = [REGION_TONES.rust, REGION_TONES.orange, REGION_TONES.orange, REGION_TONES.gold]

/**
 * The pieces of one tile as its region dresses them (pure; `pieces` is not changed). The rim's tiles
 * (weight under 1) change only some of their pieces, so a region fades in over a few tiles:
 *
 * - highlands: leaf trees become pines or go (the woods thin), bushes and flowers thin, the cover goes olive;
 * - dry: trees thin, some stand bare, the rest and the shrubs go straw and ochre, flowers and crops thin;
 * - autumn: the leaf trees and bushes turn rust, orange and gold (the pines stay green);
 * - marsh: the trees thin, reeds stand in the wet ground, lilies float on the lake;
 * - meadow: drifts of flowers on the open ground.
 *
 * What it adds is soft ground cover only (reeds, lilies, flowers), never a solid; what it swaps reaches
 * no further than what stood there.
 */
export function dressRegion(pieces: readonly PlacedPiece[], t: RegionTile, seed: number): PlacedPiece[] {
  const w = t.weight
  const out: PlacedPiece[] = []
  const roll = (k: number, salt: number) => hash2(seed + 1301 + salt, t.i, k)
  pieces.forEach((p) => {
    // each piece rolls by where it stands, so a piece thinned out by a knob changes no other piece's roll
    const k = Math.round(p.x * 64) * 7919 + Math.round(p.z * 64)
    const fam = natureFamily(p.piece)
    const crop = p.piece.startsWith("kenney-nature/crops-") || p.piece.startsWith("kenney-nature/crop-")
    // the rim's fade: this piece takes the region's look or keeps the island's
    if (roll(k, 1) >= w || (!fam && !(crop && t.kind === "dry"))) {
      out.push(p)
      return
    }
    const name = kaykitName(p.piece) ?? ""
    const leafTree = fam === "tree" && !name.startsWith("tree-bare")
    const r = roll(k, 2)
    // a KayKit piece's foliage takes the region's tone in place of its wood's (one variant per piece and
    // tone, not one per tone it had: each is a geometry the batch bakes); any other piece's tone over its own
    const tone = (m: Record<number, number>): PlacedPiece => ({
      ...p,
      swatchMap: p.piece.startsWith("kaykit-forest/") ? { ...m } : overTone(p.swatchMap, m),
    })
    if (t.kind === "highlands") {
      if (leafTree) {
        if (r < 0.35) return
        const pine = swapTree(p, (TREE_HEIGHT[name] ?? 5) < 6 ? "tree-4-b" : "tree-4-c", 1.05)
        out.push({ ...pine, swatchMap: overTone(undefined, REGION_TONES.pine) })
      } else if (fam === "pine") {
        if (r >= 0.2) out.push(tone(REGION_TONES.pine))
      } else if (fam === "bush") {
        if (r >= 0.45) out.push(tone(REGION_TONES.olive))
      } else if (fam === "flower") {
        if (r >= 0.6) out.push(p)
      } else if (fam === "grass") out.push(tone(REGION_TONES.olive))
      else out.push(p)
    } else if (t.kind === "dry") {
      if (crop) {
        if (r >= 0.4) out.push(p)
      } else if (leafTree) {
        if (r < 0.4) return
        if (r < 0.65) {
          const bare = ["tree-bare-1-c", "tree-bare-2-b", "tree-bare-1-b"][Math.floor(roll(k, 3) * 3)]!
          out.push(swapTree(p, bare, 0.85))
        } else out.push(tone(REGION_TONES.dry))
      } else if (fam === "bush") {
        if (r >= 0.3) out.push(tone(REGION_TONES.dry))
      } else if (fam === "flower") {
        if (r >= 0.7) out.push(p)
      } else if (fam === "pine" || fam === "grass") out.push(tone(REGION_TONES.dry))
      else out.push(p)
    } else if (t.kind === "autumn") {
      if (leafTree || fam === "bush")
        out.push(tone(AUTUMN[Math.floor(roll(k, 4) * AUTUMN.length)] ?? REGION_TONES.orange))
      else if (fam === "grass") out.push(tone(REGION_TONES.olive))
      else out.push(p)
    } else if (t.kind === "marsh") {
      if (leafTree) {
        if (r >= 0.3) out.push(tone(REGION_TONES.olive))
      } else if (fam === "grass" || fam === "bush") out.push(tone(REGION_TONES.olive))
      else out.push(p)
    } else out.push(p)
  })
  if (t.kind === "marsh" && t.open && w > 0.2) {
    // reeds standing in the wet ground
    const n = Math.round(4 + 10 * w)
    for (let k = 0; k < n; k++) {
      if (roll(k, 11) > w + 0.15) continue
      const [x, z] = rimAt(t, 0.25 + 0.65 * roll(k, 12), roll(k, 13) * Math.PI * 2)
      out.push({
        piece: KF(roll(k, 14) < 0.6 ? "grass-2-a" : "grass-1-a"),
        x,
        y: t.y,
        z,
        rot: roll(k, 15) * Math.PI * 2,
        scale: 2 + 1.1 * roll(k, 16),
        swatchMap: overTone(undefined, REGION_TONES.reed),
      })
    }
  }
  if (t.kind === "marsh" && t.lake && w > 0.3) {
    // lilies floating on the lake
    const n = 1 + Math.floor(3 * w * roll(0, 21) + 0.5)
    for (let k = 0; k < n; k++) {
      const [x, z] = rimAt(t, 0.15 + 0.55 * roll(k, 22), roll(k, 23) * Math.PI * 2)
      out.push({
        piece: roll(k, 24) < 0.5 ? "kenney-nature/lily-large" : "kenney-nature/lily-small",
        x,
        y: t.y - LILY_DROP,
        z,
        rot: roll(k, 25) * Math.PI * 2,
        scale: 1 + 0.5 * roll(k, 26),
      })
    }
  }
  if (t.kind === "meadow" && t.open && w > 0.2) {
    // two or three drifts of flowers, each of one colour
    const colours = ["red", "yellow", "purple", "yellow"]
    const drifts = 3 + Math.floor(roll(0, 31) * 2)
    for (let d = 0; d < drifts; d++) {
      if (roll(d, 32) > w + 0.1) continue
      const colour = colours[Math.floor(roll(d, 33) * colours.length)]!
      const [cx, cz] = rimAt(t, 0.15 + 0.35 * roll(d, 34), roll(d, 35) * Math.PI * 2)
      const n = 4 + Math.floor(roll(d, 36) * 5)
      for (let k = 0; k < n; k++) {
        const j = d * 16 + k
        const a = roll(j, 37) * Math.PI * 2
        const rr = 0.2 + 0.75 * roll(j, 38)
        out.push({
          piece: `kenney-nature/flower-${colour}-${"abc"[Math.floor(roll(j, 39) * 3)]}`,
          x: cx + Math.cos(a) * rr,
          y: t.y,
          z: cz + Math.sin(a) * rr,
          rot: roll(j, 40) * Math.PI * 2,
          scale: 1.2 + 0.5 * roll(j, 41),
        })
      }
    }
  }
  return out
}
