/**
 * The autumn harvest (decisions 2026-10-14 "Seasons + regions"): hay bales, heaps of pumpkins, crates of
 * produce and sacks of grain left by the barns and along the field edges of the farms. The world places
 * them; the Studio draws them in one extra instanced draw, only while it is autumn (render
 * props/harvest.ts), so summer is exactly what it was.
 *
 * Placed pure and stable: each farm tile's piles come from the seed and the tile's own coordinates
 * (never its index, never what was placed before it), so a farm keeps its piles as the island grows
 * round it. They stand on free ground only: inside their tile, clear of every solid (the collision
 * layer's outlines), of every road, street, stair and deck strip, of the walk graph's edges (the
 * spurs out to the fields and the doors' ways), of every spot someone works or sits at, and of every
 * other piece standing there (the crops, the bushes). They are no-block pieces: nobody is ever sent
 * through one, because nothing is placed where anybody walks or stands.
 */
import { hash2 } from "../geom/index.ts"
import { type Solid, SolidGrid, type SolidKind, solidDistance } from "./collide.ts"
import { type HexGrid, hexAt } from "./grid.ts"
import type { HexIsland } from "./island.ts"
import { natureFamily } from "./nature.ts"
import { roadStrips, StripGrid } from "./roads.ts"
import { type PlacedSpot, type TileFurniture, tileFurniture } from "./spots.ts"
import { HEX_TILE_SIZE, type PlacedPiece } from "./tiles.ts"
import type { HexWalk } from "./walk.ts"
import type { HexWorld } from "./world.ts"

/** How much bigger than the pieces' own scale a heap is laid (a heap is read from the camera's height). */
const GROW = 1.3

/** What a pile is made of. */
export const HARVEST_PIECES = {
  bale: "kenney-graveyard/hay-bale",
  bundle: "kenney-graveyard/hay-bale-bundled",
  pumpkin: "kenney-graveyard/pumpkin",
  squash: "kenney-graveyard/pumpkin-tall",
  crate: "kaykit-dungeon/box-small",
  sack: "kaykit-hexagon/sack",
} as const
export type HarvestKind = "hay" | "pumpkins" | "crates" | "sacks"

/** Every piece a pile can be made of, for whoever loads them. */
export const HARVEST_IDS: readonly string[] = Object.values(HARVEST_PIECES)

/** One piece of a pile in the world. */
export interface HarvestPiece {
  piece: string
  x: number
  y: number
  z: number
  rot: number
  scale: number
  /** The tile it stands on, and which pile (heap) of that tile. */
  tile: number
  heap: number
}

/** The tiles that are farms and fields, and how many heaps each wants at most. */
const FARM_HEAPS: Readonly<Record<string, number>> = {
  field: 2,
  farmstead: 3,
  "farmstead-yard": 4,
  orchard: 1,
  "cottage-veg": 1,
  homestead: 2,
}

/** Heaps by tile kind: the odds of each kind of heap (hay, pumpkins, crates, sacks), summing to 1. */
const ODDS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  field: [0.6, 0.3, 0, 0.1],
  farmstead: [0.4, 0.15, 0.3, 0.15],
  "farmstead-yard": [0.4, 0.15, 0.3, 0.15],
  orchard: [0.2, 0.2, 0.6, 0],
  "cottage-veg": [0.1, 0.6, 0.2, 0.1],
  homestead: [0.35, 0.2, 0.3, 0.15],
}
const KINDS: readonly HarvestKind[] = ["hay", "pumpkins", "crates", "sacks"]

/** The round a heap keeps clear, by kind, metres. */
const REACH: Readonly<Record<HarvestKind, number>> = {
  hay: 0.5 * GROW,
  pumpkins: 0.42 * GROW,
  crates: 0.5 * GROW,
  sacks: 0.46 * GROW,
}
/** What a heap keeps clear of, beyond its own round, metres. */
const FROM_SOLID = 0.12
const FROM_STRIP = 0.18
const FROM_WALK = 0.35
const FROM_SPOT = 0.75
const FROM_PIECE = 0.08
/** A piece that is no obstacle: the grass and the flowers it stands in. */
const SOFT_FAMILY = new Set(["grass", "flower"])
/** A standing piece's own round, metres (what is not a solid: a crop, a bush, a plant, a prop). */
const pieceRound = (p: PlacedPiece): number =>
  /^kenney-nature\/crop/.test(p.piece) ? 0.1 : natureFamily(p.piece) === "bush" ? 0.4 : 0.3
