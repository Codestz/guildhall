import { type OrthographicCamera as Ortho, type PerspectiveCamera as Persp, Vector3 } from "three"

/** The camera rig's small pure helpers (scene/CameraRig.tsx): the follow shot's close-in, easing and curves. */

/**
 * Close in on whoever was just picked (once, so the viewer can zoom back out). In Explore the
 * camera also drops to a three-quarter angle: low enough to see the character's animation, not
 * the top of their head.
 */
export function closeIn(camera: Ortho | Persp, control: { target: Vector3 }, goal: number): void {
  if ((camera as Ortho).isOrthographicCamera) {
    const o = camera as Ortho
    o.zoom = Math.max(o.zoom, goal)
    o.updateProjectionMatrix()
    return
  }
  const offset = camera.position.clone().sub(control.target)
  const azimuth = Math.atan2(offset.x, offset.z)
  const elevation = FOLLOW_ELEVATION
  camera.position
    .copy(control.target)
    .add(
      new Vector3(
        Math.sin(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
        Math.cos(azimuth) * Math.cos(elevation),
      ).multiplyScalar(goal),
    )
}

/** Following someone in Explore: ~30° above the ground. */
const FOLLOW_ELEVATION = 0.52

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** Cubic Bézier at `t` into `out` (no allocation). */
export function bezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number, out: Vector3): Vector3 {
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  return out.set(
    a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3,
    a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3,
    a.z * w0 + b.z * w1 + c.z * w2 + d.z * w3,
  )
}
