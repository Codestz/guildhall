/**
 * Routing on the walk graph (walk.ts) for townsfolk: the graph with every off-street spot a routine
 * uses (a house door, a place to stand by a well or a stall, a lamp) joined onto its nearest walkable
 * edge by a short step, and A* over it. Each arc remembers the walk edge it is a piece of, so a leg
 * can be checked against the graph and drawn with that edge's clip and speed. Boat lanes are left
 * out: townsfolk walk (boats carry them only when a later task says so).
 */
import { closest, intersect } from "../geom/line.ts"
import { contains, type Ring } from "../geom/poly.ts"
import { add, dist, norm, perp, round3, scale, sub, type Vec2 } from "../geom/vec.ts"
import { WALK_RULES, type WalkGraph, type WalkKind } from "./walk.ts"

export type Vec3 = [x: number, y: number, z: number]

/** One way out of a node: a piece of a walk edge (`edge` its id) or a spot's step (`edge` −1). */
export interface Arc {
  to: number
  kind: WalkKind
  edge: number
  /** Metres along it. */
  len: number
  /** Points from this node to `to`, with height. */
  pts: Vec3[]
}

export interface RouteGraph {
  nodes: { at: Vec2; y: number }[]
  out: Arc[][]
  /** The route node of each walk node (the same ids: walk nodes come first). */
  walkNodes: number
}

/** Edge kinds a spot may join (not piers: nobody lives on one; never a boat lane). */
const JOINABLE: ReadonlySet<WalkKind> = new Set([
  "street",
  "road",
  "path",
  "trail",
  "stairs",
  "ramp",
  "bridge",
])

const xz = (p: Vec3): Vec2 => [p[0], p[2]]
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  round3(a[0] + (b[0] - a[0]) * t),
  round3(a[1] + (b[1] - a[1]) * t),
  round3(a[2] + (b[2] - a[2]) * t),
]
const length3 = (pts: readonly Vec3[]): number => {
  let l = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec3
    const b = pts[i] as Vec3
    l += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return l
}

/**
 * The walk graph with each of `spots` joined on: route nodes `0..walk.nodes.length-1` are the walk
 * nodes, then one per spot in order (the returned `spotNodes[i]`). A spot joins the nearest point of
 * a joinable edge, which is split there; a spot already on a node joins that node. A step that would
 * cut through one of `blocked` (a stall, a fountain) joins the nearest point it can reach clear instead
 * (or the nearest point, when none is clear).
 */
