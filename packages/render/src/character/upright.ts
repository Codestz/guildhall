/**
 * The upright solver (ADR 010): after the mixer has posed the body, an upright prop's pivot is turned
 * so the prop's `up` axis is world-up again. The pivot sits at the handle, so the handle stays in the
 * hand; the turn is the shortest one that levels the prop, so it keeps as much of the hand's twist
 * about world-up as it can (a lantern still swings round with the wrist, it just never tilts).
 */
import { Quaternion, Vector3 } from "three"
import type { Mounted } from "./mount.ts"

const UP = new Vector3(0, 1, 0)
const scratch = { hand: new Quaternion(), align: new Quaternion(), up: new Vector3() }

/** Levels `mounted` if its mount is upright and it is shown; anything else follows the hand untouched. */
export function keepUpright(mounted: Mounted): void {
  const upright = mounted.mount.upright
  if (!upright || !mounted.pivot.visible) return
  const { hand, align, up } = scratch
  mounted.bone.getWorldQuaternion(hand)
  // The prop's up in the world with the pivot unturned: hand · piece · up.
  up.set(...upright.up)
    .applyQuaternion(mounted.piece.quaternion)
    .applyQuaternion(hand)
  align.setFromUnitVectors(up.normalize(), UP)
  // pivot = hand⁻¹ · align · hand, so world = align · hand · piece: the hand's turn, then the levelling.
  mounted.pivot.quaternion.copy(hand).invert().multiply(align).multiply(hand)
}
