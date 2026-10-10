import { BufferGeometry, Color, Float32BufferAttribute } from "three"

/**
 * A tiny low-poly mesh builder for the links' stone and timber (bridges, docks): flat-shaded faces
 * painted one of two ways, never both in one geometry, so a whole layer is one material and one draw
 * call. A hex sRGB colour is a vertex colour (the docks' timber); a `Swatch` is a texel of the land
 * pack's palette (the bridges' stone, in the island's own material, so light and shadow match).
 * Faces are given in any winding with the outward direction they should face; the builder turns them.
 */
export type V3 = readonly [x: number, y: number, z: number]

/**
 * A colour of the land pack's palette texture (the hexagon pack's 8 × 4 swatches, each a gradient
 * from light at its top to dark at its foot): the column and row, and how far down the gradient
 * (0 the light end, 1 the dark).
 */
export interface Swatch {
  col: number
  row: number
  t: number
}
export type Paint = number | Swatch

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const tint = new Color()
/** Keeps a swatch's gradient off its edges, where the neighbouring swatch bleeds in. */
const clamp = (t: number): number => Math.min(0.95, Math.max(0.05, t))

export class Shapes {
  private positions: number[] = []
  private colours: number[] = []
  private uvs: number[] = []

  /**
   * A triangle facing `out`. `shade` (0…1+) darkens or lightens it: a vertex colour's brightness, or how
   * far down its swatch's gradient the face is taken (lighter is further up).
   */
  tri(a: V3, b: V3, c: V3, out: V3, paint: Paint, shade = 1): void {
    const flip = dot(cross(sub(b, a), sub(c, a)), out) < 0
    const [p, q] = flip ? [c, b] : [b, c]
    for (const v of [a, p, q]) this.positions.push(v[0], v[1], v[2])
    if (typeof paint === "number") {
      tint.setHex(paint).multiplyScalar(shade)
      for (let i = 0; i < 3; i++) this.colours.push(tint.r, tint.g, tint.b)
    } else {
      const u = (paint.col + 0.5) / 8
      const v = (paint.row + clamp(paint.t - (shade - 1) * 1.2)) / 4
      for (let i = 0; i < 3; i++) this.uvs.push(u, v)
    }
  }

  /** A quad (a, b, c, d round its edge) facing `out`. */
  quad(a: V3, b: V3, c: V3, d: V3, out: V3, paint: Paint, shade = 1): void {
    this.tri(a, b, c, out, paint, shade)
    this.tri(a, c, d, out, paint, shade)
  }

  /**
   * An upright box turned `yaw` about the y axis (radians, 0 = long side along +z) round `at`
   * (its centre), half sizes `half` (x across, y up, z along), without its bottom.
   */
  box(at: V3, half: V3, yaw: number, paint: Paint, shade = 1): void {
    const s = Math.sin(yaw)
    const c = Math.cos(yaw)
    // x across (right = (c, -s)), z along ((s, c)).
    const p = (x: number, y: number, z: number): V3 => [
      at[0] + x * c * half[0] + z * s * half[2],
      at[1] + y * half[1],
      at[2] - x * s * half[0] + z * c * half[2],
    ]
    const right: V3 = [c, 0, -s]
    const along: V3 = [s, 0, c]
    const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]]
    this.quad(p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1), [0, 1, 0], paint, shade * 1.12)
    this.quad(p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1), right, paint, shade * 0.92)
    this.quad(p(-1, -1, -1), p(-1, 1, -1), p(-1, 1, 1), p(-1, -1, 1), neg(right), paint, shade * 0.92)
    this.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), along, paint, shade * 0.82)
    this.quad(p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), neg(along), paint, shade * 0.82)
  }

  get triangles(): number {
    return this.positions.length / 9
  }

  /** The finished geometry: non-indexed, flat normals, with colours or palette coordinates. */
  geometry(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3))
    if (this.colours.length > 0) geometry.setAttribute("color", new Float32BufferAttribute(this.colours, 3))
    if (this.uvs.length > 0) geometry.setAttribute("uv", new Float32BufferAttribute(this.uvs, 2))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    return geometry
  }
}

/** A cheap stable 0…1 from two integers: the stones' and planks' shade variation. */
export function jitter(i: number, j = 0): number {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return x - Math.floor(x)
}
