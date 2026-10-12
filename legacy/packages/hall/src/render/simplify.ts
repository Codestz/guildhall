import { BufferAttribute, BufferGeometry } from "three"

/**
 * Coarse copies of static pieces for the far tier (render/tiers.ts), made at load by meshoptimizer
 * as the crowd's mesh levels are (scene/crowd/simplify.ts): only the index changes, so a coarse
 * copy draws the piece's own vertices with their UVs and normals.
 *
 * The packs are flat-shaded low poly, every face its own vertices: a plain simplify sees every
 * hard edge as a seam and can hardly take a triangle off (a house keeps ~80% at a fifth of a unit).
 * `Permissive` lets an edge collapse across those seams while the surface moves no more than the
 * error. But the packs colour by UV (a palette texture), so a collapse across a UV seam repaints a
 * face: a far house's wall turned the roof's colour. The UVs are weighed into the error (UV_WEIGHT),
 * which keeps colour seams where they are: a house keeps ~60% at a tenth of a unit, a tree ~60%.
 */

/** What this module needs of meshoptimizer's simplifier (its `MeshoptSimplifier`). */
export interface Simplifier {
  simplifyWithAttributes(
    indices: Uint32Array,
    positions: Float32Array,
    positionsStride: number,
    attributes: Float32Array,
    attributesStride: number,
    weights: number[],
    lock: Uint8Array | null,
    target: number,
    error: number,
    flags?: ("ErrorAbsolute" | "Permissive")[],
  ): [Uint32Array, number]
}

/**
 * How much a UV's move counts against the error, per unit of UV: a palette cell is ~0.06 across,
 * so moving a corner into the next colour costs more than any far tier allows.
 */
const UV_WEIGHT = 10

let loading: Promise<Simplifier> | undefined

/** meshoptimizer's simplifier, loaded once (its own chunk, ~20 KB gzipped). */
export function loadSimplifier(): Promise<Simplifier> {
  loading ??= import("meshoptimizer/simplifier").then(async ({ MeshoptSimplifier }) => {
    await MeshoptSimplifier.ready
    return MeshoptSimplifier
  })
  return loading
}

/** A coarse copy is kept only if it draws at most this share of the piece's triangles. */
const WORTH = 0.75

/**
 * `geometry` with fewer triangles, its surface moved at most `error` (in its own units): the
 * vertices it still draws, with all their attributes, under a new index. Null when it would not
 * save a quarter, or the geometry isn't indexed or isn't plain (interleaved) arrays.
 */
export function coarser(
  simplifier: Simplifier,
  geometry: BufferGeometry,
  error: number,
): BufferGeometry | null {
  const index = geometry.index
  const position = geometry.getAttribute("position")
  if (!index || !position) return null
  if (Object.values(geometry.attributes).some((attribute) => "isInterleavedBufferAttribute" in attribute))
    return null
  const positions = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    positions[i * 3] = position.getX(i)
    positions[i * 3 + 1] = position.getY(i)
    positions[i * 3 + 2] = position.getZ(i)
  }
  const uv = geometry.getAttribute("uv")
  const uvs = new Float32Array(position.count * 2)
  if (uv)
    for (let i = 0; i < position.count; i++) {
      uvs[i * 2] = uv.getX(i)
      uvs[i * 2 + 1] = uv.getY(i)
    }
  const indices = Uint32Array.from(index.array as ArrayLike<number>)
  const [kept] = simplifier.simplifyWithAttributes(
    indices,
    positions,
    3,
    uvs,
    2,
    [UV_WEIGHT, UV_WEIGHT],
    null,
    0,
    error,
    ["ErrorAbsolute", "Permissive"],
  )
  if (kept.length > indices.length * WORTH) return null
  return compact(geometry, kept)
}

/** The vertices `indices` draw, copied out of `geometry` into a new one, re-indexed. */
function compact(geometry: BufferGeometry, indices: Uint32Array): BufferGeometry {
  const remap = new Map<number, number>()
  const order: number[] = []
  const index = new Uint32Array(indices.length)
  indices.forEach((vertex, i) => {
    let to = remap.get(vertex)
    if (to === undefined) {
      to = order.length
      remap.set(vertex, to)
      order.push(vertex)
    }
    index[i] = to
  })
  const copy = new BufferGeometry()
  for (const [name, source] of Object.entries(geometry.attributes)) {
    const size = source.itemSize
    const from = source.array as Float32Array
    const array = new (from.constructor as Float32ArrayConstructor)(order.length * size)
    order.forEach((vertex, i) => {
      for (let k = 0; k < size; k++) array[i * size + k] = from[vertex * size + k] ?? 0
    })
    copy.setAttribute(name, new BufferAttribute(array, size, source.normalized))
  }
  copy.setIndex(new BufferAttribute(order.length <= 0xffff ? Uint16Array.from(index) : index, 1))
  return copy
}
