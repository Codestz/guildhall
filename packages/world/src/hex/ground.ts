/**
 * The hex island's ground as one soft mesh (decisions.md "Clean restart on hex": merge + soft coast).
 * Tiles of the same ground at the same height merge: their tops share colour at shared corners (one
 * smooth noise field, no per-tile jitter) and no rim or wall is drawn between them. A wall is drawn only
 * where a tile stands higher than its neighbour (a terrace step, a cliff). Where low land meets the sea
 * the edge becomes a sand slope running down under the water, so the coast reads as a beach, not a cut;
 * high land meets the sea as a cliff down to the island's base.
 */
import { fbm } from "../geom/noise.ts"
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
): HexFineGround {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const r = R / sub
  const step = 0.37
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
  const cells = new Map<string, { x: number; z: number; y: number; t: (typeof w.tiles)[number] }>()
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
  const pos: number[] = []
  const col: number[] = []
  const tone = (x: number, z: number) => 0.93 + 0.12 * (fbm(seed + 77, x / 22, z / 22, 2) * 0.5 + 0.5)
  const put = (x: number, y: number, z: number, c: RGB, k: number) => {
    pos.push(x, y, z)
    col.push((c[0] * k) / 255, (c[1] * k) / 255, (c[2] * k) / 255)
  }
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
  for (const [key, c] of cells) {
    const [q, rr] = key.split(",").map(Number) as [number, number]
    const top = pal.top[c.t.ground] ?? pal.top.grass!
    // grass on a soft tile tints a little lighter as it climbs
    const lift = soft(c.t) ? 1 + Math.min(0.08, (c.y - c.t.top) * 0.03) : 1
    const P = corners.map(([dx, dz]) => [c.x + dx, c.z + dz] as const)
    for (let k = 0; k < 6; k++) {
      const a = P[k]!
      const b = P[(k + 1) % 6]!
      put(c.x, c.y, c.z, top, tone(c.x, c.z) * lift)
      put(b[0], c.y, b[1], top, tone(b[0], b[1]) * lift)
      put(a[0], c.y, a[1], top, tone(a[0], a[1]) * lift)
    }
    const side =
      c.t.ground === "rock" || c.t.ground === "cliff" ? (pal.side[c.t.ground] ?? pal.sideLand) : pal.sideLand
    for (let k = 0; k < 6; k++) {
      const [sq, sr] = STEP[k]!
      const n = cells.get(`${q + sq},${rr + sr}`)
      const floor = n ? n.y : base
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
    return cells.get(`${q},${rr}`)?.y ?? 0
  }
  return { position: new Float32Array(pos), color: new Float32Array(col), heightAt, count: cells.size }
}
