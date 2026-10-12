/**
 * Stage 7a (plan §4): the town's edge. A walled town gets a curtain wall just outside its wall street,
 * open where streets pass through it (a gatehouse at each gate), towers at its sharp turns and every
 * 28–36 m, and ending at the shore with a tower where a lake cuts the town; an unwalled one gets a
 * hedge (village) or a fence (hamlet) along the same line. `layoutEdge` turns any edge into catalog
 * pieces through its kit: segments chord to chord along the line, towers at the stations, a gate
 * piece filling each gate gap. Kits are measured pieces, chosen by tier.
 */
import { DMath } from "@guildhall/core"
import { closest, dedupe, distTo, intersect, length, offsetLine } from "../geom/line.ts"
import { faces, type PlanarGraph } from "../geom/planar.ts"
import { area, centroid, contains, offset, type Polygon, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import {
  add,
  at,
  cross,
  dist,
  dot,
  EPS,
  lerp,
  norm,
  round3,
  scale,
  snap,
  sub,
  type Vec2,
} from "../geom/vec.ts"
import { KERB } from "./blocks.ts"
import { normalizeSpec } from "./spec.ts"
import { QUAY, sturdyClip } from "./streets.ts"
import type { Edge, EdgeKit, PieceInstance, StreetGraph, Tier, TownPlan, TownSpecInput } from "./types.ts"

/** A turn sharper than this (radians) stands a tower on a wall and breaks a hedge's run. */
export const SHARP = Math.PI / 7
/** Clear ground between the wall street's kerb and the widest part of the wall (its towers), metres. */
const WALL_ROOM = 0.5
/** Wall line pieces closer than this to the water are the waterfront's (the quay street's), metres. */
const WATERFRONT = QUAY + 1.5
/** A wall end stays this far beyond its end tower's reach from the water, metres. */
const SHORE_ROOM = 0.5
/** Wall line pieces shorter than this after the water cut are dropped, metres. */
const MIN_RUN = 15
/** Douglas–Peucker tolerance for the wall line: corners stay corners, wobbles go, metres. */
const SIMPLIFY = 0.4

/**
 * A kit as the layout needs it: the pinned `EdgeKit` plus how its pieces sit (measured from the GLBs).
 * `along` is the piece-space axis a segment runs on; `across` is how far its mesh centre sits off the
 * origin across the run (piece-space x when running along z, z when running along x).
 */
export interface EdgeKitProfile extends EdgeKit {
  along: "x" | "z"
  across: number
  /** Metres across the run. */
  thickness: number
  /** The tower's narrowest width (its reach over a joint is half of it), metres. */
  towerSize?: number
  /** Metres the gate piece covers at scale 1. */
  gateLength?: number
}

/**
 * Measured kits (catalog sizes after import). Walls run along their piece x, hedges and fences along
 * z; every piece here is centred on its origin across the run except Kenney's hedge, which sits on its
 * cell's +x edge.
 */
export const EDGE_KITS = {
  /** KayKit Medieval Hexagon: thick crenellated stone, round blue-bannered towers. City and capital. */
  stone: {
    segment: "kaykit-hexagon/wall-straight",
    length: 8.4,
    tower: "kaykit-hexagon/building-tower-base-blue",
    towerSize: 7.44,
    gate: "kaykit-hexagon/wall-straight-gate",
    gateLength: 8.4,
    along: "x",
    across: 0,
    thickness: 3.36,
  },
  /** Quaternius Modular Medieval: a lighter crenellated wall with slender round towers. Town. */
  curtain: {
    segment: "quaternius-castle/wall",
    length: 3.88,
    tower: "quaternius-castle/tower",
    towerSize: 2.84,
    gate: "quaternius-castle/wall-entrance",
    gateLength: 3.88,
    along: "x",
    across: 0,
    thickness: 1.41,
  },
  /** Kenney Fantasy Town's tall hedge. Village. */
  hedge: {
    segment: "kenney-town/hedge-large",
    length: 3.47,
    along: "z",
    across: 1.04,
    thickness: 1.39,
  },
  /** KayKit's wooden rail fence. Hamlet, and fields. */
  fence: {
    segment: "kaykit-hexagon/fence-wood-straight",
    length: 2.31,
    along: "z",
    across: 0,
    thickness: 0.2,
  },
} as const satisfies Record<string, EdgeKitProfile>

/** The kit for each edge kind in a town of this tier: a city's wall is heavier than a town's. */
export function edgeKits(tier: Tier): Record<Edge["kind"], EdgeKitProfile> {
  const big = tier === "city" || tier === "capital"
  return { wall: big ? EDGE_KITS.stone : EDGE_KITS.curtain, hedge: EDGE_KITS.hedge, fence: EDGE_KITS.fence }
}

/** The kind of edge that closes an unwalled town: a hamlet fences itself, anything larger hedges. */
export function townEdgeKind(spec: TownSpecInput): Edge["kind"] {
  const s = normalizeSpec(spec)
  return s.walls ? "wall" : s.tier === "hamlet" ? "fence" : "hedge"
}

/**
 * The town's edge: one or more lines just outside the wall street, gapped where streets cross them.
 * A wall's line keeps its towers clear of the street; a lake cuts it, and each cut end runs on to the
 * shore. Ids start after any edge already in the plan.
 */
export function walls(plan: TownPlan, spec: TownSpecInput, roll: Roll): Edge[] {
  const s = normalizeSpec(spec)
  const kind = townEdgeKind(s)
  const kit = edgeKits(s.tier)[kind]
  const plazaC = centroid(at(plan.plazas, 0))
  const town = townRing(plan.streets, plazaC)
  if (!town) return []
  const reach = Math.max(kit.thickness, kit.towerSize ?? 0) / 2
  const line = outline(offsetRing(town.ring, town.band + WALL_ROOM + reach, plazaC))
  const firstId = plan.edges.reduce((m, e) => Math.max(m, e.id + 1), 0)
  const towers = kind === "wall" ? { spacing: round3(28 + 8 * roll("spacing:walls")) } : undefined
  const runs = plan.water.length > 0 ? cutAtWater(line, plan.water, reach) : [{ points: line, closed: true }]
  return runs.map((run, i) => ({
    id: firstId + i,
    kind,
    points: run.points,
    closed: run.closed,
    gaps: streetGaps(run.points, run.closed, plan.streets, kit),
    ...(towers ? { towers } : {}),
  }))
}

/** The pieces one edge is drawn with, by role. */
export interface EdgeLayout {
  segments: PieceInstance[]
  towers: PieceInstance[]
  gates: PieceInstance[]
}

/**
 * An edge as kit pieces. Runs between gaps are cut at stations (the ends, the sharp turns and, on a
 * walled kit, towers every `towers.spacing`); each stretch between stations is split into equal chords
 * whose pieces are scaled to fit them exactly, so neighbours meet end to end. Towers stand on the
 * stations, set back from a gap by half their reach so they clear the street; a gate gap gets the gate
 * piece scaled to its width.
 */
export function layoutEdge(edge: Edge, kit: EdgeKitProfile): EdgeLayout {
  const path = pathOf(edge.points, edge.closed)
  const out: EdgeLayout = { segments: [], towers: [], gates: [] }
  if (path.total <= EPS) return out
  const tower = kit.tower && kit.towerSize && edge.towers ? kit : null
  const reach = tower ? (tower.towerSize ?? 0) / 2 : 0

  for (const g of edge.gaps) {
    if (g.kind !== "gate" || !kit.gate || !kit.gateLength) continue
    const a = path.at(g.s - g.width / 2)
    const b = path.at(g.s + g.width / 2)
    out.gates.push(place(kit.gate, kit, lerp(a, b, 0.5), sub(b, a), g.width / kit.gateLength))
  }

  for (const run of solidRuns(edge, path.total)) {
    const from = run.a + (run.gapA ? reach / 2 : 0)
    const to = run.b - (run.gapB ? reach / 2 : 0)
    if (to - from <= EPS) {
      if (tower)
        out.towers.push(
          place(tower.tower as string, tower, path.at((from + to) / 2), path.dir((from + to) / 2), 1),
        )
      continue
    }
    const stops = stations(path, from, to, tower ? reach : 0, edge.towers?.spacing)
    if (tower)
      for (const s of stops) out.towers.push(place(tower.tower as string, tower, path.at(s), path.dir(s), 1))
    for (let k = 0; k + 1 < stops.length; k++) {
      const u = at(stops, k)
      const v = at(stops, k + 1)
      const l = v - u
      // Two towers whose reaches meet already close a short stretch.
      if (tower && l <= 2 * reach * 0.95) continue
      const n = Math.max(1, Math.round(l / kit.length))
      for (let i = 0; i < n; i++) {
        const p = path.at(u + (l * i) / n)
        const q = path.at(u + (l * (i + 1)) / n)
        out.segments.push(place(kit.segment, kit, lerp(p, q, 0.5), sub(q, p), dist(p, q) / kit.length))
      }
    }
  }
  return out
}

/** Every piece of an edge, segments then towers then gates. */
export function edgePieces(edge: Edge, kit: EdgeKitProfile): PieceInstance[] {
  const l = layoutEdge(edge, kit)
  return [...l.segments, ...l.towers, ...l.gates]
}

/** A piece centred on `mid`, its run axis along `dir`, uniformly scaled. */
function place(piece: string, kit: EdgeKitProfile, mid: Vec2, dir: Vec2, s: number): PieceInstance {
  const d = norm(dir)
  const rot = kit.along === "x" ? DMath.atan2(-d[1], d[0]) : DMath.atan2(d[0], d[1])
  // The piece's cross axis in world space (local x when running along z, local z when along x); its
  // mesh sits `across` off the origin along it, so the origin moves back by that much.
  const side: Vec2 = kit.along === "z" ? [d[1], -d[0]] : [-d[1], d[0]]
  const p = sub(mid, scale(side, kit.across * s))
  return { piece, x: round3(p[0]), y: 0, z: round3(p[1]), rot: round3(rot), scale: round3(s) }
}

interface Run {
  a: number
  b: number
  /** Whether each end is a gap's edge (else the line's own end). */
  gapA: boolean
  gapB: boolean
}

/** The stretches of the edge between its gaps, as arc lengths (a closed edge's may run past `total`). */
function solidRuns(edge: Edge, total: number): Run[] {
  const gaps = [...edge.gaps].sort((x, y) => x.s - y.s)
  if (gaps.length === 0) return [{ a: 0, b: total, gapA: false, gapB: false }]
  const runs: Run[] = []
  if (!edge.closed) {
    let a = 0
    let gapA = false
    for (const g of gaps) {
      runs.push({ a, b: g.s - g.width / 2, gapA, gapB: true })
      a = g.s + g.width / 2
      gapA = true
    }
    runs.push({ a, b: total, gapA, gapB: false })
    return runs.filter((r) => r.b - r.a > EPS || (r.gapA && r.gapB))
  }
  gaps.forEach((g, k) => {
    const next = gaps[k + 1] ?? { s: at(gaps, 0).s + total, width: at(gaps, 0).width }
    runs.push({ a: g.s + g.width / 2, b: next.s - next.width / 2, gapA: true, gapB: true })
  })
  return runs
}

/**
 * Where a run stops: its two ends, its sharp turns (no closer than `room` to another stop) and, when
 * `spacing` is given, evenly spread extra stops wherever two stops lie more than 1.4 spacings apart.
 */
function stations(path: Path, from: number, to: number, room: number, spacing?: number): number[] {
  const stops = [from]
  const sharp = path.turns
    .filter((t) => t.angle > SHARP)
    .flatMap((t) => [t.s, t.s + path.total])
    .filter((s) => s > from + Math.max(room, EPS) && s < to - Math.max(room, EPS))
    .sort((x, y) => x - y)
  for (const s of sharp) if (s - at(stops, stops.length - 1) > room) stops.push(s)
  if (to - at(stops, stops.length - 1) <= room && stops.length > 1) stops.pop()
  stops.push(to)
  if (!spacing) return stops
  const out: number[] = [from]
  for (let k = 1; k < stops.length; k++) {
    const u = at(stops, k - 1)
    const v = at(stops, k)
    const extra = v - u > 1.4 * spacing ? Math.round((v - u) / spacing) - 1 : 0
    for (let i = 1; i <= extra; i++) out.push(u + ((v - u) * i) / (extra + 1))
    out.push(v)
  }
  return out
}

interface Path {
  total: number
  /** The point at arc length s (a closed path wraps; an open one clamps). */
  at: (s: number) => Vec2
  /** The unit direction of travel at arc length s. */
  dir: (s: number) => Vec2
  /** Each vertex's arc length and turn angle (radians); an open path's ends have none. */
  turns: { s: number; angle: number }[]
}

function pathOf(points: readonly Vec2[], closed: boolean): Path {
  const pts = closed ? [...points, at(points, 0)] : [...points]
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(at(cum, i - 1) + dist(at(pts, i - 1), at(pts, i)))
  const total = at(cum, cum.length - 1)
  const find = (s0: number): { i: number; t: number } => {
    const s = closed ? ((s0 % total) + total) % total : Math.min(Math.max(s0, 0), total)
    let i = 0
    while (i < pts.length - 2 && at(cum, i + 1) < s) i++
    const l = at(cum, i + 1) - at(cum, i)
    return { i, t: l > 0 ? (s - at(cum, i)) / l : 0 }
  }
  const turns: Path["turns"] = []
  const n = points.length
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const u = sub(at(points, i), at(points, (i - 1 + n) % n))
    const v = sub(at(points, (i + 1) % n), at(points, i))
    turns.push({ s: at(cum, i), angle: DMath.atan2(Math.abs(cross(u, v)), dot(u, v)) })
  }
  return {
    total,
    at: (s) => {
      const { i, t } = find(s)
      return lerp(at(pts, i), at(pts, i + 1), t)
    },
    dir: (s) => {
      const { i } = find(s)
      return norm(sub(at(pts, i + 1), at(pts, i)))
    },
    turns,
  }
}

