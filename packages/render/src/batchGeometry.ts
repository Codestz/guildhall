/**
 * A piece as one batch geometry (ADR 007): every mesh under it merged, its node transforms baked in,
 * and its attributes in the one format the batch holds. Library GLBs differ (quantized int16 or float
 * positions, int8 or float normals, rgb or rgba byte colours, `_ao` or none), and a BatchedMesh takes
 * the format of its first geometry for all of them, so every geometry is converted on the way in.
 */
import {
  BufferAttribute,
  BufferGeometry,
  type BufferGeometry as Geometry,
  Matrix3,
  Matrix4,
  Mesh,
  type Object3D,
  Vector3,
} from "three"
import { recolour } from "./tint.ts"

/** `_SHADE` neutral (the swatch's own lightness) and `_AO` unoccluded, for geometry without them. */
const SHADE_NEUTRAL = 128
const AO_NONE = 255

/**
 * The batch's vertex format: float positions and normals, byte rgb colour (normalized), and the
 * palette bytes `_swatch` (raw), `_shade` and `_ao` (normalized) kept for a later GPU re-tint (ADR 008),
 * and `_glow` (normalized): 1 on a light source's glass or flame, which glows by night (night/glow.ts).
 */
export const BATCH_ATTRIBUTES = {
  position: { itemSize: 3, normalized: false, array: Float32Array },
  normal: { itemSize: 3, normalized: false, array: Float32Array },
  color: { itemSize: 3, normalized: true, array: Uint8Array },
  _swatch: { itemSize: 1, normalized: false, array: Uint8Array },
  _shade: { itemSize: 1, normalized: true, array: Uint8Array },
  _ao: { itemSize: 1, normalized: true, array: Uint8Array },
  _glow: { itemSize: 1, normalized: true, array: Uint8Array },
} as const

const byte = (value: number, normalized: boolean) =>
  Math.min(255, Math.max(0, Math.round(normalized ? value * 255 : value)))

/**
 * Every mesh under `root`, re-tinted by `swatchMap` (cached variants, ADR 008) and merged into one
 * indexed geometry in the batch format, in `root`'s space. A mesh without normals gets computed
 * ones, without colour white, without palette bytes neutral ones. The result is new and the
 * caller's: the sources are not touched. Vertices whose swatch is in `glow` (the piece's light-source
 * swatches, GLOW_SWATCHES) get `_glow` 1; a source already in the batch format keeps its own.
 */
export function batchGeometry(
  root: Object3D,
  swatchMap: Record<number, number> = {},
  glow: readonly number[] = [],
): BufferGeometry {
  root.updateWorldMatrix(true, true)
  const toRoot = new Matrix4().copy(root.matrixWorld).invert()
  const parts: { geometry: Geometry; matrix: Matrix4 }[] = []
  root.traverse((node) => {
    if (node instanceof Mesh && node.geometry.getAttribute("position"))
      parts.push({
        geometry: recolour(node.geometry, swatchMap),
        matrix: new Matrix4().multiplyMatrices(toRoot, node.matrixWorld),
      })
  })

  let vertices = 0
  let indices = 0
  for (const { geometry } of parts) {
    const count = geometry.getAttribute("position").count
    vertices += count
    indices += geometry.index?.count ?? count
  }
  const out = {
    position: new Float32Array(vertices * 3),
    normal: new Float32Array(vertices * 3),
    color: new Uint8Array(vertices * 3),
    _swatch: new Uint8Array(vertices),
    _shade: new Uint8Array(vertices).fill(SHADE_NEUTRAL),
    _ao: new Uint8Array(vertices).fill(AO_NONE),
    _glow: new Uint8Array(vertices),
  }
  const glowing = new Set(glow)
  const index = new Uint32Array(indices)

  const p = new Vector3()
  const normalMatrix = new Matrix3()
  let base = 0
  let at = 0
  for (const { geometry: source, matrix } of parts) {
    let geometry = source
    if (!geometry.getAttribute("normal")) {
      geometry = source.clone()
      geometry.computeVertexNormals()
    }
    normalMatrix.getNormalMatrix(matrix)
    const position = geometry.getAttribute("position")
    const normal = geometry.getAttribute("normal")
    const colour = geometry.getAttribute("color")
    const swatch = geometry.getAttribute("_swatch")
    const shade = geometry.getAttribute("_shade")
    const ao = geometry.getAttribute("_ao")
    const lit = geometry.getAttribute("_glow")
    for (let v = 0; v < position.count; v++) {
      const o = base + v
      // getX/Y/Z read quantized attributes as the values they stand for.
      p.fromBufferAttribute(position, v)
        .applyMatrix4(matrix)
        .toArray(out.position, o * 3)
      p.fromBufferAttribute(normal, v)
        .applyMatrix3(normalMatrix)
        .normalize()
        .toArray(out.normal, o * 3)
      if (colour) {
        out.color[o * 3] = byte(colour.getX(v), true)
        out.color[o * 3 + 1] = byte(colour.getY(v), true)
        out.color[o * 3 + 2] = byte(colour.getZ(v), true)
      } else out.color.fill(255, o * 3, o * 3 + 3)
      if (swatch) out._swatch[o] = byte(swatch.getX(v), swatch.normalized)
      if (shade) out._shade[o] = byte(shade.getX(v), shade.normalized)
      if (ao) out._ao[o] = byte(ao.getX(v), ao.normalized)
      if (lit) out._glow[o] = byte(lit.getX(v), lit.normalized)
      if (glowing.has(out._swatch[o] as number)) out._glow[o] = 255
    }
    const sourceIndex = geometry.index
    const count = sourceIndex?.count ?? position.count
    // A mirroring transform flips the winding; swap two corners so faces still point out.
    const flip = matrix.determinant() < 0
    for (let i = 0; i < count; i++) {
      const corner = flip && i % 3 > 0 ? i + (i % 3 === 1 ? 1 : -1) : i
      index[at + i] = base + (sourceIndex ? sourceIndex.getX(corner) : corner)
    }
    base += position.count
    at += count
  }

  const merged = new BufferGeometry()
  for (const [name, f] of Object.entries(BATCH_ATTRIBUTES))
    merged.setAttribute(name, new BufferAttribute(out[name as keyof typeof out], f.itemSize, f.normalized))
  merged.setIndex(new BufferAttribute(index, 1))
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  merged.name = root.name
  return merged
}
