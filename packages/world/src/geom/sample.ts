/** Blue-noise scatter: trees in gardens, rocks in woods. */
import { DMath } from "@guildhall/core"
import { bbox, contains, type Polygon, type Ring } from "./poly.ts"
import { at, dist, snap, type Vec2 } from "./vec.ts"

/** A number in [0, 1) for a salt: `(salt) => roll(seed, salt)` from core. */
export type Roll = (salt: string) => number

/** Candidates tried round each active point before it retires (Bridson's k). */
const TRIES = 30

/**
 * Points inside the ring (or polygon with holes), none closer than `r` to another and no gap much
 * wider than 2r: Bridson's Poisson-disk sampling, every draw from `roll`, so a seed gives the same
 * points everywhere.
 */
export function poissonIn(shape: Ring | Polygon, r: number, roll: Roll): Vec2[] {
  const outer = (typeof shape[0]?.[0] === "number" ? shape : shape[0]) as Ring | undefined
  if (!outer || outer.length < 3 || !(r > 0)) return []
  const [min, max] = bbox(outer)
  const cell = r / Math.SQRT2
  const cols = Math.max(1, Math.ceil((max[0] - min[0]) / cell))
  const rows = Math.max(1, Math.ceil((max[1] - min[1]) / cell))
  const grid = new Int32Array(cols * rows).fill(-1)
  const points: Vec2[] = []
  const active: number[] = []
  let draws = 0
  const draw = () => roll(`${draws++}:poisson`)
  const cellOf = (p: Vec2): [number, number] => [
    Math.min(cols - 1, Math.floor((p[0] - min[0]) / cell)),
    Math.min(rows - 1, Math.floor((p[1] - min[1]) / cell)),
  ]
  const fits = (p: Vec2): boolean => {
    if (p[0] < min[0] || p[0] > max[0] || p[1] < min[1] || p[1] > max[1]) return false
    if (!contains(shape, p, 0)) return false
    const [cx, cz] = cellOf(p)
    for (let z = Math.max(0, cz - 2); z <= Math.min(rows - 1, cz + 2); z++) {
      for (let x = Math.max(0, cx - 2); x <= Math.min(cols - 1, cx + 2); x++) {
        const k = at(grid, z * cols + x)
        if (k >= 0 && dist(at(points, k), p) < r) return false
      }
    }
    return true
  }
  const keep = (p: Vec2) => {
    const [cx, cz] = cellOf(p)
    grid[cz * cols + cx] = points.length
    active.push(points.length)
    points.push(p)
  }
  for (let attempt = 0; attempt < TRIES && points.length === 0; attempt++) {
    const p: Vec2 = [min[0] + draw() * (max[0] - min[0]), min[1] + draw() * (max[1] - min[1])]
    if (fits(p)) keep(p)
  }
  while (active.length > 0) {
    const pick = Math.floor(draw() * active.length)
    const centre = at(points, at(active, pick))
    let placed = false
    for (let t = 0; t < TRIES && !placed; t++) {
      const angle = 2 * Math.PI * draw()
      const radius = r * (1 + draw())
      const p: Vec2 = [centre[0] + radius * DMath.cos(angle), centre[1] + radius * DMath.sin(angle)]
      if (fits(p)) {
        keep(p)
        placed = true
      }
    }
    if (!placed) active.splice(pick, 1)
  }
  return points.map(snap)
}
