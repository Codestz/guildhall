/**
 * Stage 2 (plan §4): the street graph, grown the way an old town grows rather than drawn with a
 * compass. A closed street runs round the town through its gates (the wall street: W4 raises the
 * wall along it), bulging unevenly between them and running along the waterfront where a lake cuts
 * it. The market is an irregular square: a frame of straight sides round the plaza whose corners are
 * where the main streets come in, the main gate's corner drawn out so its street widens into the
 * square. Main streets bend from those corners out to the gates; partial rings (never a whole
 * circle, each at its own radius) join some neighbouring main streets; side streets fork off and
 * wander outward until they meet another street, a few of them forking round a small triangular
 * square (a well's, an inn's, a chapel's). A harbour street drops from the square to the shore (the
 * quay) and a street rings the castle ground. Outside, each gate's road wanders on to the coast and
 * forks once into a footpath that stops in the country (a `road-end`, for W8's points of interest).
 * A hamlet has no wall street: one bent street, or a crossroads, through a small green.
 *
 * Everything is planarized into nodes at junctions and edges carrying their polylines, vertices on
 * the 1 m grid where they are drawn (not where streets cross or fork). Every draw goes through
 * `roll`, its varying part first.
 */
import { DMath } from "@guildhall/core"
import { chaikin, closest, dedupe, intersect, length, resample } from "../geom/line.ts"
import { axes, obb, rectCorners } from "../geom/obb.ts"
import { planarize } from "../geom/planar.ts"
import { area, bbox, centroid, clip, contains, offset, type Polygon, type Ring } from "../geom/poly.ts"
import type { Roll } from "../geom/sample.ts"
import {
  add,
  at,
  dist,
  dot,
  EPS,
  lerp,
  norm,
  perp,
  round3,
  scale,
  snap,
  sub,
  type Vec2,
} from "../geom/vec.ts"
import { normalizeSpec, TIER_DEFAULTS } from "./spec.ts"
import type { Site, Square, StreetEdge, StreetGraph, StreetNode, Tier, TownSpecInput } from "./types.ts"

export type StreetClass = StreetEdge["cls"]

/** Street widths by class, metres (plan §3.4). */
export const STREET_WIDTH: Readonly<Record<StreetClass, number>> = { main: 7, street: 5, lane: 3.5, road: 4 }
/** Nodes closer than this merge, and a street end this close to another street joins it, metres. */
export const MERGE = 2
/** The waterfront street's centreline lies this far from the water (a 4 m quay strip remains), metres. */
export const QUAY = 7
/** The most road just outside each gate that gets suburb frontage, metres (blocks.ts builds it). */
export const SUBURB: Readonly<Record<Tier, number>> = {
  hamlet: 24,
  village: 32,
  town: 45,
  city: 60,
  capital: 70,
}

/** The kernel's booleans retry near-degenerate input themselves now; kept for callers importing it. */
export const sturdyClip = clip

/** Gates keep this far back from the water, beyond the quay, metres. */
const GATE_SHORE = 12
/** Gates keep this far round (radians, seen from the plaza) from the castle. */
const CASTLE_ARC = 0.7
/** The market frame keeps this much room between the plaza's edge and its centreline, metres. */
const FRAME_ROOM = 4
/** Angles tried round the gate circle. */
const GATE_SAMPLES = 360
/** Side streets that fork off and wander outward, by tier (the squares' forks among them). */
const SPURS: Readonly<Record<Tier, number>> = { hamlet: 0, village: 2, town: 5, city: 8, capital: 10 }
/** Secondary squares, by tier. */
const SQUARES: Readonly<Record<Tier, number>> = { hamlet: 0, village: 1, town: 2, city: 3, capital: 3 }
/** What the squares are for, in the order they are made. */
const SQUARE_KINDS: readonly Square["kind"][] = ["well", "inn", "chapel"]
/** A street piece shorter than this is not worth a street, metres. */
const SHORT = 12

interface StreetLine {
  points: Vec2[]
  cls: StreetClass
}

interface NodeMark {
  at: Vec2
  kind?: StreetNode["kind"]
  tag?: StreetNode["tag"]
}

/** A piece of a line cut at its crossings with other lines; `to` when its last point is a crossing. */
interface Piece {
  points: Vec2[]
  from: boolean
  to: boolean
}

/** The land piece the town stands on: the one holding the plaza (a lake can cut a corner off). */
export function townLand(site: Site): Polygon {
  const c = centroid(site.plaza)
  return site.land.find((poly) => contains(poly, c)) ?? (site.land[0] as Polygon)
}

