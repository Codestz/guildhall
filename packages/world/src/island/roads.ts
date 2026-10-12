/**
 * Growth step 2 (plan-w8 §4.2, ADR 012, ADR 014): the main roads. A road exists because it leads
 * somewhere, so first the island's reasons for one, in story order: the best other bay, the biggest
 * lake's shore, the rough ground's edge, the far headland. Each is routed from the main town's exit
 * whose bearing is nearest it, by A* over the road cost field with the roads already built cheap, so
 * a later road runs out along an earlier one and leaves it where its own way parts.
 *
 * Only the stretches a road adds are drawn: where its cells leave the network it branches off, where
 * they come back it merges in, and the network edge it touches is split there (a `junction`). A branch
 * leaves a little behind the cell it parted at, so it peels off in a Y rather than a sharp T, and if a
 * new stretch still crosses an older edge the two are split at the crossing. Every stretch is string-
 * pulled and rounded over the cost without the network's discount: the line follows the land, not the
 * raster of the road beside it. Road k (in reason order) is `grown 1 + k`.
 */
import { closest, distTo, intersect, length } from "../geom/line.ts"
import { area, centroid, type Ring } from "../geom/poly.ts"
import {
  type CostGrid,
  cellAt,
  cellCentre,
  gridAStar,
  lineCost,
  smoothRoute,
  stringPull,
} from "../geom/route.ts"
import type { Roll } from "../geom/sample.ts"
import { add, dist, dot, len, norm, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { costField, OCCUPANTS, type Occupancy } from "./cost.ts"
import {
  GROUND_KINDS,
  type IslandSite,
  type NormalIslandSpec,
  type RoadEdge,
  type RoadNetwork,
  type RoadNode,
  type Settlement,
} from "./types.ts"

/** Somewhere a main road leads, and the open ground by it where the road ends. */
export interface Reason {
  /** `bay:<bay id>`, `lake:<i>`, `rough:<i>`, `headland:<i>` (indices into the site's lists). */
  id: string
  kind: "bay" | "lake" | "rough" | "headland"
  /** The feature itself: the bay's innermost shore, the lake's or the rough's nearest edge, the cape's tip. */
  toward: Vec2
  /** Where the road ends: open land beside it. */
  at: Vec2
}

/** A far bay counts when it lies at least this share of half the coast away from the harbour's, along the coast. */
const BAY_ALONG = 0.6
/** Metres the road's end stands back from its feature, and the clearance its cell keeps from coast and lakes. */
const STAND_OFF = 16
const CLEAR = 12
/** How far round the stand-off point an open cell is looked for, metres. */
const SEARCH = 60
/** A far headland lies at least this many frame reaches from the town's centre. */
const FAR = 1.5
/** A reason whose end lies this near an earlier one's is the same destination, metres. */
const SAME = 30
/** An excursion off the network shorter than this many cells, between two stretches on it, is noise. */
const JOG = 4
/** A branch leaves (a merge joins) this many metres back along the road it meets: [min, max], rolled. */
const PEEL: readonly [number, number] = [12, 28]
/** A junction keeps this far from either end of the edge it splits, metres; nearer, it takes that end. */
const END_GAP = 6
const ROAD_WIDTH = 4
/** The lie of the land: [lattice pitch, metres; strength]. */
const GRAIN: readonly [number, number] = [90, 2]

const LAND = GROUND_KINDS.indexOf("land")
const FRAME = OCCUPANTS.indexOf("frame")

/** The island's reasons for a main road, in growth order (§4.2); each one a distinct destination. */
export function reasons(site: IslandSite, main: Settlement): Reason[] {
  const out: Reason[] = []
  const push = (r: Omit<Reason, "at">, from: Vec2) => {
    const at = openNear(site, main, from)
    if (!at || out.some((o) => dist(o.at, at) < SAME)) return
    out.push({ ...r, at })
  }

  const bay = farBay(site)
  if (bay)
    push({ id: `bay:${bay.id}`, kind: "bay", toward: bay.shore }, sub(bay.shore, scale(bay.out, STAND_OFF)))

  // A lake's or a rock field's road comes to its side nearest the town's way out, outside the frame.
  const exits = exitsOf(main).map((e) => e.at)
  const from = exits.length > 0 ? exits : [main.origin]
  const edgeOf = (ring: Ring): Vec2 | null => {
    const mid = centroid(ring)
    const outside = ring.filter(
      (p) => dist(away(p, mid), main.origin) > main.frame.reach + 2 * site.ground.cell,
    )
    if (outside.length === 0) return null
    const gap = (p: Vec2) => Math.min(...from.map((q) => dist(q, p)))
    return outside.reduce((a, b) => (gap(b) < gap(a) - 1e-9 ? b : a))
  }
  for (const kind of ["lake", "rough"] as const) {
    const rings = kind === "lake" ? site.lakes : site.rough
    const i = biggest(rings)
    const edge = i >= 0 ? edgeOf(rings[i] as Ring) : null
    if (edge) push({ id: `${kind}:${i}`, kind, toward: edge }, away(edge, centroid(rings[i] as Ring)))
  }

  // The cape furthest from the town; the two that flank the harbour's mouth are not far.
  let far = -1
  site.headlands.forEach((tip, i) => {
    if (dist(tip, main.origin) < FAR * main.frame.reach) return
    if (far < 0 || dist(tip, main.origin) > dist(site.headlands[far] as Vec2, main.origin)) far = i
  })
  if (far >= 0) {
    const tip = site.headlands[far] as Vec2
    push(
      { id: `headland:${far}`, kind: "headland", toward: tip },
      add(tip, scale(norm(sub(site.centre, tip)), 2 * STAND_OFF)),
    )
  }
  return out
}

/**
 * The main roads: one per reason, in order, from the main town's nearest exit to the reason's end,
 * sharing the roads before it. A reason nothing reaches (walled off by water) gets no road.
 */
export function mainRoads(
  site: IslandSite,
  main: Settlement,
  _spec: NormalIslandSpec,
  roll: Roll,
): RoadNetwork {
  const { ground } = site
  const occupancy = frameOccupancy(site, main)
  const lie = grain(site, roll)
  const base: CostGrid = grid(site, lay(costField(ground, "road", occupancy), lie))
  const exits = exitsOf(main)
  const net = new Network()

  reasons(site, main).forEach((reason, k) => {
    const bearing = Math.atan2(reason.at[1] - main.origin[1], reason.at[0] - main.origin[0])
    const exit = exits.reduce<RoadNode | null>((best, e) => {
      if (!best) return e
      return turn(e.at, main.origin, bearing) < turn(best.at, main.origin, bearing) ? e : best
    }, null)
    if (!exit) return
    // The cost with the network so far cheap, every exit open (an unused one is not a node yet).
    const routing = { nodes: [...net.nodes, ...exits], edges: net.edges }
    const g = grid(site, lay(costField(ground, "road", occupancy, routing), lie))
    const cells = gridAStar(g, cellAt(g, exit.at), cellAt(g, reason.at))
    if (!cells) return
    // Every cost off the network is at least 1; on it, the road's discount.
    const on = cells.map((c) => (g.cost[c] as number) < 1)
    for (let i = 0; i < on.length; ) {
      let j = i
      while (j < on.length && on[j] === on[i]) j++
      if (!on[i] && i > 0 && j < on.length && j - i < JOG) for (let m = i; m < j; m++) on[m] = true
      i = j
    }
    const peel = PEEL[0] + (PEEL[1] - PEEL[0]) * roll(`road:${reason.id}`)
    const grown = 1 + k
    const stamp = { reason: reason.id, grown }
    let reached = false
    for (let s = 0; s < cells.length; ) {
      if (on[s]) {
        s++
        continue
      }
      let e = s
      while (e + 1 < cells.length && !on[e + 1]) e++
      const run = cells.slice(Math.max(0, s - 1), Math.min(cells.length, e + 2))
      const centre = (i: number) => cellCentre(g, cells[Math.max(0, Math.min(cells.length - 1, i))] as number)
      // Pulled and rounded over the land without the network's discount, the run's own cells open (an
      // exit, or a road through the town's frame, is closed ground otherwise). Its ends: the exit, the
      // reason's end, or the point of the network it leaves or joins, moved along it (behind a branch,
      // ahead of a merge) so the two fork in a Y.
      const land: CostGrid = { ...base, cost: base.cost.slice() }
      for (const c of run) if (!Number.isFinite(land.cost[c] as number)) land.cost[c] = 1
      let line = stringPull(run, land)
      let from: OnEdge | null = null
      let to: OnEdge | null = null
      if (s === 0) line[0] = exit.at
      else {
        from = net.project(centre(s - 1)) as OnEdge
        line[0] = from.at
        const y = net.fork(from, sub(centre(s - 4), centre(s - 1)), peel, line, land)
        if (y) [from, line] = [y.on, y.line]
      }
      if (e === cells.length - 1) line[line.length - 1] = reason.at
      else {
        to = net.project(centre(e + 1)) as OnEdge
        line[line.length - 1] = to.at
        const y = net.fork(to, sub(centre(e + 4), centre(e + 1)), peel, [...line].reverse(), land)
        if (y) [to, line] = [y.on, y.line.reverse()]
      }
      const a = from ? net.attach(from) : net.node(exit)
      // Attaching the start may have split the edge the end lies on: find it again.
      const b = to
        ? net.attach(net.project(to.at) as OnEdge)
        : net.add({ at: reason.at, kind: "end", ref: reason.id })
      if (!to) reached = true
      if (a !== b) net.road(a, b, smoothRoute(line, land), stamp)
      s = e + 1
    }
    // The whole way on roads already built: the reason's end is a point on them.
    if (!reached) {
      const p = net.project(reason.at)
      if (p) {
        const id = net.attach(p)
        const node = net.nodes[id] as RoadNode
        node.ref ??= reason.id
      }
    }
  })
  return { nodes: net.nodes, edges: net.edges }
}

/** A point on an edge: which edge, after which of its points, and where. */
interface OnEdge {
  edge: number
  seg: number
  at: Vec2
}

/** The network as it grows: nodes and edges, splitting an edge wherever a road meets or crosses it. */
class Network {
  nodes: RoadNode[] = []
  edges: RoadEdge[] = []

  add(n: Omit<RoadNode, "id">): number {
    const id = this.nodes.length
    this.nodes.push({ id, ...n })
    return id
  }

  /** The node for a town exit, added on first use. */
  node(exit: RoadNode): number {
    const known = this.nodes.find((n) => n.kind === "exit" && n.ref === exit.ref)
    return known ? known.id : this.add({ at: exit.at, kind: "exit", ref: exit.ref })
  }

  /** The nearest point of any edge to p, or null with no edges. */
  project(p: Vec2): OnEdge | null {
    let best: (OnEdge & { d: number }) | null = null
    for (const e of this.edges)
      for (let i = 1; i < e.points.length; i++) {
        const c = closest(p, e.points[i - 1] as Vec2, e.points[i] as Vec2)
        if (!best || c.d < best.d - 1e-9) best = { edge: e.id, seg: i - 1, at: c.at, d: c.d }
      }
    return best
  }

  /**
   * A Y where a road leaves the network at `on` (its `line` starting there): the fork point slid
   * `peel` metres along the edge the way `toward` points, and the road's line from there straight to
   * its point `peel` metres out, then on as before. Null where that would not read as a fork: the
   * edge too short, the road still hugging it, or the new leg touching the impassable or another edge.
   */
  fork(
    on: OnEdge,
    toward: Vec2,
    peel: number,
    line: Vec2[],
    g: CostGrid,
  ): { on: OnEdge; line: Vec2[] } | null {
    const e = this.edges[on.edge] as RoadEdge
    const total = length(e.points)
    const s0 = arcAt(e.points, on)
    const dir = sub(pointAt(e.points, Math.min(total, s0 + 1)), pointAt(e.points, Math.max(0, s0 - 1)))
    if (len(toward) < 1 || len(dir) === 0) return null
    const s = s0 + (dot(dir, toward) >= 0 ? peel : -peel)
    if (s < END_GAP || s > total - END_GAP) return null
    const q = onEdgeAt(e, s)
    const out = onLine(line, peel)
    const b = out.at
    if (distTo(b, e.points) < 0.4 * peel) return null
    if (!Number.isFinite(lineCost(g, toGrid(g, q.at), toGrid(g, b)))) return null
    for (const f of this.edges)
      for (let k = 1; k < f.points.length; k++) {
        const x = intersect(q.at, b, f.points[k - 1] as Vec2, f.points[k] as Vec2)
        if (x && dist(x.at, q.at) > 1) return null
      }
    return { on: q, line: [q.at, b, ...line.slice(out.seg + 1)] }
  }

  /** The node at a point on an edge: an end of the edge when near one, else a junction splitting it. */
  attach(p: OnEdge): number {
    const e = this.edges[p.edge] as RoadEdge
    const s = arcAt(e.points, p)
    if (s < END_GAP) return e.a
    if (length(e.points) - s < END_GAP) return e.b
    return this.split(e, p.seg, snap(p.at))
  }

  /** Splits edge e at `at`, which lies on its segment `seg`; returns the new junction. */
  private split(e: RoadEdge, seg: number, at: Vec2): number {
    if (dist(at, (this.nodes[e.a] as RoadNode).at) < 0.01) return e.a
    if (dist(at, (this.nodes[e.b] as RoadNode).at) < 0.01) return e.b
    const id = this.add({ at, kind: "junction" })
    const head = [...e.points.slice(0, seg + 1), at]
    const tail = [at, ...e.points.slice(seg + 1)]
    this.edges.push({ ...e, id: this.edges.length, a: id, points: dedupe(tail) })
    e.b = id
    e.points = dedupe(head)
    return id
  }

  /** Adds a road a → b, splitting it and any older edge wherever the two cross. */
  road(a: number, b: number, points: Vec2[], stamp: { reason: string; grown: number }): void {
    points[0] = (this.nodes[a] as RoadNode).at
    points[points.length - 1] = (this.nodes[b] as RoadNode).at
    let from = a
    let rest = points
    for (;;) {
      const hit = this.firstCrossing(rest, from)
      if (!hit) break
      const j = this.split(this.edges[hit.edge] as RoadEdge, hit.seg, hit.at)
      this.push(from, j, [...rest.slice(0, hit.mine + 1), hit.at], stamp)
      from = j
      rest = [hit.at, ...rest.slice(hit.mine + 1)]
    }
    this.push(from, b, rest, stamp)
  }

  private push(a: number, b: number, points: Vec2[], stamp: { reason: string; grown: number }): void {
    const line = dedupe(points)
    if (a === b || line.length < 2) return
    this.edges.push({
      id: this.edges.length,
      a,
      b,
      cls: "road",
      points: line,
      width: ROAD_WIDTH,
      walk: "road",
      reason: stamp.reason,
      grown: stamp.grown,
    })
  }

  /** The first point along `line` (leaving node `from`) where it crosses an edge away from its own ends. */
  private firstCrossing(line: Vec2[], from: number): (OnEdge & { mine: number }) | null {
    const start = (this.nodes[from] as RoadNode).at
    const end = line[line.length - 1] as Vec2
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1] as Vec2
      const q = line[i] as Vec2
      let best: (OnEdge & { mine: number; t: number }) | null = null
      for (const e of this.edges)
        for (let k = 1; k < e.points.length; k++) {
          const x = intersect(p, q, e.points[k - 1] as Vec2, e.points[k] as Vec2)
          if (!x || dist(x.at, start) < 1 || dist(x.at, end) < 1) continue
          if (!best || x.t < best.t) best = { edge: e.id, seg: k - 1, at: snap(x.at), mine: i - 1, t: x.t }
        }
      if (best) return best
    }
    return null
  }
}

