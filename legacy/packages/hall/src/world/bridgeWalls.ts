import { type Bridge, endsOf } from "./bridges.ts"
import { DMath } from "./dmath.ts"
import type { Spot } from "./layout.ts"

/**
 * A bridge, to a boat, is a wall: its deck stands as high as a hull's masts and nothing sails under
 * it. So every ship that moves on its own (the ferries' lanes, the islands' laps, the GitHub
 * sea's voyages) keeps BRIDGE_CLEAR off a bridge's axis: the deck's width, its towers and the hull's
 * length. Pure geometry.
 */

/** A bridge's axis, landing to landing, in the archipelago's coordinates. */
export interface Wall {
  a: Spot
  b: Spot
}

/** A ship's centre keeps this far from a bridge's axis: the deck (to 6.5, 7.7 at a tower) and half a hull. */
export const BRIDGE_CLEAR = 13

export const wallOf = (bridge: Bridge): Wall => {
  const [a, b] = endsOf(bridge)
  return { a, b }
}

/** The wall seen from an island whose keep is at `center`. */
export const wallFrom = (wall: Wall, center: Spot): Wall => ({
  a: [wall.a[0] - center[0], wall.a[1] - center[1]],
  b: [wall.b[0] - center[0], wall.b[1] - center[1]],
})

/** Where on the wall (0…1 along it) the point is nearest. */
function nearestT({ a, b }: Wall, x: number, z: number): number {
  const ex = b[0] - a[0]
  const ez = b[1] - a[1]
  const length2 = ex * ex + ez * ez || 1
  return Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / length2))
}

/** How far the point is from the wall's axis. */
export function wallDistance(wall: Wall, x: number, z: number): number {
  const t = nearestT(wall, x, z)
  return DMath.hypot(wall.a[0] + (wall.b[0] - wall.a[0]) * t - x, wall.a[1] + (wall.b[1] - wall.a[1]) * t - z)
}

/** Whether the point keeps `margin` off every wall. */
export function clearOf(walls: readonly Wall[], x: number, z: number, margin = BRIDGE_CLEAR): boolean {
  for (const wall of walls) if (wallDistance(wall, x, z) < margin) return false
  return true
}

/**
 * The point moved out of every wall's margin, to the side of the wall it is on (on the axis itself,
 * to the wall's right). A point already clear is returned as given.
 */
export function pushedClear(walls: readonly Wall[], x: number, z: number, margin = BRIDGE_CLEAR): Spot {
  let px = x
  let pz = z
  // A push can land in another wall's margin: a few rounds settle it.
  for (let round = 0; round < 4; round++) {
    let moved = false
    for (const wall of walls) {
      const t = nearestT(wall, px, pz)
      const nx = wall.a[0] + (wall.b[0] - wall.a[0]) * t
      const nz = wall.a[1] + (wall.b[1] - wall.a[1]) * t
      const d = DMath.hypot(px - nx, pz - nz)
      if (d >= margin) continue
      const ex = wall.b[0] - wall.a[0]
      const ez = wall.b[1] - wall.a[1]
      const length = DMath.hypot(ex, ez) || 1
      px = nx + (d > 1e-6 ? (px - nx) / d : ez / length) * margin
      pz = nz + (d > 1e-6 ? (pz - nz) / d : -ex / length) * margin
      moved = true
    }
    if (!moved) break
  }
  return [px, pz]
}
