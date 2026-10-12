/**
 * Stage 2 (plan §4): the street graph. A closed street runs round the town through its gates (the
 * wall street: W4 raises the wall along it) and along the waterfront where a lake cuts it; an oval
 * market street rings the plaza; main roads bend from the oval out to each gate and run on as dirt
 * roads to the bounds; a harbour street drops from the oval to the shore (the quay); a street rings
 * the castle ground; a middle ring circles the larger towns. Everything is planarized into nodes at
 * junctions and edges carrying their polylines, vertices on the 1 m grid where they are drawn (not
 * where streets cross). Every draw goes through `roll`, its varying part first.
 */
import { DMath } from "@guildhall/core"
import { chaikin, closest, dedupe, distTo, intersect, length, resample } from "../geom/line.ts"
import { axes, obb, rectCorners } from "../geom/obb.ts"
import { planarize } from "../geom/planar.ts"
import {
  area,
  type ClipOp,
  centroid,
  clip,
  contains,
  type MultiPolygon,
  offset,
  type Polygon,
  type Ring,
  type Shape,
} from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, at, dist, EPS, lerp, norm, perp, round3, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { normalizeSpec, TIER_DEFAULTS } from "./spec.ts"
import type { Site, StreetEdge, StreetGraph, StreetNode, TownSpecInput } from "./types.ts"

export type StreetClass = StreetEdge["cls"]

/** Street widths by class, metres (plan §3.4). */
export const STREET_WIDTH: Readonly<Record<StreetClass, number>> = { main: 7, street: 5, lane: 3.5, road: 4 }
/** Nodes closer than this merge, and a street end this close to another street joins it, metres. */
export const MERGE = 2
/** The waterfront street's centreline lies this far from the water (a 4 m quay strip remains), metres. */
export const QUAY = 7

/** Gates keep this far back from the water, beyond the quay, metres. */
const GATE_SHORE = 12
/** Gates keep this far round (radians, seen from the plaza) from the castle. */
const CASTLE_ARC = 0.7
/** The market oval keeps this much room between the plaza's edge and its centreline, metres. */
const OVAL_ROOM = 4
/** A middle ring needs this much room on each side, metres. */
const RING_ROOM = 25
/** Angles tried round the gate circle. */
const GATE_SAMPLES = 360

interface StreetLine {
  points: Vec2[]
  cls: StreetClass
}

interface NodeMark {
  at: Vec2
  kind: StreetNode["kind"]
}

/** The land piece the town stands on: the one holding the plaza (a lake can cut a corner off). */
export function townLand(site: Site): Polygon {
  const c = centroid(site.plaza)
  return site.land.find((poly) => contains(poly, c)) ?? (site.land[0] as Polygon)
}

