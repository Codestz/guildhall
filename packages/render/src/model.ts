import { log } from "@guildhall/core"
import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  type Object3D,
  Texture,
} from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

const logger = log("render:model")

let loader: GLTFLoader | null = null

export interface Measure {
  /** Axis-aligned world size `[w, h, d]` in metres. */
  size: [number, number, number]
  /** The lowest world y: subtract it to stand the object on the ground. */
  minY: number
  /** The box centre: subtract its x and z to centre the object over the origin. */
  centre: [number, number, number]
}

/**
 * A raw glTF/GLB with its own materials kept (a preview of untouched vendor art, unlike `loadPiece`).
 * Every mesh casts and receives shadows; every texture gets mipmaps and `anisotropy` (pass the
 * renderer's max) so it stays crisp at grazing angles.
 */
export async function loadModel(url: string, opts: { anisotropy?: number } = {}): Promise<Object3D> {
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync(url)
  const root = gltf.scene
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return
    node.castShadow = true
    node.receiveShadow = true
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (!(value instanceof Texture)) continue
        value.generateMipmaps = true
        value.minFilter = LinearMipmapLinearFilter
        value.anisotropy = opts.anisotropy ?? 1
        value.needsUpdate = true
      }
    }
  })
  // Kept on the scene so `poseModel` can find the file's clips.
  root.animations = gltf.animations
  logger.debug("loaded", { url, clips: gltf.animations.length })
  return root
}

/**
 * Freezes a rigged model in the first frame of its clip named `clip` (a character's idle stance
 * instead of its bind pose). False, and the model untouched, when it has no such clip.
 */
export function poseModel(model: Object3D, clip: string): boolean {
  const found = AnimationClip.findByName(model.animations, clip)
  if (!found) return false
  const mixer = new AnimationMixer(model)
  mixer.clipAction(found).play()
  mixer.update(0)
  return true
}

/** The world-space bounds of `object` (skinned meshes in their current pose) as size and floor. */
export function measure(object: Object3D): Measure {
  // updateMatrixWorld, not updateWorldMatrix, for the subtree: only it refreshes a SkinnedMesh's
  // bindMatrixInverse, without which a scaled skinned mesh measures scaled twice.
  object.updateWorldMatrix(true, false)
  object.updateMatrixWorld(true)
  const box = new Box3().setFromObject(object, true)
  if (box.isEmpty()) return { size: [0, 0, 0], minY: 0, centre: [0, 0, 0] }
  return {
    size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z],
    minY: box.min.y,
    centre: [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2],
  }
}

/** An empty node holding `children`, for building one piece out of several (a composed house). */
export function group(name: string, ...children: Object3D[]): Object3D {
  const node = new Group()
  node.name = name
  if (children.length > 0) node.add(...children)
  return node
}
