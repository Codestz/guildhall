/**
 * A load carried in both arms (the carrying walk, character/carry.ts): it rides the chest bone, centred
 * between Holding_A's hands (V1 measured them ±0.32 across, ~0.55 ahead of and a little under the
 * chest), upright as it stands on the ground, its long side across the body (a log lies across the arms).
 *
 * Pure: a mount (ADR 010) for the chest slot from the piece's size, so the crowd and a hero's mixer place
 * it with the maths every held prop uses.
 */
import type { Mount } from "@guildhall/assets"

/** Where the load's centre sits in the chest bone's frame (metres at look scale 1): ahead, under. */
export const CARRY_AT = { ahead: 0.5, down: 0.14 } as const
/** The most a load spans across the arms (rig metres; past both hands, KayKit's chunky way): wider ones are scaled down to it. */
export const CARRY_SPAN = 1

/**
 * The chest mount for a piece of `size` (w, h, d) whose base is at its origin (`centred`: its centre is),
 * scaled so its widest side spans at most CARRY_SPAN. Its x points ahead and z across the body; y stays up.
 */
export function carryMount(size: readonly [number, number, number], centred = false): Mount {
  const [w, h, d] = size
  const scale = Math.min(1, CARRY_SPAN / Math.max(w, d, 1e-3))
  const cy = centred ? 0 : h / 2
  // the handle is the prop point that lands on the bone: the centre less the offset, in prop units
  // (the mount maps prop x to the chest's forward and prop y to its up: see mountBasis)
  return {
    slot: "chest",
    hands: 2,
    handle: [-CARRY_AT.ahead / scale, cy + CARRY_AT.down / scale, 0],
    axis: [0, 1, 0],
    edge: [1, 0, 0],
    scale: round(scale),
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000
