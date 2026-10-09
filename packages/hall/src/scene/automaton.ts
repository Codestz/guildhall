import { Color, type Mesh, type MeshStandardMaterial, type Object3D } from "three"
import { cloneRig } from "./rig.ts"

/**
 * The Automaton (ADR 0010): the bots' construct. KayKit's Skeleton_Minion is on the adventurers'
 * own rig, so it plays every adventurer clip and joins the baked crowd as any model does (its bones
 * map by name: crowd/bake.ts `boneMap`). Re-cast here, once per loaded scene, as a bronze construct
 * with glowing eyes:
 *
 *   - its body becomes the tinted part (`…_Tinted`): the archetype's bronze dyes it on both paths,
 *     the hero's own tint and the crowd's per-member tint, like any adventurer's cape — no new
 *     material per member, no extra draw;
 *   - the bone-white palette goes metallic, and the eyes glow a cold blue (the graveyard's skeletons
 *     glow green: never mistaken for undead).
 *
 * A copy, never the loaded scene: the graveyard's minions share it (scene/Undead.tsx).
 */

const EYES = new Color("#62d8ff")
const made = new WeakMap<Object3D, Object3D>()

export function construct(scene: Object3D): Object3D {
  const known = made.get(scene)
  if (known) return known
  const copy = cloneRig(scene)
  copy.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    const material = (mesh.material as MeshStandardMaterial).clone()
    if (/Eyes/.test(mesh.name)) {
      material.emissive = EYES.clone()
      material.emissiveIntensity = 2.2
      material.color = EYES.clone()
    } else {
      mesh.name = `${mesh.name}_Tinted`
      material.metalness = 0.55
      material.roughness = 0.42
    }
    mesh.material = material
  })
  made.set(scene, copy)
  return copy
}
