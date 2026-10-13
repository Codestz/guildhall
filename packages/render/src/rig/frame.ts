import type { CameraPose } from "@guildhall/core"

/**
 * Framing a subject off the screen's centre (the follow camera's): the orbit target that puts a point
 * at a given place on screen, so a subject can sit in the middle of what a HUD leaves clear. Pure.
 */

type Vec3 = [number, number, number]

const RAD = Math.PI / 180
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The orbit target that puts `subject` at NDC `frame` (x right, y up; the clear frame's middle), seen from `pose`'s angles and
 * distance: moved across the ground along the view's right and forward (foreshortened by the tilt).
 * Pure and exact for a subject level with the target (the subject sits on the ray through the frame's
 * middle): a point `s` metres ahead of the target on its level shows at NDC y = s sin e / ((D + s cos e) ty).
 */
export function framedTarget(
  subject: Vec3,
  pose: Pick<CameraPose, "azimuth" | "elevation" | "distance">,
  lens: { fov: number; aspect: number },
  frame: { x: number; y: number },
): Vec3 {
  if (frame.x === 0 && frame.y === 0) return [subject[0], subject[1], subject[2]]
  const ty = Math.tan((lens.fov / 2) * RAD)
  const el = clamp(pose.elevation, 5, 89) * RAD
  const sin = Math.sin(el)
  const cos = Math.cos(el)
  const d = pose.distance
  // how far ahead of the target the subject must stand (its depth grows with it), then how far across
  const fy = clamp(frame.y, -0.9, 0.9)
  const along = (fy * ty * d) / Math.max(0.05, sin - fy * ty * cos)
  const across = frame.x * ty * lens.aspect * (d + along * cos)
  const az = pose.azimuth * RAD
  // the rig looks along (-sin az, -cos az) on the ground; its right is (cos az, -sin az)
  const rx = Math.cos(az)
  const rz = -Math.sin(az)
  const fx = -Math.sin(az)
  const fz = -Math.cos(az)
  return [subject[0] - rx * across - fx * along, subject[1], subject[2] - rz * across - fz * along]
}
