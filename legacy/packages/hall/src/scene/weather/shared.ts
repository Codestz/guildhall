import { type Camera, MathUtils, type OrthographicCamera, type PerspectiveCamera, Vector3 } from "three"

/**
 * Shared by every weather effect: how fast each effect eases towards the environment's numbers
 * (the model already moves smoothly; this hides the last steps, a change of weather's band), and
 * what the camera is looking at. The wind itself (direction, eased strength) is atmosphere/wind.ts.
 */

/** Damping rate for `MathUtils.damp`: about 1.5 s to settle. */
export const EASE = 2

const ORIGIN = new Vector3()

/** Where the camera looks: the controls' target, or the island's centre. */
export function targetOf(controls: unknown): Vector3 {
  return (controls as { target?: Vector3 } | null)?.target ?? ORIGIN
}

/** World units the camera sees across, at the target. */
export function seenWidth(camera: Camera, size: { width: number; height: number }, target: Vector3): number {
  if ((camera as OrthographicCamera).isOrthographicCamera)
    return size.width / (camera as OrthographicCamera).zoom
  const fov = MathUtils.degToRad((camera as PerspectiveCamera).fov / 2)
  return 2 * camera.position.distanceTo(target) * Math.tan(fov) * (size.width / size.height)
}

/** Screen pixels per world unit at distance 1 (perspective) or anywhere (orthographic). */
export function pixelsPerUnit(camera: Camera, size: { height: number }): number {
  if ((camera as OrthographicCamera).isOrthographicCamera) return (camera as OrthographicCamera).zoom
  return size.height / 2 / Math.tan(MathUtils.degToRad((camera as PerspectiveCamera).fov / 2))
}
