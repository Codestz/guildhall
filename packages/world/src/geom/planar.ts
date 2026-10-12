/**
 * Planar graphs: polylines (the streets) split where they cross, near nodes merged, and the faces
 * (the blocks) walked out of the result.
 */
import { closest, dedupe, intersect } from "./line.ts"
import { area } from "./poly.ts"
import { at, dist, EPS, lerp, snap, type Vec2 } from "./vec.ts"

export interface PlanarEdge {
  a: number
  b: number
  /** The index of the input polyline this edge came from (the first one, where two overlap). */
  src: number
}

export interface PlanarGraph {
  nodes: Vec2[]
  edges: PlanarEdge[]
}

export interface Face {
  /** Counter-clockwise, the face on the left of every side. */
  ring: Vec2[]
  /** `nodes[i]` is `ring[i]`. */
  nodes: number[]
  /** `edges[i]` joins `nodes[i]` to `nodes[i + 1]` (wrapping round). */
  edges: number[]
}

interface Seg {
  a: Vec2
  b: Vec2
  src: number
  /** Parameters along a→b where the segment is cut. */
  cuts: number[]
}

/**
 * The polylines as one planar graph of straight edges: every crossing becomes a node, an end within
 * `tol` of another segment joins it there, and nodes closer than `tol` merge into the first one made
 * (positions on the 1e-3 grid). Merging can, rarely, bend an edge across another: keep `tol` well
 * under the spacing of the streets.
 */
export function planarize(lines: readonly (readonly Vec2[])[], tol = EPS): PlanarGraph {
  const segs: Seg[] = []
  lines.forEach((line, src) => {
    const pts = dedupe(line)
    for (let i = 0; i + 1 < pts.length; i++)
      segs.push({ a: at(pts, i), b: at(pts, i + 1), src, cuts: [0, 1] })
  })
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = at(segs, i)
      const o = at(segs, j)
      const hit = intersect(s.a, s.b, o.a, o.b)
      if (hit) {
        s.cuts.push(hit.t)
        o.cuts.push(hit.u)
      }
      touch(s, o, tol)
      touch(o, s, tol)
    }
  }
  const nodes: Vec2[] = []
  const nodeAt = (p: Vec2): number => {
    for (let k = 0; k < nodes.length; k++) if (dist(at(nodes, k), p) <= tol) return k
    nodes.push(snap(p))
    return nodes.length - 1
  }
  const edges: PlanarEdge[] = []
  const seen = new Set<string>()
  for (const s of segs) {
    const ids = [...new Set(s.cuts)].sort((x, y) => x - y).map((t) => nodeAt(lerp(s.a, s.b, t)))
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = at(ids, k)
      const b = at(ids, k + 1)
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (a === b || seen.has(key)) continue
      seen.add(key)
      edges.push({ a, b, src: s.src })
    }
  }
  return { nodes, edges }
}

/** Cuts `s` where an end of `o` lies within `tol` of its interior (a T-junction). */
function touch(s: Seg, o: Seg, tol: number): void {
  for (const end of [o.a, o.b]) {
    const near = closest(end, s.a, s.b)
    if (near.d <= tol && near.t > 0 && near.t < 1) s.cuts.push(near.t)
  }
}

/**
 * The bounded faces of a planar graph, each walked with the face on its left by always taking the
 * sharpest right turn at a node. The outer face of every component (negative area) is dropped. A
 * dead-end edge shows up inside its face as a there-and-back spike.
 */
export function faces(graph: PlanarGraph): Face[] {
  const { nodes, edges } = graph
  // Half-edge h runs edges[h >> 1] forwards when even, backwards when odd.
  const from = (h: number) => (h & 1 ? at(edges, h >> 1).b : at(edges, h >> 1).a)
  const to = (h: number) => (h & 1 ? at(edges, h >> 1).a : at(edges, h >> 1).b)
  const out: number[][] = nodes.map(() => [])
  for (let h = 0; h < edges.length * 2; h++) at(out, from(h)).push(h)
  const angle = (h: number) => {
    const a = at(nodes, from(h))
    const b = at(nodes, to(h))
    return diamond(b[0] - a[0], b[1] - a[1])
  }
  for (const list of out) list.sort((x, y) => angle(x) - angle(y) || x - y)
  const next = (h: number): number => {
    const list = at(out, to(h))
    const k = list.indexOf(h ^ 1)
    return at(list, k - 1)
  }
  const used = new Uint8Array(edges.length * 2)
  const found: Face[] = []
  for (let start = 0; start < edges.length * 2; start++) {
    if (used[start]) continue
    const walk: number[] = []
    for (let h = start; !used[h]; h = next(h)) {
      used[h] = 1
      walk.push(h)
    }
    const ids = walk.map(from)
    const ring = ids.map((k) => at(nodes, k))
    if (area(ring) > EPS * EPS) found.push({ ring, nodes: ids, edges: walk.map((h) => h >> 1) })
  }
  return found
}

/** A stand-in for the angle of (x, z) in [0, 4), increasing counter-clockwise, without trigonometry. */
function diamond(x: number, z: number): number {
  if (z >= 0) return x >= 0 ? z / (x + z || 1) : 1 - x / (-x + z)
  return x < 0 ? 2 - z / (-x - z) : 3 + x / (x - z)
}
