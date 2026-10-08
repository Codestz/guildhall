/**
 * Who is drawn as a hero and who joins the crowd (scene/body.ts). A hero is a full SkinnedMesh
 * with its own mixer and its gear as real meshes; a crowd member is a slot in the baked crowd
 * (crowd/Crowd.ts), drawn with everyone of its model in one call per part. Both play the same clip
 * at the same phase from the same root (scene/brain.ts), so the switch is invisible; heroes are for
 * what the crowd can't show yet and for whoever the camera is close to.
 *
 *   Small casts      every story the hall ships (Saga's guild, a party, a rush of 12) has at most
 *                    ALL_HEROES adventurers: all heroes, drawn exactly as before the crowd existed.
 *   Always a hero    the selected (followed) one; anyone dissolving in or out; anyone carrying a
 *                    lit lantern (its light follows the real hand's bone, scene/lights/carried.ts).
 *   Close            within NEAR of the camera's target and drawn at least TALL px high on screen;
 *                    let go past FAR or under SHORT (the gap keeps anyone from flickering between).
 */

/** At most this many adventurers: everyone is a hero. */
export const ALL_HEROES = 16
/** Units from the camera's target: a hero within NEAR, back to the crowd past FAR. */
export const NEAR = 9
export const FAR = 12
/** On-screen height, CSS px: a hero from TALL, back to the crowd under SHORT. */
export const TALL = 110
export const SHORT = 90
/** A figure's height, world units, for its on-screen size. */
export const FIGURE_HEIGHT = 2.4

/**
 * Should this adventurer be a hero this frame? `hero`: is it one now (for the hysteresis);
 * `pinned`: must be (selected, dissolving, a lantern); `distance` to the camera's target; `tall`,
 * its height on screen in CSS px. Pure, for tests.
 */
export function heroic(hero: boolean, pinned: boolean, distance: number, tall: number): boolean {
  if (pinned) return true
  return hero ? distance <= FAR && tall >= SHORT : distance <= NEAR && tall >= TALL
}
