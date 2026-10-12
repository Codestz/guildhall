/**
 * Stage 3 (plan §4): blocks. The street graph's faces (dead ends pruned first, so none of them spike
 * into a face) are cut back by the streets' ribbons plus a kerb, which insets each block by half its
 * fronting street's width and 0.5 m. The face holding the plaza is the plaza, the one holding the
 * castle ground the castle, one holding a secondary square that square (an open green block); the
 * rest are lots blocks.
 *
 * Blocks grow denser toward the market: a lots block over its local limit (a share of the tier's
 * `amax` that grows from the market out to the wall), or wider than two lot depths, is cut once by a
 * lane across its long axis, somewhere near the middle, at its own slant and with a kink, and the
 * faces are walked again until every block fits; the big ones are cut by streets rather than lanes.
 * Then a few big blocks out toward the wall get a dead-end lane into their middle (a courtyard).
 *
 * The land outside the town comes back too: the quay strip as a harbour block, short ribbons of
 * frontage blocks along each road just outside its gate (a hamlet's along its street as well, since
 * it has no faces but its green), and the rest as green farmland, so blocks and streets cover the
 * town's land.
 */
import { DMath } from "@guildhall/core"
import { closest, dedupe, distTo, intersect, length, ribbon } from "../geom/line.ts"
import { axes, hull, obb } from "../geom/obb.ts"
import { faces, type PlanarGraph } from "../geom/planar.ts"
import {
  area,
  bbox,
  centroid,
  clip,
  contains,
  type MultiPolygon,
  offset,
  orient,
  type Polygon,
  type Ring,
  splitByLine,
} from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, at, cross, dist, dot, len, lerp, norm, perp, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { normalizeSpec, TIER_DEFAULTS } from "./spec.ts"
import { MERGE, QUAY, STREET_WIDTH, SUBURB, townLand } from "./streets.ts"
import type {
  Block,
  DistrictKind,
  Site,
  Square,
  StreetEdge,
  StreetGraph,
  StreetNode,
  Tier,
  TownSpecInput,
} from "./types.ts"

/** Street ribbons are widened by this on each side: the kerb between a street and its blocks, metres. */
export const KERB = 0.5
/** A lots block wider than two of these (its OBB's short side) is cut, metres. */
export const LOT_DEPTH = 22
/** Pieces smaller than this are dust from the booleans and dropped, m². */
const DUST = 1
/** A lots piece smaller than this is too small to hold a house: it becomes green, m². */
const SCRAP = 60
/** Rounds of cutting before giving up. */
const MAX_ROUNDS = 14
/** A cut's heading wanders this far from square across its block, radians (±14°). */
const LANE_JITTER = (14 * Math.PI) / 180
/** A cut kinks sideways by up to this share of its length. */
const LANE_KINK = 0.08
/** The local block limit by the market, as a share of `amax`; it grows to all of it at the wall. */
const CORE_SHARE = 0.3
/** Dead-end lanes into big blocks, by tier. */
const CULS: Readonly<Record<Tier, number>> = { hamlet: 0, village: 1, town: 3, city: 5, capital: 6 }
/** Frontage blocks along a road: how deep, and how long a run before a gap, metres. */
const FRONT_DEPTH = [16, 22] as const
const FRONT_RUN = [16, 30] as const
const FRONT_GAP = [3, 9] as const

interface Cutter {
  ring: Ring
  box: [Vec2, Vec2]
}

interface TownFace {
  ring: Ring
  /** Street edge ids round it. */
  edges: number[]
}

/** A lane to add: from street to street, or (`open`) from a street to a dead end of its own. */
interface Lane {
  points: Vec2[]
  cls: StreetEdge["cls"]
  open?: boolean
}

