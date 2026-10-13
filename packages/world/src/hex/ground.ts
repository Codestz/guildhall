/**
 * The hex island's ground as one soft mesh (decisions.md "Clean restart on hex": merge + soft coast).
 * Tiles of the same ground at the same height merge: their tops share colour at shared corners (one
 * smooth noise field, no per-tile jitter) and no rim or wall is drawn between them. A wall is drawn only
 * where a tile stands higher than its neighbour (a terrace step, a cliff). Where low land meets the sea
 * the edge becomes a sand slope running down under the water, so the coast reads as a beach, not a cut;
 * high land meets the sea as a cliff down to the island's base.
 */
import { fbm, hash2 } from "../geom/noise.ts"
import { pieceFootprint, solidDistance } from "./collide.ts"
import { hexAt } from "./grid.ts"
import type { HexIsland } from "./island.ts"
import { isBuildingPiece } from "./nature.ts"
import { HEX_TILE_SIZE } from "./tiles.ts"
import type { HexWorld } from "./world.ts"

type RGB = readonly [number, number, number]

export interface GroundPalette {
  top: Record<string, RGB>
  side: Record<string, RGB>
  sideLand: RGB
  slope: RGB
}

export interface HexGroundMesh {
  /** x, y, z per vertex (triangles). */
  position: Float32Array
  /** sRGB 0–1 per vertex. */
  color: Float32Array
}

/** How far a beach slope runs out under the water, in tile radii, and how deep it ends. */
const SLOPE_OUT = 0.55
const SLOPE_DEPTH = -0.9

/**
 * A wall's shade at height y: by the world height, not the wall's own top and foot, so every wall's bands
 * line up across the island like rock strata (darker low, a lighter band every 0.74 m).
 */
const strata = (y: number): number => {
  const band = Math.floor((y + 10) / 0.74)
  return 0.62 + 0.3 * Math.min(1, Math.max(0, (y + 2.5) / 9)) + (band % 2 ? 0.04 : 0)
}

export function hexGroundMesh(h: HexIsland, w: HexWorld, pal: GroundPalette, base = -2.5): HexGroundMesh {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const seed = h.spec.seed
  const tileOf = new Map<number, (typeof w.tiles)[number]>()
  for (const t of w.tiles) tileOf.set(t.i, t)
  const corners: [number, number][] = []
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30)
    corners.push([Math.cos(a), Math.sin(a)])
  }
  const pos: number[] = []
  const col: number[] = []
  /** The ground's tone at a point: one field over the island, so shared corners match. */
  const tone = (x: number, z: number) => 0.93 + 0.12 * (fbm(seed + 77, x / 22, z / 22, 2) * 0.5 + 0.5)
  const put = (x: number, y: number, z: number, c: RGB, k: number) => {
    pos.push(x, y, z)
    col.push((c[0] * k) / 255, (c[1] * k) / 255, (c[2] * k) / 255)
  }
  const isWater = (t: { ground: string } | undefined) => !t || t.ground === "water"
  for (const t of w.tiles) {
    const top = pal.top[t.ground] ?? pal.top.grass!
    const side = pal.side[t.ground] ?? pal.sideLand
    const P = corners.map(([cx, cz]) => [t.x + cx * R, t.z + cz * R] as const)
    // the top: a fan, coloured by the shared tone at each corner
    for (let k = 0; k < 6; k++) {
      const a = P[k]!
      const b = P[(k + 1) % 6]!
      put(t.x, t.top, t.z, top, tone(t.x, t.z))
      put(b[0], t.top, b[1], top, tone(b[0], b[1]))
      put(a[0], t.top, a[1], top, tone(a[0], a[1]))
    }
    // each edge: nothing between equals, a wall down to a lower neighbour, a beach slope or a cliff to the sea
    const nb = g.neighbours(t.i)
    for (let k = 0; k < 6; k++) {
      // edge k (corners k, k+1) faces direction 60°·k in x/z, which is neighbour d = (6 - k) % 6
      const j = nb[(6 - k) % 6]!
      const n = j >= 0 ? tileOf.get(j) : undefined
      const a = P[k]!
      const b = P[(k + 1) % 6]!
      const sea = !n || (isWater(n) && n.top < 0)
      if (sea && t.ground !== "water" && t.top < 1.6) {
        // a beach slope out under the water
        const ang = (Math.PI / 180) * (60 * k)
        const ox = Math.cos(ang) * R * SLOPE_OUT
        const oz = Math.sin(ang) * R * SLOPE_OUT
        const sand = pal.slope
        put(a[0], t.top, a[1], sand, 1)
        put(b[0], t.top, b[1], sand, 1)
        put(b[0] + ox, SLOPE_DEPTH, b[1] + oz, sand, 0.85)
        put(a[0], t.top, a[1], sand, 1)
        put(b[0] + ox, SLOPE_DEPTH, b[1] + oz, sand, 0.85)
        put(a[0] + ox, SLOPE_DEPTH, a[1] + oz, sand, 0.85)
        // close the corner wedge toward the next edge's slope
        const ang2 = (Math.PI / 180) * (60 * (k + 1))
        const j2 = nb[(6 - ((k + 1) % 6)) % 6]!
        const n2 = j2 >= 0 ? tileOf.get(j2) : undefined
        if (!n2 || (isWater(n2) && n2.top < 0)) {
          put(b[0], t.top, b[1], sand, 1)
          put(
            b[0] + Math.cos(ang2) * R * SLOPE_OUT,
            SLOPE_DEPTH,
            b[1] + Math.sin(ang2) * R * SLOPE_OUT,
            sand,
            0.85,
          )
          put(b[0] + ox, SLOPE_DEPTH, b[1] + oz, sand, 0.85)
        }
        continue
      }
      const floor = sea ? base : n ? n.top : base
      if (floor >= t.top - 0.01) continue
      put(a[0], t.top, a[1], side, strata(t.top))
      put(b[0], t.top, b[1], side, strata(t.top))
      put(b[0], floor, b[1], side, strata(floor))
      put(a[0], t.top, a[1], side, strata(t.top))
      put(b[0], floor, b[1], side, strata(floor))
      put(a[0], floor, a[1], side, strata(floor))
    }
  }
  return { position: new Float32Array(pos), color: new Float32Array(col) }
}