/** The town's exits in island coordinates, as road nodes (not yet numbered). */
function exitsOf(main: Settlement): RoadNode[] {
  return main.layout.streets.nodes
    .filter((n) => n.tag === "exit")
    .map((n) => ({ id: -1, at: snap(add(main.origin, n.at)), kind: "exit", ref: `${main.id}#${n.id}` }))
}

/**
 * The lie of the land until M4 brings slope: a seeded, gentle, low-frequency unevenness (×1 to
 * ×1 + GRAIN[1] per cell, bilinear over a GRAIN[0] m lattice) that a road bends round, so open
 * country gives easy curves rather than ruled lines.
 */
function grain(site: IslandSite, roll: Roll): Float32Array {
  const { w, h, cell } = site.ground
  const [pitch, amp] = GRAIN
  const lw = Math.ceil((w * cell) / pitch) + 2
  const lh = Math.ceil((h * cell) / pitch) + 2
  const knot = new Float32Array(lw * lh)
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) knot[j * lw + i] = roll(`grain:${i}:${j}`)
  const out = new Float32Array(w * h)
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) * cell) / pitch
      const v = ((z + 0.5) * cell) / pitch
      const i = Math.floor(u)
      const j = Math.floor(v)
      const fu = smooth(u - i)
      const fv = smooth(v - j)
      const k = (a: number, b: number) => knot[b * lw + a] as number
      const top = k(i, j) + (k(i + 1, j) - k(i, j)) * fu
      const bottom = k(i, j + 1) + (k(i + 1, j + 1) - k(i, j + 1)) * fu
      out[z * w + x] = 1 + amp * (top + (bottom - top) * fv)
    }
  return out
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/** The cost with the lie of the land laid on every cell off the network (on it, the road's discount stands). */
function lay(cost: Float32Array, lie: Float32Array): Float32Array {
  for (let i = 0; i < cost.length; i++)
    if ((cost[i] as number) >= 1) cost[i] = (cost[i] as number) * (lie[i] as number)
  return cost
}