export function streets(site: Site, spec: TownSpecInput, roll: Roll): StreetGraph {
  const s = normalizeSpec(spec)
  const r = site.radius
  const land = townLand(site)
  const plazaC = centroid(site.plaza)
  const inner = (d: number) => piece(offset(land, -d), plazaC)
  // The castle street runs round the castle ground, its kerbed half-width out from it.
  const round = STREET_WIDTH.street + 1
  const castle = site.castleSite
    ? rectCorners({ ...site.castleSite, w: site.castleSite.w + round, d: site.castleSite.d + round })
    : null

  const gates = placeGates(r, TIER_DEFAULTS[s.tier].gates, inner(QUAY + GATE_SHORE), plazaC, site, roll)
  const loop = wallLoop(gates, r, roll)
  const town = piece(sturdyClip(loop, inner(QUAY), "intersection"), plazaC)
  const oval = marketOval(site.plaza, roll)

  const inTown = (p: Vec2) => contains(town, p)
  const inOval = (p: Vec2) => contains(oval, p)
  const inCastle = (p: Vec2) => castle !== null && contains(castle, p)
  const free = (p: Vec2) => inTown(p) && !inOval(p) && !inCastle(p)
  const cuts = [town, oval, ...(castle ? [castle] : [])]

  const lines: StreetLine[] = [{ points: closeLine(town.map(grid)), cls: s.walls ? "street" : "lane" }]
  // Where the plaza sits near the water the oval gives way to the waterfront street.
  for (const p of clipLine(closeLine(oval), inTown, [town])) lines.push({ points: p, cls: "street" })
  if (castle) {
    for (const p of clipLine(closeLine(castle), (q) => inTown(q) && !inOval(q), [town, oval]))
      lines.push({ points: p, cls: "street" })
  }
  const ovalReach = Math.max(...oval.map((p) => dist(p, plazaC)))
  if (0.55 * r - ovalReach >= RING_ROOM) {
    for (const p of clipLine(middleRing(r, roll), free, cuts)) lines.push({ points: p, cls: "street" })
  }

  const marks: NodeMark[] = gates.map((g) => ({ at: g, kind: "gate" }))
  gates.forEach((g, k) => {
    const start = rayHit(plazaC, g, oval) ?? plazaC
    const main = bent(start, g, 0.12, `${k}:main`, roll)
    const pieces = clipLine(main, free, cuts)
    for (const p of pieces) lines.push({ points: p, cls: "main" })
    // Where the bends dip back inside the oval, the road leaves it further round; where it leaves
    // right beside the castle street, the two merge and the junction is the castle's.
    const leaves = pieces[0] && at(pieces[0], 0)
    const byCastle = (p: Vec2) => castle !== null && distTo(p, castle, true) <= 2 * MERGE
    if (leaves && distTo(leaves, oval, true) <= 0.01 && !byCastle(leaves))
      marks.push({ at: leaves, kind: "plaza" })
    const road = clipLine(outRoad(g, r, `${k}:road`, roll), (q) => contains(land, q) && !inTown(q), [
      town,
      ...land,
    ])
    const fromGate = road.find((p) => dist(at(p, 0), g) <= MERGE)
    if (fromGate) lines.push({ points: fromGate, cls: "road" })
  })

  const shore = nearestShore(site.water, plazaC)
  if (shore) {
    const onOval = rayHit(plazaC, shore, oval)
    const start = onOval && inTown(onOval) ? onOval : rayHit(plazaC, shore, town)
    const keep = (q: Vec2) => contains(land, q) && !(inOval(q) && inTown(q)) && !inCastle(q)
    const harbour = start
      ? clipLine(bent(start, shore, 0.08, "harbour:main", roll), keep, [...cuts, ...land])
      : []
    const first = harbour.find((p) => start && dist(at(p, 0), start) <= MERGE)
    if (start && first) {
      lines.push({ points: first, cls: "main" })
      marks.push({ at: at(first, first.length - 1), kind: "quay" })
      if (start === onOval) marks.push({ at: start, kind: "plaza" })
    }
  }
  return buildGraph(lines, marks)
}

/**
 * The lines as a street graph: planarized (crossings become nodes, near nodes merge), then every
 * run of plain two-way nodes of one class collapsed into a single edge carrying the polyline. A
 * mark names the junction or end within the merge distance of it; any other node is a `junction`, or
 * an `end` when only one street reaches it.
 */
function buildGraph(lines: readonly StreetLine[], marks: readonly NodeMark[]): StreetGraph {
  const pg = planarize(
    lines.map((l) => clearEnds(l.points)),
    MERGE,
  )
  const inc: number[][] = pg.nodes.map(() => [])
  pg.edges.forEach((e, i) => {
    at(inc, e.a).push(i)
    at(inc, e.b).push(i)
  })
  const clsOf = (e: number) => at(lines, at(pg.edges, e).src).cls
  const marked = new Map<number, StreetNode["kind"]>()
  for (const m of marks) {
    let best = -1
    // A mark names where streets meet or end, never a bend in the middle of one.
    pg.nodes.forEach((p, i) => {
      if (at(inc, i).length === 2 || dist(p, m.at) > MERGE) return
      if (best < 0 || dist(p, m.at) < dist(at(pg.nodes, best), m.at)) best = i
    })
    if (best >= 0 && !marked.has(best)) marked.set(best, m.kind)
  }
  const kept = new Set<number>()
  inc.forEach((list, v) => {
    if (list.length !== 2 || marked.has(v) || clsOf(at(list, 0)) !== clsOf(at(list, 1))) kept.add(v)
  })

  const used = new Uint8Array(pg.edges.length)
  const chains: { from: number; to: number; points: Vec2[]; cls: StreetClass }[] = []
  const walk = (v: number, e: number) => {
    const points = [at(pg.nodes, v)]
    let cur = v
    let edge = e
    for (;;) {
      used[edge] = 1
      const pe = at(pg.edges, edge)
      cur = pe.a === cur ? pe.b : pe.a
      points.push(at(pg.nodes, cur))
      if (kept.has(cur)) break
      const nextEdge = at(inc, cur).find((x) => x !== edge && !used[x])
      if (nextEdge === undefined) break
      edge = nextEdge
    }
    chains.push({ from: v, to: cur, points, cls: clsOf(e) })
  }
  const order = (v: number) => {
    for (const e of at(inc, v)) if (!used[e]) walk(v, e)
  }
  for (let v = 0; v < pg.nodes.length; v++) if (kept.has(v)) order(v)
  // Loops with no junction on them keep their first node.
  for (let e = 0; e < pg.edges.length; e++) {
    if (used[e]) continue
    const v = at(pg.edges, e).a
    kept.add(v)
    order(v)
  }

  const ids = new Map<number, number>()
  const nodes: StreetNode[] = []
  const idOf = (v: number) => {
    let id = ids.get(v)
    if (id === undefined) {
      id = nodes.length
      ids.set(v, id)
      const degree = at(inc, v).length
      nodes.push({ id, at: at(pg.nodes, v), kind: marked.get(v) ?? (degree === 1 ? "end" : "junction") })
    }
    return id
  }
  const edges: StreetEdge[] = chains.map((c, id) => ({
    id,
    a: idOf(c.from),
    b: idOf(c.to),
    points: c.points,
    cls: c.cls,
    width: STREET_WIDTH[c.cls],
  }))
  return { nodes, edges }
}