/** Tiles under trees: the grass there is darker and bluer. */
const SHADED = new Set<string | null>(["woods", "pines", "hunter", "lumber"])
/** Open grass that takes lighter, sunnier patches. */
const OPEN = new Set([null, "meadow", "pasture", "orchard", "hillside", "shepherd", "homestead"])
const DIRT: RGB = [170, 140, 96]
const DEEP_GRASS: RGB = [70, 112, 46]
const SUN_GRASS: RGB = [150, 178, 78]
const DAMP: RGB = [92, 120, 58]

type Cell = { x: number; z: number; y: number; t: HexWorld["tiles"][number] }

const mix = (a: RGB, b: RGB, f: number): RGB => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
  a[2] + (b[2] - a[2]) * f,
]

/** Squared distance from (px, pz) to the segment a→b. */
const segment2 = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const lx = bx - ax
  const lz = bz - az
  const f = Math.max(0, Math.min(1, ((px - ax) * lx + (pz - az) * lz) / (lx * lx + lz * lz || 1)))
  const dx = px - ax - lx * f
  const dz = pz - az - lz * f
  return dx * dx + dz * dz
}

/**
 * Every small hex's own flat colour (decisions.md "Polish round": a varied ground that keeps the low-poly
 * feel): a small per-hex shift in tone and hue, darker grass under woods, sunny patches in the open, worn
 * dirt along the paths and before the doors, damp grass on the banks, and a blended hex wherever two
 * grounds meet (sand into grass, gravel round rock), so no seam is a hard cut.
 */