export function streets(island: Site, spec: TownSpecInput, roll: Roll): StreetGraph {
  const s = normalizeSpec(spec)
  // The sea is all round the island: a town without a harbour keeps its back to it (no harbour
  // street, no waterfront); its roads still stop at the coast, where the land does.
  const site = s.harbour ? island : { ...island, water: [] }
  const r = site.radius
  const land = townLand(site)
  const plazaC = centroid(site.plaza)
  const dry = piece(offset(land, -(QUAY + GATE_SHORE)), plazaC)
  const hamlet = s.tier === "hamlet"
  // A hamlet's two ways in lie roughly along its axis, so its street runs past the green.
  const axis = hamlet ? hamletAxis(site) : null
  const along = axis ? DMath.atan2(axis[1], axis[0]) + 0.4 * (2 * roll("along:gates") - 1) : undefined
  const gates = placeGates(r, hamlet ? 2 : TIER_DEFAULTS[s.tier].gates, dry, plazaC, site, roll, along)
  const shore = nearestShore(site.water, plazaC)
  return hamlet
    ? hamletStreets(site, gates, shore, roll)
    : townStreets(site, s.tier, s.walls, gates, shore, roll)
}

function townStreets(
  site: Site,
  tier: Tier,
  walls: boolean,
  gates: Vec2[],
  shore: Vec2 | null,
  roll: Roll,
): StreetGraph {
  const r = site.radius
  const land = townLand(site)
  const plazaC = centroid(site.plaza)
  const quayLand = piece(offset(land, -QUAY), plazaC)
  // The castle street runs round the castle ground, its kerbed half-width out from it.
  const round = STREET_WIDTH.street + 1
  const castle = site.castleSite
    ? rectCorners({ ...site.castleSite, w: site.castleSite.w + round, d: site.castleSite.d + round })
    : null

  const loop = wallLoop(gates, r, roll)
  let town = piece(clip(loop, quayLand, "intersection"), plazaC)
  // A castle on the town's edge is part of its defences: the wall street goes round its far side.
  if (castle?.some((p) => !contains(town, p, 0)))
    town = piece(clip(clip(town, castle, "union"), quayLand, "intersection"), plazaC)
  const main = mainGate(gates, site, plazaC, roll)
  const frame = marketFrame(site.plaza, gates, main, FRAME_ROOM, 1.5, roll)

  const inTown = (p: Vec2) => contains(town, p)
  const inFrame = (p: Vec2) => contains(frame.ring, p)
  const inCastle = (p: Vec2) => castle !== null && contains(castle, p)
  const free = (p: Vec2) => contains(town, p, 0) && !inFrame(p) && !inCastle(p)
  const cuts = [town, frame.ring, ...(castle ? [castle] : [])]

  const lines: StreetLine[] = [{ points: closeLine(town.map(grid)), cls: walls ? "street" : "lane" }]
  // Where the plaza sits near the water the square gives way to the waterfront street.
  for (const p of clipLine(closeLine(frame.ring), inTown, [town])) lines.push({ points: p, cls: "street" })
  if (castle) {
    // Its sides on the town's edge are the wall street's.
    const inside = (q: Vec2) => contains(town, q, 0) && !inFrame(q) && distTo(q, town) > 1
    for (const p of clipLine(closeLine(castle), inside, [town, frame.ring]))
      lines.push({ points: p, cls: "street" })
  }

  const marks: NodeMark[] = gates.map((g) => ({ at: g, kind: "gate" }))
  const mains: Vec2[][] = []
  gates.forEach((g, k) => {
    const start = at(frame.mouths, k)
    const pieces = clipLine(bent(start, g, 0.14, `${k}:main`, roll), free, cuts)
    for (const p of pieces) {
      lines.push({ points: p, cls: "main" })
      mains.push(p)
    }
    // Where the bends dip back inside the square, the street leaves it further round; where it
    // leaves right beside the castle street, the two merge and the junction is the castle's.
    const leaves = pieces[0] && at(pieces[0], 0)
    const byCastle = (p: Vec2) => castle !== null && distTo(p, castle) <= 2 * MERGE
    if (leaves && distTo(leaves, frame.ring) <= 0.01 && !byCastle(leaves))
      marks.push({ at: leaves, kind: "plaza" })
  })

  if (shore) {
    const onFrame = rayHit(plazaC, shore, frame.ring)
    const start = onFrame && inTown(onFrame) ? onFrame : rayHit(plazaC, shore, town)
    const keep = (q: Vec2) => contains(land, q) && !(inFrame(q) && inTown(q)) && !inCastle(q)
    const harbour = start
      ? clipLine(bent(start, shore, 0.08, "harbour:main", roll), keep, [...cuts, ...land])
      : []
    const first = harbour.find((p) => start && dist(at(p, 0), start) <= MERGE)
    if (start && first) {
      lines.push({ points: first, cls: "main" })
      marks.push({ at: at(first, first.length - 1), kind: "quay" })
      if (start === onFrame) marks.push({ at: start, kind: "plaza" })
    }
  }

  // The castle's own approach: from the middle of its front, toward the market, to the first street.
  if (site.castleSite && castle) {
    const front = rayHit(site.castleSite.c, plazaC, castle)
    if (front) {
      const run = firstRun(bent(front, plazaC, 0.06, "castle:approach", roll), pointsOf(lines), 0.5)
      if (run?.to && length(run.points) >= SHORT && free(mid(run.points)))
        lines.push({ points: run.points, cls: "street" })
    }
  }

  // A street joining the wall street must keep clear of the gates, which are the main streets'.
  const fits = (pts: Vec2[]) =>
    free(mid(pts)) && [at(pts, 0), at(pts, pts.length - 1)].every((p) => gates.every((g) => dist(g, p) >= 10))
  const arcs = partialRings(tier, r, gates, plazaC, lines, fits, roll)
  for (const a of arcs) lines.push({ points: a, cls: "street" })

  const squares = sideStreets(tier, r, plazaC, [...mains, ...arcs], lines, fits, roll)

  gates.forEach((g, k) => {
    countryRoad(
      g,
      k,
      r,
      site,
      (q) => contains(land, q) && !contains(town, q, 0),
      [town, ...land],
      SUBURB[tier],
      lines,
      marks,
      roll,
    )
  })
  const graph = buildGraph(lines, marks)
  return squares.length > 0 ? { ...graph, squares } : graph
}

