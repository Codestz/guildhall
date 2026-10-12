/**
 * What `createVertexMesh` computes from its arrays before it uploads them, three-free so a worker can do
 * it: the colours from sRGB to linear (as three's `Color.setRGB(…, SRGBColorSpace)`) and the flat
 * normals of the triangles (as `computeVertexNormals` on a non-indexed geometry).
 */

/** Linear-sRGB `c` (0–1) from sRGB, the IEC 61966-2-1 curve three uses. */
export const srgbToLinear = (c: number): number =>
  c < 0.04045 ? c * 0.0773993808 : (c * 0.9478672986 + 0.0521327014) ** 2.4

const CURVE_STEPS = 4096
const CURVE = Float64Array.from({ length: CURVE_STEPS + 1 }, (_, k) => srgbToLinear(k / CURVE_STEPS))

export interface VertexMeshData {
  position: Float32Array
  /** Linear colours. */
  color: Float32Array
  normal: Float32Array
}

/** Triangle `position`s and their sRGB colours, ready to upload (`createVertexMesh(stage, data)`). */
export function vertexMeshData(position: Float32Array, srgb: Float32Array): VertexMeshData {
  const color = new Float32Array(srgb.length)
  // A ground has a million channels: the curve is read from a table (exact to ~1e-8 between its steps).
  for (let i = 0; i < srgb.length; i++) {
    const c = srgb[i] as number
    if (c < 0 || c >= 1) color[i] = srgbToLinear(c)
    else {
      const f = c * CURVE_STEPS
      const k = Math.floor(f)
      const a = CURVE[k] as number
      color[i] = a + ((CURVE[k + 1] as number) - a) * (f - k)
    }
  }
  const normal = new Float32Array(position.length)
  const p = position
  for (let i = 0; i + 8 < p.length; i += 9) {
    // (c - b) × (a - b), as three's computeVertexNormals
    const ax = p[i]! - p[i + 3]!
    const ay = p[i + 1]! - p[i + 4]!
    const az = p[i + 2]! - p[i + 5]!
    const cx = p[i + 6]! - p[i + 3]!
    const cy = p[i + 7]! - p[i + 4]!
    const cz = p[i + 8]! - p[i + 5]!
    let nx = cy * az - cz * ay
    let ny = cz * ax - cx * az
    let nz = cx * ay - cy * ax
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    for (let k = 0; k < 9; k += 3) {
      normal[i + k] = nx
      normal[i + k + 1] = ny
      normal[i + k + 2] = nz
    }
  }
  return { position, color, normal }
}
