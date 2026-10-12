/**
 * A crowd person's held props, posed on the CPU from the bake with the hero's own maths: the slot
 * bone's frame (`socketAt`), the mount's per-clip pose (`mountPose`: basis, roll, offset, hide) and the
 * upright solver's levelling (character/upright.ts), so a prop sits in a crowd hand exactly where it
 * sits in a hero's. A few hundred matrices a frame; the props then draw as one batch.
 *
 *   person · bone · pivot (offset, upright turn) · piece (basis + roll, scale)
 */
import type { Mount, MountSlot } from "@guildhall/assets"
import { Matrix4, Quaternion, Vector3 } from "three"
import { mountPose } from "../character/mount.ts"
import { type BakePose, type BoneBake, socketAt } from "./bake.ts"

export interface HeldProp {
  mount: Mount
  slot: MountSlot
  /** The slot bone's index in the bake. */
  bone: number
}

type Pose = ReturnType<typeof mountPose>

const UP = new Vector3(0, 1, 0)
const scratch = {
  socket: new Matrix4(),
  pivot: new Matrix4(),
  piece: new Matrix4(),
  hand: new Quaternion(),
  align: new Quaternion(),
  turn: new Quaternion(),
  up: new Vector3(),
  at: new Vector3(),
  size: new Vector3(),
  one: new Vector3(1, 1, 1),
}

/** mountPose per (mount, slot, clip), made once: it allocates. */
const poses = new WeakMap<Mount, Map<string, Pose>>()

function poseFor(mount: Mount, slot: MountSlot, clip: string): Pose {
  let bySlot = poses.get(mount)
  if (!bySlot) {
    bySlot = new Map()
    poses.set(mount, bySlot)
  }
  const key = `${slot}|${clip}`
  let pose = bySlot.get(key)
  if (!pose) {
    pose = mountPose(mount, slot, mount.clips?.[clip])
    bySlot.set(key, pose)
  }
  return pose
}

/**
 * `prop`'s matrix in the rig root's space for a person at `pose` playing `clip` (the clip names the
 * mount's overrides), into `target`; false when the clip hides it.
 */
export function propMatrix(
  bake: BoneBake,
  pose: BakePose,
  clip: string,
  prop: HeldProp,
  target: Matrix4,
): boolean {
  if (prop.mount.clips?.[clip]?.hide) return false
  const s = scratch
  const p = poseFor(prop.mount, prop.slot, clip)
  socketAt(bake, pose, prop.bone, s.socket)
  s.turn.identity()
  const upright = prop.mount.upright
  if (upright) {
    s.socket.decompose(s.at, s.hand, s.size)
    s.up
      .set(...upright.up)
      .applyQuaternion(p.quaternion)
      .applyQuaternion(s.hand)
    s.align.setFromUnitVectors(s.up.normalize(), UP)
    // pivot = hand⁻¹ · align · hand (character/upright.ts).
    s.turn.copy(s.hand).invert().multiply(s.align).multiply(s.hand)
  }
  s.pivot.compose(p.offset, s.turn, s.one)
  s.piece.compose(p.position, p.quaternion, s.size.setScalar(p.scale))
  target.multiplyMatrices(s.socket, s.pivot).multiply(s.piece)
  return true
}