export function routeGraph(
  walk: WalkGraph,
  spots: readonly Vec2[],
  blocked: readonly Ring[] = [],
): { graph: RouteGraph; spotNodes: number[] } {
  const nodes = walk.nodes.map((n) => ({ at: n.at, y: n.y }))
  const out: Arc[][] = nodes.map(() => [])
  const arc = (a: number, b: number, kind: WalkKind, edge: number, pts: Vec3[]) => {
    const len = length3(pts)
    out[a]?.push({ to: b, kind, edge, len, pts })
    out[b]?.push({ to: a, kind, edge, len, pts: [...pts].reverse() })
  }

  // Where each spot joins: an edge, the segment and the parameter along it.
  type Join = { edge: number; seg: number; t: number; d: number }
  const joins = spots.map((p): Join => {
    // Only what stands between: not one the spot is on (a garden, a square), not ones far off.
    const near = blocked.filter((r) => r.some((q) => dist(q, p) < 20) && !contains(r, p))
    let best: Join = { edge: -1, seg: 0, t: 0, d: Infinity }
    let clear: Join = best
    for (const e of walk.edges) {
      if (!JOINABLE.has(e.kind)) continue
      for (let k = 0; k + 1 < e.points.length; k++) {
        const c = closest(p, xz(e.points[k] as Vec3), xz(e.points[k + 1] as Vec3))
        if (c.d < best.d) best = { edge: e.id, seg: k, t: c.t, d: c.d }
        if (c.d < clear.d && !crosses(p, c.at, near)) clear = { edge: e.id, seg: k, t: c.t, d: c.d }
      }
    }
    return clear.edge >= 0 ? clear : best
  })

  // Each spot's node, and the node it steps onto the edge at.
  const spotNodes: number[] = []
  const cutsOf = new Map<number, { seg: number; t: number; node: number; at: Vec3 }[]>()
  spots.forEach((p, i) => {
    const j = joins[i] as Join
    const e = walk.edges[j.edge]
    const self = nodes.length
    nodes.push({ at: p, y: 0 })
    out.push([])
    spotNodes.push(self)
    if (!e) return
    const lerped = lerp3(e.points[j.seg] as Vec3, e.points[j.seg + 1] as Vec3, j.t)
    // A spot on the way is cut in exactly where it is, so a walk ends on it.
    const on: Vec3 = j.d > 1e-3 ? lerped : [p[0], lerped[1], p[1]]
    nodes[self] = { at: p, y: on[1] }
    const ends = [e.points[0] as Vec3, e.points[e.points.length - 1] as Vec3]
    const atEnd = ends.findIndex((q) => dist(xz(q), xz(on)) < 1e-3)
    let join: number
    if (atEnd >= 0) join = atEnd === 0 ? e.a : e.b
    else {
      join = nodes.length
      nodes.push({ at: xz(on), y: on[1] })
      out.push([])
      const list = cutsOf.get(e.id) ?? []
      list.push({ seg: j.seg, t: j.t, node: join, at: on })
      cutsOf.set(e.id, list)
    }
    if (j.d > 1e-3) arc(self, join, "path", -1, [[p[0], on[1], p[1]], on])
    else arc(self, join, "path", -1, [on, on])
  })

  // Each walk edge, split at the joins along it (boat lanes left out).
  for (const e of walk.edges) {
    if (e.kind === "boat-lane") continue
    const cuts = (cutsOf.get(e.id) ?? []).sort((x, y) => x.seg - y.seg || x.t - y.t)
    let from = e.a
    let pts: Vec3[] = [e.points[0] as Vec3]
    let k = 0
    for (const c of cuts) {
      for (; k < c.seg; k++) pts.push(e.points[k + 1] as Vec3)
      const p = c.at
      pts.push(p)
      arc(from, c.node, e.kind, e.id, pts)
      from = c.node
      pts = [p]
    }
    for (; k + 1 < e.points.length; k++) pts.push(e.points[k + 1] as Vec3)
    arc(from, e.b, e.kind, e.id, pts)
  }
  return { graph: { nodes, out, walkNodes: walk.nodes.length }, spotNodes }
}

/** Whether the step a→b cuts through any of `rings` (a way that runs over one may be stepped onto). */
const crosses = (a: Vec2, b: Vec2, rings: readonly Ring[]): boolean =>
  rings.some(
    (r) => !contains(r, b) && r.some((q, i) => intersect(a, b, q, r[(i + 1) % r.length] as Vec2) !== null),
  )

/** Seconds-per-metre weight of an arc: slower edge types (stairs, fords) cost more. */
const weight = (a: Arc): number => a.len / WALK_RULES[a.kind].speed

/**
 * The cheapest arcs from `from` to `to` (A*, the straight-line distance as heuristic; no walked
 * edge is faster than a street), or null when `to` cannot be reached. `[]` when they are the same.
 */
export function route(g: RouteGraph, from: number, to: number): Arc[] | null {
  if (from === to) return []
  const goal = g.nodes[to]?.at as Vec2
  const h = (n: number) => dist((g.nodes[n] as { at: Vec2 }).at, goal)
  const best = new Map<number, number>([[from, 0]])
  const came = new Map<number, { prev: number; arc: Arc }>()
  const heap = new Heap()
  heap.push(from, h(from))
  while (heap.size > 0) {
    const n = heap.pop()
    if (n === to) break
    const g0 = best.get(n) as number
    for (const a of g.out[n] ?? []) {
      const c = g0 + weight(a)
      if (c < (best.get(a.to) ?? Infinity) - 1e-9) {
        best.set(a.to, c)
        came.set(a.to, { prev: n, arc: a })
        heap.push(a.to, c + h(a.to))
      }
    }
  }
  if (!came.has(to)) return null
  const arcs: Arc[] = []
  for (let n = to; n !== from; ) {
    const c = came.get(n) as { prev: number; arc: Arc }
    arcs.push(c.arc)
    n = c.prev
  }
  return arcs.reverse()
}