/** Which cells a settlement's frame closes: those whose centre lies within its reach. */
function frameOccupancy(site: IslandSite, main: Settlement): Occupancy {
  const { w, h, cell, origin } = site.ground
  const use = new Uint8Array(w * h)
  const reach = main.frame.reach
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      const p: Vec2 = [origin[0] + (x + 0.5) * cell, origin[1] + (z + 0.5) * cell]
      if (dist(p, main.origin) < reach) use[z * w + x] = FRAME
    }
  return { use }
}

const grid = (site: IslandSite, cost: Float32Array): CostGrid => ({
  w: site.ground.w,
  h: site.ground.h,
  cost,
  cell: site.ground.cell,
  origin: site.ground.origin,
})

const toGrid = (g: CostGrid, p: Vec2): Vec2 => {
  const c = g.cell ?? 1
  const o = g.origin ?? [0, 0]
  return [(p[0] - o[0]) / c, (p[1] - o[1]) / c]
}

/**
 * The centre of the open land cell nearest p (plain land: not shore, rough or water, clear of the
 * coast and the lakes, outside the town's frame), within SEARCH metres; null if there is none.
 */
function openNear(site: IslandSite, main: Settlement, p: Vec2): Vec2 | null {
  const g = site.ground
  const cx = Math.floor((p[0] - g.origin[0]) / g.cell)
  const cz = Math.floor((p[1] - g.origin[1]) / g.cell)
  const r = Math.ceil(SEARCH / g.cell)
  let best: Vec2 | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (let z = Math.max(0, cz - r); z <= Math.min(g.h - 1, cz + r); z++)
    for (let x = Math.max(0, cx - r); x <= Math.min(g.w - 1, cx + r); x++) {
      const i = z * g.w + x
      if (g.kind[i] !== LAND || (g.coastDist[i] as number) < CLEAR || (g.lakeDist[i] as number) < CLEAR)
        continue
      const c: Vec2 = [g.origin[0] + (x + 0.5) * g.cell, g.origin[1] + (z + 0.5) * g.cell]
      if (dist(c, main.origin) < main.frame.reach + g.cell) continue
      const d = dist(c, p)
      if (d < bestD - 1e-9) {
        best = c
        bestD = d
      }
    }
  return best && bestD <= SEARCH ? snap(best) : null
}