/** Tries to find a place for a heap. */
const TRIES = 56

type V2 = readonly [number, number]

export interface HarvestOpts {
  /** The spots and solids (spots.ts), when the caller has them. */
  furniture?: TileFurniture
  /** The walk graph (walk.ts), when the caller has it: its edges are ways nobody may be sent round a heap on. */
  walk?: Pick<HexWalk, "nodes" | "edges">
  /** Which kinds of tile (by prefab) have heaps; default all farms. */
  tiles?: ReadonlySet<string>
}

/** The distance from (x, z) to the segment a→b. */
function segDistance(x: number, z: number, a: V2, b: V2): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l2 = dx * dx + dz * dz || 1e-12
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2))
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z)
}

/** The walk graph's ways as polylines in the ground plane (an edge's detour corners too). */
function wayLines(walk: Pick<HexWalk, "nodes" | "edges">): [V2, V2][] {
  const out: [V2, V2][] = []
  for (const e of walk.edges) {
    const a = walk.nodes[e.a]!
    const b = walk.nodes[e.b]!
    let at: V2 = [a.x, a.z]
    for (const c of e.via ?? []) {
      out.push([at, c])
      at = c
    }
    out.push([at, [b.x, b.z]])
  }
  return out
}

/** Points in 2 m cells, for the near queries. */
class Cells<T extends { x: number; z: number }> {
  private readonly cells = new Map<number, T[]>()
  constructor(items: Iterable<T>) {
    for (const it of items) {
      const key = this.key(Math.floor(it.x / 2), Math.floor(it.z / 2))
      const list = this.cells.get(key)
      if (list) list.push(it)
      else this.cells.set(key, [it])
    }
  }
  private key = (cx: number, cz: number) => (cx + 4096) * 8192 + cz + 4096
  near(x: number, z: number, r: number): T[] {
    const out: T[] = []
    for (let cx = Math.floor((x - r) / 2); cx <= Math.floor((x + r) / 2); cx++)
      for (let cz = Math.floor((z - r) / 2); cz <= Math.floor((z + r) / 2); cz++)
        for (const it of this.cells.get(this.key(cx, cz)) ?? []) out.push(it)
    return out
  }
}

interface Part {
  piece: string
  /** Offset in the heap's frame (metres, y up), its turn and scale. */
  dx: number
  dy: number
  dz: number
  rot: number
  scale: number
}