function groundPaint(
  h: HexIsland,
  w: HexWorld,
  pal: GroundPalette,
  cells: Map<string, Cell>,
  seed: number,
): Map<string, RGB> {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const e = (R * Math.sqrt(3)) / 2
  const tileOf = new Map<number, HexWorld["tiles"][number]>()
  for (const t of w.tiles) tileOf.set(t.i, t)
  const out = new Map<string, RGB>()
  const base = new Map<string, RGB>()
  for (const [key, c] of cells) base.set(key, pal.top[c.t.ground] ?? pal.top.grass!)
  const STEP6: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ]
  for (const [key, c] of cells) {
    const [q, rr] = key.split(",").map(Number) as [number, number]
    let col = base.get(key)!
    const grass = c.t.ground === "grass"
    // every small hex a touch apart from its neighbours: lighter or darker, a little yellower or bluer
    const v = hash2(seed + 91, q, rr) - 0.5
    const hue = hash2(seed + 93, q, rr) - 0.5
    col = [
      col[0] * (1 + 0.07 * v) + 14 * hue,
      col[1] * (1 + 0.07 * v) + 4 * hue,
      col[2] * (1 + 0.07 * v) - 6 * hue,
    ]
    if (grass) {
      if (SHADED.has(c.t.prefab)) col = mix(col, DEEP_GRASS, 0.5)
      else if (OPEN.has(c.t.prefab)) {
        const patch = fbm(seed + 95, c.x / 9, c.z / 9, 2)
        if (patch > 0.12) col = mix(col, SUN_GRASS, Math.min(0.55, (patch - 0.12) * 2.4))
      }
    }
    // worn ground beside the paths and before the doors (the road strip itself is drawn over it)
    if (c.t.ground !== "water" && c.t.ground !== "rock" && c.t.ground !== "cliff") {
      let near = 9
      const around = [c.t.i, ...g.neighbours(c.t.i)]
      for (const i of around) {
        const t = i >= 0 ? tileOf.get(i) : undefined
        if (!t) continue
        for (const d of t.paths ?? []) {
          const a = (Math.PI / 180) * (60 * d)
          near = Math.min(near, segment2(c.x, c.z, t.x, t.z, t.x + Math.cos(a) * e, t.z - Math.sin(a) * e))
        }
        if (t.door !== undefined && i === c.t.i) {
          const a = (Math.PI / 180) * (60 * t.door)
          const dx = c.x - (t.x + Math.cos(a) * e * 0.8)
          const dz = c.z - (t.z - Math.sin(a) * e * 0.8)
          near = Math.min(near, (dx * dx + dz * dz) * 0.7)
        }
      }
      const d = Math.sqrt(near)
      if (d < 2.2) col = mix(col, DIRT, 0.42 * (1 - d / 2.2) + 0.08 * hash2(seed + 99, q, rr))
    }
    // where grounds meet, a hex takes some of the other ground: sand into grass, gravel round rock,
    // damp grass on a bank
    if (c.t.ground !== "water") {
      let n = 0
      let sum: RGB = [0, 0, 0]
      let wet = false
      for (const [sq, sr] of STEP6) {
        const nk = `${q + sq},${rr + sr}`
        const o = cells.get(nk)
        if (!o || o.t.ground === c.t.ground) continue
        if (o.t.ground === "water") {
          wet = true
          continue
        }
        const b = base.get(nk)!
        sum = [sum[0] + b[0], sum[1] + b[1], sum[2] + b[2]]
        n++
      }
      if (n) col = mix(col, [sum[0] / n, sum[1] / n, sum[2] / n], 0.3)
      if (wet && grass) col = mix(col, DAMP, 0.35)
    }
    out.set(key, col)
  }
  return out
}

/** Tiles whose ground may bend into small terraces (nature); everything else stays flat at its tile's top. */
const SOFT = new Set([
  null,
  "woods",
  "meadow",
  "pasture",
  "orchard",
  "hillside",
  "pines",
  "reeds",
  "hunter",
  "shepherd",
])

export interface HexFineGround extends HexGroundMesh {
  /** The ground at a point: a small hex's top. */
  heightAt(x: number, z: number): number
  /** Small hexes drawn. */
  count: number
  /** What `heightAt` reads, as plain data (a worker hands it over). */
  heights: HexHeights
}

/**
 * Heights on a hex grid of radius `size` (pointy top, axial q, r): hex (q, r) holds
 * `y[(r - r0) · cols + q - q0]`; 0 off the grid and where no ground stands.
 */
export interface HexHeights {
  size: number
  q0: number
  r0: number
  cols: number
  rows: number
  y: Float32Array
  /**
   * The seats (fine ground only): on the tile grid (radius `seat.size`), a seated tile's top, NaN for
   * one that is not; each small hex's tile (its slot on that grid) and whether it is cut along a tile
   * edge; and the height of each cut part on another tile than its own (small hex slot, tile slot, y).
   */
  seat?: { size: number; q0: number; r0: number; cols: number; rows: number; y: Float32Array }
  parent?: Int32Array
  split?: Uint8Array
  off?: { cell: Int32Array; tile: Int32Array; y: Float32Array }
}

const SQ3_ = Math.sqrt(3)
function axialOf(x: number, z: number, size: number): [number, number] {
  const qf = ((SQ3_ / 3) * x - z / 3) / size
  const rf = ((2 / 3) * z) / size
  const sf = -qf - rf
  let q = Math.round(qf)
  let r = Math.round(rf)
  const s = Math.round(sf)
  const dq = Math.abs(q - qf)
  const dr = Math.abs(r - rf)
  const ds = Math.abs(s - sf)
  if (dq > dr && dq > ds) q = -r - s
  else if (dr > ds) r = -q - s
  return [q, r]
}

/**
 * The height at a point from plain heights data (what a worker hands over): a seat's top over its tile,
 * else the small hex's (or, where a small hex is cut along a seat's edge, its part's). The fine mesh is
 * built from the same answers, so feet stand on what is drawn.
 */