/** The far bay furthest along the coast from the harbour's, if one is far enough to be worth a road. */
function farBay(site: IslandSite) {
  const ring = site.coast
  const main = site.bays.find((b) => b.main)
  if (!main || ring.length < 3) return null
  const arcs = [0]
  for (let i = 1; i <= ring.length; i++)
    arcs.push((arcs[i - 1] as number) + dist(ring[i - 1] as Vec2, ring[i % ring.length] as Vec2))
  const perimeter = arcs[ring.length] as number
  const arcOf = (p: Vec2) => arcs[ring.indexOf(nearest(ring, p))] as number
  const home = arcOf(main.shore)
  let best: { bay: (typeof site.bays)[number]; along: number } | null = null
  for (const bay of site.bays) {
    if (bay.main) continue
    const d = Math.abs(arcOf(bay.shore) - home)
    const along = Math.min(d, perimeter - d)
    if (along >= (BAY_ALONG * perimeter) / 2 && (!best || along > best.along)) best = { bay, along }
  }
  return best?.bay ?? null
}

/** The index of the ring with the largest area, -1 for none. */
function biggest(rings: readonly Ring[]): number {
  let best = -1
  rings.forEach((ring, i) => {
    if (best < 0 || Math.abs(area(ring)) > Math.abs(area(rings[best] as Ring))) best = i
  })
  return best
}