/**
 * An open line without the inner points that crowd its ends: merging would otherwise fold an end
 * into its neighbour and the line would stop short of where it was going.
 */
function clearEnds(line: readonly Vec2[]): Vec2[] {
  const first = at(line, 0)
  const last = at(line, line.length - 1)
  if (line.length < 3 || dist(first, last) <= EPS) return [...line]
  const inner = line.slice(1, -1).filter((p) => dist(p, first) > MERGE && dist(p, last) > MERGE)
  return [first, ...inner, last]
}

/**
 * The parts of a polyline where `keep` holds, cut where it crosses any of the rings. A closed line
 * (last point = first) whose kept parts wrap past its start comes back as one piece.
 */
function clipLine(line: readonly Vec2[], keep: (p: Vec2) => boolean, rings: readonly Ring[]): Vec2[][] {
  const pieces: Vec2[][] = []
  let cur: Vec2[] = []
  const flush = () => {
    if (cur.length > 1 && length(cur) >= MERGE) pieces.push(dedupe(cur).map(snap))
    cur = []
  }
  for (let i = 0; i + 1 < line.length; i++) {
    const a = at(line, i)
    const b = at(line, i + 1)
    const ts = [0, 1]
    for (const ring of rings)
      for (let j = 0; j < ring.length; j++) {
        const hit = intersect(a, b, at(ring, j), at(ring, j + 1))
        if (hit) ts.push(hit.t)
      }
    const sorted = [...new Set(ts)].sort((x, y) => x - y)
    for (let k = 0; k + 1 < sorted.length; k++) {
      const t0 = at(sorted, k)
      const t1 = at(sorted, k + 1)
      if (t1 - t0 < 1e-9) continue
      if (!keep(lerp(a, b, (t0 + t1) / 2))) {
        flush()
        continue
      }
      const p0 = lerp(a, b, t0)
      const last = cur[cur.length - 1]
      if (!last) cur.push(p0)
      else if (dist(last, p0) > EPS) {
        flush()
        cur.push(p0)
      }
      cur.push(lerp(a, b, t1))
    }
  }
  const tail = cur
  flush()
  const closed = line.length > 2 && dist(at(line, 0), at(line, line.length - 1)) <= EPS
  const first = pieces[0]
  const last = pieces[pieces.length - 1]
  if (
    closed &&
    pieces.length > 1 &&
    first &&
    last &&
    tail.length > 1 &&
    dist(at(first, 0), at(line, 0)) <= EPS
  ) {
    pieces.pop()
    pieces[0] = dedupe([...last, ...first])
  }
  return pieces
}

/** Grid steps the second operand is moved by when the booleans trip over it. */
const NUDGES: Vec2[] = [
  [0.001, 0],
  [0, 0.001],
  [-0.001, 0.001],
  [0.002, -0.001],
]

/**
 * `clip`, retried with the second operand (or the first, when the second is empty) moved by a grid
 * step or two when polygon-clipping trips over near-degenerate input ("Unable to complete output
 * ring"). A millimetre is far below anything a town draws.
 */