/**
 * A hamlet: one bent street from gate to gate that runs past a small green along its long side, a
 * lane bowing round the green's far side back to the street, and (one time in two) a crossroads:
 * an arm or two running out into the fields from the street or the lane. No ring encloses it.
 */
function hamletStreets(site: Site, gates: Vec2[], shore: Vec2 | null, roll: Roll): StreetGraph {
  const r = site.radius
  const land = townLand(site)
  const plazaC = centroid(site.plaza)
  // A hamlet keeps no quay: its streets need only keep off the water itself.
  const quayLand = piece(offset(land, -MERGE), plazaC)
  const box = obb(site.plaza)
  // The street runs along the hamlet's axis on the gates' side of the green (inland, by water);
  // the lane bows round the other side.
  const x = hamletAxis(site)
  const z = perp(x)
  const lean = gates.reduce((sum: Vec2, g) => add(sum, sub(g, plazaC)), [0, 0])
  const water = site.water[0] ? sub(plazaC, centroid(site.water[0])) : null
  const toStreet = dot(water ?? lean, z) > 0 ? z : scale(z, -1)
  const ends = gates.length === 2 && dot(sub(at(gates, 0), plazaC), x) > dot(sub(at(gates, 1), plazaC), x)
  const along = ends ? x : scale(x, -1)
  // The plaza's reach along the axis, toward the street and toward the lane.
  const reach = (d: Vec2) => Math.max(...site.plaza.map((p) => dot(sub(p, box.c), d)))
  const half = reach(along) + 4
  const gap = reach(toStreet) + 2 + STREET_WIDTH.main / 2
  const bow = reach(scale(toStreet, -1)) + (water ? 3 : 6) + STREET_WIDTH.lane / 2 + 3 * roll("bow:hamlet")
  const apex = 0.3 * (2 * roll("apex:hamlet") - 1) * half
  // Laid out round the plaza, or moved inland a step at a time until it keeps off the water.
  const layout = (shift: number) => {
    const c = add(box.c, scale(toStreet, shift))
    const pa = grid(add(c, add(scale(along, half), scale(toStreet, gap))))
    const pb = grid(add(c, add(scale(along, -half), scale(toStreet, gap))))
    const lane = smooth(
      [
        pa,
        add(c, add(scale(along, half + 1), scale(toStreet, -0.6 * bow))),
        add(c, add(scale(along, apex), scale(toStreet, -bow))),
        add(c, add(scale(along, -half - 1), scale(toStreet, -0.6 * bow))),
        pb,
      ],
      1,
      5,
    )
    lane[0] = pa
    lane[lane.length - 1] = pb
    return { pa, pb, lane }
  }
  const dry = (l: ReturnType<typeof layout>) =>
    l.lane.every((p) => contains(quayLand, p, 0) && distTo(p, quayLand) > STREET_WIDTH.lane)
  let shift = 0
  while (water && shift < 24 && !dry(layout(shift))) shift += 2
  const { pa, pb, lane } = layout(shift)
  const green: Ring = [...lane.slice(0, -1), pb]
  const inGreen = (p: Vec2) => contains(green, p)
  const free = (p: Vec2) => contains(quayLand, p, 0) && !inGreen(p)
  const lines: StreetLine[] = []
  for (const p of clipLine([pa, pb], (q) => contains(quayLand, q), [quayLand]))
    lines.push({ points: p, cls: "main" })
  for (const p of clipLine(lane, (q) => contains(quayLand, q), [quayLand]))
    lines.push({ points: p, cls: "lane" })

  const marks: NodeMark[] = []
  const reached: Vec2[] = []
  gates.forEach((g, k) => {
    // Each gate's street comes in to the nearer end of the green's side (else the other end); the
    // second gate takes the end the first left free, so the street runs through.
    const taken = marks.find((m) => m.kind === "plaza")?.at
    const near = dist(g, pa) <= dist(g, pb) ? [pa, pb] : [pb, pa]
    const ends = taken ? near.sort((p, q) => Number(p === taken) - Number(q === taken)) : near
    // Its bends are drawn again (less deep) when they would run it along the lane, which leaves the
    // same end of the street.
    const tries = ends.flatMap((start) => [0, 1, 2].map((t) => ({ start, t })))
    for (const { start, t } of tries) {
      const salt = t === 0 ? `${k}:main` : `${k}:${t}:main`
      const pieces = clipLine(bent(start, g, 0.2 / (1 + t), salt, roll), free, [green, quayLand])
      const first = pieces.find(
        (p) =>
          dist(at(p, p.length - 1), g) <= MERGE &&
          dist(at(p, 0), start) <= MERGE &&
          !tooClose(p, [lane], 6, 0, STREET_WIDTH.lane / 2 + MERGE),
      )
      if (!first) continue
      lines.push({ points: first, cls: "main" })
      marks.push({ at: start, kind: "plaza" })
      reached.push(g)
      marks.push({ at: g, kind: "gate" })
      return
    }
  })
  if (roll("crossroads:hamlet") < 0.5) {
    // Out from the middle of the street, away from the green, and from the lane's far side.
    const arms: [Vec2, Vec2][] = [
      [grid(lerp(pa, pb, 0.5)), toStreet],
      [at(lane, Math.floor(lane.length / 2)), scale(toStreet, -1)],
    ]
    const count = 1 + Math.floor(2 * roll("arms:hamlet"))
    arms.slice(0, count).forEach(([c, d], i) => {
      const out = DMath.atan2(d[1], d[0]) + 0.5 * (2 * roll(`${i}:arm-turn`) - 1)
      const walk = wander(c, out, 3, (0.25 + 0.1 * roll(`${i}:arm-length`)) * r, 0.35, out, `${i}:arm`, roll)
      const run = firstRun(walk, pointsOf(lines), 0.5)
      if (!run) return
      const kept = clipLine(run.points, free, [quayLand])[0]
      if (kept && dist(at(kept, 0), c) <= MERGE && length(kept) >= SHORT)
        lines.push({ points: kept, cls: "street" })
    })
  }
  if (shore) {
    const start = rayHit(plazaC, shore, green)
    const keep = (q: Vec2) => contains(land, q) && !inGreen(q)
    const harbour = start
      ? clipLine(bent(start, shore, 0.08, "harbour:main", roll), keep, [green, ...land])
      : []
    const first = harbour.find((p) => start && dist(at(p, 0), start) <= MERGE)
    if (start && first && !firstRun(first, pointsOf(lines), 0.5)?.to) {
      lines.push({ points: first, cls: "main" })
      marks.push({ at: at(first, first.length - 1), kind: "quay" })
    }
  }
  const inside = (q: Vec2) => dist(q, plazaC) < r - 0.5
  reached.forEach((g, k) => {
    countryRoad(
      g,
      k,
      r,
      site,
      (q) => contains(land, q) && !inside(q),
      land,
      SUBURB.hamlet,
      lines,
      marks,
      roll,
    )
  })
  return buildGraph(lines, marks)
}

