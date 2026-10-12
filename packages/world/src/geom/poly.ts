/**
 * Polygons: blocks, lots, plazas, water. Booleans go through `polygon-clipping` (pure, + − × ÷ only)
 * and nothing else in the repo imports it. Offsets are built on the booleans: the polygon grown by
 * (or cut back by) one strip per edge plus a mitred join per open corner, so an offset that splits a
 * block, or closes a courtyard, comes out right without any self-intersection repair.
 */
import pc from "polygon-clipping"
import { closest, dedupe } from "./line.ts"
import { add, at, cross, dot, EPS, len, norm, perp, scale, snap, sub, type Vec2 } from "./vec.ts"

/** A closed loop of points, the closing point not repeated. */
export type Ring = Vec2[]
/** An outer ring (counter-clockwise) followed by its holes (clockwise). */
export type Polygon = Ring[]
export type MultiPolygon = Polygon[]
/** What the booleans take: a bare ring, a polygon with holes, or several polygons. */
export type Shape = Ring | Polygon | MultiPolygon
export type ClipOp = "union" | "intersection" | "difference" | "xor"

/** Beyond this ratio of the offset distance, an offset corner is cut square instead of mitred. */
const MITER_LIMIT = 2

/** Signed area: positive when the ring runs counter-clockwise. */
export function area(ring: readonly Vec2[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = at(ring, i)
    const b = at(ring, i + 1)
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

/** The area covered: outer rings minus their holes, summed over every polygon. */
export function shapeArea(shape: Shape): number {
  let sum = 0
  for (const poly of toMulti(shape)) {
    poly.forEach((ring, i) => {
      sum += i === 0 ? Math.abs(area(ring)) : -Math.abs(area(ring))
    })
  }
  return sum
}

/** The ring running counter-clockwise (or clockwise when `ccw` is false), as a copy. */
export function orient(ring: readonly Vec2[], ccw = true): Ring {
  return area(ring) > 0 === ccw ? [...ring] : [...ring].reverse()
}

/** The area centroid of a ring (its vertex mean when it has no area). */
export function centroid(ring: readonly Vec2[]): Vec2 {
  const a = area(ring)
  if (Math.abs(a) < 1e-12) {
    let x = 0
    let z = 0
    for (const p of ring) {
      x += p[0]
      z += p[1]
    }
    return [x / ring.length, z / ring.length]
  }
  let cx = 0
  let cz = 0
  for (let i = 0; i < ring.length; i++) {
    const p = at(ring, i)
    const q = at(ring, i + 1)
    const c = p[0] * q[1] - q[0] * p[1]
    cx += (p[0] + q[0]) * c
    cz += (p[1] + q[1]) * c
  }
  return [cx / (6 * a), cz / (6 * a)]
}

/** The axis-aligned bounds of every point given, as [min, max]. */
export function bbox(points: readonly Vec2[]): [min: Vec2, max: Vec2] {
  let min: Vec2 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  let max: Vec2 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const p of points) {
    min = [Math.min(min[0], p[0]), Math.min(min[1], p[1])]
    max = [Math.max(max[0], p[0]), Math.max(max[1], p[1])]
  }
  return [min, max]
}

/**
 * Whether p is inside the ring, or the polygon with holes. A point within `eps` of an edge counts as
 * inside, so a lot whose front lies on the block edge is inside the block.
 */
export function contains(shape: Ring | Polygon, p: Vec2, eps = EPS): boolean {
  const rings = isRing(shape) ? [shape] : shape
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = at(ring, i)
      const b = at(ring, j)
      if (closest(p, a, b).d <= eps) return true
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
        inside = !inside
      }
    }
  }
  return inside
}

/**
 * The boolean `a op b`, as clean polygons on the 1e-3 grid (outer rings CCW, holes CW). The
 * polygons within one multipolygon must not overlap each other: union them first if they might.
 */
export function clip(a: Shape, b: Shape, op: ClipOp): MultiPolygon {
  return run(op, toMulti(a), [toMulti(b)])
}

/**
 * The shape grown outward by `d` (or shrunk inward by −d), with mitred corners (cut square past
 * twice |d|). A shrink can split the shape in several pieces or remove it: the result is every piece.
 */
export function offset(shape: Shape, d: number): MultiPolygon {
  const multi = toMulti(shape).map((poly) => poly.map((ring, i) => orient(ring, i === 0)))
  if (d === 0 || multi.length === 0) return run("union", multi, [])
  // Each piece is its own operand: the booleans expect a multipolygon's members not to overlap.
  const pieces = multi.flatMap((poly) => poly.flatMap((ring) => buffer(ring, d))).map((ring) => [[ring]])
  return run(d > 0 ? "union" : "difference", multi, pieces)
}