export function sturdyClip(a: Shape, b: Shape, op: ClipOp): MultiPolygon {
  for (let k = 0; ; k++) {
    const d = NUDGES[k - 1]
    try {
      if (!d) return clip(a, b, op)
      return b.length > 0 ? clip(a, nudge(b, d), op) : clip(nudge(a, d), b, op)
    } catch (err) {
      if (k >= NUDGES.length) throw err
    }
  }
}

function nudge(shape: Shape, d: Vec2): Shape {
  const move = (x: unknown): unknown =>
    Array.isArray(x) && typeof x[0] === "number"
      ? snap([x[0] + d[0], (x[1] as number) + d[1]])
      : (x as unknown[]).map(move)
  return move(shape) as Shape
}

/** The polygon of the multipolygon holding p (else the largest), as its outer ring. */
function piece(multi: Polygon[], p: Vec2): Ring {
  const hit = multi.find((poly) => contains(poly, p))
  if (hit) return at(hit, 0)
  const sorted = [...multi].sort((a, b) => area(at(b, 0)) - area(at(a, 0)))
  return sorted[0] ? at(sorted[0], 0) : []
}

/** On the 1 m grid (ADR 006), −0 folded. */
const grid = (p: Vec2): Vec2 => [round3(Math.round(p[0])), round3(Math.round(p[1]))]

/** The ring as an open line that returns to its start. */
const closeLine = (ring: readonly Vec2[]): Vec2[] => [...ring, at(ring, 0)]

/** Chaikin-smoothed, resampled to about `step`, on the 1 m grid. */
function smooth(points: readonly Vec2[], passes: number, step: number, closed = false): Vec2[] {
  const out = resample(chaikin(points, passes, closed), step, closed).map(grid)
  return dedupe(out, closed)
}

/**
 * Gate positions at radius r, spread evenly from a rolled phase, each moved to the nearest angle that
 * is on dry land well back from the shore and not toward the castle, and never two close together.
 */
function placeGates(r: number, n: number, dry: Ring, plazaC: Vec2, site: Site, roll: Roll): Vec2[] {
  const dir = (t: number): Vec2 => [DMath.cos(t), DMath.sin(t)]
  const castleDir = site.castleSite ? norm(sub(site.castleSite.c, plazaC)) : null
  const allowed: number[] = []
  for (let i = 0; i < GATE_SAMPLES; i++) {
    const t = (2 * Math.PI * i) / GATE_SAMPLES
    const p = scale(dir(t), r)
    if (!contains(dry, p, 0)) continue
    if (castleDir && angleBetween(norm(sub(p, plazaC)), castleDir) < CASTLE_ARC) continue
    allowed.push(t)
  }
  const phase = 2 * Math.PI * roll("phase:gates")
  const spacing = (2 * Math.PI) / n
  const chosen: number[] = []
  for (let k = 0; k < n; k++) {
    const want = phase + spacing * (k + 0.2 * (roll(`${k}:gate`) - 0.5))
    let best: number | null = null
    for (const t of allowed) {
      if (chosen.some((c) => angleDiff(c, t) < spacing * 0.5)) continue
      if (best === null || angleDiff(t, want) < angleDiff(best, want)) best = t
    }
    if (best !== null) chosen.push(best)
  }
  return chosen.sort((a, b) => a - b).map((t) => grid(scale(dir(t), r)))
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return Math.min(d, 2 * Math.PI - d)
}
const angleBetween = (u: Vec2, v: Vec2) =>
  DMath.atan2(Math.abs(u[0] * v[1] - u[1] * v[0]), u[0] * v[0] + u[1] * v[1])

/** The closed loop through the gates (exactly), wobbling in and out between them, counter-clockwise. */
function wallLoop(gates: Vec2[], r: number, roll: Roll): Ring {
  const angle = (p: Vec2) => DMath.atan2(p[1], p[0])
  const out: Vec2[] = []
  gates.forEach((g, k) => {
    const t0 = angle(g)
    let t1 = gates.length === 1 ? t0 + 2 * Math.PI : angle(at(gates, k + 1))
    while (t1 <= t0) t1 += 2 * Math.PI
    const mids = Math.max(2, Math.round(((t1 - t0) * r) / 35))
    const section: Vec2[] = [g]
    for (let i = 1; i <= mids; i++) {
      const t = t0 + ((t1 - t0) * i) / (mids + 1)
      const rr = r * (1 + 0.07 * (2 * roll(`${k}:${i}:wall`) - 1))
      section.push([rr * DMath.cos(t), rr * DMath.sin(t)])
    }
    section.push(gates.length === 1 ? g : at(gates, k + 1))
    out.push(...smooth(section, 2, 9).slice(0, -1))
  })
  return dedupe(out, true)
}

