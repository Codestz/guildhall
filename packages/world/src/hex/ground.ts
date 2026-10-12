/**
 * The hex island's ground as one soft mesh (decisions.md "Clean restart on hex": merge + soft coast).
 * Tiles of the same ground at the same height merge: their tops share colour at shared corners (one
 * smooth noise field, no per-tile jitter) and no rim or wall is drawn between them. A wall is drawn only
 * where a tile stands higher than its neighbour (a terrace step, a cliff). Where low land meets the sea
 * the edge becomes a sand slope running down under the water, so the coast reads as a beach, not a cut;
 * high land meets the sea as a cliff down to the island's base.
 */
import { fbm, hash2 } from "../geom/noise.ts"
import type { HexIsland } from "./island.ts"
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
}

/**
 * The ground on a finer hex grid (`sub` small hexes across a tile): every small hex takes the top of the
 * tile under it where that tile must stay flat (buildings, roads, fields, rock, water), else a height
 * blended from the tiles round it and snapped to small steps, so hills rise in many low terraces and land
 * falls toward the shore. Walls stand only where a small hex is higher than its neighbour.
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
  const g = h.grid
  const R = HEX_TILE_SIZE
  const r = R / sub
  const step = (w.step ?? 0.8) / 3
  const seed = h.spec.seed
  const tileOf = new Map<number, (typeof w.tiles)[number]>()
  for (const t of w.tiles) tileOf.set(t.i, t)
  const SQ3 = Math.sqrt(3)
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
  const soft = (t: (typeof w.tiles)[number]) =>
    SOFT.has(t.prefab) &&
    t.ground !== "water" &&
    t.ground !== "rock" &&
    t.ground !== "cliff" &&
    t.ground !== "paved"
  /** A small hex's height: the parent's, or a blend of the tiles within reach. */
  const heightOf = (x: number, z: number): number | null => {
    const p = parent(x, z)
    if (!p) return null
    if (!soft(p)) return p.top
    let sum = 0
    let wt = 0
    const [pq, pr] = axial(x, z, R)
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
      const y = heightOf(x, z)
      if (y === null) continue
      cells.set(`${q},${rr}`, { x, z, y, t: p })
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
    if (!soft(c.t)) continue
    const [q, rr] = key.split(",").map(Number) as [number, number]
    for (const [sq, sr] of STEP6) {
      const n = cells.get(`${q + sq},${rr + sr}`)
      if (n && !soft(n.t) && n.t.ground !== "water" && n.y < c.y) c.y = n.y
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
  const cellAt = (q: number, rr: number) => {
    const k = slot(q, rr)
    return k < 0 ? undefined : dense[k]
  }
  // Every top is 18 vertices, and walls come 6 at a time: the buffers start at twice the tops and grow.
  let pos = new Float32Array(cells.size * 18 * 3 * 2)
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
  const tones = new Float64Array(6)
  const corners: [number, number][] = []
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30)
    corners.push([Math.cos(a) * r, Math.sin(a) * r])
  }
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
  for (const [key, c] of cells) {
    const [q, rr] = key.split(",").map(Number) as [number, number]
    const top = painted.get(key) ?? pal.top[c.t.ground] ?? pal.top.grass!
    // grass on a soft tile tints a little lighter as it climbs
    const lift = soft(c.t) ? 1 + Math.min(0.08, (c.y - c.t.top) * 0.03) : 1
    const P = corners.map(([dx, dz]) => [c.x + dx, c.z + dz] as const)
    // each corner's tone once (a corner is shared by two of the fan's triangles)
    const centre = tone(c.x, c.z) * lift
    for (let k = 0; k < 6; k++) tones[k] = tone(P[k]![0], P[k]![1]) * lift
    for (let k = 0; k < 6; k++) {
      const a = P[k]!
      const b = P[(k + 1) % 6]!
      put(c.x, c.y, c.z, top, centre)
      put(b[0], c.y, b[1], top, tones[(k + 1) % 6]!)
      put(a[0], c.y, a[1], top, tones[k]!)
    }
    const side =
      c.t.ground === "rock" || c.t.ground === "cliff" ? (pal.side[c.t.ground] ?? pal.sideLand) : pal.sideLand
    for (let k = 0; k < 6; k++) {
      const [sq, sr] = STEP[k]!
      const nb = cellAt(q + sq, rr + sr)
      const floor = nb ? nb.y : base
      if (floor >= c.y - 0.01) continue
      const a = P[k]!
      const b = P[(k + 1) % 6]!
      put(a[0], c.y, a[1], side, strata(c.y))
      put(b[0], c.y, b[1], side, strata(c.y))
      put(b[0], floor, b[1], side, strata(floor))
      put(a[0], c.y, a[1], side, strata(c.y))
      put(b[0], floor, b[1], side, strata(floor))
      put(a[0], floor, a[1], side, strata(floor))
    }
  }
  const heightAt = (x: number, z: number): number => {
    const [q, rr] = axial(x, z, r)
    const k = slot(q, rr)
    return k < 0 ? 0 : (heights[k] as number)
  }
  return {
    position: pos.slice(0, n),
    color: col.slice(0, n),
    heightAt,
    count: cells.size,
    heights: { size: r, q0: minQ, r0: minR, cols, rows, y: heights },
  }
}
