/**
 * Smooth shading with creases, the way a bevelled hand-modelled piece reads: each vertex of a
 * non-indexed mesh takes the area-weighted mean of the face normals of every face that meets it
 * (same position) and leans within the smoothing angle of its own face; a face further round is a
 * crease and does not count. Open slopes read soft and rounded; a ledge's riser, a ridge's crest and
 * a cliff's edge keep a hard line, being more than the angle from the face beside them.
 */

/** The smoothing angle: two faces closer than this blend at their shared vertices. */
export const CREASE_DEGREES = 20
const COS = Math.cos((CREASE_DEGREES * Math.PI) / 180)
/** Positions closer than this (world units) are one vertex. */
const GRID = 200

/**
 * Vertex normals for triangles `position` (9 numbers each) with face normals `face` (9 each, one per
 * vertex, unit). `flat` marks triangles that keep their face normal and join nothing (skirts).
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
    area[t] = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
  }
  const normal = Float32Array.from(face)
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    for (const v of bucket) {
      const [fx, fy, fz] = [face[v * 3], face[v * 3 + 1], face[v * 3 + 2]] as [number, number, number]
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
        if (fx * gx + fy * gy + fz * gz < COS) continue
        const weight = area[Math.floor(w / 3)] as number
        sx += gx * weight
        sy += gy * weight
        sz += gz * weight
      }
      const length = Math.hypot(sx, sy, sz)
      if (length > 1e-9) {
        normal[v * 3] = sx / length
        normal[v * 3 + 1] = sy / length
        normal[v * 3 + 2] = sz / length
      }
    }
  }
  return normal
}