/** An ellipse round the plaza with room for the street, along the plaza's long axis, gently wobbled. */
function marketOval(plaza: Ring, roll: Roll): Ring {
  const box = obb(plaza)
  const { x, z } = axes(box.rot)
  const local = plaza.map((p): Vec2 => {
    const d = sub(p, box.c)
    return [d[0] * x[0] + d[1] * x[1], d[0] * z[0] + d[1] * z[1]]
  })
  let k = 1
  const fits = () => local.every(([u, v]) => (u / ((box.w / 2) * k)) ** 2 + (v / ((box.d / 2) * k)) ** 2 <= 1)
  while (!fits()) k += 0.05
  const a = (box.w / 2) * k + OVAL_ROOM + STREET_WIDTH.street / 2
  const b = (box.d / 2) * k + OVAL_ROOM + STREET_WIDTH.street / 2
  const n = 14
  const pts: Vec2[] = Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n
    const w = 1 + 0.06 * roll(`${i}:oval`)
    return add(box.c, add(scale(x, a * w * DMath.cos(t)), scale(z, b * w * DMath.sin(t))))
  })
  return smooth(pts, 2, 5, true)
}

/** The plan's ring: 9–12 points at 0.5–0.6r with radial jitter, smoothed, as a closed line. */
function middleRing(r: number, roll: Roll): Vec2[] {
  const n = 9 + Math.floor(4 * roll("count:ring"))
  const base = r * (0.5 + 0.1 * roll("radius:ring"))
  const phase = 2 * Math.PI * roll("phase:ring")
  const pts: Vec2[] = Array.from({ length: n }, (_, i) => {
    const t = phase + (2 * Math.PI * i) / n
    const rr = base * (1 + 0.1 * (2 * roll(`${i}:ring`) - 1))
    return [rr * DMath.cos(t), rr * DMath.sin(t)]
  })
  return closeLine(smooth(pts, 1, 7, true))
}

/** a → b with two bends pushed sideways up to `bend` of the length, smoothed once, on the grid. */
function bent(a: Vec2, b: Vec2, bend: number, salt: string, roll: Roll): Vec2[] {
  const l = dist(a, b)
  const side = perp(norm(sub(b, a)))
  const push = (i: number) => scale(side, bend * l * (2 * roll(`${i}:${salt}`) - 1))
  const p1 = add(lerp(a, b, 1 / 3), push(1))
  const p2 = add(lerp(a, b, 2 / 3), push(2))
  const out = smooth([a, p1, p2, b], 1, 6)
  out[0] = snap(a)
  out[out.length - 1] = snap(b)
  return out
}

/** From a gate straight out to the bounds square (half side 1.3r), with one bend. */
function outRoad(g: Vec2, r: number, salt: string, roll: Roll): Vec2[] {
  const d = norm(g)
  const h = 1.3 * r
  const reach = Math.min(
    Math.abs(d[0]) > EPS ? (h - Math.abs(g[0])) / Math.abs(d[0]) : Infinity,
    Math.abs(d[1]) > EPS ? (h - Math.abs(g[1])) / Math.abs(d[1]) : Infinity,
  )
  const end = add(g, scale(d, reach))
  const mid = add(lerp(g, end, 0.5), scale(perp(d), 0.1 * reach * (2 * roll(salt) - 1)))
  const out = smooth([g, mid, end], 1, 8)
  out[0] = g
  out[out.length - 1] = snap(end)
  return out
}

/** Where the segment from `from` toward `to` first crosses the closed ring. */
function rayHit(from: Vec2, to: Vec2, ring: Ring): Vec2 | null {
  let best: { at: Vec2; t: number } | null = null
  for (let i = 0; i < ring.length; i++) {
    const hit = intersect(from, to, at(ring, i), at(ring, i + 1))
    if (hit && (!best || hit.t < best.t)) best = hit
  }
  return best ? snap(best.at) : null
}

/** The water's edge point nearest p, if there is water. */
function nearestShore(water: readonly Ring[], p: Vec2): Vec2 | null {
  let best: { at: Vec2; d: number } | null = null
  for (const ring of water)
    for (let i = 0; i < ring.length; i++) {
      const c = closest(p, at(ring, i), at(ring, i + 1))
      if (!best || c.d < best.d) best = c
    }
  return best ? snap(best.at) : null
}
