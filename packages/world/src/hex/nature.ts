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

export const NATURE_DEFAULTS: Readonly<Required<Omit<HexNature, "pine">>> = {
  tree: 1,
  bush: 1,
  rock: 1,
  grass: 1,
  flower: 1,
  woods: 1,
  wild: 1,
}

/**
 * The island's chosen nature (user, 2026-10-12, preset "C + small ground" from the nature board): trees
 * stand over the cottages (an oak about 3× the eave), woods are fewer trees but a little more of the
 * countryside, and the ground cover shrinks to knee height. The Studio builds with it unless
 * `?nature=today` asks for the knobs at 1; any knob in the query overrides its value.
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
export const NATURE_FAMILIES: readonly NatureFamily[] = ["tree", "pine", "bush", "rock", "grass", "flower"]

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
export function natureScale(nature: HexNature, family: NatureFamily): number {
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
