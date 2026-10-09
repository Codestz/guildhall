import { BufferGeometry, Float32BufferAttribute, type Material, Matrix4, type Mesh } from "three"
import { FAR } from "../../render/tiers.ts"
import type { Chunks } from "../../world/chunks.ts"
import type { Relief } from "../../world/gen/relief/index.ts"
import { type MeshArrays, reliefMesh } from "../../world/gen/relief/mesh.ts"
import { cellToWorld } from "../../world/lands.ts"
import { reliefCells } from "../../world/reliefChunks.ts"
import { markGrowable } from "../growth/registry.ts"
import { type TieredInstance, type TieredLayer, tiered, tieredBatch, tieredMerge } from "../tiers.ts"

/**
 * A relief as meshes (terrain v2 §6.1), on the island's own terms: the massifs' geometries
 * (world/gen/relief/mesh.ts, in world units, UV'd onto the land palette) drawn with `material`, the
 * land material's snow-line copy (snow.ts). The relief is cut by the island's regions
 * (world/reliefChunks.ts) and tiered with them (scene/tiers.ts): a region draws its massif hexes in
 * full (the mesh's tier 0) or, far out, as the mesh's tier 2 (a lattice of hex corners and centres, the
 * hybrid's stairs kept), both built once up front and swapped in place. WebGL: one BatchedMesh, one
 * instance per region, so the growth film (`?grow`, scene/growth) rides each region up like a land
 * tile; WebGPU, which has no multi-draw: one merged mesh per region and tier.
 */

/**
 * Where the relief goes far, as a share of the land's own threshold (render/tiers.ts FAR_BELOW).
 * Its coarse copy is not bound by FAR_ERROR as the land's pieces are (its stairs sit on a hex-sized
 * lattice, up to a couple of units off), so it holds its full tier until the island is seen whole.
 */
export const RELIEF_FAR_AT = 0.6

export function reliefGeometry(arrays: MeshArrays): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(arrays.position, 3))
  geometry.setAttribute("normal", new Float32BufferAttribute(arrays.normal, 3))
  geometry.setAttribute("uv", new Float32BufferAttribute(arrays.uv, 2))
  geometry.computeBoundingSphere()
  return geometry
}

export interface ReliefLayer {
  meshes: Mesh[]
  tiers: TieredLayer
}

/** The relief's meshes: they cast and receive shadows (a ridge shades the valley behind it). */
export function reliefLayer(relief: Relief, material: Material, merge: boolean, chunks: Chunks): ReliefLayer {
  // Each region is built `lift` below its place and set up by its instance matrix: the growth film
  // sinks an instance by (DEPTH + its base height) × rise, so a region whose base matrix holds its own
  // height sinks right out of sight, and rises out of the sea as the land under its middle does.
  const instances: (TieredInstance & {
    spot: readonly [number, number]
    massifs: readonly ReadonlySet<string>[]
  })[] = []
  reliefCells(relief, chunks).forEach((cells, chunk) => {
    if (cells.length === 0) return
    const lift = Math.ceil(Math.max(...cells.map((cell) => relief.massifAt(cell)?.height ?? 0))) + 1
    const place = (tier: 0 | 2): BufferGeometry =>
      reliefGeometry(reliefMesh(relief, cells, tier)).translate(0, -lift, 0)
    // The film raises it with its massifs' land, as one (growthRelief.ts); the spot is only where it stands.
    const massifs = [...new Set(cells.flatMap((cell) => relief.massifAt(cell) ?? []))].map((m) => m.keys)
    const points = cells.map((cell) => cellToWorld(cell))
    const spot: readonly [number, number] = [
      points.reduce((sum, [x]) => sum + x, 0) / points.length,
      points.reduce((sum, [, z]) => sum + z, 0) / points.length,
    ]
    instances.push({
      piece: { near: place(0), far: place(FAR) },
      matrix: new Matrix4().makeTranslation(0, lift, 0),
      chunk,
      spot,
      massifs,
    })
  })
  if (instances.length === 0) return { meshes: [], tiers: tiered(chunks, () => {}) }
  const count = chunks.list.length
  const built = merge
    ? tieredMerge(material, instances, count)
    : tieredBatch(material, instances, count, (mesh, id, { spot, massifs }) =>
        markGrowable(mesh, id, "land", spot[0], spot[1], "", massifs),
      )
  for (const { piece } of instances) {
    piece.near.dispose()
    piece.far?.dispose()
  }
  for (const mesh of built.meshes) {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }
  return { meshes: built.meshes, tiers: tiered(chunks, built.swap, RELIEF_FAR_AT) }
}
