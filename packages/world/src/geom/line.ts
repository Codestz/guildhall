/**
 * Polylines: the streets. Smoothing (Chaikin corner cutting, whose limit is the quadratic B-spline),
 * even resampling, segment intersection, distances, and offset curves for the street edges.
 */
import { add, at, cross, dist, dot, EPS, len, lerp, norm, perp, scale, snap, sub, type Vec2 } from "./vec.ts"

/** Beyond this ratio of the offset distance, a miter corner is cut flat (bevelled) instead. */
const MITER_LIMIT = 2

/** The points without consecutive repeats (closer than EPS), and without a repeated closing point when closed. */
export function dedupe(line: readonly Vec2[], closed = false): Vec2[] {
  const out: Vec2[] = []
  for (const p of line) {
    const last = out[out.length - 1]
    if (!last || dist(last, p) > EPS) out.push(p)
  }
  if (closed && out.length > 1 && dist(at(out, 0), at(out, out.length - 1)) <= EPS) out.pop()
  return out
}

/** The polyline's segments as index pairs into its points, wrapping round when closed. */
function segments(n: number, closed: boolean): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i + 1 < n; i++) out.push([i, i + 1])
  if (closed && n > 2) out.push([n - 1, 0])
  return out
}

export function length(line: readonly Vec2[], closed = false): number {
  let sum = 0
  for (const [i, j] of segments(line.length, closed)) sum += dist(at(line, i), at(line, j))
  return sum
}

/**
 * Where segments a1→a2 and b1→b2 cross: the point and its parameters along each (`t` on a, `u` on b,
 * both in [0, 1]). Null when they miss or are parallel (collinear overlaps included).
 */
export function intersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): { at: Vec2; t: number; u: number } | null {
  const r = sub(a2, a1)
  const s = sub(b2, b1)
  const denom = cross(r, s)
  if (Math.abs(denom) < 1e-12 * len(r) * len(s)) return null
  const qp = sub(b1, a1)
  const t = cross(qp, s) / denom
  const u = cross(qp, r) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { at: add(a1, scale(r, t)), t, u }
}

/** The point of segment a→b nearest p, its parameter along the segment, and its distance from p. */
export function closest(p: Vec2, a: Vec2, b: Vec2): { at: Vec2; t: number; d: number } {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2))
  const at = add(a, scale(ab, t))
  return { at, t, d: dist(p, at) }
}

/** The distance from p to the nearest point of the polyline. */
export function distTo(p: Vec2, line: readonly Vec2[], closed = false): number {
  if (line.length === 1) return dist(p, at(line, 0))
  let best = Number.POSITIVE_INFINITY
  for (const [i, j] of segments(line.length, closed))
    best = Math.min(best, closest(p, at(line, i), at(line, j)).d)
  return best
}

/**
 * The polyline at evenly spaced arc lengths, as close to `step` apart as a whole number of steps
 * allows. An open line keeps both its end points; a closed one starts at its first point.
 */
export function resample(line: readonly Vec2[], step: number, closed = false): Vec2[] {
  const pts = dedupe(line, closed)
  if (pts.length < 2 || !(step > 0)) return pts.map(snap)
  const segs = segments(pts.length, closed)
  const total = length(pts, closed)
  const count = Math.max(1, Math.round(total / step))
  const out: Vec2[] = [snap(at(pts, 0))]
  let seg = 0
  let segStart = 0
  for (let k = 1; k < count; k++) {
    const s = (total * k) / count
    for (;;) {
      const [i, j] = at(segs, seg)
      const l = dist(at(pts, i), at(pts, j))
      if (s <= segStart + l || seg === segs.length - 1) {
        out.push(snap(lerp(at(pts, i), at(pts, j), l === 0 ? 0 : (s - segStart) / l)))
        break
      }
      segStart += l
      seg++
    }
  }
  if (!closed) out.push(snap(at(pts, pts.length - 1)))
  return out
}

/**
 * Chaikin corner cutting: each pass replaces every corner by points a quarter and three quarters of
 * the way along its segments. An open line keeps its end points; repeated passes tend to the
 * quadratic B-spline of the original points.
 */
export function chaikin(line: readonly Vec2[], iterations = 1, closed = false): Vec2[] {
  let pts = dedupe(line, closed)
  for (let pass = 0; pass < iterations && pts.length > 2; pass++) {
    const next: Vec2[] = closed ? [] : [at(pts, 0)]
    for (const [i, j] of segments(pts.length, closed)) {
      const a = at(pts, i)
      const b = at(pts, j)
      const first = !closed && i === 0
      const final = !closed && j === pts.length - 1
      if (!first) next.push(lerp(a, b, 0.25))
      if (!final) next.push(lerp(a, b, 0.75))
    }
    if (!closed) next.push(at(pts, pts.length - 1))
    pts = next
  }
  return pts.map(snap)
}

/**
 * The polyline moved `d` to its left (a negative `d` moves it right), every segment parallel to the
 * original at exactly |d|. Corners are mitred, and bevelled when the miter would reach past twice
 * |d|. A curve tighter than |d| folds over itself on its inner side: keep street widths under the
 * curve radius.
 */
export function offsetLine(line: readonly Vec2[], d: number, closed = false): Vec2[] {
  const pts = dedupe(line, closed)
  const n = pts.length
  if (n < 2) return pts.map(snap)
  const normal = (i: number, j: number): Vec2 => perp(norm(sub(at(pts, j), at(pts, i))))
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const p = at(pts, i)
    const hasPrev = closed || i > 0
    const hasNext = closed || i < n - 1
    const prev = hasPrev ? normal((i - 1 + n) % n, i) : null
    const next = hasNext ? normal(i, (i + 1) % n) : null
    if (!prev || !next) {
      out.push(add(p, scale((prev ?? next) as Vec2, d)))
      continue
    }
    const bisector = norm(add(prev, next))
    const cos = dot(bisector, prev)
    if (cos * MITER_LIMIT < 1) {
      out.push(add(p, scale(prev, d)), add(p, scale(next, d)))
    } else {
      out.push(add(p, scale(bisector, d / cos)))
    }
  }
  return out.map(snap)
}

/** The ground polygon of an open street: its centreline widened to `width`, counter-clockwise. */
export function ribbon(line: readonly Vec2[], width: number): Vec2[] {
  const right = offsetLine(line, -width / 2)
  const left = offsetLine(line, width / 2).reverse()
  return [...right, ...left]
}
