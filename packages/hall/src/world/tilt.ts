/**
 * A placement's tilt (LandPlacement.tilt): the horizontal part [nx, nz] of the unit normal the piece
 * stands on, so a rock on a cliff lies along the face instead of upright against it. The piece
 * turns about its own up (`rot`) first, then its up is carried onto the normal. Pure maths (no
 * three), shared by the scene's matrices and the generators that must know where a tilted piece's
 * base ends up.
 */

export type Tilt = readonly [nx: number, nz: number]
export type Quat = readonly [x: number, y: number, z: number, w: number]
type Vec = readonly [number, number, number]

/** The rotation that carries (0, 1, 0) onto the unit normal with horizontal part `tilt`. */
export function tiltQuaternion([nx, nz]: Tilt): Quat {
  const run = Math.hypot(nx, nz)
  if (run < 1e-6) return [0, 0, 0, 1]
  const ny = Math.sqrt(Math.max(0, 1 - run * run))
  const half = Math.atan2(run, ny) / 2
  const k = Math.sin(half) / run
  return [nz * k, 0, -nx * k, Math.cos(half)]
}

/** A point of the piece's own space (before scale) as the placement turns it: yaw about up, then the tilt. */
export function orient(point: Vec, rot: number, tilt: Tilt): [number, number, number] {
  const [x, y, z] = point
  const [c, s] = [Math.cos(rot), Math.sin(rot)]
  const [px, py, pz] = [x * c + z * s, y, -x * s + z * c]
  const [qx, qy, qz, qw] = tiltQuaternion(tilt)
  // v' = v + 2w(q × v) + 2 q × (q × v)
  const [tx, ty, tz] = [2 * (qy * pz - qz * py), 2 * (qz * px - qx * pz), 2 * (qx * py - qy * px)]
  return [
    px + qw * tx + (qy * tz - qz * ty),
    py + qw * ty + (qz * tx - qx * tz),
    pz + qw * tz + (qx * ty - qy * tx),
  ]
}
