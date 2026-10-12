/**
 * Oriented rectangles: footprints, lots, and the bounding box that decides where a block is cut.
 * A rect's frame is three's `rotation.y = rot`: local +x is world (cos rot, −sin rot) and local +z is
 * world (sin rot, cos rot), so a lot whose +z faces the street renders facing it with no conversion.
 */
import { DMath } from "@guildhall/core"
import { intersect } from "./line.ts"
import { contains, type Polygon, type Ring } from "./poly.ts"
import { add, at, cross, dot, EPS, norm, perp, round3, scale, snap, sub, type Vec2 } from "./vec.ts"

export interface Rect {
  /** Centre. */
  c: Vec2
  rot: number
  /** Extent along local x. */
  w: number
  /** Extent along local z. */
  d: number
}

/** The rect's local x and z axes in world space. */
export function axes(rot: number): { x: Vec2; z: Vec2 } {
  const c = DMath.cos(rot)
  const s = DMath.sin(rot)
  return { x: [c, -s], z: [s, c] }
}

/** The corners, counter-clockwise from local (−x, −z). */
export function rectCorners(r: Rect): Ring {
  const { x, z } = axes(r.rot)
  const hx = scale(x, r.w / 2)
  const hz = scale(z, r.d / 2)
  return [sub(sub(r.c, hx), hz), sub(add(r.c, hx), hz), add(add(r.c, hx), hz), add(sub(r.c, hx), hz)]
}

/** The convex hull, counter-clockwise, without collinear points (Andrew's monotone chain). */
export function hull(points: readonly Vec2[]): Ring {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const half = (list: Vec2[]): Vec2[] => {
    const out: Vec2[] = []
    for (const p of list) {
      while (
        out.length >= 2 &&
        cross(sub(at(out, out.length - 1), at(out, out.length - 2)), sub(p, at(out, out.length - 2))) <= 0
      )
        out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(pts), ...half([...pts].reverse())]
}

/**
 * The smallest-area rectangle round the points, its long side along local x (`w ≥ d`). One of its
 * sides lies along a hull edge, so each edge is tried in turn; the first smallest wins.
 */
export function obb(points: readonly Vec2[]): Rect {
  const h = hull(points)
  let best: { u: Vec2; c: Vec2; w: number; d: number } | null = null
  for (let i = 0; i < h.length; i++) {
    const u = norm(sub(at(h, i + 1), at(h, i)))
    const v = perp(u)
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const p of h) {
      u0 = Math.min(u0, dot(p, u))
      u1 = Math.max(u1, dot(p, u))
      v0 = Math.min(v0, dot(p, v))
      v1 = Math.max(v1, dot(p, v))
    }
    const area = (u1 - u0) * (v1 - v0)
    if (!best || area < best.w * best.d - 1e-9) {
      const c = add(scale(u, (u0 + u1) / 2), scale(v, (v0 + v1) / 2))
      best = u1 - u0 >= v1 - v0 ? { u, c, w: u1 - u0, d: v1 - v0 } : { u: v, c, w: v1 - v0, d: u1 - u0 }
    }
  }
  if (!best) {
    const p = points[0] ?? [0, 0]
    return { c: snap(p), rot: 0, w: 0, d: 0 }
  }
  return { c: snap(best.c), rot: DMath.atan2(-best.u[1], best.u[0]), w: round3(best.w), d: round3(best.d) }
}

/**
 * The rect fronting segment a→b from arc length `s` to `s + w`, reaching `depth` to the segment's
 * left (into a counter-clockwise block) with its local +z facing out across the segment.
 */
export function frontRect(a: Vec2, b: Vec2, s: number, w: number, depth: number): Rect {
  const t = norm(sub(b, a))
  const c = add(add(a, scale(t, s + w / 2)), scale(perp(t), depth / 2))
  return { c: snap(c), rot: DMath.atan2(t[1], -t[0]), w, d: depth }
}

/**
 * Whether two rects share more than a sliver: separating-axis test on their four axes, where
 * touching does not count. Neither does overlapping by under `eps`, by default the two grid steps
 * that rounding both centres can make of two rects packed side by side.
 */
export function rectsOverlap(a: Rect, b: Rect, eps = 2 * EPS): boolean {
  const ca = rectCorners(a)
  const cb = rectCorners(b)
  const ax = axes(a.rot)
  const bx = axes(b.rot)
  for (const axis of [ax.x, ax.z, bx.x, bx.z]) {
    const pa = ca.map((p) => dot(p, axis))
    const pb = cb.map((p) => dot(p, axis))
    const overlap = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb))
    if (overlap <= eps) return false
  }
  return true
}

/**
 * Whether the rect lies inside the ring (or polygon with holes), its sides allowed to lie on the
 * boundary: every corner inside, and no boundary edge or vertex inside the rect cut back by `eps`.
 */
export function rectInPoly(r: Rect, shape: Ring | Polygon, eps = EPS): boolean {
  if (!rectCorners(r).every((p) => contains(shape, p, eps))) return false
  const inner = rectCorners({ ...r, w: Math.max(0, r.w - 2 * eps), d: Math.max(0, r.d - 2 * eps) })
  const rings = typeof shape[0]?.[0] === "number" ? [shape as Ring] : (shape as Polygon)
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = at(ring, i)
      const q = at(ring, i + 1)
      if (strictlyInside(inner, p)) return false
      for (let k = 0; k < 4; k++) if (intersect(p, q, at(inner, k), at(inner, k + 1))) return false
    }
  }
  return true
}

/** Whether p is strictly inside a convex counter-clockwise ring. */
const strictlyInside = (ring: Ring, p: Vec2) =>
  ring.every((a, i) => cross(sub(at(ring, i + 1), a), sub(p, a)) > 0)