/** A heap's pieces in its own frame, from its numbers `r(k)` (each in [0, 1)). */
function heapParts(kind: HarvestKind, r: (k: number) => number): Part[] {
  const turn = r(0) * Math.PI * 2
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const at = (x: number, y: number, z: number, rot: number, scale: number, piece: string): Part => ({
    piece,
    dx: (x * c + z * s) * GROW,
    dy: y * GROW,
    dz: (-x * s + z * c) * GROW,
    rot: turn + rot,
    scale: scale * GROW,
  })
  if (kind === "hay") {
    const a = r(1) < 0.5 ? HARVEST_PIECES.bale : HARVEST_PIECES.bundle
    const k = 0.5 + r(2) * 0.08
    const parts = [at(-0.3, 0, -0.2, (r(3) - 0.5) * 0.3, k, a), at(0.3, 0, 0.18, (r(4) - 0.5) * 0.3, k, a)]
    // a third on the two, three times in five
    if (r(5) < 0.6) parts.push(at(0, 0.36 * k * 1.6, 0, Math.PI / 2 + (r(6) - 0.5) * 0.4, k, a))
    return parts
  }
  if (kind === "pumpkins") {
    const n = 5 + Math.floor(r(1) * 3)
    const parts: Part[] = []
    for (let j = 0; j < n; j++) {
      const ang = (j / n) * Math.PI * 2 + r(2) * 0.6
      const rr = 0.27 + r(10 + j) * 0.06
      const k = 0.36 + r(20 + j) * 0.1
      parts.push(
        at(
          Math.cos(ang) * rr,
          0,
          Math.sin(ang) * rr,
          r(30 + j) * Math.PI * 2,
          k,
          r(40 + j) < 0.28 ? HARVEST_PIECES.squash : HARVEST_PIECES.pumpkin,
        ),
      )
    }
    // the crown of the heap
    parts.push(at(0, 0.17, 0, r(3) * Math.PI * 2, 0.4 + r(4) * 0.08, HARVEST_PIECES.pumpkin))
    if (r(5) < 0.5) parts.push(at(0.05, 0.3, -0.04, r(6) * Math.PI * 2, 0.34, HARVEST_PIECES.squash))
    return parts
  }
  if (kind === "crates") {
    const k = 0.33
    const parts = [at(-0.19, 0, 0, (r(1) - 0.5) * 0.2, k, HARVEST_PIECES.crate)]
    parts.push(at(0.2, 0, (r(2) - 0.5) * 0.06, (r(3) - 0.5) * 0.2, k, HARVEST_PIECES.crate))
    // the produce in them, heaped over their open tops
    for (let j = 0; j < 4; j++) {
      const x = j < 2 ? -0.19 : 0.2
      parts.push(
        at(
          x + (r(10 + j) - 0.5) * 0.12,
          k * 0.9,
          (j % 2 ? 1 : -1) * 0.07 + (r(20 + j) - 0.5) * 0.05,
          r(30 + j) * Math.PI * 2,
          0.3 + r(40 + j) * 0.06,
          j === 3 ? HARVEST_PIECES.squash : HARVEST_PIECES.pumpkin,
        ),
      )
    }
    // a third crate on the two, sometimes
    if (r(5) < 0.5) parts.push(at(0, k * 1.05, 0, (r(6) - 0.5) * 0.5, k, HARVEST_PIECES.crate))
    return parts
  }
  const k = 0.7
  const parts = [
    at(-0.2, 0, -0.1, (r(1) - 0.5) * 0.6, k, HARVEST_PIECES.sack),
    at(0.22, 0, 0.1, (r(2) - 0.5) * 0.6 + 0.3, k, HARVEST_PIECES.sack),
  ]
  if (r(3) < 0.6) parts.push(at(0, 0.2 * k * 1.1, 0, r(4) * Math.PI * 2, k * 0.95, HARVEST_PIECES.sack))
  return parts
}

/** The kind of heap a roll picks, by a tile's odds. */
function kindFor(prefab: string, roll: number): HarvestKind {
  const odds = ODDS[prefab] ?? ODDS.farmstead!
  let acc = 0
  for (let k = 0; k < 4; k++) {
    acc += odds[k]!
    if (roll < acc) return KINDS[k]!
  }
  return "hay"
}

/**
 * The harvest piles of a built world: for each farm tile (a prefab in `FARM_HEAPS`), a few heaps on free
 * ground. Pure: the same world gives the same piles, in tile order.
 */
