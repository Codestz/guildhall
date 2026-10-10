import { type Cell, HEX_SCALE } from "../../lands.ts"
import type { Spot } from "../../layout.ts"

/**
 * The relief's ground: a triangular lattice whose vertices are the hex centres and corners (edge
 * `CIRCUM`, the hex's circumradius), each edge subdivided `RES` times. Its triangles never cross a
 * hex edge, so a massif's rim meets the neighbouring tiles exactly, and the coarser tiers (n = 2, 1)
 * are strict subsamples of the finest.
 *
 * A vertex is an integer pair (I, J) at a resolution n: x = (CIRCUM/n)·(I + J/2), z = (ROW/n)·J.
 * A cell's centre is J = line·n, I = ((3q − line)/2)·n; its corners are the centre plus n·CORNERS[k].
 */

/** The hex's circumradius (the lattice's edge at n = 1). */
export const CIRCUM = (HEX_SCALE * 2) / Math.sqrt(3)
/** Height of one lattice row at n = 1. */
export const ROW = HEX_SCALE
/** The finest resolution (tier 0): 1.44-unit spacing, 96 triangles a hex. */
export const RES = 4

/** Corner k (at 60°·k from the centre) as a lattice step at n = 1. */
export const CORNERS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
]

/** A vertex's world position at resolution n. */
export const pointOf = (i: number, j: number, n = RES): Spot => [(CIRCUM / n) * (i + j / 2), (ROW / n) * j]

/**
 * The one or two triangles of a hex's sector at (a, b) (a, b ≥ 0, a + b < n), each as three (a, b)
 * pairs: the one pointing out (a, b), (a + 1, b), (a, b + 1), and, inside the sector, the one back to it.
 */
export function sectorTriangles(n: number, a: number, b: number): [number, number][][] {
  const out: [number, number][][] = [
    [
      [a, b],
      [a + 1, b],
      [a, b + 1],
    ],
  ]
  if (a + b < n - 1)
    out.push([
      [a + 1, b],
      [a + 1, b + 1],
      [a, b + 1],
    ])
  return out
}

/** A cell's centre as a lattice vertex at resolution n. */
export const centreOf = ([q, line]: Cell, n = RES): readonly [number, number] => [
  ((3 * q - line) / 2) * n,
  line * n,
]

/**
 * Heights on the lattice at RES over a bounding box; NaN where the massif owns no vertex. `heightAt`
 * is O(1): a lattice coordinate, the triangle it falls in, a barycentric blend.
 */
export class HeightGrid {
  readonly data: Float32Array

  constructor(
    readonly i0: number,
    readonly j0: number,
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Float32Array(width * height).fill(Number.NaN)
  }

  /** The array index of vertex (i, j), or -1 off the box. */
  index(i: number, j: number): number {
    const x = i - this.i0
    const y = j - this.j0
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? -1 : y * this.width + x
  }

  get(i: number, j: number): number {
    const at = this.index(i, j)
    return at < 0 ? Number.NaN : (this.data[at] as number)
  }

  set(i: number, j: number, value: number): void {
    const at = this.index(i, j)
    if (at >= 0) this.data[at] = value
  }

  /** The ground's height at a world point, or undefined where the massif owns no triangle there. */
  heightAt(x: number, z: number): number | undefined {
    const fj = (z * RES) / ROW
    const fi = (x * RES) / CIRCUM - fj / 2
    const i = Math.floor(fi)
    const j = Math.floor(fj)
    const u = fi - i
    const v = fj - j
    const a = this.get(i, j)
    if (u + v <= 1) {
      const b = this.get(i + 1, j)
      const c = this.get(i, j + 1)
      const h = a * (1 - u - v) + b * u + c * v
      return Number.isNaN(h) ? undefined : h
    }
    const b = this.get(i + 1, j + 1)
    const c = this.get(i + 1, j)
    const d = this.get(i, j + 1)
    const h = b * (u + v - 1) + c * (1 - v) + d * (1 - u)
    return Number.isNaN(h) ? undefined : h
  }
}
