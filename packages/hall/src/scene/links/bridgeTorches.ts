import { InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from "three"
import type { Baked } from "../events/common.ts"
import type { V3 } from "./shapes.ts"

/**
 * A bridge's torches: the island's own street torch (kit.glb `torch`, world/lights.ts), standing on
 * the parapets where the deck levels out, one instanced mesh for every bridge's. The flame is a halo
 * (scene/atmosphere/Lamps) that LinksLayer lights at dusk, here where it burns.
 */

/** A little under the street torch's post (world/lights.ts TORCH_SCALE, 2.6): a parapet is not a verge. */
const SCALE = 2.3
/** Where a torch's flame burns, over its foot: the street torch's (0.92 of its height). */
export const FLAME_UP = 0.92 * SCALE

/** The torch mesh standing at each of `posts` (the base of each). */
export function torchMesh(baked: Baked, posts: readonly V3[]): InstancedMesh {
  const mesh = new InstancedMesh(
    baked.geometry,
    new MeshStandardMaterial({ map: baked.material.map, roughness: baked.material.roughness }),
    posts.length,
  )
  mesh.name = "bridge-torches"
  mesh.receiveShadow = true
  const matrix = new Matrix4()
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  for (const [i, [x, y, z]] of posts.entries()) {
    turn.setFromAxisAngle(up, i * 1.9)
    mesh.setMatrixAt(i, matrix.compose(new Vector3(x, y, z), turn, new Vector3(SCALE, SCALE, SCALE)))
  }
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/** Where each torch's flame burns. */
export const flamesOf = (posts: readonly V3[]): V3[] => posts.map(([x, y, z]): V3 => [x, y + FLAME_UP, z])