/**
 * The shape cut by the infinite line through p along dir: the pieces to the left of the direction
 * and those to its right. Together they cover exactly the shape.
 */
export function splitByLine(shape: Shape, p: Vec2, dir: Vec2): { left: MultiPolygon; right: MultiPolygon } {
  const multi = toMulti(shape)
  const t = norm(dir)
  const n = perp(t)
  const [min, max] = bbox(multi.flat(2))
  const reach = len(sub(max, min)) + len(sub(p, scale(add(min, max), 0.5))) + 1
  const half = (side: number): Ring => {
    const back = add(p, scale(t, -reach))
    const front = add(p, scale(t, reach))
    const lift = scale(n, side * 2 * reach)
    return [back, front, add(front, lift), add(back, lift)]
  }
  return {
    left: run("intersection", multi, [[[half(1)]]]),
    right: run("intersection", multi, [[[half(-1)]]]),
  }
}

/**
 * The thin pieces whose union (with the ring's region, when growing) or removal (when shrinking) makes
 * the offset: one strip per edge on the side the offset moves into, and a mitred join at each corner
 * where two strips open a gap (convex corners when growing, reflex ones when shrinking).
 */
function buffer(raw: Ring, d: number): Ring[] {
  // The outer ring runs CCW and holes CW, so the region's outside is always on an edge's right.
  const ring = dedupe(raw, true)
  const n = ring.length
  if (n < 3) return []
  const reach = Math.abs(d)
  const side = d > 0 ? -1 : 1 // right normal when growing, left when shrinking
  const dirs = ring.map((p, i) => norm(sub(at(ring, i + 1), p)))
  const out: Ring[] = []
  for (let i = 0; i < n; i++) {
    const a = at(ring, i)
    const b = at(ring, i + 1)
    const s = scale(perp(at(dirs, i)), side * reach)
    out.push([a, b, add(b, s), add(a, s)])
  }
  for (let i = 0; i < n; i++) {
    const t1 = at(dirs, i - 1)
    const t2 = at(dirs, i)
    const turn = cross(t1, t2)
    // A gap opens on the moving side when the boundary turns away from it.
    const reversal = dot(t1, t2) < -1 + 1e-9
    if (!reversal && turn * side >= 0) continue
    const v = at(ring, i)
    const s1 = scale(perp(t1), side)
    const s2 = scale(perp(t2), side)
    const sum = add(s1, s2)
    const bis = reversal || len(sum) < 1e-9 ? t1 : norm(sum)
    const cos = dot(bis, s1)
    const p1 = add(v, scale(s1, reach))
    const p2 = add(v, scale(s2, reach))
    if (!reversal && cos * MITER_LIMIT >= 1) {
      out.push([v, p1, add(v, scale(bis, reach / cos)), p2])
    } else {
      // Cut square: extend each offset line until it is MITER_LIMIT·|d| from v along the bisector.
      const l1 = (MITER_LIMIT * reach - reach * dot(s1, bis)) / dot(t1, bis)
      const l2 = (MITER_LIMIT * reach - reach * dot(s2, bis)) / -dot(t2, bis)
      out.push([v, p1, add(p1, scale(t1, l1)), add(p2, scale(t2, -l2)), p2])
    }
  }
  return out
}

function isRing(shape: Shape | Ring): shape is Ring {
  const first = shape[0]
  return first !== undefined && typeof first[0] === "number"
}

function toMulti(shape: Shape): MultiPolygon {
  if (shape.length === 0) return []
  if (isRing(shape)) return [[shape]]
  const first = shape[0] as Ring | Polygon
  return isRing(first) ? [shape as Polygon] : (shape as MultiPolygon)
}

function run(op: ClipOp, subject: MultiPolygon, clips: MultiPolygon[]): MultiPolygon {
  const input = (m: MultiPolygon) => m.map((poly) => poly.map((ring) => ring.map(snap)))
  const others = clips.filter((m) => m.length > 0)
  if (subject.length === 0) {
    // Nothing intersected or cut is nothing; nothing joined to the rest is the rest.
    const [first, ...rest] = others
    return op === "intersection" || op === "difference" || !first ? [] : run(op, first, rest)
  }
  const result = pc[op](input(subject), ...others.map(input))
  const out: MultiPolygon = []
  for (const poly of result) {
    const rings = poly
      .map((ring) =>
        dedupe(
          ring.map((p) => snap(p as Vec2)),
          true,
        ),
      )
      .filter((ring) => ring.length >= 3 && Math.abs(area(ring)) > EPS * EPS)
    const [outer, ...holes] = rings
    if (!outer) continue
    out.push([orient(outer), ...holes.map((h) => orient(h, false))])
  }
  return out
}
