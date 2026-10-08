import { type Camera, type OrthographicCamera, type PerspectiveCamera, Vector3 } from "three"

/**
 * Who is drawn as a hero and who joins the crowd (scene/body.ts). A hero is a full SkinnedMesh
 * with its own mixer and its gear as real meshes; a crowd member is a slot in the baked crowd
 * (crowd/Crowd.ts), drawn with everyone of its model in one call per part. Both play the same clip
 * at the same phase from the same root (scene/brain.ts), so the switch is invisible; heroes are for
 * what the crowd can't show yet and for whoever the camera is close to.
 *
 *   Small casts      every story the hall ships (Saga's guild, a party, a rush of 12) has at most
 *                    ALL_HEROES adventurers: all heroes, drawn exactly as before the crowd existed.
 *   Always a hero    the selected (followed) one; anyone dissolving in or out. (A lantern carrier
 *                    may join the crowd: its light follows the crowd's baked hand, Crowd `held`.)
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

/**
 * Crowd members' meshes by size on screen (crowd/simplify.ts makes the coarser ones, crowd/Crowd.ts
 * draws each level as its own instanced troop). Level k+1 from under `under` CSS px tall, back to k
 * over `over` (the gap keeps a member from flickering between two). A level's surface moves at most
 * its error (crowd/simplify.ts LEVELS: 1.5 cm, 4 cm), under a pixel at the heights it is drawn at.
 * Checked in same-instant probe shots (2026-10-08): LOD1 at the `look` zoom (members 45–100 px) and
 * LOD2 at the default zoom differ from the full mesh only in scattered edge pixels.
 */
export const MESH_LODS: readonly { under: number; over: number }[] = [
  { under: 90, over: 100 },
  { under: 45, over: 52 },
]

/**
 * The mesh level a crowd member draws at, from the one it draws now (`level`) and its on-screen
 * height (`tall`, CSS px), among `levels` (1: only the full mesh). Pure, for tests.
 */
export function meshLod(level: number, tall: number, levels: number): number {
  let next = Math.min(level, levels - 1)
  while (next > 0 && tall > (MESH_LODS[next - 1]?.over ?? Number.POSITIVE_INFINITY)) next--
  while (next < levels - 1 && tall < (MESH_LODS[next]?.under ?? 0)) next++
  return next
}

/** The camera, read once a frame for how tall each crowd member is drawn (`tallAt`). */
export interface Lens {
  /** The camera's place and the way it looks (unit). */
  readonly at: Vector3
  readonly forward: Vector3
  /** Perspective: CSS px per world unit at depth 1 (0 for an orthographic camera). */
  focal: number
  /** Orthographic: CSS px per world unit anywhere (0 for a perspective camera). */
  flat: number
}

export function lens(): Lens {
  return { at: new Vector3(), forward: new Vector3(), focal: 0, flat: 0 }
}

/** `camera` (drawn `height` CSS px tall) into `out`. No allocation. */
export function look(camera: Camera, height: number, out: Lens): Lens {
  out.at.setFromMatrixPosition(camera.matrixWorld)
  out.forward.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate()
  const ortho = camera as OrthographicCamera
  if (ortho.isOrthographicCamera) {
    out.focal = 0
    out.flat = (height * ortho.zoom) / Math.max(1e-6, ortho.top - ortho.bottom)
    return out
  }
  const persp = camera as PerspectiveCamera
  const fov = persp.isPerspectiveCamera ? persp.getEffectiveFOV() : 50
  out.focal = height / (2 * Math.tan((fov * Math.PI) / 360))
  out.flat = 0
  return out
}

/** How tall (CSS px) a figure standing at (x, y, z) is drawn through `lens`. */
export function tallAt(lens: Lens, x: number, y: number, z: number): number {
  if (lens.flat > 0) return FIGURE_HEIGHT * lens.flat
  const { at, forward } = lens
  const depth = (x - at.x) * forward.x + (y + FIGURE_HEIGHT / 2 - at.y) * forward.y + (z - at.z) * forward.z
  return (FIGURE_HEIGHT * lens.focal) / Math.max(depth, 0.1)
}