/**
 * Where streets cross the line: one gap per crossing (crossings closer than a gap's width merge). A
 * crossing by a street from a gate node is a gate; any other is a plain gap. A walled kit's gap is the
 * street plus a tower's reach and a metre, at least the gate piece's length.
 */
function streetGaps(
  points: readonly Vec2[],
  closed: boolean,
  g: StreetGraph,
  kit: EdgeKitProfile,
): Edge["gaps"] {
  const path = pathOf(points, closed)
  const pts = closed ? [...points, at(points, 0)] : [...points]
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(at(cum, i - 1) + dist(at(pts, i - 1), at(pts, i)))
  const hits: { s: number; width: number; kind: "gate" | "gap" }[] = []
  for (const e of g.edges) {
    const gate = at(g.nodes, e.a).kind === "gate" || at(g.nodes, e.b).kind === "gate"
    const width = kit.towerSize ? Math.max(kit.gateLength ?? 0, e.width + kit.towerSize / 2 + 1) : e.width + 1
    for (let i = 0; i + 1 < pts.length; i++)
      for (let j = 0; j + 1 < e.points.length; j++) {
        const hit = intersect(at(pts, i), at(pts, i + 1), at(e.points, j), at(e.points, j + 1))
        if (!hit) continue
        const s = at(cum, i) + hit.t * dist(at(pts, i), at(pts, i + 1))
        hits.push({ s, width: round3(width), kind: gate ? "gate" : "gap" })
      }
  }
  hits.sort((a, b) => a.s - b.s)
  const out: Edge["gaps"] = []
  for (const h of hits) {
    const last = out[out.length - 1]
    if (last && h.s - last.s < (h.width + last.width) / 2) {
      if (h.kind === "gate") last.kind = "gate"
      last.width = Math.max(last.width, h.width)
      continue
    }
    // An open line's gap stays on the line.
    const s = closed ? h.s : Math.min(Math.max(h.s, h.width / 2), path.total - h.width / 2)
    out.push({ s: round3(s), width: h.width, kind: h.kind })
  }
  return out
}