/** The way a hamlet's street runs: along the shore where there is water, else along the plaza. */
function hamletAxis(site: Site): Vec2 {
  const water = site.water[0]
  if (water) return perp(norm(sub(centroid(water), centroid(site.plaza))))
  return axes(obb(site.plaza).rot).x
}

/**
 * The road out of a gate: it wanders on across the island to the coast, and once past the suburb it
 * forks into a footpath that runs off into the country and stops there, a `road-end`.
 */
function countryRoad(
  g: Vec2,
  k: number,
  r: number,
  site: Site,
  keep: (p: Vec2) => boolean,
  rings: readonly Ring[],
  suburbMax: number,
  lines: StreetLine[],
  marks: NodeMark[],
  roll: Roll,
): void {
  const plazaC = centroid(site.plaza)
  const out = DMath.atan2(g[1] - plazaC[1], g[0] - plazaC[0])
  // Enough strides to reach the far shore; the coast cuts it where it gets there.
  const far = Math.max(...rings.flatMap((ring) => ring.map((p) => dist(p, g))))
  const steps = Math.ceil(far / 30)
  const walk = wander(g, out, steps, 30, 0.3, out, `${k}:road`, roll)
  walk[0] = g
  const road = clipLine(walk, keep, rings).find((p) => dist(at(p, 0), g) <= MERGE)
  if (!road) return
  road[0] = g
  lines.push({ points: road, cls: "road" })
  const total = length(road)
  const suburb = Math.min(suburbMax, 0.6 * total)
  const s = suburb + 3 + 6 * roll(`${k}:fork`)
  if (s > total - 8) return
  const fork = pointAt(road, s)
  const side = roll(`${k}:fork-side`) < 0.5 ? -1 : 1
  const heading = DMath.atan2(fork.dir[1], fork.dir[0]) + side * (0.8 + 0.5 * roll(`${k}:fork-turn`))
  const reach = (0.2 + 0.2 * roll(`${k}:path-length`)) * r
  const path = wander(
    fork.at,
    heading,
    Math.max(2, Math.round(reach / 18)),
    18,
    0.35,
    null,
    `${k}:path`,
    roll,
  )
  const run = firstRun(path, pointsOf(lines), 0.5)
  if (!run) return
  const kept = clipLine(run.points, keep, rings)[0]
  if (!kept || dist(at(kept, 0), fork.at) > MERGE || length(kept) < SHORT) return
  // A footpath that runs into another road joins it, one cut by the coast ends there; one that
  // stops short in the country is a road end.
  const end = at(kept, kept.length - 1)
  const stops = !run.to && dist(end, at(run.points, run.points.length - 1)) <= 0.01
  lines.push({ points: kept, cls: "road" })
  marks.push({ at: fork.at, tag: "fork" })
  if (stops) marks.push({ at: at(kept, kept.length - 1), tag: "road-end" })
}