/** The ring's vertex nearest p (the first of equals). */
function nearest(ring: readonly Vec2[], p: Vec2): Vec2 {
  return ring.reduce((a, b) => (dist(b, p) < dist(a, p) ? b : a))
}

/** STAND_OFF metres on from `edge`, away from `centre`. */
const away = (edge: Vec2, centre: Vec2): Vec2 => add(edge, scale(norm(sub(edge, centre)), STAND_OFF))

/** How far the bearing of p from o turns from `bearing`, radians in [0, π]. */
function turn(p: Vec2, o: Vec2, bearing: number): number {
  const d = Math.abs(Math.atan2(p[1] - o[1], p[0] - o[0]) - bearing) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

/** The arc length along `line` of a point on its segment `seg`. */
function arcAt(line: readonly Vec2[], p: { seg: number; at: Vec2 }): number {
  let s = 0
  for (let i = 1; i <= p.seg; i++) s += dist(line[i - 1] as Vec2, line[i] as Vec2)
  return s + dist(line[p.seg] as Vec2, p.at)
}

/** The point at arc length s along the line. */
function pointAt(line: readonly Vec2[], s: number): Vec2 {
  return onLine(line, s).at
}

function onEdgeAt(e: RoadEdge, s: number): OnEdge {
  const { seg, at } = onLine(e.points, s)
  return { edge: e.id, seg, at }
}

function onLine(line: readonly Vec2[], s: number): { seg: number; at: Vec2 } {
  let left = s
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Vec2
    const b = line[i] as Vec2
    const l = dist(a, b)
    if (left <= l || i === line.length - 1) {
      const t = l === 0 ? 0 : Math.min(1, left / l)
      return { seg: i - 1, at: add(a, scale(sub(b, a), t)) }
    }
    left -= l
  }
  return { seg: 0, at: line[0] as Vec2 }
}

/** Drops points within 1 cm of the one before. */
function dedupe(line: readonly Vec2[]): Vec2[] {
  return line.filter((p, i) => i === 0 || dist(p, line[i - 1] as Vec2) > 0.01)
}
