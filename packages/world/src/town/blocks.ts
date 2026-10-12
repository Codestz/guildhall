/**
 * Stage 3 (plan §4): blocks. The street graph's faces (dead ends pruned first, so none of them spike
 * into a face) are cut back by the streets' ribbons plus a kerb, which insets each block by half its
 * fronting street's width and 0.5 m. The face holding the plaza is the plaza, the one holding the
 * castle ground the castle; the rest are lots blocks. A lots block over the tier's `amax`, or wider
 * than two lot depths, is cut by parallel lanes across its long axis (each lane splits the streets it
 * ends on), and the faces are walked again until every block fits. The land outside the town comes
 * back too: the quay strip as a harbour block, the rest as green farmland, so blocks and streets
 * cover the town's land. The booleans run through `sturdyClip` (see streets.ts).
 */
import { DMath } from "@guildhall/core"
import { chaikin, closest, dedupe, distTo, intersect, length, ribbon } from "../geom/line.ts"
import { axes, hull, obb } from "../geom/obb.ts"
import { faces, type PlanarGraph } from "../geom/planar.ts"
import { area, bbox, centroid, contains, type MultiPolygon, offset, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import { add, at, cross, dist, dot, len, norm, perp, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { normalizeSpec, TIER_DEFAULTS } from "./spec.ts"
import { MERGE, QUAY, STREET_WIDTH, sturdyClip, townLand } from "./streets.ts"
import type {
  Block,
  DistrictKind,
  Site,
  StreetEdge,
  StreetGraph,
  StreetNode,
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
const MAX_ROUNDS = 12
/** A lane's heading wanders this far from square across its block, radians (±8°). */
const LANE_JITTER = (8 * Math.PI) / 180
/** A lane bows sideways by up to this share of its length. */
const LANE_BOW = 0.06

interface Cutter {
  ring: Ring
  box: [Vec2, Vec2]
}

interface TownFace {
  ring: Ring
  /** Street edge ids round it. */
  edges: number[]
}

export function blocks(
  graph: StreetGraph,
  site: Site,
  spec: TownSpecInput,
  roll: Roll,
): { blocks: Block[]; graph: StreetGraph } {
  const s = normalizeSpec(spec)
  const amax = TIER_DEFAULTS[s.tier].amax
  const plazaC = centroid(site.plaza)
  const castleC = site.castleSite?.c ?? null
  const cache = new Map<string, MultiPolygon>()

  let g = graph
  let found: TownFace[] = []
  let loose: Cutter[] = []
  // A face that kept its ring kept its streets (a lane reaching it adds a node to it), so its carving
  // from an earlier round stands.
  const carved = (f: TownFace): MultiPolygon => {
    const key = f.ring.map((p) => `${p[0]},${p[1]}`).join(";")
    let out = cache.get(key)
    if (!out) {
      out = carveFace(f, g, loose)
      cache.set(key, out)
    }
    return out
  }
  const kindOf = (f: TownFace): Block["use"] =>
    contains(f.ring, plazaC) ? "plaza" : castleC && contains(f.ring, castleC) ? "castle" : "lots"

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const walked = townFaces(g)
    found = walked.faces
    loose = streetCutters(g, (e) => walked.loose.includes(e.id))
    const lanes: Vec2[][] = []
    found.forEach((f, fi) => {
      if (kindOf(f) !== "lots") return
      carved(f).forEach((poly, pi) => {
        const ring = at(poly, 0)
        const a = area(ring)
        if (a < SCRAP || (a <= amax && obb(ring).d <= 2 * LOT_DEPTH)) return
        const parts = Math.max(2, Math.ceil(a / amax))
        lanes.push(...lanesAcross(f.ring, ring, parts, (salt) => roll(`${salt}:${round}:${fi}:${pi}:lane`)))
      })
    })
    if (lanes.length === 0) break
    g = withLanes(g, lanes)
  }

  const seeds = districtSeeds(s.districts, site, plazaC, roll)
  const out: Block[] = []
  const push = (ring: Ring, use: Block["use"], district: DistrictKind) =>
    out.push({ id: out.length, poly: ring, use, district })
  for (const f of found) {
    const use = kindOf(f)
    for (const poly of carved(f)) {
      const ring = at(poly, 0)
      if (area(ring) < DUST) continue
      if (use === "plaza") push(ring, "plaza", "market")
      else if (use === "castle") push(ring, "castle", "castle")
      else if (area(ring) < SCRAP) push(ring, "green", nearest(seeds, centroid(ring)))
      else push(ring, "lots", nearest(seeds, centroid(ring)))
    }
  }
  for (const [ring, use] of outside(found, g, site)) push(ring, use, use === "harbour" ? "harbour" : "farm")
  return { blocks: out, graph: g }
}

/**
 * The graph with the lanes added. A lane runs across one face from street to street, so it crosses
 * nothing: each end joins the node within the merge distance of it, or splits the street it lies on.
 */
function withLanes(g: StreetGraph, lanes: readonly Vec2[][]): StreetGraph {
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
    const a = attach(at(lane, 0))
    const b = attach(at(lane, lane.length - 1))
    if (a === b) continue
    const from = at(nodes, a).at
    const to = at(nodes, b).at
    const inner = lane.slice(1, -1).filter((p) => dist(p, from) > MERGE && dist(p, to) > MERGE)
    edges.push({
      id: edges.length,
      a,
      b,
      points: [from, ...inner, to],
      cls: "lane",
      width: STREET_WIDTH.lane,
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

/** The shape minus every cutter whose bounds meet it. */
function carve(shape: MultiPolygon, cutters: readonly Cutter[]): MultiPolygon {
  let out = shape
  const [min, max] = bbox(shape.flat(2))
  for (const c of cutters) {
    if (c.box[0][0] > max[0] || c.box[1][0] < min[0] || c.box[0][1] > max[1] || c.box[1][1] < min[1]) continue
    out = sturdyClip(out, c.ring, "difference")
    if (out.length === 0) break
  }
  return out
}

/**
 * The lanes cutting `piece` (inside the face `ring`) into `n` parts along its long axis: parallel,
 * square to that axis give or take 8°, running from street to street across the face, gently bowed.
 */
function lanesAcross(ring: Ring, piece: Ring, n: number, draw: Roll): Vec2[][] {
  const box = obb(piece)
  const { x, z } = axes(box.rot)
  const reach = dist(...bbox(ring)) + 1
  const grid = [0, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.4, -0.4]
  // One heading for every lane of the block, so they never cross.
  const turn = LANE_JITTER * (2 * draw("turn") - 1)
  const dir: Vec2 = [
    z[0] * DMath.cos(turn) - z[1] * DMath.sin(turn),
    z[0] * DMath.sin(turn) + z[1] * DMath.cos(turn),
  ]
  const out: Vec2[][] = []
  for (let i = 1; i < n; i++) {
    // The cut's place on the long axis, or failing that (a block bent round a corner) the nearest
    // point of the box that is inside the block.
    const aim = add(box.c, scale(x, (i / n - 0.5) * box.w))
    const tries = grid.flatMap((fz) =>
      grid.map((fx) => add(aim, add(scale(x, fx * box.w), scale(z, fz * box.d)))),
    )
    tries.sort((a, b) => dist(a, aim) - dist(b, aim))
    const c = tries.find((p) => contains(piece, p, 0))
    if (!c) continue
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
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue
    const a = add(c, scale(dir, lo))
    const b = add(c, scale(dir, hi))
    const bow = scale(perp(dir), LANE_BOW * (hi - lo) * (2 * draw(`${i}:bow`) - 1))
    const bowed = chaikin([a, add(scale(add(a, b), 0.5), bow), b], 1)
    // The straight chord stays inside the face; a bowed one could swing out round a corner of it.
    out.push(staysIn(bowed, ring) ? bowed : [snap(a), snap(b)])
  }
  return out
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
 * the water, within the town's radius, is harbour; the rest is green.
 */
function outside(found: readonly TownFace[], g: StreetGraph, site: Site): [Ring, "harbour" | "green"][] {
  const sides = new Map<number, number>()
  for (const f of found) for (const e of f.edges) sides.set(e, (sides.get(e) ?? 0) + 1)
  const edgeOf = (e: StreetEdge) => sides.get(e.id) === 1
  const rim = g.edges.filter(edgeOf)
  const band = Math.max(0, ...rim.map((e) => e.width)) / 2 + KERB
  const town = sturdyClip(
    found.map((f) => [f.ring]),
    [],
    "union",
  )
  const rest = sturdyClip(townLand(site), offset(town, band), "difference")

  const rimNodes = new Set(rim.flatMap((e) => [e.a, e.b]))
  const inner = g.edges.filter((e) => sides.get(e.id) === 2 && e.width / 2 + KERB > band)
  const cutters = [...streetCutters(g, (e) => !sides.has(e.id)), ...endsAt(inner, rimNodes)]

  const water =
    site.water.length > 0
      ? sturdyClip(
          offset(
            site.water.map((w) => [w]),
            QUAY + 2,
          ),
          disc([0, 0], site.radius * 1.05, 48),
          "intersection",
        )
      : []
  const harbour = water.length > 0 ? sturdyClip(rest, water, "intersection") : []
  const green = water.length > 0 ? sturdyClip(rest, water, "difference") : rest
  const out: [Ring, "harbour" | "green"][] = []
  for (const poly of carve(harbour, cutters))
    if (area(at(poly, 0)) >= DUST) out.push([at(poly, 0), "harbour"])
  for (const poly of carve(green, cutters)) if (area(at(poly, 0)) >= DUST) out.push([at(poly, 0), "green"])
  return out
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
