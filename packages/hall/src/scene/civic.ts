import { use } from "react"
import type { Material, Mesh, Object3D } from "three"
import CIVIC from "../world/civic.json"
import type { LandPlacement } from "../world/lands.ts"

/**
 * The land pack's civic pieces (civic.glb, scripts/assets.ts): the castle, towers and curtain wall a
 * gen 2 island's civic centre is built of, and its venues' tables, stools and books. Lazy like the
 * second town kit (scene/town2.ts): the hand island and the first generator's never place one, so
 * their visitors never fetch it, and the loader and its decoder come with it, as chunks of their own.
 */

export const CIVIC_URL = `${import.meta.env.BASE_URL}assets/civic.glb`

/** A piece of the civic bundle. */
export const isCivic = (piece: string): boolean => piece in CIVIC

let loading: Promise<Record<string, Object3D>> | undefined

/** The bundle's pieces by node name, fetched once. */
export function loadCivic(): Promise<Record<string, Object3D>> {
  loading ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/libs/meshopt_decoder.module.js"),
    ])
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(CIVIC_URL)
    const nodes: Record<string, Object3D> = {}
    // Only the pieces' own nodes (the scene's children): a piece's inner mesh may share a name with another.
    for (const node of gltf.scene.children) if (isCivic(node.name)) nodes[node.name] = node
    return nodes
  })()
  return loading
}

/**
 * Draws the bundle's pieces with the land pack's own materials where it has one of the same name (the
 * hex pack's palette, the dungeon pack's): the batches (scene/Island.tsx, a group per material) then
 * keep their groups instead of opening a second one for the same palette.
 */
export function shareMaterials(nodes: Record<string, Object3D>, lands: Record<string, Object3D>): void {
  const own = new Map<string, Material>()
  for (const node of Object.values(lands))
    node.traverse((child) => {
      const mesh = child as Mesh
      const material = mesh.material as Material
      if (mesh.isMesh && !own.has(material.name)) own.set(material.name, material)
    })
  for (const node of Object.values(nodes))
    node.traverse((child) => {
      const mesh = child as Mesh
      const same = mesh.isMesh ? own.get((mesh.material as Material).name) : undefined
      if (same) mesh.material = same
    })
}

/** The bundle's pieces if any placement uses one (suspends while they load), else nothing. */
export function useCivic(placements: readonly LandPlacement[]): Record<string, Object3D> | undefined {
  return placements.some((placement) => isCivic(placement.piece)) ? use(loadCivic()) : undefined
}