/**
 * The wall street's loop: the union of the faces the town's streets close (dead ends pruned), as the
 * outer ring holding the plaza, with the half-width (plus kerb) of the widest street along it.
 */
function townRing(g: StreetGraph, plazaC: Vec2): { ring: Ring; band: number } | null {
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
  const pg: PlanarGraph = { nodes: g.nodes.map((n) => n.at), edges: [] }
  g.edges.forEach((e, i) => {
    if (!alive[i]) return
    let prev = e.a
    for (let k = 1; k < e.points.length; k++) {
      const next = k === e.points.length - 1 ? e.b : pg.nodes.push(at(e.points, k)) - 1
      pg.edges.push({ a: prev, b: next, src: i })
      prev = next
    }
  })
  const found = faces(pg)
  if (found.length === 0) return null
  const union = sturdyClip(
    found.map((f) => [f.ring]),
    [],
    "union",
  )
  const ring = outerHolding(union, plazaC)
  if (!ring) return null
  const rim = g.edges.filter((e, i) => alive[i] && e.points.every((p) => distTo(p, ring, true) <= 0.05))
  const band = Math.max(0, ...rim.map((e) => e.width)) / 2 + KERB
  return { ring, band }
}

/** The outer ring of the polygon holding p (else the largest). */
function outerHolding(multi: readonly Polygon[], p: Vec2): Ring | null {
  const hit = multi.find((poly) => contains(poly, p))
  if (hit) return at(hit, 0)
  const sorted = [...multi].sort((a, b) => area(at(b, 0)) - area(at(a, 0)))
  return sorted[0] ? at(sorted[0], 0) : null
}

