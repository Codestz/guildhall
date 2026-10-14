/**
 * The carrying walk (V1's scene/activity.ts, kept): KayKit has no walk with full arms, so one is made
 * once per clip set from Holding_A's arms over Walking_A's legs, hips, back and head. A log, a basket or
 * a sack then rides the chest between the hands (props/carry.ts).
 */
import { AnimationClip } from "three"

/** The made clip's name: the crowd bakes it like any other, a hero's mixer plays it. */
export const CARRY_WALK = "Carry_Walk"

/** Arm and hand tracks (three's names drop the dot: `upperarm.l` is `upperarml`). */
const ARMS = /^(upperarm|lowerarm|wrist|handslot|hand)\.?[lr]\./

/** Whether a track drives an arm or a hand (taken from Holding_A), else the walk's. */
export const armTrack = (name: string): boolean => ARMS.test(name)

/**
 * The carrying walk over `clips` (Walking_A's length and legs, Holding_A's arms), or null when either is
 * missing. Tracks are cloned: the sources are not touched.
 */
export function carryClip(clips: readonly AnimationClip[]): AnimationClip | null {
  const walk = clips.find((c) => c.name === "Walking_A")
  const hold = clips.find((c) => c.name === "Holding_A")
  if (!walk || !hold) return null
  return new AnimationClip(CARRY_WALK, walk.duration, [
    ...walk.tracks.filter((t) => !armTrack(t.name)).map((t) => t.clone()),
    ...hold.tracks.filter((t) => armTrack(t.name)).map((t) => t.clone()),
  ])
}

/** `clips` with the carrying walk added (once), for every character the rig's clips load onto. */
export function withCarry(clips: AnimationClip[]): AnimationClip[] {
  if (clips.some((c) => c.name === CARRY_WALK)) return clips
  const made = carryClip(clips)
  return made ? [...clips, made] : clips
}