export function harvestPiles(h: HexIsland, w: HexWorld, opts: HarvestOpts = {}): HarvestPiece[] {
  const g: HexGrid = h.grid
  const R = HEX_TILE_SIZE
  const want = opts.tiles ?? new Set(Object.keys(FARM_HEAPS))
  const farms = w.tiles.filter((t) => t.prefab && want.has(t.prefab))
  if (!farms.length) return []
  const furniture = opts.furniture ?? tileFurniture(g, w)
  const near = (x: number, z: number) =>
    farms.some((t) => (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < (R * 2.2) ** 2)
  // what is near a farm: the solids that are walls (the soft discs are the composer's margins), the ways,
  // the spots, the standing pieces
  const solids = new SolidGrid(furniture.solids.filter((s) => !s.soft && near(s.cx, s.cz)))
  const strips = new StripGrid(roadStrips(h, w))
  const ways = opts.walk ? wayLines(opts.walk).filter(([a, b]) => near(a[0], a[1]) || near(b[0], b[1])) : []
  const wayCells = new Cells(ways.map(([a, b]) => ({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, a, b })))
  const wayReach = Math.max(0, ...ways.map(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) / 2))
  const spots = new Cells<PlacedSpot>(furniture.spots.filter((s) => near(s.x, s.z)))
  const standing = new Cells(
    w.pieces.filter((p) => {
      const f = natureFamily(p.piece)
      return !(f && SOFT_FAMILY.has(f)) && near(p.x, p.z)
    }),
  )
  const byIndex = new Map(w.tiles.map((t) => [t.i, t]))
  /** Whether a point is dry, level ground as flat as the tile `top` it is measured from. */
  const level = (x: number, z: number, top: number): boolean => {
    const { q, r } = hexAt(x / R, z / R)
    const t = byIndex.get(g.index(q, r))
    return (
      !!t &&
      t.ground !== "water" &&
      t.ground !== "cliff" &&
      t.ground !== "shore" &&
      Math.abs(t.top - top) < 0.12
    )
  }
  const flat = (k: SolidKind) => k !== "blocker"

  /** Whether a round of radius `r` at (x, z) is free ground, level with `top` (a farm tile's). */
  const free = (top: number, x: number, z: number, r: number): boolean => {
    // dry level ground, the whole round (it may reach over a tile's edge onto the next field's)
    for (const [ox, oz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const)
      if (!level(x + ox, z + oz, top)) return false
    for (const s of solids.near(x, z, r + FROM_SOLID))
      if (flat(s.kind) && solidDistance(s as Solid, x, z) < r + FROM_SOLID) return false
    if (strips.on(x, z, r + FROM_STRIP)) return false
    for (const wl of wayCells.near(x, z, r + FROM_WALK + wayReach))
      if (segDistance(x, z, wl.a, wl.b) < r + FROM_WALK) return false
    for (const s of spots.near(x, z, r + FROM_SPOT))
      if (Math.hypot(s.x - x, s.z - z) < r + FROM_SPOT) return false
    for (const p of standing.near(x, z, r + 1))
      if (Math.hypot(p.x - x, p.z - z) < r + pieceRound(p) + FROM_PIECE) return false
    return true
  }

  const out: HarvestPiece[] = []
  for (const t of farms) {
    const prefab = t.prefab as string
    const q = g.q[t.i]!
    const rr = g.r[t.i]!
    const seed = h.spec.seed
    // this tile's own numbers: its coordinates and the seed, nothing else
    const roll = (salt: number) => hash2(seed * 31 + salt, q, rr)
    const max = FARM_HEAPS[prefab] ?? 1
    // a farm always shows some of its harvest; a field, a heap or two, or none
    const heaps =
      prefab === "field"
        ? Math.min(max, Math.floor(roll(1) * (max + 1.2)))
        : Math.min(max, 1 + Math.floor(roll(1) * max))
    const placed: { x: number; z: number; r: number }[] = []
    for (let k = 0; k < heaps; k++) {
      const kind = kindFor(prefab, roll(10 + k))
      const reach = REACH[kind]
      for (let a = 0; a < TRIES; a++) {
        const tag = 100 + k * 1000 + a * 10
        // a field's heaps stand toward its edge, a yard's by the buildings
        const lo = prefab === "field" ? 1.6 : 0.7
        const hi = prefab === "field" ? 2.5 : prefab === "farmstead-yard" ? 3.4 : 2.7
        const ang = roll(tag) * Math.PI * 2
        const d = lo + roll(tag + 1) * (hi - lo)
        const x = t.x + Math.cos(ang) * d
        const z = t.z + Math.sin(ang) * d
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + reach + 0.25)) continue
        if (!free(t.top, x, z, reach)) continue
        const own = (n: number) => hash2(seed * 31 + 7 + n, Math.round(x * 20), Math.round(z * 20))
        const parts = heapParts(kind, own)
        // every piece itself on free ground too: the heap's edge may meet a crop
        const y = w.heightAt(x, z)
        let n = 0
        for (const p of parts) {
          const px = x + p.dx
          const pz = z + p.dz
          if (p.dy === 0 && !free(t.top, px, pz, 0.14)) continue
          out.push({
            piece: p.piece,
            x: px,
            y: y + p.dy,
            z: pz,
            rot: p.rot,
            scale: p.scale,
            tile: t.i,
            heap: k,
          })
          n++
        }
        if (n > 0) placed.push({ x, z, r: reach })
        break
      }
    }
  }
  return out
}

/** The ground a heap's pieces stand on, in a heap's summary: how many heaps, how many pieces. */
export function harvestHeaps(piles: readonly HarvestPiece[]): number {
  return new Set(piles.map((p) => `${p.tile}:${p.heap}`)).size
}

/** A heap piece as a placed piece (for the checks that treat it like any other). */
export const harvestAsPiece = (p: HarvestPiece): PlacedPiece => ({
  piece: p.piece,
  x: p.x,
  y: p.y,
  z: p.z,
  rot: p.rot,
  scale: p.scale,
})
