import { use } from "react"
import type { Object3D } from "three"
import type { LandPlacement } from "../world/lands.ts"

/**
 * The second town kit (town2.glb, scripts/assets.ts): Kenney Fantasy Town, Castle and Survival
 * pieces baked onto the hex pack's palette, for the buildings gen 2's prefabs (world/prefabs/town2.ts)
 * make from them. Lazy: an island whose placements use none never fetches it (the first generator's
 * never do), and the loader and its decoder are fetched with it, as chunks of their own.
 */

export const TOWN2_URL = `${import.meta.env.BASE_URL}assets/town2.glb`

/** A piece of the second town kit (every one is named `t2_…`). */
export const isTown2 = (piece: string): boolean => piece.startsWith("t2_")

let loading: Promise<Record<string, Object3D>> | undefined

/** The kit's pieces by node name, fetched once. */
export function loadTown2(): Promise<Record<string, Object3D>> {
  loading ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/libs/meshopt_decoder.module.js"),
    ])
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(TOWN2_URL)
    const nodes: Record<string, Object3D> = {}
    // Only the kit's own pieces: a Kenney child node named `barrel` must not stand in for the hex pack's.
    gltf.scene.traverse((node) => {
      if (isTown2(node.name)) nodes[node.name] = node
    })
    return nodes
  })()
  return loading
}

/** The kit's pieces if any placement uses one (suspends while they load), else nothing. */
export function useTown2(placements: readonly LandPlacement[]): Record<string, Object3D> | undefined {
  return placements.some((placement) => isTown2(placement.piece)) ? use(loadTown2()) : undefined
}
