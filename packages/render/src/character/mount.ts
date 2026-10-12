/**
 * A held or worn prop on a character's slot bone (ADR 010). The prop hangs from a pivot at the slot
 * origin, so its handle point is the pivot's origin: per-clip offsets move the pivot, and the upright
 * solver (upright.ts) only ever turns it, which keeps the handle in the hand whatever it does.
 *
 *   bone ─ pivot (position = clip offset, quaternion = upright solver) ─ piece (mountBasis + clip roll)
 */
import { type Mount, type MountClip, type MountSlot, mountBasis, SLOT_FRAMES } from "@guildhall/assets"
import { Group, type Object3D, Quaternion, Vector3 } from "three"
import type { Character } from "./load.ts"

export interface Mounted {
  mount: Mount
  slot: MountSlot
  /** The slot bone the pivot rides on. */
  bone: Object3D
  /** At the handle point: toggle visibility here; the upright solver turns it. */
  pivot: Group
  piece: Object3D
}

/**
 * The piece's place in its pivot for clip `clip` (null: no clip): `mountBasis`, then the clip's roll
 * about the slot's `along`, which turns the translation too so the handle stays on the origin. The
 * clip's offset is the pivot's, not the piece's (see the module comment).
 */
export function mountPose(
  m: Mount,
  slot: MountSlot,
  clip: MountClip | undefined,
): { quaternion: Quaternion; position: Vector3; offset: Vector3; scale: number } {
  const basis = mountBasis(m, slot)
  const quaternion = new Quaternion(...basis.rotation)
  const position = new Vector3(...basis.translation)
  if (clip?.roll) {
    const roll = new Quaternion().setFromAxisAngle(new Vector3(...SLOT_FRAMES[slot].along), clip.roll)
    quaternion.premultiply(roll)
    position.applyQuaternion(roll)
  }
  const offset = clip?.offset ? new Vector3(...clip.offset) : new Vector3()
  return { quaternion, position, offset, scale: m.scale ?? 1 }
}

/** Re-poses a mounted prop for clip `name` (its `clips` override, or none): roll, offset, hide. */
export function mountClip(mounted: Mounted, name: string | null): void {
  const clip = name === null ? undefined : mounted.mount.clips?.[name]
  const pose = mountPose(mounted.mount, mounted.slot, clip)
  mounted.piece.quaternion.copy(pose.quaternion)
  mounted.piece.position.copy(pose.position)
  mounted.piece.scale.setScalar(pose.scale)
  mounted.pivot.position.copy(pose.offset)
  mounted.pivot.quaternion.identity()
  mounted.pivot.visible = !clip?.hide
}

/**
 * Hangs `piece` on the character's `slot` bone (default: the mount's own slot), posed for the clip
 * playing now, and registers it so `ch.update` keeps it upright and `ch.play` re-poses it per clip.
 * Throws when the body has no such bone.
 */
export function attachMount(
  ch: Character,
  piece: Object3D,
  mount: Mount,
  slot: MountSlot = mount.slot,
): Mounted {
  const bone = ch.bone(slot)
  if (!bone) throw new Error(`attachMount: no bone ${SLOT_FRAMES[slot].bone} for slot ${slot}`)
  const pivot = new Group()
  pivot.name = `mount:${slot}`
  pivot.add(piece)
  bone.add(pivot)
  const mounted: Mounted = { mount, slot, bone, pivot, piece }
  mountClip(mounted, ch.clip)
  ch.mounted.push(mounted)
  return mounted
}

/** Takes a mounted prop off its character (the piece stays a child of the detached pivot). */
export function detachMount(ch: Character, mounted: Mounted): void {
  mounted.pivot.removeFromParent()
  const i = ch.mounted.indexOf(mounted)
  if (i >= 0) ch.mounted.splice(i, 1)
}
