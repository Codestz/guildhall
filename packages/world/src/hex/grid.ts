/**
 * The hex grid every hex world lives on (decisions.md "Clean restart on hex"): pointy-top hexes in axial
 * coordinates (q, r), the third cube coordinate s = -q - r implied. A map is a hexagon of tiles round the
 * origin, `radius` rings out, stored in a flat array; a tile's index, its neighbours and its centre are
 * plain arithmetic, so placement and connection are grid maths.
 */

export interface Hex {
  q: number
  r: number
}

/** The six neighbour steps, counter-clockwise from east. */
export const DIRS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

/** Steps between two hexes. */
export const hexDistance = (a: Hex, b: Hex): number =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2

const SQ3 = Math.sqrt(3)

/** A tile's centre in tile units (centre to corner = 1); x right, y down the screen / +z in the world. */
export const hexCentre = (h: Hex): [number, number] => [SQ3 * (h.q + h.r / 2), 1.5 * h.r]

/** The hex a point (tile units) falls in. */
export function hexAt(x: number, y: number): Hex {
  const qf = (SQ3 / 3) * x - y / 3
  const rf = (2 / 3) * y
  const sf = -qf - rf
  let q = Math.round(qf)
  let r = Math.round(rf)
  const s = Math.round(sf)
  const dq = Math.abs(q - qf)
  const dr = Math.abs(r - rf)
  const ds = Math.abs(s - sf)
  if (dq > dr && dq > ds) q = -r - s
  else if (dr > ds) r = -q - s
  return { q, r }
}

/** A hexagon-shaped map of tiles `radius` rings round the origin, as a flat indexed grid. */
export interface HexGrid {
  radius: number
  /** Number of tiles: 3r(r+1)+1. */
  size: number
  q: Int16Array
  r: Int16Array
  /** Tile index at (q, r), or -1 off the map. */
  index(q: number, r: number): number
  /** The (up to six) neighbours of tile i, as indices, in DIRS order (-1 off the map). */
  neighbours(i: number): Int32Array
  /** Steps from the origin. */
  ring(i: number): number
}

export function hexGrid(radius: number): HexGrid {
  const size = 3 * radius * (radius + 1) + 1
  const q = new Int16Array(size)
  const r = new Int16Array(size)
  const side = 2 * radius + 1
  const lookup = new Int32Array(side * side).fill(-1)
  let n = 0
  for (let rr = -radius; rr <= radius; rr++)
    for (let qq = -radius; qq <= radius; qq++) {
      if (Math.abs(qq + rr) > radius) continue
      q[n] = qq
      r[n] = rr
      lookup[(rr + radius) * side + qq + radius] = n
      n++
    }
  const index = (qq: number, rr: number): number => {
    if (Math.abs(qq) > radius || Math.abs(rr) > radius || Math.abs(qq + rr) > radius) return -1
    return lookup[(rr + radius) * side + qq + radius]!
  }
  const nb = new Int32Array(size * 6)
  for (let i = 0; i < size; i++)
    for (let d = 0; d < 6; d++) nb[i * 6 + d] = index(q[i]! + DIRS[d]!.q, r[i]! + DIRS[d]!.r)
  return {
    radius,
    size,
    q,
    r,
    index,
    neighbours: (i) => nb.subarray(i * 6, i * 6 + 6),
    ring: (i) => hexDistance({ q: q[i]!, r: r[i]! }, { q: 0, r: 0 }),
  }
}