export function heightsReader(hh: HexHeights): (x: number, z: number) => number {
  const { size, q0, r0, cols, rows, y, seat, parent, split, off } = hh
  const offs = new Map<number, number>()
  if (off) for (let k = 0; k < off.cell.length; k++) offs.set(off.cell[k]! * 1e6 + off.tile[k]!, off.y[k]!)
  return (x, z) => {
    let ts = -1
    if (seat) {
      const [tq, tr] = axialOf(x, z, seat.size)
      const c = tq - seat.q0
      const w = tr - seat.r0
      if (c >= 0 && w >= 0 && c < seat.cols && w < seat.rows) {
        ts = w * seat.cols + c
        const sy = seat.y[ts]!
        if (!Number.isNaN(sy)) return sy
      }
    }
    const [q, r] = axialOf(x, z, size)
    const c = q - q0
    const w = r - r0
    if (c < 0 || w < 0 || c >= cols || w >= rows) return 0
    const k = w * cols + c
    if (!split?.[k] || ts < 0 || parent?.[k] === ts) return y[k] as number
    return offs.get(k * 1e6 + ts) ?? (y[k] as number)
  }
}

/**
 * Tiles that are a seat (decisions.md "Relief must be walkable"; the user: "buildings must always have a
 * terrain block below them"): a tile carrying a road, a building, a scene, a field or a castle is one flat
 * hex at its top out to its own edges, exactly, so whatever stands on it out to its edge has ground under
 * it, and its neighbours meet it at its edge with a step (a stair on a road, a strata wall elsewhere).
 * Water, bare rock and cliffs, beaches and nature keep the small hexes.
 */
/** The most a plinth raises (or lowers) a small hex to a building's base: a terrace's snap, not a step. */
const PLINTH = 0.3
const UNSEATED = new Set<string | null>(["rocky", "beach", "lake", "dock", "dock-boats", "dock-ship"])

type Tile = HexWorld["tiles"][number]

/** Clips a convex polygon (x, z pairs) to the half-plane n · p ≤ c. */
function clipHalf(poly: number[], nx: number, nz: number, c: number): number[] {
  const out: number[] = []
  const n = poly.length / 2
  for (let k = 0; k < n; k++) {
    const ax = poly[k * 2]!
    const az = poly[k * 2 + 1]!
    const bx = poly[((k + 1) % n) * 2]!
    const bz = poly[((k + 1) % n) * 2 + 1]!
    const da = ax * nx + az * nz - c
    const db = bx * nx + bz * nz - c
    if (da <= 0) out.push(ax, az)
    if (da < 0 !== db < 0 && Math.abs(da - db) > 1e-12) {
      const f = da / (da - db)
      out.push(ax + (bx - ax) * f, az + (bz - az) * f)
    }
  }
  return out
}

const SQ3 = Math.sqrt(3)
/** Edge normals of a pointy-top hex (corners at −30°, 30°, …): 0°, 60°, … */
const NORMALS: [number, number][] = [0, 1, 2, 3, 4, 5].map((k) => [
  Math.cos((Math.PI / 3) * k),
  Math.sin((Math.PI / 3) * k),
])

/** A convex polygon cut to the hex of radius R at (cx, cz). */
function clipToHex(poly: number[], cx: number, cz: number, R: number): number[] {
  const e = (R * SQ3) / 2
  let p = poly
  for (const [nx, nz] of NORMALS) {
    p = clipHalf(p, nx, nz, nx * cx + nz * cz + e)
    if (p.length < 6) return []
  }
  return p
}

const area2 = (p: number[]) => {
  let a = 0
  const n = p.length / 2
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    a += p[k * 2]! * p[j * 2 + 1]! - p[j * 2]! * p[k * 2 + 1]!
  }
  return Math.abs(a) / 2
}

/** One drawn top: a small hex, or the part of one inside one tile, at its height. */
interface Piece {
  poly: number[]
  y: number
  /** The tile it lies on and the small hex it came from. */
  t: Tile
  key: string
}

/** The fine ground's heights: what the mesh is built from and what `heightAt` answers. */
export interface HexGroundHeights {
  heightAt(x: number, z: number): number
  /** The tile seated at a point (one flat top to its edges), or undefined. */
  seatAt(x: number, z: number): Tile | undefined
  /** As plain data on the small-hex grid (a small hex's own height; seats are not in it). */
  heights: HexHeights
}

interface FineModel extends HexGroundHeights {
  cells: Map<string, Cell>
  pieces: Piece[]
  /** The small hexes, by key, that are split along a tile edge. */
  split: Set<string>
  r: number
  /** The tile under a point. */
  tileAt(x: number, z: number): Tile | undefined
}

