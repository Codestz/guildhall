import { DMath } from "../../dmath.ts"
import { LEDGE_STEP } from "./shape.ts"

/**
 * The ledges as true stairs (relief/shape.ts). Strata's grid heights are ledge heights (multiples of
 * LEDGE_STEP), so a lattice triangle straddling two ledges is a ramp whose two alternating
 * orientations shade as a sawtooth. Here the step lives on the lattice's *edges*: an edge between
 * two ledges is cut at one place per riser (`profile`): a flat run at the lower ledge, a vertical
 * riser, a flat run at the upper. Both triangles on an edge read the same profile, so stairs meet
 * stairs exactly. A ramp triangle (a peak's face, a rim, a river's hex) beside stairs keeps its
 * straight edge (`rampOf`, with the riser's mid-point on it) and a curtain (`curtainOf`) closes the
 * gap in the vertical plane over the edge between the ramp's line and the profile: a wall of the
 * taller side, so the mesh is a closed solid with no crack and no T-junction. Inside a stairs
 * triangle the riser joins the two crossings: a flat wall facing downhill.
 *
 * The trade-off: the grid (`heightAt`, so walkers and trees) still reads the ramp between two ledges,
 * so over that one-lattice-step band it is up to half a ledge off the mesh. On a flat ledge top the
 * two agree exactly, and dressing keeps its trees and rocks to flat ground (dressing.ts).
 */

type Vertex = readonly number[]
type Tri = [number[], number[], number[]]
type Facing = readonly [number, number]

export interface Stairs {
  /** Flat tops, each at its ledge's height. */
  tops: Tri[]
  /** Risers, with the ledge below them and the way they face (downhill, in x, z). */
  walls: { tri: Tri; low: number; outward: Facing }[]
}

const EPS = 1e-3

/** Whether a height stands on a ledge. */
export const onLedge = (y: number): boolean => Math.abs(y / LEDGE_STEP - Math.round(y / LEDGE_STEP)) < EPS

export const levelOf = (v: Vertex): number => Math.round((v[1] as number) / LEDGE_STEP)

/**
 * One point of an edge's profile. `foot` and `lip` bound a riser (between ledge `bound` and the next),
 * `mid` stands half-way up it, on the straight line between the edge's ends; `run` stands on that
 * line over the flat between two risers.
 */
export interface Node {
  at: number[]
  level: number
  bound: number
  kind: "foot" | "mid" | "lip" | "run"
}

/** The profile from `a` to `b`, `a` first in (x, z) order so both triangles of an edge compute the same floats. */
function nodesBetween(a: Vertex, b: Vertex): Node[] {
  const [la, lb] = [levelOf(a), levelOf(b)]
  const out: Node[] = []
  const dir = Math.sign(lb - la)
  const at = (t: number, y: number): number[] => [
    (a[0] as number) + ((b[0] as number) - (a[0] as number)) * t,
    y,
    (a[2] as number) + ((b[2] as number) - (a[2] as number)) * t,
    0,
    0,
  ]
  const along = (y: number): number => (y - (a[1] as number)) / ((b[1] as number) - (a[1] as number))
  for (let k = la; k !== lb; k += dir) {
    const bound = Math.min(k, k + dir)
    const t = along((bound + 0.5) * LEDGE_STEP)
    const [first, second] = dir > 0 ? [bound, bound + 1] : [bound + 1, bound]
    out.push(
      { at: at(t, first * LEDGE_STEP), level: first, bound, kind: dir > 0 ? "foot" : "lip" },
      { at: at(t, (bound + 0.5) * LEDGE_STEP), level: first, bound, kind: "mid" },
      { at: at(t, second * LEDGE_STEP), level: second, bound, kind: dir > 0 ? "lip" : "foot" },
    )
    // Between two risers the straight line crosses the flat between them.
    if (k + dir !== lb)
      out.push({ at: at(along(second * LEDGE_STEP), second * LEDGE_STEP), level: second, bound, kind: "run" })
  }
  return out
}

/** The profile of the edge from `u` to `v` (both on ledges), in order from `u`. Empty between two vertices of one ledge. */
export function profile(u: Vertex, v: Vertex): Node[] {
  const forward =
    (u[0] as number) < (v[0] as number) || (u[0] === v[0] && (u[2] as number) < (v[2] as number))
  return forward ? nodesBetween(u, v) : nodesBetween(v, u).reverse()
}

/** The profile's points that lie on the straight line between the edge's ends: what a ramp over that edge carries. */
export const onLine = (nodes: readonly Node[]): number[][] =>
  nodes.filter((n) => n.kind === "mid" || n.kind === "run").map((n) => n.at)