export function blocks(
  graph: StreetGraph,
  site: Site,
  spec: TownSpecInput,
  roll: Roll,
): { blocks: Block[]; graph: StreetGraph } {
  const s = normalizeSpec(spec)
  const amax = TIER_DEFAULTS[s.tier].amax
  const r = site.radius
  const plazaC = centroid(site.plaza)
  const castleC = site.castleSite?.c ?? null
  const squares = graph.squares ?? []
  const cache = new Map<string, MultiPolygon>()
  // The local limit: a share of amax by the market, all of it out at the wall.
  const reachOfPlaza = Math.max(...site.plaza.map((p) => dist(p, plazaC)))
  const limit = (c: Vec2) => {
    const t = Math.min(1, Math.max(0, (dist(c, plazaC) - reachOfPlaza) / (0.75 * r)))
    return amax * (CORE_SHARE + (1 - CORE_SHARE) * t)
  }

  let g = graph
  let found: TownFace[] = []
  let loose: Cutter[] = []
  // A face that kept its ring kept its streets (a lane reaching it adds a node to it), so its carving
  // from an earlier round stands.
  const keyOf = (f: TownFace) => f.ring.map((p) => `${p[0]},${p[1]}`).join(";")
  const carved = (f: TownFace): MultiPolygon => {
    const key = keyOf(f)
    let out = cache.get(key)
    if (!out) {
      out = carveFace(f, g, loose)
      cache.set(key, out)
    }
    return out
  }
  const squareOf = (f: TownFace): Square | undefined => squares.find((q) => contains(f.ring, q.at, 0))
  const kindOf = (f: TownFace): Block["use"] | "square" =>
    contains(f.ring, plazaC)
      ? "plaza"
      : castleC && contains(f.ring, castleC)
        ? "castle"
        : squareOf(f)
          ? "square"
          : "lots"
  const walk = () => {
    const walked = townFaces(g)
    found = walked.faces
    const ids = new Set(walked.loose)
    loose = streetCutters(g, (e) => ids.has(e.id))
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    walk()
    const lanes: Lane[] = []
    found.forEach((f, fi) => {
      if (kindOf(f) !== "lots") return
      carved(f).forEach((poly, pi) => {
        const ring = at(poly, 0)
        const a = area(ring)
        const lim = limit(centroid(ring))
        if (a < SCRAP || (a <= lim && obb(ring).d <= 2 * LOT_DEPTH)) return
        const draw = (salt: string) => roll(`${salt}:${round}:${fi}:${pi}:lane`)
        const cut = laneAcross(f.ring, ring, draw)
        if (cut) lanes.push({ points: cut, cls: a > 3 * lim && draw("cls") < 0.5 ? "street" : "lane" })
      })
    })
    if (lanes.length === 0) break
    g = withLanes(g, lanes)
  }

  // Courtyards: a dead-end lane into a few of the biggest blocks out toward the wall.
  const culs: Lane[] = []
  const big = found
    .flatMap((f, fi) =>
      kindOf(f) === "lots" ? carved(f).map((poly, pi) => ({ f, ring: at(poly, 0), key: `${fi}:${pi}` })) : [],
    )
    .filter((b) => area(b.ring) >= 0.45 * amax && obb(b.ring).d >= 26)
    .sort((x, y) => dist(centroid(y.ring), plazaC) - dist(centroid(x.ring), plazaC))
  const reached = new Set<TownFace>()
  for (const b of big) {
    if (culs.length >= CULS[s.tier] || reached.has(b.f)) continue
    const lane = culDeSac(b.f.ring, b.ring, (salt) => roll(`${salt}:${b.key}:cul`))
    if (!lane) continue
    culs.push({ points: lane, cls: "lane", open: true })
    reached.add(b.f)
    // Its face may keep its ring (the lane can start on a node it already had): carve it again.
    cache.delete(keyOf(b.f))
  }
  if (culs.length > 0) {
    g = withLanes(g, culs)
    walk()
  }

  const seeds = districtSeeds(s.districts, site, plazaC, roll)
  const out: Block[] = []
  const push = (ring: Ring, use: Block["use"], district: DistrictKind, square?: Square["kind"]) => {
    const block: Block = { id: out.length, poly: ring, use, district }
    if (square) block.square = square
    out.push(block)
  }
  for (const f of found) {
    const use = kindOf(f)
    for (const poly of carved(f)) {
      const ring = at(poly, 0)
      if (area(ring) < DUST) continue
      if (use === "plaza") push(ring, "plaza", "market")
      else if (use === "castle") push(ring, "castle", "castle")
      else if (use === "square") push(ring, "green", nearest(seeds, centroid(ring)), squareOf(f)?.kind)
      else if (area(ring) < SCRAP) push(ring, "green", nearest(seeds, centroid(ring)))
      else push(ring, "lots", nearest(seeds, centroid(ring)))
    }
  }
  const draw = (salt: string) => roll(`${salt}:front`)
  for (const [ring, use] of outside(found, g, site, s.tier, draw)) {
    if (use === "lots") push(ring, "lots", nearest(seeds, centroid(ring)))
    else push(ring, use, use === "harbour" ? "harbour" : "farm")
  }
  return { blocks: out, graph: g === graph ? graph : { ...graph, nodes: g.nodes, edges: g.edges } }
}

