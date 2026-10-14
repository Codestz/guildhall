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
  field: [0.7, 0.14, 0.04, 0.12],
  farmstead: [0.58, 0.14, 0.16, 0.12],
  "farmstead-yard": [0.58, 0.14, 0.16, 0.12],
  orchard: [0.4, 0.2, 0.4, 0],
  "cottage-veg": [0.35, 0.35, 0.2, 0.1],
  homestead: [0.58, 0.14, 0.16, 0.12],
}
const KINDS: readonly HarvestKind[] = ["hay", "pumpkins", "crates", "sacks"]

/** The round a heap keeps clear, by kind, metres. */
const REACH: Readonly<Record<HarvestKind, number>> = {
  hay: 0.5 * GROW,
  pumpkins: 0.45 * GROW,
  crates: 0.5 * GROW,
  sacks: 0.45 * GROW,
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
    const k = 0.5 + r(2) * 0.06
    // real stacks: bales lie in rows, the next layer across the seams of the one below
    const bw = 0.6
    const bd = 0.44
    const bh = 0.29
    const parts: Part[] = []
    const wob = (j: number) => (r(j) - 0.5) * 0.14
    if (r(7) < 0.5) {
      // a block three high: two rows of two, two across them, one on top
      for (let i = 0; i < 4; i++)
        parts.push(at(((i % 2) - 0.5) * bw, 0, (Math.floor(i / 2) - 0.5) * bd, wob(10 + i), k, a))
      for (let i = 0; i < 2; i++)
        parts.push(at(0, bh, (i - 0.5) * bd * 1.05, Math.PI / 2 + wob(20 + i), k, a))
      parts.push(at(0, bh * 2, 0, wob(30), k, a))
      // and sometimes one leaning at its foot
      if (r(8) < 0.5) parts.push(at(bw * 0.95, 0, bd * 0.3, wob(31) + 0.4, k, a))
    } else {
      // a wall two high: a row of three, two on it
      const n = 3
      for (let i = 0; i < n; i++)
        parts.push(at((i - (n - 1) / 2) * bw, 0, wob(10 + i) * 0.3, wob(40 + i), k, a))
      for (let i = 0; i < n - 1; i++)
        parts.push(at((i - (n - 2) / 2) * bw, bh, wob(20 + i) * 0.3, wob(50 + i), k, a))
      // a second row behind it, the first of a block
      if (r(9) < 0.5)
        for (let i = 0; i < n - 1; i++) parts.push(at((i - (n - 2) / 2) * bw, 0, bd, wob(60 + i), k, a))
    }
    return parts
  }
  if (kind === "pumpkins") {
    // a mound: a ring, a ring on it, a crown
    const parts: Part[] = []
    const pick = (j: number) => (r(70 + j) < 0.25 ? HARVEST_PIECES.squash : HARVEST_PIECES.pumpkin)
    const n = 5 + Math.floor(r(1) * 2)
    for (let j = 0; j < n; j++) {
      const ang = (j / n) * Math.PI * 2 + r(2) * 0.6
      const rr = 0.34 + r(10 + j) * 0.06
      parts.push(
        at(
          Math.cos(ang) * rr,
          0,
          Math.sin(ang) * rr,
          r(30 + j) * Math.PI * 2,
          0.38 + r(20 + j) * 0.08,
          pick(j),
        ),
      )
    }
    const m = 3
    for (let j = 0; j < m; j++) {
      const ang = (j / m) * Math.PI * 2 + r(3) * 2
      parts.push(
        at(
          Math.cos(ang) * 0.16,
          0.14,
          Math.sin(ang) * 0.16,
          r(35 + j) * Math.PI * 2,
          0.4 + r(25 + j) * 0.06,
          pick(10 + j),
        ),
      )
    }
    parts.push(at(0, 0.29, 0, r(4) * Math.PI * 2, 0.4 + r(5) * 0.06, HARVEST_PIECES.pumpkin))
    if (r(6) < 0.5) parts.push(at(0.1, 0.36, -0.06, r(7) * Math.PI * 2, 0.32, HARVEST_PIECES.squash))
    return parts
  }
  if (kind === "crates") {
    const k = 0.33
    const cw = 0.38
    const parts: Part[] = []
    // a row of three, two on it (the next layer on the seams), sometimes a second row of two behind
    const rows: [number, number][] = [[0, 0]]
    if (r(1) < 0.45) rows.push([0, cw * 1.02])
    for (const [, z] of rows) {
      const n = z === 0 ? 3 : 2
      for (let i = 0; i < n; i++)
        parts.push(
          at((i - (n - 1) / 2) * cw, 0, z, (r(2 + i + z * 10) - 0.5) * 0.16, k, HARVEST_PIECES.crate),
        )
    }
    const second = r(3) < 0.7 ? 2 : 1
    for (let i = 0; i < second; i++)
      parts.push(
        at(second === 2 ? (i - 0.5) * cw : 0, k * 1.02, 0, (r(5 + i) - 0.5) * 0.3, k, HARVEST_PIECES.crate),
      )
    // the produce heaped over the open tops: the crates on top, the second row's, and the first row's
    // ends when only one crate stands on it
    const open: [number, number, number][] = []
    for (let i = 0; i < second; i++) open.push([second === 2 ? (i - 0.5) * cw : 0, k * 1.9, 0])
    if (second === 1) open.push([-cw, k * 0.9, 0], [cw, k * 0.9, 0])
    if (rows.length > 1) for (const x of [-0.5 * cw, 0.5 * cw]) open.push([x, k * 0.9, cw * 1.02])
    for (const [j, [x, y, z]] of open.entries()) {
      for (let q = 0; q < 2; q++)
        parts.push(
          at(
            x + (q - 0.5) * 0.13 + (r(10 + j + q) - 0.5) * 0.05,
            y,
            z + (r(20 + j + q) - 0.5) * 0.1,
            r(30 + j + q) * Math.PI * 2,
            0.28 + r(40 + j + q) * 0.06,
            r(50 + j + q) < 0.25 ? HARVEST_PIECES.squash : HARVEST_PIECES.pumpkin,
          ),
        )
    }
    return parts
  }
  // sacks: a row of three, two on it, one on those
  const k = 0.7
  const sw = 0.42
  const sh = 0.17
  const parts: Part[] = []
  const n = 2 + Math.floor(r(1) * 2)
  for (let i = 0; i < n; i++)
    parts.push(
      at((i - (n - 1) / 2) * sw, 0, (r(10 + i) - 0.5) * 0.1, (r(20 + i) - 0.5) * 0.7, k, HARVEST_PIECES.sack),
    )
  for (let i = 0; i < n - 1; i++)
    parts.push(
      at(
        (i - (n - 2) / 2) * sw,
        sh,
        (r(30 + i) - 0.5) * 0.08,
        (r(40 + i) - 0.5) * 0.7,
        k,
        HARVEST_PIECES.sack,
      ),
    )
  if (n === 3) parts.push(at(0, sh * 2, 0, (r(50) - 0.5) * 0.7, k * 0.95, HARVEST_PIECES.sack))
  // one slumped beside, and one more behind
  parts.push(at(sw * (n / 2 + 0.15), 0, 0.12, r(51) * Math.PI * 2, k, HARVEST_PIECES.sack))
  if (r(52) < 0.6) parts.push(at(0, 0, sw * 0.95, (r(53) - 0.5) * 0.7, k, HARVEST_PIECES.sack))
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
        const y = w.heightAt(x, z)
        // every piece standing on the ground on free ground too (a heap's edge may meet a crop): a stack
        // never stands on a hole, so what is blocked goes with what rests on it, and a heap that loses
        // much of itself is tried elsewhere first
        const blocked = parts.filter((p) => p.dy === 0 && !free(t.top, x + p.dx, z + p.dz, 0.14))
        const left = parts.filter(
          (p) =>
            !blocked.some((b) => (p.dy === 0 ? p === b : Math.hypot(p.dx - b.dx, p.dz - b.dz) < 0.5 * GROW)),
        )
        if (blocked.length && (a < TRIES * 0.6 || left.length < parts.length * 0.6)) continue
        let n = 0
        for (const p of left) {
          out.push({
            piece: p.piece,
            x: x + p.dx,
            y: y + p.dy,
            z: z + p.dz,
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
