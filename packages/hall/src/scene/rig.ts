import type { Object3D, Skeleton, SkinnedMesh } from "three"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"

/**
 * A skinned model's own copy (SkeletonUtils.clone) whose parts bound to the same rig share ONE
 * skeleton. The glTF loader, and SkeletonUtils after it, give every skinned part its own Skeleton,
 * even the parts of one character on one skin (body, cape and hat; the undead's eyes): each then
 * flattened its bones and uploaded its bone texture every frame, the same matrices twice.
 * Sharing one is what lets the renderer do that once per character (docs/perf-budget.md).
 */
export function cloneRig(source: Object3D): Object3D {
  const copy = cloneSkinned(source)
  const rigs: Skeleton[] = []
  copy.traverse((node) => {
    const mesh = node as SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const twin = rigs.find((rig) => sameRig(rig, mesh.skeleton))
    if (twin) mesh.skeleton = twin
    else rigs.push(mesh.skeleton)
  })
  return copy
}

/** The same bones in the same order with the same bind pose: one set of bone matrices serves both. */
export function sameRig(a: Skeleton, b: Skeleton): boolean {
  if (a.bones.length !== b.bones.length) return false
  for (let i = 0; i < a.bones.length; i++) {
    if (a.bones[i] !== b.bones[i]) return false
    const inverseA = a.boneInverses[i]
    const inverseB = b.boneInverses[i]
    if (!inverseA || !inverseB || !inverseA.equals(inverseB)) return false
  }
  return true
}