/** Tiles whose ground bends into small terraces (nature, no road, nothing built on it). */
const softTile = (t: Tile) =>
  SOFT.has(t.prefab) &&
  !t.paths &&
  t.ground !== "water" &&
  t.ground !== "rock" &&
  t.ground !== "cliff" &&
  t.ground !== "paved"

/**
 * The seated tiles of a world (see UNSEATED): its roads, the tiles a KayKit building or wall stands on (a
 * shepherd's hut on its pasture too), and every other flat tile but water, rock, beaches and docks.
 */
export function seatTiles(h: HexIsland, w: Pick<HexWorld, "tiles" | "pieces">): Set<number> {
  const R = HEX_TILE_SIZE
  const carries = new Set<number>()
  for (const pc of w.pieces) {
    if (!isBuildingPiece(pc.piece)) continue
    const { q, r } = hexAt(pc.x / R, pc.z / R)
    const i = h.grid.index(q, r)
    if (i >= 0) carries.add(i)
  }
  const out = new Set<number>()
  for (const t of w.tiles)
    if (t.ground !== "water" && (!!t.paths || carries.has(t.i) || (!softTile(t) && !UNSEATED.has(t.prefab))))
      out.add(t.i)
  return out
}

function fineModel(h: HexIsland, w: HexWorld, sub: number): FineModel {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const r = R / sub
  const step = (w.step ?? 0.8) / 3
  const tileOf = new Map<number, Tile>()
  for (const t of w.tiles) tileOf.set(t.i, t)
  const axial = (x: number, z: number, size: number): [number, number] => {
    const qf = ((SQ3 / 3) * x - z / 3) / size
    const rf = ((2 / 3) * z) / size
    const sf = -qf - rf
    let q = Math.round(qf)
    let rr = Math.round(rf)
    const s = Math.round(sf)
    const dq = Math.abs(q - qf)
    const dr = Math.abs(rr - rf)
    const ds = Math.abs(s - sf)
    if (dq > dr && dq > ds) q = -rr - s
    else if (dr > ds) rr = -q - s
    return [q, rr]
  }
  const parent = (x: number, z: number) => {
    const [q, rr] = axial(x, z, R)
    const i = g.index(q, rr)
    return i >= 0 ? tileOf.get(i) : undefined
  }
  const soft = softTile
  const seats = seatTiles(h, w)
  const seated = (t: Tile | undefined): boolean => !!t && seats.has(t.i)
  /** A small hex's height as a part of tile p: p's top, or a blend of the tiles within reach. */
  const heightOf = (x: number, z: number, p: Tile): number => {
    if (!soft(p)) return p.top
    let sum = 0
    let wt = 0
    const pq = g.q[p.i]!
    const pr = g.r[p.i]!
    for (let dq = -1; dq <= 1; dq++)
      for (let dr = -1; dr <= 1; dr++) {
        if (Math.abs(dq + dr) > 1) continue
        const i = g.index(pq + dq, pr + dr)
        const n = i >= 0 ? tileOf.get(i) : undefined
        const cx = SQ3 * (pq + dq + (pr + dr) / 2) * R
        const cz = 1.5 * (pr + dr) * R
        const d = Math.hypot(x - cx, z - cz) / R
        const k = Math.max(0, 1.25 - d) ** 2
        if (k <= 0) continue
        // the sea pulls the land down toward the shore; water tiles count at their bank
        const y = !n ? 0.2 : n.ground === "water" ? Math.max(n.top + 0.45, 0.2) : n.top
        sum += y * k
        wt += k
      }
    const y = wt ? sum / wt : p.top
    return Math.max(0.35, Math.round(y / step) * step)
  }
  const cells = new Map<string, Cell>()
  let minQ = 1e9
  let maxQ = -1e9
  let minR = 1e9
  let maxR = -1e9
  for (const t of w.tiles) {
    const [q, rr] = axial(t.x, t.z, r)
    minQ = Math.min(minQ, q - sub - 1)
    maxQ = Math.max(maxQ, q + sub + 1)
    minR = Math.min(minR, rr - sub - 1)
    maxR = Math.max(maxR, rr + sub + 1)
  }
  for (let rr = minR; rr <= maxR; rr++)
    for (let q = minQ; q <= maxQ; q++) {
      const x = SQ3 * (q + rr / 2) * r
      const z = 1.5 * rr * r
      const p = parent(x, z)
      if (!p) continue
      cells.set(`${q},${rr}`, { x, z, y: seated(p) ? p.top : heightOf(x, z, p), t: p })
    }
  // a soft (nature) cell never stands above a flat neighbour cell (a road, a field, a building's tile): its
  // hexagon reaches over the tile edge, so a higher one would cover the road strip there
  const STEP6: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ]
  for (const [key, c] of cells) {
    if (!soft(c.t) || seated(c.t)) continue
    const [q, rr] = key.split(",").map(Number) as [number, number]
    for (const [sq, sr] of STEP6) {
      const n = cells.get(`${q + sq},${rr + sr}`)
      if (n && (!soft(n.t) || seated(n.t)) && n.t.ground !== "water" && n.y < c.y) c.y = n.y
    }
  }
  // A plinth under every building and wall (the backstop of the seats above): a small hex of an unseated
  // tile its outline reaches over, a terrace's snap off its base (a meadow's cell a step's third lower),
  // is raised to the base, so the ground is under all of it
  const plinth = new Map<string, number>()
  for (const pc of w.pieces) {
    if (!isBuildingPiece(pc.piece)) continue
    const s = pieceFootprint(pc)
    if (!s) continue
    const [q0, r0] = axial(s.cx, s.cz, r)
    const reach = Math.ceil(s.r / (r * 1.5)) + 1
    for (let dq = -reach; dq <= reach; dq++)
      for (let dr = -reach; dr <= reach; dr++) {
        const key = `${q0 + dq},${r0 + dr}`
        const c = cells.get(key)
        if (!c || c.t.ground === "water" || solidDistance(s, c.x, c.z) > r) continue
        // (a cut small hex's part on an unseated tile beside a seat takes it too, below)
        if (Math.abs(c.y - pc.y) <= PLINTH || seated(c.t)) plinth.set(key, pc.y)
        if (!seated(c.t) && Math.abs(c.y - pc.y) <= PLINTH) c.y = pc.y
      }
  }
  // The cells also on a dense (q, r) grid over the island's box, for the lookups below and `heightAt`.
  const cols = Math.max(0, maxQ - minQ + 1)
  const rows = Math.max(0, maxR - minR + 1)
  const slot = (q: number, rr: number) =>
    q < minQ || q > maxQ || rr < minR || rr > maxR ? -1 : (rr - minR) * cols + (q - minQ)
  const heights = new Float32Array(cols * rows)
  const dense: (Cell | undefined)[] = new Array(cols * rows)
  for (const [key, c] of cells) {
    const [q, rr] = key.split(",").map(Number) as [number, number]
    const k = slot(q, rr)
    dense[k] = c
    heights[k] = c.y
  }
  // Every small hex as drawn: whole, or (where it straddles a seat's edge) cut along the tile edges into
  // the part on each tile, a seat's part at the seat's top and the rest at that tile's own height there.
  const e = (R * SQ3) / 2
  const pieces: Piece[] = []
  const split = new Set<string>()
  /** Off-parent heights of split cells, by `key|tile`. */
  const offParent = new Map<string, number>()
  const hexAround = (x: number, z: number, rad: number) => {
    const out: number[] = []
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 30)
      out.push(x + Math.cos(a) * rad, z + Math.sin(a) * rad)
    }
    return out
  }
  for (const [key, c] of cells) {
    const p = c.t
    // how far inside its tile the small hex's centre is: a whole small hex fits when it is a radius in
    const inside = e - Math.max(...NORMALS.map(([nx, nz]) => (c.x - p.x) * nx + (c.z - p.z) * nz))
    const others = inside < r ? [...g.neighbours(p.i)].filter((j) => j >= 0) : []
    const touches = others
      .map((j) => tileOf.get(j))
      .filter((t): t is Tile => !!t)
      .filter((t) => {
        const d = Math.max(...NORMALS.map(([nx, nz]) => (c.x - t.x) * nx + (c.z - t.z) * nz))
        return d - e < r
      })
    if (!seated(p) && !touches.some((t) => seated(t))) {
      pieces.push({ poly: hexAround(c.x, c.z, r), y: c.y, t: p, key })
      continue
    }
    split.add(key)
    const cell = hexAround(c.x, c.z, r)
    for (const t of [p, ...touches]) {
      const poly = clipToHex(cell, t.x, t.z, R)
      if (poly.length < 6 || area2(poly) < 1e-4) continue
      let y: number
      if (seated(t)) y = t.top
      else if (t === p) y = c.y
      else {
        const base = plinth.get(key)
        const own = heightOf(c.x, c.z, t)
        y = base !== undefined && t.ground !== "water" && Math.abs(own - base) <= PLINTH ? base : own
        offParent.set(`${key}|${t.i}`, y)
      }
      pieces.push({ poly, y, t, key })
    }
  }
  // the seats and the cut small hexes as plain data, and the answer read from it
  let tq0 = 1e9
  let tq1 = -1e9
  let tr0 = 1e9
  let tr1 = -1e9
  for (const t of w.tiles) {
    tq0 = Math.min(tq0, g.q[t.i]!)
    tq1 = Math.max(tq1, g.q[t.i]!)
    tr0 = Math.min(tr0, g.r[t.i]!)
    tr1 = Math.max(tr1, g.r[t.i]!)
  }
  const tcols = Math.max(0, tq1 - tq0 + 1)
  const trows = Math.max(0, tr1 - tr0 + 1)
  const seatY = new Float32Array(tcols * trows).fill(Number.NaN)
  const tslot = (t: Tile) => (g.r[t.i]! - tr0) * tcols + (g.q[t.i]! - tq0)
  for (const t of w.tiles) if (seated(t)) seatY[tslot(t)] = t.top
  const parentOf = new Int32Array(cols * rows).fill(-1)
  const splitOf = new Uint8Array(cols * rows)
  const offCell: number[] = []
  const offTile: number[] = []
  const offY: number[] = []
  for (const [key, c] of cells) {
    const [q, rr] = key.split(",").map(Number) as [number, number]
    const k = slot(q, rr)
    parentOf[k] = tslot(c.t)
    if (split.has(key)) splitOf[k] = 1
  }
  for (const [key, y] of offParent) {
    const [cell, tile] = key.split("|") as [string, string]
    const [q, rr] = cell.split(",").map(Number) as [number, number]
    const t = tileOf.get(Number(tile))!
    offCell.push(slot(q, rr))
    offTile.push(tslot(t))
    offY.push(y)
  }
  const data: HexHeights = {
    size: r,
    q0: minQ,
    r0: minR,
    cols,
    rows,
    y: heights,
    seat: { size: R, q0: tq0, r0: tr0, cols: tcols, rows: trows, y: seatY },
    parent: parentOf,
    split: splitOf,
    off: { cell: Int32Array.from(offCell), tile: Int32Array.from(offTile), y: Float32Array.from(offY) },
  }
  const read = heightsReader(data)
  const seatAt = (x: number, z: number): Tile | undefined => {
    const t = parent(x, z)
    return t && seated(t) ? t : undefined
  }
  const heightAt = read
  return {
    heightAt,
    seatAt,
    heights: data,
    cells,
    pieces,
    split,
    r,
    tileAt: parent,
  }
}