/** The ring grown by d (the polygon offset; the mitred line offset if the booleans trip). */
export function offsetRing(ring: Ring, d: number, inside: Vec2): Ring {
  try {
    const grown = outerHolding(offset(ring, d), inside)
    if (grown && grown.length >= 3) return grown
  } catch {
    // polygon-clipping can fail on valid near-degenerate input: the line offset stands in.
  }
  const ccw = area(ring) >= 0 ? ring : [...ring].reverse()
  return offsetLine(ccw, -d, true)
}

/** A closed ring as the edge's line: simplified, on the 1e-3 grid, counter-clockwise. */
export function outline(ring: Ring): Vec2[] {
  const ccw = area(ring) >= 0 ? ring : [...ring].reverse()
  return dedupe(simplify(ccw, SIMPLIFY, true), true).map(snap)
}

/** Douglas–Peucker: the fewest points within `tol` of the line (a closed one keeps its first point). */
function simplify(points: readonly Vec2[], tol: number, closed: boolean): Vec2[] {
  if (points.length < 3) return [...points]
  if (closed) {
    // Split at the point farthest from the first, simplify both halves.
    const first = at(points, 0)
    let far = 0
    points.forEach((p, i) => {
      if (dist(p, first) > dist(at(points, far), first)) far = i
    })
    const a = simplify(points.slice(0, far + 1), tol, false)
    const b = simplify([...points.slice(far), first], tol, false)
    return [...a, ...b.slice(1, -1)]
  }
  const a = at(points, 0)
  const b = at(points, points.length - 1)
  let worst = -1
  let worstD = tol
  for (let i = 1; i + 1 < points.length; i++) {
    const d = closest(at(points, i), a, b).d
    if (d > worstD) {
      worst = i
      worstD = d
    }
  }
  if (worst < 0) return [a, b]
  return [
    ...simplify(points.slice(0, worst + 1), tol, false).slice(0, -1),
    ...simplify(points.slice(worst), tol, false),
  ]
}

