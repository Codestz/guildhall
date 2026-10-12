import type { BufferGeometry, Object3D, SkinnedMesh } from "three"

/**
 * The crowd's coarser meshes (crowd/lod.ts MESH_LODS), simplified at load by meshoptimizer: for
 * each model part (body, tinted cape/hat), one index buffer per level. Only the index changes: an
 * edge collapses onto one of its own ends, so a level draws the part's own vertices — skin joints
 * and weights, UVs, normals untouched, the same vertex buffers on the GPU. Vertices split at a seam
 * (a palette UV edge, a hard normal) only ever collapse along it, so seams stay seams.
 *
 * At load rather than baked into the .glb (scripts/assets.ts), by measurement (2026-10-08): baked,
 * the levels' indices add ~123 KB gzipped to every load (198 KB raw, uint16) and need a slot in
 * the glTF the heroes' rigs must skip; at load, the simplifier is a ~20 KB gzipped chunk fetched
 * only when a crowd first forms, and simplifying all six models takes ~40 ms once (4–9 ms a model,
 * next to the bake's 100–300 ms). Until it is done, everyone draws the full mesh.
 */

/** Per model part (its loaded geometry): the index of each level past the full mesh, coarsest last. */
export type PartLods = Map<BufferGeometry, (Uint16Array | Uint32Array)[]>

/**
 * Each level: the share of triangles aimed for, and the most it may move the surface (world units,
 * bind pose; a figure is ~2.2 tall). Whichever stops it first: a part that can't lose that much
 * without moving more (a hat's brim, a cape's hem) keeps more triangles, so silhouettes hold.
 */
export const LEVELS: readonly { ratio: number; error: number }[] = [
  { ratio: 0.5, error: 0.015 },
  { ratio: 0.25, error: 0.04 },
]

/** What simplify.ts needs of meshoptimizer's simplifier (its `MeshoptSimplifier`). */
export interface Simplifier {
  simplify(
    indices: Uint32Array,
    positions: Float32Array,
    stride: number,
    target: number,
    error: number,
    flags?: "ErrorAbsolute"[],
  ): [Uint32Array, number]
}

/** Every skinned part of `models`, simplified (meshoptimizer loaded on first call, its own chunk). */
export async function simplifyModels(models: Record<string, Object3D>): Promise<PartLods> {
  const { MeshoptSimplifier } = await import("meshoptimizer/simplifier")
  await MeshoptSimplifier.ready
  const lods: PartLods = new Map()
  for (const model of Object.values(models))
    model.traverse((node) => {
      const part = node as SkinnedMesh
      if (part.isSkinnedMesh && !lods.has(part.geometry))
        lods.set(part.geometry, simplifyPart(MeshoptSimplifier, part.geometry))
    })
  return lods
}

/** One part's levels (LEVELS), each from the full mesh. An unindexed part gets none. */
export function simplifyPart(
  simplifier: Simplifier,
  geometry: BufferGeometry,
): (Uint16Array | Uint32Array)[] {
  const index = geometry.index
  const position = geometry.getAttribute("position")
  if (!index || !position) return []
  const positions = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    positions[i * 3] = position.getX(i)
    positions[i * 3 + 1] = position.getY(i)
    positions[i * 3 + 2] = position.getZ(i)
  }
  const indices = Uint32Array.from(index.array as ArrayLike<number>)
  return LEVELS.map(({ ratio, error }) => {
    const target = Math.floor((indices.length * ratio) / 3) * 3
    const [simplified] = simplifier.simplify(indices, positions, 3, target, error, ["ErrorAbsolute"])
    return position.count <= 0xffff ? Uint16Array.from(simplified) : simplified
  })
}