/**
 * The graph with the lanes added. A lane runs across one face from street to street, so it crosses
 * nothing: each end joins the node within the merge distance of it, or splits the street it lies on.
 * An open lane's far end is a new dead end.
 */
function withLanes(g: StreetGraph, lanes: readonly Lane[]): StreetGraph {
  const nodes: StreetNode[] = g.nodes.map((n) => ({ ...n }))
  const edges: StreetEdge[] = g.edges.map((e) => ({ ...e }))
  const attach = (p: Vec2): number => {
    let best = -1
    nodes.forEach((n, i) => {
      if (dist(n.at, p) <= MERGE && (best < 0 || dist(n.at, p) < dist(at(nodes, best).at, p))) best = i
    })
    if (best >= 0) return best
    let hit = { e: -1, k: 0, d: Infinity, at: p }
    edges.forEach((e, i) => {
      for (let k = 0; k + 1 < e.points.length; k++) {
        const c = closest(p, at(e.points, k), at(e.points, k + 1))
        if (c.d < hit.d) hit = { e: i, k, d: c.d, at: c.at }
      }
    })
    const e = at(edges, hit.e)
    const id = nodes.length
    const cut = snap(hit.at)
    nodes.push({ id, at: cut, kind: "junction" })
    edges[hit.e] = { ...e, b: id, points: dedupe([...e.points.slice(0, hit.k + 1), cut]) }
    edges.push({ ...e, id: edges.length, a: id, points: dedupe([cut, ...e.points.slice(hit.k + 1)]) })
    return id
  }
  for (const lane of lanes) {
    const a = attach(at(lane.points, 0))
    const last = snap(at(lane.points, lane.points.length - 1))
    const b = lane.open ? nodes.push({ id: nodes.length, at: last, kind: "end" }) - 1 : attach(last)
    if (a === b) continue
    const from = at(nodes, a).at
    const to = at(nodes, b).at
    const inner = lane.points.slice(1, -1).filter((p) => dist(p, from) > MERGE && dist(p, to) > MERGE)
    edges.push({
      id: edges.length,
      a,
      b,
      points: [from, ...inner, to],
      cls: lane.cls,
      width: STREET_WIDTH[lane.cls],
    })
  }
  return { nodes, edges }
}

/**
 * The bounded faces of the graph with every dead end pruned away, walked along the street polylines,
 * and the pruned edges (the loose ends: roads, the quay).
 */
function townFaces(g: StreetGraph): { faces: TownFace[]; loose: number[] } {
  const alive = g.edges.map(() => true)
  const degree = g.nodes.map(() => 0)
  for (const e of g.edges) {
    degree[e.a] = at(degree, e.a) + 1
    degree[e.b] = at(degree, e.b) + 1
  }
  for (let changed = true; changed; ) {
    changed = false
    g.edges.forEach((e, i) => {
      if (!alive[i] || (at(degree, e.a) > 1 && at(degree, e.b) > 1)) return
      alive[i] = false
      degree[e.a] = at(degree, e.a) - 1
      degree[e.b] = at(degree, e.b) - 1
      changed = true
    })
  }
  // Every polyline point becomes a planar node, so the faces follow the curves.
  const pg: PlanarGraph = { nodes: g.nodes.map((n) => n.at), edges: [] }
  const owner: number[] = []
  g.edges.forEach((e, i) => {
    if (!alive[i]) return
    let prev = e.a
    for (let k = 1; k < e.points.length; k++) {
      const last = k === e.points.length - 1
      const next = last ? e.b : pg.nodes.push(at(e.points, k)) - 1
      pg.edges.push({ a: prev, b: next, src: i })
      owner.push(i)
      prev = next
    }
  })
  return {
    faces: faces(pg).map((f) => ({ ring: f.ring, edges: [...new Set(f.edges.map((h) => at(owner, h)))] })),
    loose: g.edges.filter((_, i) => !alive[i]).map((e) => e.id),
  }
}