/**
 * The closed line minus its waterfront (the stretch within `WATERFRONT` of the water, where the quay
 * street runs instead), each remaining piece run on from its cut ends to the shore. An end stops
 * `reach + SHORE_ROOM` from the water so its tower stands on land.
 */
function cutAtWater(
  line: readonly Vec2[],
  water: readonly Vec2[][],
  reach: number,
): { points: Vec2[]; closed: boolean }[] {
  const toWater = (p: Vec2) => Math.min(...water.map((w) => (contains(w, p, 0) ? 0 : distTo(p, w, true))))
  const near = (p: Vec2) => toWater(p) < WATERFRONT
  const start = line.findIndex((p) => !near(p))
  if (start < 0) return []
  const loop = [...line.slice(start), ...line.slice(0, start), at(line, start)]
  if (!loop.some(near)) return [{ points: [...line], closed: true }]

  // Walk the loop in fine steps; keep the stretches away from the water, cut where it comes near.
  const pieces: Vec2[][] = []
  let cur: Vec2[] = []
  for (let i = 0; i + 1 < loop.length; i++) {
    const a = at(loop, i)
    const b = at(loop, i + 1)
    if (!near(a)) cur.push(a)
    const steps = Math.max(1, Math.ceil(dist(a, b) / 0.25))
    for (let k = 1; k <= steps; k++) {
      const p = lerp(a, b, (k - 1) / steps)
      const q = lerp(a, b, k / steps)
      if (near(p) !== near(q)) {
        const x = edgeOfZone(p, q, near)
        if (near(q)) {
          cur.push(x)
          pieces.push(cur)
          cur = []
        } else cur.push(x)
      }
    }
  }
  if (!near(at(loop, loop.length - 1))) cur.push(at(loop, loop.length - 1))
  if (cur.length > 1) pieces.push(cur)

  // The loop starts away from the water, so its first and last pieces are one wall.
  const last = pieces.length > 1 ? pieces.pop() : undefined
  if (last) pieces[0] = [...last, ...at(pieces, 0)]
  return pieces
    .map((p) => dedupe(p))
    .filter((p) => p.length > 1 && length(p) >= MIN_RUN)
    .map((p) => {
      const stop = reach + SHORE_ROOM
      const head = toShore(at(p, 1), at(p, 0), water, toWater, stop)
      const tail = toShore(at(p, p.length - 2), at(p, p.length - 1), water, toWater, stop)
      const body = simplify(p, SIMPLIFY, false)
      return { points: dedupe([...head.reverse(), ...body, ...tail]).map(snap), closed: false }
    })
}