/**
 * Partial rings: between neighbouring main streets (seen round the plaza), an arc at its own radius,
 * from one main street to the next. Never every gap at once, so no ring closes; the bigger towns try
 * an inner and an outer band.
 */
function partialRings(
  tier: Tier,
  r: number,
  gates: readonly Vec2[],
  plazaC: Vec2,
  lines: readonly StreetLine[],
  fits: (points: Vec2[]) => boolean,
  roll: Roll,
): Vec2[][] {
  const angles = gates.map((g) => DMath.atan2(g[1] - plazaC[1], g[0] - plazaC[0])).sort((a, b) => a - b)
  const n = angles.length
  const bands: [number, number][] =
    tier === "village"
      ? [[0.45, 0.6]]
      : tier === "town"
        ? [
            [0.4, 0.52],
            [0.62, 0.74],
          ]
        : [
            [0.34, 0.46],
            [0.56, 0.7],
          ]
  const out: Vec2[][] = []
  const skip = Math.floor(n * roll("skip:rings"))
  for (let k = 0; k < n; k++) {
    const t0 = at(angles, k)
    let t1 = at(angles, k + 1)
    while (t1 <= t0) t1 += 2 * Math.PI
    bands.forEach(([lo, hi], b) => {
      // One gap in each band stays open, so no ring closes round the town.
      if (k === (skip + b) % n || roll(`${k}:${b}:ring`) < 0.25) return
      const base = r * (lo + (hi - lo) * roll(`${k}:${b}:ring-radius`))
      const from = t0 - 0.25
      const to = t1 + 0.25
      const count = Math.max(3, Math.round(((to - from) * base) / 22))
      const pts: Vec2[] = Array.from({ length: count + 1 }, (_, i) => {
        const t = from + ((to - from) * i) / count
        const rr = base * (1 + 0.14 * (2 * roll(`${k}:${b}:${i}:ring`) - 1))
        return add(plazaC, [rr * DMath.cos(t), rr * DMath.sin(t)])
      })
      const arc = smooth(pts, 2, 7)
      const others = [...pointsOf(lines), ...out]
      for (const p of splitAtHits(arc, others, 0))
        if (
          p.from &&
          p.to &&
          length(p.points) >= SHORT &&
          fits(p.points) &&
          !tooClose(p.points, others, 10, 10, 6)
        )
          out.push(p.points)
    })
  }
  return out
}

/**
 * Side streets: each forks off a main street or a ring at a slant and wanders outward until it meets
 * another street. The first few fork in a Y round a triangle of ground, a secondary square.
 */
function sideStreets(
  tier: Tier,
  r: number,
  plazaC: Vec2,
  parents: readonly Vec2[][],
  lines: StreetLine[],
  fits: (points: Vec2[]) => boolean,
  roll: Roll,
): Square[] {
  const squares: Square[] = []
  const want = SPURS[tier]
  const wantSquares = SQUARES[tier]
  const starts: Vec2[] = []
  const total = parents.reduce((sum, p) => sum + length(p), 0)
  if (total === 0) return squares
  let made = 0
  for (let attempt = 0; attempt < 4 * want && made < want; attempt++) {
    const salt = `${attempt}:spur`
    // A parent picked by length, and a place along it clear of its ends and of other forks.
    const pick = roll(`${salt}:parent`) * total
    let before = 0
    const parent =
      parents.find((p) => {
        before += length(p)
        return before > pick
      }) ?? at(parents, 0)
    const l = length(parent)
    const square = squares.length < wantSquares
    const half = square ? 18 + 5 * roll(`${salt}:base`) : 0
    if (l < 2 * (half + 14)) continue
    const s = half + 14 + (l - 2 * (half + 14)) * roll(`${salt}:at`)
    const base = pointAt(parent, s)
    if (starts.some((q) => dist(q, base.at) < 30)) continue
    const tangent = DMath.atan2(base.dir[1], base.dir[0])
    // Outward: the side of the parent facing away from the plaza.
    const left = perp(base.dir)
    const side = dot(left, sub(base.at, plazaC)) >= 0 ? 1 : -1
    const heading = tangent + side * (0.6 + 0.6 * roll(`${salt}:turn`))
    const away = DMath.atan2(base.at[1] - plazaC[1], base.at[0] - plazaC[0])
    const cls: StreetClass = square || roll(`${salt}:cls`) < 0.6 ? "street" : "lane"
    const lineSet = pointsOf(lines)

    if (!square) {
      const walk = wander(base.at, heading, Math.ceil((0.9 * r) / 16), 16, 0.3, away, salt, roll)
      const run = firstRun(walk, lineSet, 0.5)
      if (!run?.to || length(run.points) < SHORT || !fits(run.points)) continue
      if (tooClose(run.points, lineSet)) continue
      lines.push({ points: run.points, cls })
      starts.push(base.at)
      made++
      continue
    }
    // The Y: two legs from the parent meet at the square's far corner, and the street runs on.
    const a = pointAt(parent, s - half).at
    const b = pointAt(parent, s + half).at
    const tip = add(base.at, scale([DMath.cos(heading), DMath.sin(heading)], 26 + 6 * roll(`${salt}:depth`)))
    const legs = [
      [a, tip],
      [b, tip],
    ].map(([p, q]) =>
      resample([p as Vec2, q as Vec2], 6).map((x, i, all) => (i === 0 || i === all.length - 1 ? x : grid(x))),
    )
    const clear = legs.every((leg) => {
      const run = firstRun(leg, lineSet, 0.5)
      return run !== null && !run.to && fits(leg)
    })
    if (!clear) continue
    const walk = wander(tip, heading, Math.ceil((0.9 * r) / 16), 16, 0.3, away, salt, roll)
    const run = firstRun(walk, [...lineSet, ...legs], 0.5)
    if (!run?.to || length(run.points) < SHORT || !fits(run.points)) continue
    if (tooClose(run.points, lineSet)) continue
    for (const leg of legs) lines.push({ points: leg, cls: "street" })
    lines.push({ points: run.points, cls })
    squares.push({ at: snap(centroid([a, b, tip])), kind: at(SQUARE_KINDS, squares.length) })
    starts.push(base.at)
    made++
  }
  return squares
}