/** A triangle of ledge-height vertices as stairs. `p`, `q`, `r` are [x, y, z, ...]. */
export function stairsOf(p: Vertex, q: Vertex, r: Vertex): Stairs {
  const stairs: Stairs = { tops: [], walls: [] }
  const corners = [p, q, r]
  const levels = corners.map(levelOf)
  const [lo, hi] = [Math.min(...levels), Math.max(...levels)]
  const edges = corners.map((c, i) => profile(c, corners[(i + 1) % 3] as Vertex))
  for (let level = lo; level <= hi; level++) {
    // The ledge's top: the corners standing on it, and the points where the edges' profiles stand on it.
    const poly: number[][] = []
    corners.forEach((c, i) => {
      if (levels[i] === level) poly.push([c[0] as number, level * LEDGE_STEP, c[2] as number, 0, 0])
      for (const node of edges[i] as Node[])
        if (node.kind !== "mid" && node.level === level) poly.push(node.at)
    })
    stairs.tops.push(...triangulate(poly))
    if (level === hi) continue
    // The riser to the next ledge: between the two edges that cross it, foot, middle and lip on each.
    const side = (kind: Node["kind"]): number[][] =>
      edges.flatMap((e) => e.filter((n) => n.bound === level && n.kind === kind).map((n) => n.at))
    const [feet, mids, lips] = [side("foot"), side("mid"), side("lip")]
    if (feet.length !== 2 || mids.length !== 2 || lips.length !== 2) continue
    const [f0, f1, m0, m1, l0, l1] = [feet[0], feet[1], mids[0], mids[1], lips[0], lips[1]] as number[][] as [
      number[],
      number[],
      number[],
      number[],
      number[],
      number[],
    ]
    const [dx, dz] = [(f1[0] as number) - (f0[0] as number), (f1[2] as number) - (f0[2] as number)]
    const length = DMath.hypot(dx, dz)
    if (length < 1e-4) continue
    // Faces the lower corners.
    const low = corners.filter((_, i) => (levels[i] as number) <= level)
    const lx = low.reduce((sum, c) => sum + (c[0] as number), 0) / low.length - (f0[0] as number)
    const lz = low.reduce((sum, c) => sum + (c[2] as number), 0) / low.length - (f0[2] as number)
    const sign = Math.sign(-dz * lx + dx * lz) || 1
    const outward: Facing = [(-dz / length) * sign, (dx / length) * sign]
    for (const tri of [
      [f0, f1, m1],
      [f0, m1, m0],
      [m0, m1, l1],
      [m0, l1, l0],
    ] as Tri[])
      stairs.walls.push({ tri, low: level, outward })
  }
  return stairs
}

/** A triangle's aspect: its longest edge squared over twice its area (1.15 equilateral), infinite when it has no area. */
function aspect(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const [ux, uy, uz] = [
    (b[0] as number) - (a[0] as number),
    (b[1] as number) - (a[1] as number),
    (b[2] as number) - (a[2] as number),
  ]
  const [vx, vy, vz] = [
    (c[0] as number) - (a[0] as number),
    (c[1] as number) - (a[1] as number),
    (c[2] as number) - (a[2] as number),
  ]
  const area = DMath.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  if (area < 1e-9) return Number.POSITIVE_INFINITY
  const longest = Math.max(
    DMath.hypot(ux, uy, uz),
    DMath.hypot(vx, vy, vz),
    DMath.hypot(vx - ux, vy - uy, vz - uz),
  )
  return (longest * longest) / (2 * area)
}

/**
 * The triangles of a flat convex polygon (its points in order, collinear ones on its edges kept as
 * vertices) that make the least stretched triangulation: the worst triangle as round as it can be,
 * then the sum. Every point of the ring is a vertex, so what shares an edge with it matches.
 */
export function triangulate(ring: readonly number[][]): Tri[] {
  const n = ring.length
  type Cut = { worst: number; sum: number; cut: number }
  const best: Cut[][] = ring.map(() => ring.map(() => ({ worst: 0, sum: 0, cut: -1 })))
  for (let span = 2; span < n; span++)
    for (let i = 0; i + span < n; i++) {
      const j = i + span
      let pick: Cut = { worst: Number.POSITIVE_INFINITY, sum: Number.POSITIVE_INFINITY, cut: -1 }
      for (let k = i + 1; k < j; k++) {
        const own = aspect(ring[i] as number[], ring[k] as number[], ring[j] as number[])
        const [left, right] = [best[i]?.[k] as Cut, best[k]?.[j] as Cut]
        const worst = Math.max(own, left.worst, right.worst)
        const sum = (Number.isFinite(own) ? own : 1e6) + left.sum + right.sum
        if (worst < pick.worst - 1e-9 || (worst < pick.worst + 1e-9 && sum < pick.sum))
          pick = { worst, sum, cut: k }
      }
      ;(best[i] as Cut[])[j] = pick
    }
  const out: Tri[] = []
  const walk = (i: number, j: number): void => {
    const k = best[i]?.[j]?.cut ?? -1
    if (k < 0) return
    out.push([ring[i], ring[k], ring[j]] as Tri)
    walk(i, k)
    walk(k, j)
  }
  walk(0, n - 1)
  return out
}