/** The point between p and q (on either side of the zone's edge) where `inside` flips, by bisection. */
function edgeOfZone(p: Vec2, q: Vec2, inside: (x: Vec2) => boolean): Vec2 {
  let lo = p
  let hi = q
  const want = inside(p)
  for (let i = 0; i < 20; i++) {
    const m = lerp(lo, hi, 0.5)
    if (inside(m) === want) lo = m
    else hi = m
  }
  return want ? hi : lo
}

/**
 * From a cut end, on toward the water the way the line was heading (or straight at the nearest shore
 * when that misses it), stopping `stop` short of the water: the points to append past the end.
 */
function toShore(
  prev: Vec2,
  end: Vec2,
  water: readonly Vec2[][],
  toWater: (p: Vec2) => number,
  stop: number,
): Vec2[] {
  if (toWater(end) <= stop || toWater(end) > WATERFRONT + 0.1) return []
  let dir = norm(sub(end, prev))
  const far = add(end, scale(dir, 4 * WATERFRONT))
  let hit: Vec2 | null = null
  for (const w of water)
    for (let i = 0; i < w.length; i++) {
      const h = intersect(end, far, at(w, i), at(w, (i + 1) % w.length))
      if (h && (!hit || dist(end, h.at) < dist(end, hit))) hit = h.at
    }
  if (!hit) {
    let best: { at: Vec2; d: number } | null = null
    for (const w of water)
      for (let i = 0; i < w.length; i++) {
        const c = closest(end, at(w, i), at(w, (i + 1) % w.length))
        if (!best || c.d < best.d) best = c
      }
    if (!best) return []
    hit = best.at
    dir = norm(sub(hit, end))
  }
  let t = dist(end, hit) - stop
  while (t > 0 && toWater(add(end, scale(dir, t))) < stop) t -= 0.25
  return t > 0.5 ? [snap(add(end, scale(dir, t)))] : []
}