/** Whether the line runs alongside another street (closer than a block) for any of its middle. */
function tooClose(line: readonly Vec2[], others: readonly Vec2[][], head = 20, tail = 14, near = 8): boolean {
  const l = length(line)
  for (let s = head; s < l - tail; s += 6) {
    const p = pointAt(line, s).at
    for (const o of others) if (distTo(p, o) < near) return true
  }
  return false
}

/**
 * The lines as a street graph: planarized (crossings become nodes, near nodes merge), then every
 * run of plain two-way nodes of one class collapsed into a single edge carrying the polyline. A
 * mark names (or tags) the junction or end within the merge distance of it; any other node is a
 * `junction`, or an `end` when only one street reaches it.
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
  const tagged = new Map<number, NonNullable<StreetNode["tag"]>>()
  // A bend in the middle of one street: two edges of one class.
  const plain = (v: number) => {
    const list = at(inc, v)
    return list.length === 2 && clsOf(at(list, 0)) === clsOf(at(list, 1))
  }
  for (const m of marks) {
    let best = -1
    // A mark names where streets meet, change or end, never a bend in the middle of one.
    pg.nodes.forEach((p, i) => {
      if (plain(i) || dist(p, m.at) > MERGE) return
      if (best < 0 || dist(p, m.at) < dist(at(pg.nodes, best), m.at)) best = i
    })
    if (best < 0) continue
    if (m.kind && !marked.has(best)) marked.set(best, m.kind)
    if (m.tag && !tagged.has(best)) tagged.set(best, m.tag)
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
      const node: StreetNode = {
        id,
        at: at(pg.nodes, v),
        kind: marked.get(v) ?? (degree === 1 ? "end" : "junction"),
      }
      const tag = tagged.get(v)
      if (tag) node.tag = tag
      nodes.push(node)
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
  const boxes = rings.map((ring) => bbox(ring))
  for (let i = 0; i + 1 < line.length; i++) {
    const a = at(line, i)
    const b = at(line, i + 1)
    const ts = [0, 1]
    rings.forEach((ring, ri) => {
      const [lo, hi] = at(boxes, ri)
      if (Math.max(a[0], b[0]) < lo[0] || Math.min(a[0], b[0]) > hi[0]) return
      if (Math.max(a[1], b[1]) < lo[1] || Math.min(a[1], b[1]) > hi[1]) return
      for (let j = 0; j < ring.length; j++) {
        const hit = intersect(a, b, at(ring, j), at(ring, j + 1))
        if (hit) ts.push(hit.t)
      }
    })
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

/**
 * The line cut at every crossing with the other lines (crossings within `skip` metres of its start
 * left out: a line that starts on another street starts on it, it does not cross it).
 */
