import { BufferGeometry, Color, Float32BufferAttribute } from "three"

/**
 * A tiny low-poly mesh builder for the links' stone and timber (bridges, docks): flat-shaded faces
 * with a colour each (vertex colours, so a whole layer is one material and one draw call). Faces
 * are given in any winding with the outward direction they should face; the builder turns them.
 */
export type V3 = readonly [x: number, y: number, z: number]

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const tint = new Color()

export class Shapes {
  private positions: number[] = []
  private colours: number[] = []

  /** A triangle facing `out`. `colour` is a hex sRGB value; `shade` (0…1+) darkens or lightens it. */
  tri(a: V3, b: V3, c: V3, out: V3, colour: number, shade = 1): void {
    const flip = dot(cross(sub(b, a), sub(c, a)), out) < 0
    const [p, q] = flip ? [c, b] : [b, c]
    tint.setHex(colour).multiplyScalar(shade)
    for (const v of [a, p, q]) {
      this.positions.push(v[0], v[1], v[2])
      this.colours.push(tint.r, tint.g, tint.b)
    }
  }

  /** A quad (a, b, c, d round its edge) facing `out`. */
  quad(a: V3, b: V3, c: V3, d: V3, out: V3, colour: number, shade = 1): void {
    this.tri(a, b, c, out, colour, shade)
    this.tri(a, c, d, out, colour, shade)
  }

  /**
   * An upright box turned `yaw` about the y axis (radians, 0 = long side along +z) round `at`
   * (its centre), half sizes `half` (x across, y up, z along), without its bottom.
   */
  box(at: V3, half: V3, yaw: number, colour: number, shade = 1): void {
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
    this.quad(p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1), [0, 1, 0], colour, shade * 1.12)
    this.quad(p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1), right, colour, shade * 0.92)
    this.quad(p(-1, -1, -1), p(-1, 1, -1), p(-1, 1, 1), p(-1, -1, 1), neg(right), colour, shade * 0.92)
    this.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), along, colour, shade * 0.82)
    this.quad(p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), neg(along), colour, shade * 0.82)
  }

  get triangles(): number {
    return this.positions.length / 9
  }

  /** The finished geometry: non-indexed, flat normals. */
  geometry(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute("color", new Float32BufferAttribute(this.colours, 3))
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