/**
 * A face cut back by its streets: shrunk by its narrowest street's half-width and kerb in one offset,
 * then cut by the ribbons of its wider streets, by the square ends of wider streets meeting it from
 * outside (at a slant they poke across), and by any loose end reaching in.
 */
function carveFace(f: TownFace, g: StreetGraph, loose: readonly Cutter[]): MultiPolygon {
  const narrowest = Math.min(...f.edges.map((id) => at(g.edges, id).width))
  try {
    const base = offset([[f.ring]], -(narrowest / 2 + KERB))
    const own = new Set(f.edges)
    const wide = new Set(f.edges.filter((id) => at(g.edges, id).width > narrowest))
    const nodes = new Set(f.edges.flatMap((id) => [at(g.edges, id).a, at(g.edges, id).b]))
    const meeting = g.edges.filter((e) => !own.has(e.id) && e.width > narrowest)
    // A street of another face that bends close by, across a lane, reaches over it.
    const [min, max] = bbox(f.ring)
    const reach = (e: StreetEdge) => e.width / 2 + KERB + narrowest / 2 + KERB
    const over = new Set(
      g.edges
        .filter((e) => !own.has(e.id) && !nodes.has(e.a) && !nodes.has(e.b))
        .filter((e) =>
          e.points.some(
            (p) => p[0] >= min[0] - 8 && p[0] <= max[0] + 8 && p[1] >= min[1] - 8 && p[1] <= max[1] + 8,
          ),
        )
        .filter((e) => e.points.some((p) => distTo(p, f.ring, true) < reach(e)))
        .map((e) => e.id),
    )
    return carve(base, [
      ...streetCutters(g, (e) => wide.has(e.id) || over.has(e.id), narrowest),
      ...endsAt(meeting, nodes),
      ...loose,
    ])
  } catch {
    // The offset tripped over the booleans: every street cuts its ribbon instead.
    const all = new Set(f.edges)
    return carve([[f.ring]], [...streetCutters(g, (e) => all.has(e.id)), ...loose])
  }
}

/**
 * The ribbon of every street (or of those `pick` keeps) widened by the kerb, and a disc at each of
 * their nodes to fill the corners where ribbons end square (skipped where the face's offset already
 * took `floor` wide a street's worth).
 */
function streetCutters(g: StreetGraph, pick: (e: StreetEdge) => boolean = () => true, floor = 0): Cutter[] {
  const edges = g.edges.filter(pick)
  const rings: Ring[] = edges.flatMap((e) => foldFree(e.points, e.width / 2 + KERB))
  // The narrowest street at a node sets its disc, so a disc never bites past a ribbon into a block.
  const narrowest = new Map<number, number>()
  for (const e of g.edges)
    for (const v of [e.a, e.b]) narrowest.set(v, Math.min(narrowest.get(v) ?? Infinity, e.width))
  const nodes = [...new Set(edges.flatMap((e) => [e.a, e.b]))].sort((a, b) => a - b)
  for (const v of nodes) {
    const w = narrowest.get(v) ?? 0
    if (w > floor) rings.push(disc(at(g.nodes, v).at, w / 2 + KERB, 8))
  }
  return rings.map((ring) => ({ ring, box: bbox(ring) }))
}

/**
 * The ribbon `half` either side of the line, as pieces that never fold over themselves: an offset
 * folds on the inside of a bend whose miter reaches past half a neighbouring segment, so the line is
 * split at such bends, each run gets its own ribbon, and the corner between them is filled the way
 * a whole ribbon's would be (mitred, or bevelled past twice the half-width).
 */