function splitAtHits(line: readonly Vec2[], others: readonly (readonly Vec2[])[], skip: number): Piece[] {
  const boxes = others.map((o) => bbox(o as Vec2[]))
  const hits: { i: number; t: number; at: Vec2 }[] = []
  let walked = 0
  for (let i = 0; i + 1 < line.length; i++) {
    const a = at(line, i)
    const b = at(line, i + 1)
    const l = dist(a, b)
    others.forEach((o, oi) => {
      const [lo, hi] = at(boxes, oi)
      if (Math.max(a[0], b[0]) < lo[0] || Math.min(a[0], b[0]) > hi[0]) return
      if (Math.max(a[1], b[1]) < lo[1] || Math.min(a[1], b[1]) > hi[1]) return
      for (let j = 0; j + 1 < o.length; j++) {
        const hit = intersect(a, b, at(o, j), at(o, j + 1))
        if (hit && walked + hit.t * l > skip) hits.push({ i, t: hit.t, at: hit.at })
      }
    })
    walked += l
  }
  hits.sort((x, y) => x.i - y.i || x.t - y.t)
  const out: Piece[] = []
  let cur: Vec2[] = [at(line, 0)]
  let from = false
  let hi = 0
  for (let i = 0; i + 1 < line.length; i++) {
    for (; hi < hits.length && at(hits, hi).i === i; hi++) {
      const h = at(hits, hi)
      if (dist(h.at, at(cur, cur.length - 1)) < 0.01 && cur.length > 1) continue
      cur.push(snap(h.at))
      if (cur.length > 1 && length(cur) > 0.01) out.push({ points: dedupe(cur), from, to: true })
      cur = [snap(h.at)]
      from = true
    }
    cur.push(at(line, i + 1))
  }
  if (cur.length > 1 && length(cur) > 0.01) out.push({ points: dedupe(cur), from, to: false })
  return out
}

/** The line from its start to the first street it crosses (or whole, when it crosses none). */
function firstRun(line: readonly Vec2[], others: readonly (readonly Vec2[])[], skip: number): Piece | null {
  return splitAtHits(line, others, skip)[0] ?? null
}

const pointsOf = (lines: readonly StreetLine[]): Vec2[][] => lines.map((l) => l.points)

/** The point at arc length s along the line, and the unit direction there. */
function pointAt(line: readonly Vec2[], s: number): { at: Vec2; dir: Vec2 } {
  let left = Math.max(0, s)
  for (let i = 0; i + 1 < line.length; i++) {
    const a = at(line, i)
    const b = at(line, i + 1)
    const l = dist(a, b)
    if (left <= l || i + 2 === line.length)
      return { at: snap(lerp(a, b, l === 0 ? 0 : Math.min(1, left / l))), dir: norm(sub(b, a)) }
    left -= l
  }
  return { at: at(line, 0), dir: [1, 0] }
}

/** The point half way along the line. */
const mid = (line: readonly Vec2[]): Vec2 => pointAt(line, length(line) / 2).at

/** The distance from p to the nearest point of a closed ring or open line. */
function distTo(p: Vec2, line: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, closest(p, at(line, i), at(line, i + 1)).d)
  if (line.length > 2) best = Math.min(best, closest(p, at(line, line.length - 1), at(line, 0)).d)
  return best
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
 * A street that wanders: `steps` strides of `stride` metres from `from`, its heading turning up to
 * `turn` radians a stride and (given `toward`) pulled a third of the way back toward that heading,
 * smoothed onto the grid. The start stays exactly where it was.
 */
function wander(
  from: Vec2,
  heading: number,
  steps: number,
  stride: number,
  turn: number,
  toward: number | null,
  salt: string,
  roll: Roll,
): Vec2[] {
  const pts: Vec2[] = [from]
  let h = heading
  let p = from
  for (let i = 1; i <= steps; i++) {
    h += turn * (2 * roll(`${i}:${salt}`) - 1)
    if (toward !== null) h += 0.33 * wrapAngle(toward - h)
    p = add(p, [stride * DMath.cos(h), stride * DMath.sin(h)])
    pts.push(p)
  }
  const out = smooth(pts, 1, Math.min(8, stride / 2))
  out[0] = snap(from)
  return dedupe(out)
}

const wrapAngle = (t: number): number => {
  let x = t
  while (x > Math.PI) x -= 2 * Math.PI
  while (x < -Math.PI) x += 2 * Math.PI
  return x
}

/**
 * Gate positions at radius r, spread evenly from a rolled phase, each moved to the nearest angle that
 * is on dry land well back from the shore and not toward the castle, and never two close together.
 */
