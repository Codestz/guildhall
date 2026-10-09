import { BatchedMesh, BufferGeometry, Float32BufferAttribute, type Material, Matrix4, Mesh } from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { Relief } from "../../world/gen/relief/index.ts"
import { type MeshArrays, reliefMesh } from "../../world/gen/relief/mesh.ts"
import { markGrowable } from "../growth/registry.ts"

/**
 * A relief as meshes (terrain v2 §6.1), on the island's own terms: the massifs' geometries
 * (world/gen/relief/mesh.ts, in world units, UV'd onto the land palette) drawn with `material`, the
 * land material's snow-line copy (snow.ts). WebGL: one BatchedMesh, one instance per massif, so the
 * growth film (`?grow`, scene/growth) rides each massif up like a land tile and a chunk can swap a
 * tier's geometry in place (`setGeometryIdAt`); WebGPU, which has no multi-draw: one merged mesh.
 *
 * Until world/chunks.ts lands each massif is one hex set at tier 0: the same `reliefMesh(relief,
 * cells, tier)` call a chunk will make, so nothing here changes then but the sets it is called with.
 */

export function reliefGeometry(arrays: MeshArrays): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(arrays.position, 3))
  geometry.setAttribute("normal", new Float32BufferAttribute(arrays.normal, 3))
  geometry.setAttribute("uv", new Float32BufferAttribute(arrays.uv, 2))
  geometry.computeBoundingSphere()
  return geometry
}

/** The relief's meshes: they cast and receive shadows (a ridge shades the valley behind it). */
export function reliefMeshes(relief: Relief, material: Material, merge: boolean): Mesh[] {
  const geometries = relief.massifs.map((massif) => reliefGeometry(reliefMesh(relief, massif.cells, 0)))
  if (geometries.length === 0) return []
  if (merge) {
    const merged = mergeGeometries(geometries)
    for (const geometry of geometries) geometry.dispose()
    if (!merged) return []
    const mesh = new Mesh(merged, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return [mesh]
  }
  // Each massif is built `lift` below its place and set up by its instance matrix: the growth film
  // sinks an instance by (DEPTH + its base height) × rise, so a massif whose base matrix holds its own
  // height sinks right out of sight, and rises out of the sea as the land under its middle does.
  const lifts = relief.massifs.map((massif) => Math.ceil(massif.height) + 1)
  let vertices = 0
  geometries.forEach((geometry, i) => {
    geometry.translate(0, -(lifts[i] as number), 0)
    vertices += geometry.getAttribute("position").count
  })
  const batch = new BatchedMesh(geometries.length, vertices, 0, material)
  const matrix = new Matrix4()
  geometries.forEach((geometry, i) => {
    const id = batch.addInstance(batch.addGeometry(geometry))
    batch.setMatrixAt(id, matrix.makeTranslation(0, lifts[i] as number, 0))
    const peak = relief.massifs[i]?.peaks[0]?.at ?? [0, 0]
    markGrowable(batch, id, "land", peak[0], peak[1])
    geometry.dispose()
  })
  batch.sortObjects = false
  batch.castShadow = true
  batch.receiveShadow = true
  batch.computeBoundingSphere()
  return [batch]
}