function foldFree(line: readonly Vec2[], half: number): Ring[] {
  const out: Ring[] = []
  let run: Vec2[] = [at(line, 0)]
  for (let i = 1; i + 1 < line.length; i++) {
    const p = at(line, i)
    run.push(p)
    const u = sub(p, at(line, i - 1))
    const v = sub(at(line, i + 1), p)
    const turn = Math.abs(DMath.atan2(cross(u, v), dot(u, v)))
    if (half * DMath.tan(turn / 2) <= 0.5 * Math.min(len(u), len(v))) continue
    out.push(ribbon(run, 2 * half), joint(p, u, v, half))
    run = [p]
  }
  run.push(at(line, line.length - 1))
  out.push(ribbon(run, 2 * half))
  return out
}

/** The corner piece at p between a segment along u and one along v: both square ends and the miter. */
function joint(p: Vec2, u: Vec2, v: Vec2, half: number): Ring {
  const n1 = perp(norm(u))
  const n2 = perp(norm(v))
  const pts = [n1, n2].flatMap((n) => [add(p, scale(n, half)), add(p, scale(n, -half))])
  const bis = norm(add(n1, n2))
  const cos = dot(bis, n1)
  // The outer side of the bend is opposite the way it turns; the miter is kept within twice `half`.
  if (cos * 2 >= 1) pts.push(add(p, scale(bis, (cross(u, v) > 0 ? -half : half) / cos)))
  return hull(pts.map(snap))
}

/** The kerbed ribbon of the last stretch (a street's width long, at least) of each edge ending at one of the nodes. */
function endsAt(edges: readonly StreetEdge[], nodes: ReadonlySet<number>): Cutter[] {
  const rings: Ring[] = []
  const stretch = (pts: readonly Vec2[], w: number) => {
    const out = [at(pts, 0)]
    for (let i = 1; i < pts.length && length(out) < w; i++) out.push(at(pts, i))
    return out
  }
  for (const e of edges) {
    if (nodes.has(e.a)) rings.push(...foldFree(stretch(e.points, e.width), e.width / 2 + KERB))
    if (nodes.has(e.b)) rings.push(...foldFree(stretch([...e.points].reverse(), e.width), e.width / 2 + KERB))
  }
  return rings.map((ring) => ({ ring, box: bbox(ring) }))
}

/**
 * The shape minus every cutter whose bounds meet it, in one boolean (the cutters may overlap one
 * another: polygon-clipping takes overlapping members of a clip operand as their union).
 */
function carve(shape: MultiPolygon, cutters: readonly Cutter[]): MultiPolygon {
  if (shape.length === 0) return shape
  const [min, max] = bbox(shape.flat(2))
  const near = cutters.filter(
    (c) => !(c.box[0][0] > max[0] || c.box[1][0] < min[0] || c.box[0][1] > max[1] || c.box[1][1] < min[1]),
  )
  return near.length === 0
    ? shape
    : clip(
        shape,
        near.map((c) => [c.ring]),
        "difference",
      )
}

/**
 * One cut through `piece` (inside the face `ring`): across its long axis somewhere between 38% and
 * 62% of the way along, square to it give or take 14°, running from street to street across the
 * face with a kink part way. Null when no place on the axis is inside the piece.
 */
function laneAcross(ring: Ring, piece: Ring, draw: Roll): Vec2[] | null {
  const box = obb(piece)
  const { x, z } = axes(box.rot)
  const reach = dist(...bbox(ring)) + 1
  const grid = [0, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.4, -0.4]
  const turn = LANE_JITTER * (2 * draw("turn") - 1)
  const dir: Vec2 = [
    z[0] * DMath.cos(turn) - z[1] * DMath.sin(turn),
    z[0] * DMath.sin(turn) + z[1] * DMath.cos(turn),
  ]
  // The cut's place on the long axis, or failing that (a block bent round a corner) the nearest
  // point of the box that is inside the block.
  const aim = add(box.c, scale(x, (0.24 * draw("at") - 0.12) * box.w))
  const tries = grid.flatMap((fz) =>
    grid.map((fx) => add(aim, add(scale(x, fx * box.w), scale(z, fz * box.d)))),
  )
  tries.sort((a, b) => dist(a, aim) - dist(b, aim))
  const c = tries.find((p) => contains(piece, p, 0))
  if (!c) return null
  const span = chord(ring, c, dir, reach)
  if (!span) return null
  const [a, b] = span
  const k = lerp(a, b, 0.35 + 0.3 * draw("kink-at"))
  const kinked = [a, add(k, scale(perp(dir), LANE_KINK * dist(a, b) * (2 * draw("kink") - 1))), b]
  // The straight chord stays inside the face; a kinked one could swing out round a corner of it.
  return staysIn(kinked, ring) ? kinked.map(snap) : [snap(a), snap(b)]
}

