import { DMath } from "../../dmath.ts"
/**
 * Smooth shading with creases, the way a bevelled hand-modelled piece reads: each vertex of a
 * non-indexed mesh takes the area-weighted mean of the face normals of every face that meets it
 * (same position) and leans within the smoothing angle of its own face; a face further round is a
 * crease and does not count. Open slopes read soft and rounded; a ledge's riser, a ridge's crest and
 * a cliff's edge keep a hard line, being more than the angle from the face beside them.
 */

/** The smoothing angle of risers: two walls closer than this blend at their shared vertices (a wall is never blended with ground). */
export const CREASE_DEGREES = 20
/** The ground's own (tops and ramps): wider, so a faceted flank reads as broad planes, not a face-by-face zigzag of light and dark. */
export const GROUND_DEGREES = 25
const COS = DMath.cos((CREASE_DEGREES * Math.PI) / 180)
const COS_GROUND = DMath.cos((GROUND_DEGREES * Math.PI) / 180)
/** A triangle's kind (the `flat` array): ground blends with ground, a wall only with walls, a skirt (flat) with nothing. */
export const WALL = 2
/** Positions closer than this (world units) are one vertex. */
const GRID = 200

/**
 * Vertex normals for triangles `position` (9 numbers each) with face normals `face` (9 each, one per
 * vertex, unit). `flat` gives each triangle's kind: 0 ground, WALL (2) a riser, 1 a skirt that keeps its
 * face normal and joins nothing.
 */
export function smoothNormals(
  position: readonly number[],
  face: readonly number[],
  flat: Uint8Array,
): Float32Array {
  const vertices = position.length / 3
  // Vertices bucketed by position, so the faces meeting at one are found without a pairwise search.
  const buckets = new Map<number, number[]>()
  const cell = (v: number, k: number): number => Math.round((position[v * 3 + k] as number) * GRID)
  for (let v = 0; v < vertices; v++) {
    if (flat[Math.floor(v / 3)]) continue
    const h =
      (Math.imul(cell(v, 0), 73856093) ^ Math.imul(cell(v, 1), 19349663) ^ Math.imul(cell(v, 2), 83492791)) |
      0
    const bucket = buckets.get(h)
    if (bucket) bucket.push(v)
    else buckets.set(h, [v])
  }
  const area = new Float32Array(vertices / 3)
  for (let t = 0; t < area.length; t++) {
    const o = t * 9
    const ax = (position[o + 3] as number) - (position[o] as number)
    const ay = (position[o + 4] as number) - (position[o + 1] as number)
    const az = (position[o + 5] as number) - (position[o + 2] as number)
    const bx = (position[o + 6] as number) - (position[o] as number)
    const by = (position[o + 7] as number) - (position[o + 1] as number)
    const bz = (position[o + 8] as number) - (position[o + 2] as number)
    area[t] = DMath.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
  }
  const normal = Float32Array.from(face)
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    for (const v of bucket) {
      const [fx, fy, fz] = [face[v * 3], face[v * 3 + 1], face[v * 3 + 2]] as [number, number, number]
      const kind = flat[Math.floor(v / 3)]
      const cos = kind === WALL ? COS : COS_GROUND
      let [sx, sy, sz] = [0, 0, 0]
      for (const w of bucket) {
        // Another position that hashed here is not this vertex.
        if (
          Math.abs((position[w * 3] as number) - (position[v * 3] as number)) > 0.01 ||
          Math.abs((position[w * 3 + 1] as number) - (position[v * 3 + 1] as number)) > 0.01 ||
          Math.abs((position[w * 3 + 2] as number) - (position[v * 3 + 2] as number)) > 0.01
        )
          continue
        const [gx, gy, gz] = [face[w * 3], face[w * 3 + 1], face[w * 3 + 2]] as [number, number, number]
        if (flat[Math.floor(w / 3)] !== kind || fx * gx + fy * gy + fz * gz < cos) continue
        const weight = area[Math.floor(w / 3)] as number
        sx += gx * weight
        sy += gy * weight
        sz += gz * weight
      }
      const length = DMath.hypot(sx, sy, sz)
      if (length > 1e-9) {
        normal[v * 3] = sx / length
        normal[v * 3 + 1] = sy / length
        normal[v * 3 + 2] = sz / length
      }
    }
  }
  return normal
}