/** The fine ground's heights alone (no mesh): what the fine mesh stands at, for walkers and tests. */
export function hexGroundHeights(h: HexIsland, w: HexWorld, sub = 3): HexGroundHeights {
  const m = fineModel(h, w, sub)
  return { heightAt: m.heightAt, seatAt: m.seatAt, heights: m.heights }
}

/**
 * The ground on a finer hex grid (`sub` small hexes across a tile): every small hex takes the top of the
 * tile under it where that tile must stay flat (buildings, roads, fields, rock, water), else a height
 * blended from the tiles round it and snapped to small steps, so hills rise in many low terraces and land
 * falls toward the shore. A seated tile (a road, a building, a scene, a field) is one flat top out to its
 * own hex edges (the small hexes over its edge are cut there). Walls stand only where a top is higher
 * than the ground beside it.
 */
export function hexGroundFine(
  h: HexIsland,
  w: HexWorld,
  pal: GroundPalette,
  sub = 3,
  base = -2.5,
  /** Paint every small hex its own colour (groundPaint); off, the plain tile colours (for comparisons). */
  paint = true,
): HexFineGround {
  const seed = h.spec.seed
  const m = fineModel(h, w, sub)
  const { cells, pieces, split, r } = m
  const heightAt = m.heightAt
  // Every top is 18 vertices, and walls come 6 at a time: the buffers start at twice the tops and grow.
  let pos = new Float32Array(pieces.length * 18 * 3 * 2)
  let col = new Float32Array(pos.length)
  let n = 0
  const grow = (a: Float32Array) => {
    const b = new Float32Array(a.length * 2)
    b.set(a)
    return b
  }
  const put = (x: number, y: number, z: number, c: RGB, k: number) => {
    if (n + 3 > pos.length) {
      pos = grow(pos)
      col = grow(col)
    }
    pos[n] = x
    pos[n + 1] = y
    pos[n + 2] = z
    col[n] = (c[0] * k) / 255
    col[n + 1] = (c[1] * k) / 255
    col[n + 2] = (c[2] * k) / 255
    n += 3
  }
  const tone = (x: number, z: number) => 0.93 + 0.12 * (fbm(seed + 77, x / 22, z / 22, 2) * 0.5 + 0.5)
  // neighbour across edge k (normal at 60°·k in x/z): axial step
  const STEP: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ]
  const painted = paint ? groundPaint(h, w, pal, cells, seed) : new Map<string, RGB>()
  /** The ground just outside a top's edge a→b (its lowest along the edge), or the base off the ground. */
  const floorBeside = (ax: number, az: number, bx: number, bz: number): number => {
    const dx = bx - ax
    const dz = bz - az
    const l = Math.hypot(dx, dz) || 1
    // outward for a counter-clockwise top (x right, z down the screen: the corners run with the angle)
    const ox = (dz / l) * 0.01
    const oz = (-dx / l) * 0.01
    let floor = Number.POSITIVE_INFINITY
    for (const f of [0.15, 0.5, 0.85]) {
      const x = ax + dx * f + ox
      const z = az + dz * f + oz
      floor = Math.min(floor, onGround(x, z) ? heightAt(x, z) : base)
    }
    return floor
  }
  /** Whether a point has ground drawn over it (a small hex of a tile that exists). */
  const onGround = (x: number, z: number): boolean => {
    const qf = ((SQ3 / 3) * x - z / 3) / r
    const rf = ((2 / 3) * z) / r
    const sf = -qf - rf
    let q = Math.round(qf)
    let rr = Math.round(rf)
    const s = Math.round(sf)
    const dq = Math.abs(q - qf)
    const dr = Math.abs(rr - rf)
    const ds = Math.abs(s - sf)
    if (dq > dr && dq > ds) q = -rr - s
    else if (dr > ds) rr = -q - s
    const key = `${q},${rr}`
    if (!cells.has(key)) return false
    return !split.has(key) || m.tileAt(x, z) !== undefined
  }
  for (const pc of pieces) {
    const c = cells.get(pc.key)!
    const t = pc.t
    const own = t === c.t
    const top = (own ? painted.get(pc.key) : undefined) ?? pal.top[t.ground] ?? pal.top.grass!
    // grass on a soft tile tints a little lighter as it climbs
    const lift = softTile(t) ? 1 + Math.min(0.08, (pc.y - t.top) * 0.03) : 1
    const P = pc.poly
    const k6 = P.length / 2
    const cx = P.reduce((s, v, i) => (i % 2 ? s : s + v), 0) / k6
    const cz = P.reduce((s, v, i) => (i % 2 ? s + v : s), 0) / k6
    const centre = tone(cx, cz) * lift
    for (let k = 0; k < k6; k++) {
      const ax = P[k * 2]!
      const az = P[k * 2 + 1]!
      const bx = P[((k + 1) % k6) * 2]!
      const bz = P[((k + 1) % k6) * 2 + 1]!
      put(cx, pc.y, cz, top, centre)
      put(bx, pc.y, bz, top, tone(bx, bz) * lift)
      put(ax, pc.y, az, top, tone(ax, az) * lift)
    }
    const side =
      t.ground === "rock" || t.ground === "cliff" ? (pal.side[t.ground] ?? pal.sideLand) : pal.sideLand
    const whole = !split.has(pc.key)
    const [q, rr] = whole ? (pc.key.split(",").map(Number) as [number, number]) : [0, 0]
    for (let k = 0; k < k6; k++) {
      const ax = P[k * 2]!
      const az = P[k * 2 + 1]!
      const bx = P[((k + 1) % k6) * 2]!
      const bz = P[((k + 1) % k6) * 2 + 1]!
      let floor: number
      if (whole) {
        // a whole small hex beside a whole one: its height (as before); beside a cut one, what is there
        const [sq, sr] = STEP[k]!
        const nk = `${q + sq},${rr + sr}`
        const nb = cells.get(nk)
        floor = !nb ? base : split.has(nk) ? floorBeside(ax, az, bx, bz) : nb.y
      } else floor = floorBeside(ax, az, bx, bz)
      if (floor >= pc.y - 0.01) continue
      put(ax, pc.y, az, side, strata(pc.y))
      put(bx, pc.y, bz, side, strata(pc.y))
      put(bx, floor, bz, side, strata(floor))
      put(ax, pc.y, az, side, strata(pc.y))
      put(bx, floor, bz, side, strata(floor))
      put(ax, floor, az, side, strata(floor))
    }
  }
  return {
    position: pos.slice(0, n),
    color: col.slice(0, n),
    heightAt,
    count: cells.size,
    heights: m.heights,
  }
}
