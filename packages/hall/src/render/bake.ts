import type { BufferGeometry, Matrix4 } from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

/** One placed copy of a piece: its geometry (shared between copies, never changed) and where it stands. */
export interface Placed {
  geometry: BufferGeometry
  matrix: Matrix4
}

/**
 * A static batch as one geometry, for WebGPU: every copy's geometry baked into the batch's space
 * by its matrix and merged. three's WebGPU backend has no multi-draw, so a BatchedMesh there costs
 * one draw call per visible instance (WebGPUBackend `draw`); this is one call for all of them, at
 * the price of per-instance culling. WebGL keeps its BatchedMesh (one multi-draw call, culled).
 *
 * `decorate` may add per-vertex attributes to a copy once it is baked (every copy must end up with
 * the same set, as mergeGeometries requires). Null when there is nothing to merge. The sources are
 * left as they were; the baked copies are freed.
 */
export function bakeStatic(
  placed: readonly Placed[],
  decorate?: (copy: BufferGeometry, at: Placed) => void,
): BufferGeometry | null {
  if (placed.length === 0) return null
  const copies = placed.map((at) => {
    const copy = at.geometry.clone().applyMatrix4(at.matrix)
    decorate?.(copy, at)
    return copy
  })
  const merged = mergeGeometries(copies)
  for (const copy of copies) copy.dispose()
  return merged
}