/** Where the line through c along dir leaves the ring, behind c and ahead of it. */
function chord(ring: Ring, c: Vec2, dir: Vec2, reach: number): [Vec2, Vec2] | null {
  const back = add(c, scale(dir, -reach))
  const far = add(c, scale(dir, reach))
  let lo = -Infinity
  let hi = Infinity
  for (let k = 0; k < ring.length; k++) {
    const hit = intersect(back, far, at(ring, k), at(ring, k + 1))
    if (!hit) continue
    const t = (hit.t * 2 - 1) * reach
    if (t < 0) lo = Math.max(lo, t)
    else hi = Math.min(hi, t)
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return [add(c, scale(dir, lo)), add(c, scale(dir, hi))]
}

/**
 * A dead-end lane into the piece from the street on one of its long sides, square to it, stopping
 * 55–70% of the way across with a bend near its end: the way into a courtyard. Null when it would
 * leave the face.
 */
function culDeSac(ring: Ring, piece: Ring, draw: Roll): Vec2[] | null {
  const box = obb(piece)
  const { x, z } = axes(box.rot)
  const c = add(box.c, scale(x, (0.3 * draw("at") - 0.15) * box.w))
  if (!contains(piece, c, 0)) return null
  const dir = draw("side") < 0.5 ? z : scale(z, -1)
  const span = chord(ring, c, dir, dist(...bbox(ring)) + 1)
  if (!span) return null
  const [end, start] = span
  const depth = dist(start, end) * (0.55 + 0.15 * draw("depth"))
  const inward = norm(sub(end, start))
  const bend = lerp(start, add(start, scale(inward, depth)), 0.7)
  const tip = add(
    add(start, scale(inward, depth)),
    scale(perp(inward), 0.25 * depth * (2 * draw("bend") - 1)),
  )
  const line = [start, bend, tip].map(snap)
  return staysIn(line, ring) && contains(piece, tip, 0) ? line : null
}

/** Whether the line crosses the ring nowhere but at its two ends. */
function staysIn(line: readonly Vec2[], ring: Ring): boolean {
  const ends = [at(line, 0), at(line, line.length - 1)]
  for (let i = 0; i + 1 < line.length; i++)
    for (let k = 0; k < ring.length; k++) {
      const hit = intersect(at(line, i), at(line, i + 1), at(ring, k), at(ring, k + 1))
      if (hit && ends.every((e) => dist(e, hit.at) > 0.01)) return false
    }
  return true
}

/**
 * The town's land outside the faces, cut back by the streets: the town's edge street by a band as
 * wide as its kerbed half-width, the loose ends (roads, the quay) by their ribbons, and the square ends
 * of wider streets meeting the edge (they poke past the band). The strip between the waterfront and
 * the water, within the town's radius, is harbour; along the roads just outside the gates (and along
 * a hamlet's streets) runs frontage, as lots; the rest is green.
 */
function outside(
  found: readonly TownFace[],
  g: StreetGraph,
  site: Site,
  tier: Tier,
  draw: Roll,
): [Ring, "harbour" | "green" | "lots"][] {
  const sides = new Map<number, number>()
  for (const f of found) for (const e of f.edges) sides.set(e, (sides.get(e) ?? 0) + 1)
  const edgeOf = (e: StreetEdge) => sides.get(e.id) === 1
  const rim = g.edges.filter(edgeOf)
  // The band is the narrowest edge street's; a wider one on the edge cuts its own ribbon too.
  const band = rim.length > 0 ? Math.min(...rim.map((e) => e.width)) / 2 + KERB : 0
  const town = clip(
    found.map((f) => [f.ring]),
    [],
    "union",
  )
  const rest = clip(townLand(site), offset(town, band), "difference")

  const rimNodes = new Set(rim.flatMap((e) => [e.a, e.b]))
  const inner = g.edges.filter((e) => sides.get(e.id) === 2 && e.width / 2 + KERB > band)
  const wide = (e: StreetEdge) => !sides.has(e.id) || (edgeOf(e) && e.width / 2 + KERB > band)
  const cutters = [...streetCutters(g, wide), ...endsAt(inner, rimNodes)]

  const water =
    site.water.length > 0
      ? clip(
          offset(
            site.water.map((w) => [w]),
            QUAY + 2,
          ),
          disc([0, 0], site.radius * 1.05, 48),
          "intersection",
        )
      : []
  const harbour = water.length > 0 ? clip(rest, water, "intersection") : []
  const fields = water.length > 0 ? clip(rest, water, "difference") : rest
  const strips = frontage(g, tier, draw)
  const front =
    strips.length > 0
      ? clip(
          fields,
          clip(
            strips.map((ring) => [ring]),
            [],
            "union",
          ),
          "intersection",
        )
      : []
  const green = front.length > 0 ? clip(fields, front, "difference") : fields
  const out: [Ring, "harbour" | "green" | "lots"][] = []
  for (const ring of carve(harbour, cutters).flatMap(holeFree))
    if (area(ring) >= DUST) out.push([ring, "harbour"])
  // Each strip keeps what no earlier strip took, so two meeting at a corner stay two blocks.
  let taken: MultiPolygon = []
  const boxes: [Vec2, Vec2][] = []
  for (const strip of strips) {
    const box = bbox(strip)
    const overlaps = boxes.some(
      (b) => b[0][0] < box[1][0] && b[1][0] > box[0][0] && b[0][1] < box[1][1] && b[1][1] > box[0][1],
    )
    let mine = clip(strip, front, "intersection")
    if (overlaps && mine.length > 0) mine = clip(mine, taken, "difference")
    if (mine.length === 0) continue
    boxes.push(box)
    taken = [...taken, ...mine]
    for (const poly of carve(mine, cutters)) {
      const ring = at(poly, 0)
      if (area(ring) >= 2 * SCRAP) out.push([ring, "lots"])
      else if (area(ring) >= DUST) out.push([ring, "green"])
    }
  }
  for (const ring of carve(green, cutters).flatMap(holeFree))
    if (area(ring) >= DUST) out.push([ring, "green"])
  return out
}

/**
 * Frontage strips (not yet cut to the land): runs of 16–30 m, 16–22 m deep, with gaps between, on
 * either side of each road for its suburb length out of the gate (up to the road's fork), and of a
 * hamlet's main streets and arms all along.
 */
function frontage(g: StreetGraph, tier: Tier, draw: Roll): Ring[] {
  const out: Ring[] = []
  const lines: { points: Vec2[]; width: number; from: number; to: number; salt: string }[] = []
  for (const e of g.edges) {
    const a = at(g.nodes, e.a)
    const b = at(g.nodes, e.b)
    if (e.cls === "road" && (a.kind === "gate" || b.kind === "gate")) {
      const points = a.kind === "gate" ? e.points : [...e.points].reverse()
      const l = length(points)
      const forks = (a.kind === "gate" ? b : a).tag === "fork"
      const to = Math.min(SUBURB[tier], forks ? l - 4 : 0.6 * l)
      lines.push({ points, width: e.width, from: 3, to, salt: `${e.id}` })
    } else if (
      tier === "hamlet" &&
      (e.cls === "main" || e.cls === "street") &&
      b.kind !== "quay" &&
      a.kind !== "quay"
    ) {
      lines.push({ points: e.points, width: e.width, from: 2, to: length(e.points) - 6, salt: `${e.id}` })
    }
  }
  for (const line of lines)
    for (const side of [1, -1]) {
      let s = line.from + (FRONT_GAP[1] - FRONT_GAP[0]) * draw(`${side}:${line.salt}:start`)
      for (let i = 0; s < line.to - 8; i++) {
        const salt = `${i}:${side}:${line.salt}`
        const run = Math.min(line.to - s, FRONT_RUN[0] + (FRONT_RUN[1] - FRONT_RUN[0]) * draw(`${salt}:run`))
        const depth = FRONT_DEPTH[0] + (FRONT_DEPTH[1] - FRONT_DEPTH[0]) * draw(`${salt}:depth`)
        if (draw(`${salt}:skip`) < 0.85 && run >= 8) {
          // A straight block on the chord, set back past the bulge of the road on its side (an
          // offset of the road itself would fold round its tighter bends).
          const part = between(line.points, s, s + run)
          const a = at(part, 0)
          const b = at(part, part.length - 1)
          const n = scale(perp(norm(sub(b, a))), side)
          const near = line.width / 2 + KERB - 0.3 + Math.max(0, ...part.map((p) => dot(sub(p, a), n)))
          const far = near + depth
          const ring = [
            add(a, scale(n, near)),
            add(b, scale(n, near)),
            add(b, scale(n, far)),
            add(a, scale(n, far)),
          ]
          out.push(orient(ring.map(snap)))
        }
        s += run + FRONT_GAP[0] + (FRONT_GAP[1] - FRONT_GAP[0]) * draw(`${salt}:gap`)
      }
    }
  return out
}

/** The part of the polyline between arc lengths s0 and s1. */
function between(line: readonly Vec2[], s0: number, s1: number): Vec2[] {
  const out: Vec2[] = []
  let walked = 0
  for (let i = 0; i + 1 < line.length; i++) {
    const a = at(line, i)
    const b = at(line, i + 1)
    const l = dist(a, b)
    const t0 = (s0 - walked) / l
    const t1 = (s1 - walked) / l
    if (t1 >= 0 && t0 <= 1 && l > 0) {
      if (out.length === 0) out.push(lerp(a, b, Math.max(0, t0)))
      out.push(lerp(a, b, Math.min(1, t1)))
    }
    walked += l
  }
  return dedupe(out.map(snap))
}

/**
 * The polygon as blocks without holes: one with a hole (green round a frontage block that keeps
 * back from its road, say) is cut in two by a line through that hole, and each side again.
 */
function holeFree(poly: Polygon): Ring[] {
  const hole = poly[1]
  if (!hole) return [at(poly, 0)]
  const mid = centroid(hole)
  const c = contains(hole, mid, 0) ? mid : at(hole, 0)
  const { left, right } = splitByLine(poly, c, [1, 0.37])
  return [...left, ...right].flatMap(holeFree)
}

/**
 * One seed point per district a block can belong to: the market on the plaza, the harbour toward the
 * water, the rest spread round the middle of the town. Farm and castle are not lots districts.
 */
function districtSeeds(
  kinds: readonly DistrictKind[],
  site: Site,
  plazaC: Vec2,
  roll: Roll,
): [Vec2, DistrictKind][] {
  const r = site.radius
  const out: [Vec2, DistrictKind][] = []
  const spread = kinds.filter((k) => k !== "market" && k !== "harbour" && k !== "farm" && k !== "castle")
  const phase = 2 * Math.PI * roll("phase:districts")
  if (kinds.includes("market")) out.push([plazaC, "market"])
  const shore = site.water[0]
  if (kinds.includes("harbour") && shore)
    out.push([add(plazaC, scale(norm(centroid(shore)), 0.3 * r)), "harbour"])
  spread.forEach((k, i) => {
    const t = phase + (2 * Math.PI * i) / spread.length
    out.push([[0.55 * r * DMath.cos(t), 0.55 * r * DMath.sin(t)], k])
  })
  return out
}

function nearest(seeds: readonly [Vec2, DistrictKind][], p: Vec2): DistrictKind {
  let best: [Vec2, DistrictKind] | undefined
  for (const s of seeds) if (!best || dist(s[0], p) < dist(best[0], p)) best = s
  return best ? best[1] : "residential"
}

/** A regular n-gon holding the circle of `radius` round c (its sides touch it), counter-clockwise. */
function disc(c: Vec2, radius: number, n: number): Ring {
  const corner = radius / DMath.cos(Math.PI / n)
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n
    return snap([c[0] + corner * DMath.cos(t), c[1] + corner * DMath.sin(t)])
  })
}