/**
 * The points that cut an edge of a ramp (a peak's flank, a rim's cliff) longer than `long` into 2, 4,
 * 8... equal pieces: a power of two, so the two legs of a wedge are cut at the same fractions and its
 * faces stay round. The neighbour across the edge cuts it the same (the points come from the end that
 * is first in x, z). In order from `u`; none on a short edge.
 */
export function cutEdge(u: Vertex, v: Vertex, long: number): number[][] {
  const forward =
    (u[0] as number) < (v[0] as number) || (u[0] === v[0] && (u[2] as number) < (v[2] as number))
  const [a, b] = forward ? [u, v] : [v, u]
  const [d0, d1, d2] = [
    (b[0] as number) - (a[0] as number),
    (b[1] as number) - (a[1] as number),
    (b[2] as number) - (a[2] as number),
  ]
  const length = DMath.hypot(d0, d1, d2)
  if (length <= long) return []
  const parts = DMath.pow(2, Math.ceil(DMath.log2(length / long)))
  const out: number[][] = []
  for (let m = 1; m < parts; m++) {
    const t = m / parts
    out.push([(a[0] as number) + d0 * t, (a[1] as number) + d1 * t, (a[2] as number) + d2 * t, 0, 0])
  }
  return forward ? out : out.reverse()
}

/**
 * A ramp triangle (a face that is not stairs) with `between[i]` extra vertices along its edge from
 * corner i to corner i + 1: the neighbour across that edge has its own vertices there (a stepped
 * profile's mid-points, a finer lattice, the pieces of a long edge), and the ramp must have the same
 * ones or a crack opens. All the points lie in the triangle's plane, so any triangulation of the
 * polygon they make is the same surface. Winding is up-facing.
 */
export function rampOf(p: Vertex, q: Vertex, r: Vertex, between: readonly (readonly number[][])[]): Tri[] {
  const corners = [p, q, r].map((c) => [...c]) as Tri
  const up =
    ((q[2] as number) - (p[2] as number)) * ((r[0] as number) - (p[0] as number)) -
      ((q[0] as number) - (p[0] as number)) * ((r[2] as number) - (p[2] as number)) >=
    0
  const ring = corners.flatMap((c, i) => [c, ...(between[i] ?? [])])
  return (ring.length === 3 ? [corners] : triangulate(ring)).map(([a, b, c]) => (up ? [a, b, c] : [a, c, b]))
}

/**
 * The curtain over a ramp's stepped edge `u`→`v`, whose profile is `nodes`: in the vertical plane
 * over the edge, the triangles between the ramp's straight line and the profile. Where the profile
 * lies below the line the ramp is the taller side and the curtain faces away from `inside` (the
 * ramp's third corner); where above, the stairs are, and it faces the ramp.
 */
export function curtainOf(
  u: Vertex,
  v: Vertex,
  nodes: readonly Node[],
  inside: Vertex,
): { tri: Tri; low: number; outward: Facing }[] {
  const [dx, dz] = [(v[0] as number) - (u[0] as number), (v[2] as number) - (u[2] as number)]
  const length = DMath.hypot(dx, dz)
  if (length < 1e-9) return []
  // The edge's normal, towards the ramp.
  const side =
    Math.sign(
      -dz * ((inside[0] as number) - (u[0] as number)) + dx * ((inside[2] as number) - (u[2] as number)),
    ) || 1
  const toward: Facing = [(-dz / length) * side, (dx / length) * side]
  const out: { tri: Tri; low: number; outward: Facing }[] = []
  // The line point beyond a riser's foot (before it) or lip (after it): the edge's end, or the run between two risers.
  const beyond = (index: number, dir: -1 | 1): number[] => {
    for (let k = index + dir; k >= 0 && k < nodes.length; k += dir)
      if ((nodes[k] as Node).kind === "run") return (nodes[k] as Node).at
    return [...(dir < 0 ? u : v)]
  }
  nodes.forEach((n, k) => {
    if (n.kind !== "foot" && n.kind !== "lip") return
    // The riser's middle is the next node along if this one comes first, else the one before.
    const after =
      (nodes[k + 1] as Node | undefined)?.kind === "mid" && (nodes[k + 1] as Node).bound === n.bound
    const mid = (nodes[after ? k + 1 : k - 1] as Node).at
    // The foot or lip above the line: the stairs are the taller side and the curtain faces the ramp; below it, the ramp is.
    const sign = (n.at[1] as number) > (mid[1] as number) ? 1 : -1
    out.push({
      tri: [beyond(k, after ? -1 : 1), n.at, mid],
      low: n.bound,
      outward: [toward[0] * sign, toward[1] * sign],
    })
  })
  return out
}
