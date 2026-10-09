/**
 * Sight over relief (terrain v2 §5): whether a massif stands between two points. The ray is marched
 * with the relief's own `heightAt` (undefined off every massif) every STEP units from SKIP units out
 * of the first point, and only until it has risen past the tallest peak: a camera hundreds of units
 * back costs no more than one that stands near.
 */

export interface Point {
  x: number
  y: number
  z: number
}

export type ReliefHeight = (x: number, z: number) => number | undefined

/** Samples this far apart, world units; the ground right at the subject's feet is not an obstacle. */
const STEP = 1.5
const SKIP = 2
/** The ray clears a face it passes this far above (a shoulder, a ledge). */
const SLACK = 0.5
/** Most samples one ray takes (a near-level ray over a long island). */
const MAX_STEPS = 90

/** True when relief rises above the straight line from `a` to `b`. `peak` is the tallest ground. */
export function blocked(heightAt: ReliefHeight, peak: number, a: Point, b: Point): boolean {
  const { x: ax, y: ay, z: az } = a
  const dx = b.x - ax
  const dy = b.y - ay
  const dz = b.z - az
  const length = Math.hypot(dx, dy, dz)
  if (length < SKIP) return false
  // How far along the segment the ray is still low enough to meet a peak.
  const reach = dy > 0 ? Math.min(length, ((peak + SLACK - ay) / dy) * length) : length
  const steps = Math.min(MAX_STEPS, Math.ceil((reach - SKIP) / STEP))
  for (let i = 0; i < steps; i++) {
    const t = (SKIP + i * STEP) / length
    const ground = heightAt(ax + dx * t, az + dz * t)
    if (ground !== undefined && ground > ay + dy * t + SLACK) return true
  }
  return false
}
