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
      put(a[0], t.top, a[1], side, 1)
      put(b[0], t.top, b[1], side, 1)
      put(b[0], floor, b[1], side, 0.6)
      put(a[0], t.top, a[1], side, 1)
      put(b[0], floor, b[1], side, 0.6)
      put(a[0], floor, a[1], side, 0.6)
    }
  }
  return { position: new Float32Array(pos), color: new Float32Array(col) }
}