/** A binary min-heap of node ids by priority (ties by insertion order, so routes are stable). */
class Heap {
  private items: { n: number; p: number; i: number }[] = []
  private count = 0
  get size(): number {
    return this.items.length
  }
  push(n: number, p: number): void {
    const items = this.items
    items.push({ n, p, i: this.count++ })
    let k = items.length - 1
    while (k > 0) {
      const up = (k - 1) >> 1
      if (!less(items[k], items[up])) break
      ;[items[k], items[up]] = [items[up] as never, items[k] as never]
      k = up
    }
  }
  pop(): number {
    const items = this.items
    const top = items[0] as { n: number }
    const last = items.pop() as (typeof items)[number]
    if (items.length > 0) {
      items[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1
        const r = l + 1
        let m = k
        if (l < items.length && less(items[l], items[m])) m = l
        if (r < items.length && less(items[r], items[m])) m = r
        if (m === k) break
        ;[items[k], items[m]] = [items[m] as never, items[k] as never]
        k = m
      }
    }
    return top.n
  }
}
const less = (a?: { p: number; i: number }, b?: { p: number; i: number }): boolean =>
  !!a && !!b && (a.p < b.p || (a.p === b.p && a.i < b.i))

/** Half the room a walker may take to the right of an edge's centre line, metres, by edge type. */
export const LANE_ROOM: Readonly<Record<WalkKind, number>> = {
  street: 1.3,
  road: 1.1,
  path: 0.4,
  trail: 0.4,
  stairs: 0.6,
  ramp: 0.6,
  bridge: 0.6,
  ford: 0.3,
  pier: 0.3,
  "boat-lane": 0,
}

/**
 * The points of a run of arcs, each kept to the right of the way it goes by `lane` (0..1) of its
 * edge type's room, so people pass on their own side instead of single file on the centre line. A
 * spot's step and the two ends stay where they are; a corner takes the smaller of its two offsets.
 */
export function laneLine(arcs: readonly Arc[], lane: number): { pts: Vec3[]; seg: Arc[] } {
  const pts: Vec3[] = []
  const seg: Arc[] = []
  for (const a of arcs) {
    if (pts.length === 0) pts.push(a.pts[0] as Vec3)
    for (let i = 1; i < a.pts.length; i++) {
      const p = a.pts[i] as Vec3
      const q = pts[pts.length - 1] as Vec3
      // A point on the last one is the same point (kept as the later, so a walk ends exactly on its spot).
      if (dist(xz(p), xz(q)) < 1e-3) {
        pts[pts.length - 1] = p
        continue
      }
      pts.push(p)
      seg.push(a)
    }
  }
  const room = (i: number) => (seg[i] && seg[i].edge >= 0 ? LANE_ROOM[seg[i].kind] * lane : 0)
  const shifted = pts.map((p, i): Vec3 => {
    if (i === 0 || i === pts.length - 1) return p
    const d = Math.min(room(i - 1), room(i))
    if (d === 0) return p
    const a = norm(sub(xz(p), xz(pts[i - 1] as Vec3)))
    const b = norm(sub(xz(pts[i + 1] as Vec3), xz(p)))
    const mid = norm(add(a, b))
    // The mitre: offset further at a corner so both sides keep the lane, but never more than twice.
    const cos = Math.max(0.5, mid[0] * a[0] + mid[1] * a[1])
    const right = scale(perp(mid[0] === 0 && mid[1] === 0 ? a : mid), -d / cos)
    const at2 = add(xz(p), right)
    return [round3(at2[0]), p[1], round3(at2[1])]
  })
  return { pts: shifted, seg }
}

/** The nearest point to `p` on any edge a spot may join (null when there is none). */
export function nearestOnWalk(walk: WalkGraph, p: Vec2): Vec2 | null {
  let best: { at: Vec2; d: number } | null = null
  for (const e of walk.edges) {
    if (!JOINABLE.has(e.kind)) continue
    for (let k = 0; k + 1 < e.points.length; k++) {
      const c = closest(p, xz(e.points[k] as Vec3), xz(e.points[k + 1] as Vec3))
      if (!best || c.d < best.d) best = c
    }
  }
  return best ? best.at : null
}
