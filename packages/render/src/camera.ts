import type { CameraPose } from "@guildhall/core"

/**
 * The orbit camera's maths. A pose sits on a sphere around its target: azimuth 0 looks from +z (the
 * side a piece's front faces), positive azimuth swings toward +x, elevation 90 looks straight down.
 * The input that moves it is the stage's rig (rig/index.ts).
 */

type Vec3 = [number, number, number]

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
/** Where the camera stands for a pose. */
export function poseToCamera(pose: CameraPose): Vec3 {
  const [tx, ty, tz] = pose.target
  const az = pose.azimuth * RAD
  const el = pose.elevation * RAD
  const flat = pose.distance * Math.cos(el)
  return [tx + flat * Math.sin(az), ty + pose.distance * Math.sin(el), tz + flat * Math.cos(az)]
}

/** The pose of a camera standing at `position` and looking at `target`. */
export function cameraToPose(position: Vec3, target: Vec3): CameraPose {
  const dx = position[0] - target[0]
  const dy = position[1] - target[1]
  const dz = position[2] - target[2]
  const distance = Math.hypot(dx, dy, dz)
  return {
    target: [...target],
    azimuth: Math.atan2(dx, dz) * DEG,
    elevation: distance === 0 ? 0 : Math.asin(dy / distance) * DEG,
    distance,
  }
}