function placeGates(
  r: number,
  n: number,
  dry: Ring,
  plazaC: Vec2,
  site: Site,
  roll: Roll,
  along?: number,
): Vec2[] {
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
  const phase = along ?? 2 * Math.PI * roll("phase:gates")
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

/** The gate the main street comes in by: the one furthest from the water, else a rolled one. */
function mainGate(gates: readonly Vec2[], site: Site, plazaC: Vec2, roll: Roll): number {
  const water = site.water[0]
  if (!water) return Math.floor(gates.length * roll("main:gate")) % gates.length
  const toWater = norm(sub(centroid(water), plazaC))
  let best = 0
  gates.forEach((g, k) => {
    if (dot(g, toWater) < dot(at(gates, best), toWater)) best = k
  })
  return best
}

/**
 * The closed loop through the gates (exactly), counter-clockwise. Each stretch between two gates
 * bulges out (or sags in) by its own rolled amount, wobbling on top, so the town is lobed and
 * uneven rather than round, its gates at the waists.
 */
function wallLoop(gates: Vec2[], r: number, roll: Roll): Ring {
  const angle = (p: Vec2) => DMath.atan2(p[1], p[0])
  const out: Vec2[] = []
  gates.forEach((g, k) => {
    const t0 = angle(g)
    let t1 = gates.length === 1 ? t0 + 2 * Math.PI : angle(at(gates, k + 1))
    while (t1 <= t0) t1 += 2 * Math.PI
    const mids = Math.max(2, Math.round(((t1 - t0) * r) / 30))
    const bulge = -0.06 + 0.2 * roll(`${k}:bulge`)
    const lean = 0.3 + 0.4 * roll(`${k}:lean`)
    const section: Vec2[] = [g]
    for (let i = 1; i <= mids; i++) {
      const f = i / (mids + 1)
      const t = t0 + (t1 - t0) * f
      // The bulge peaks off-centre (at `lean` of the way round), so no two stretches match.
      const envelope =
        f < lean ? DMath.sin((Math.PI / 2) * (f / lean)) : DMath.sin((Math.PI / 2) * ((1 - f) / (1 - lean)))
      const rr = r * (1 + bulge * envelope + 0.05 * (2 * roll(`${k}:${i}:wall`) - 1))
      section.push([rr * DMath.cos(t), rr * DMath.sin(t)])
    }
    section.push(gates.length === 1 ? g : at(gates, k + 1))
    out.push(...smooth(section, 2, 9).slice(0, -1))
  })
  return dedupe(out, true)
}

/**
 * The market square's frame: an irregular polygon of straight sides round the plaza (its street's
 * centreline), with a corner where each main street comes in (`mouths[k]` for `targets[k]`) and a
 * corner more for every `corner` radians of gap between them. The funnel's corner is drawn out toward its target, so that
 * street widens into the square. Every plaza point keeps `room` plus half a street inside it.
 */
function marketFrame(
  plaza: Ring,
  targets: readonly Vec2[],
  funnel: number | null,
  room: number,
  corner: number,
  roll: Roll,
): { ring: Ring; mouths: Vec2[] } {
  const box = obb(plaza)
  const { x, z } = axes(box.rot)
  const local = (d: Vec2): Vec2 => [dot(d, x), dot(d, z)]
  const pts = plaza.map((p) => local(sub(p, box.c)))
  let k = 1
  const fits = () => pts.every(([u, v]) => (u / ((box.w / 2) * k)) ** 2 + (v / ((box.d / 2) * k)) ** 2 <= 1)
  while (!fits()) k += 0.05
  const a = (box.w / 2) * k + room + STREET_WIDTH.street / 2
  const b = (box.d / 2) * k + room + STREET_WIDTH.street / 2
  const reach = (t: number) => {
    const [u, v] = local([DMath.cos(t), DMath.sin(t)])
    return 1 / Math.sqrt((u / a) ** 2 + (v / b) ** 2)
  }

  // Corners: one per target (targets within 0.35 rad share one), then across every wide gap.
  const want = targets.map((t) => DMath.atan2(t[1] - box.c[1], t[0] - box.c[0]))
  const corners: { t: number; owners: number[] }[] = []
  for (const [i, t] of want.entries()) {
    const near = corners.find((c) => angleDiff(c.t, t) < 0.35)
    if (near) near.owners.push(i)
    else corners.push({ t, owners: [i] })
  }
  corners.sort((p, q) => p.t - q.t)
  const all: { t: number; owners: number[] }[] = []
  corners.forEach((c, i) => {
    all.push(c)
    let next = at(corners, i + 1).t
    while (next <= c.t) next += 2 * Math.PI
    const gap = corners.length === 1 ? 2 * Math.PI : next - c.t
    const extra = Math.floor(gap / corner)
    for (let j = 1; j <= extra; j++) {
      const f = (j + 0.4 * (roll(`${i}:${j}:frame-at`) - 0.5)) / (extra + 1)
      all.push({ t: c.t + gap * f, owners: [] })
    }
  })
  const ring0: Vec2[] = all.map((c, i) => {
    let rr = reach(c.t) * (1 + 0.2 * roll(`${i}:frame`))
    if (funnel !== null && c.owners.includes(funnel)) rr += 0.5 * box.w
    return add(box.c, scale([DMath.cos(c.t), DMath.sin(c.t)], rr))
  })
  // Grown about the plaza until every plaza point keeps its room.
  const clearance = room + STREET_WIDTH.street / 2
  let grow = 1
  let ring: Ring = ring0.map(grid)
  const roomy = () => plaza.every((p) => contains(ring, p, 0) && distTo(p, ring) >= clearance)
  while (!roomy()) {
    grow += 0.05
    ring = ring0.map((p) => grid(add(box.c, scale(sub(p, box.c), grow))))
  }
  ring = dedupe(ring, true)
  const mouths = targets.map((_, i) => {
    const c = all.findIndex((x) => x.owners.includes(i))
    return grid(add(box.c, scale(sub(at(ring0, c), box.c), grow)))
  })
  return { ring, mouths }
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
