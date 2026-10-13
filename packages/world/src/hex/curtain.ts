/**
 * The Guildhall's curtain wall (decisions.md "castle walls meet"): one closed line round the castle's
 * site, wall pieces end to end along it, meeting whatever they abut with no gap.
 *
 * The line is the site's outline (every tile side facing out of it, building tiles' included) drawn in by
 * WALL_INSET, so the wall's outer face stays on the site. Where the line turns inward at the end of a
 * side a way (or a door's approach) crosses, the inner corner would land on that side's middle, across
 * the way: the two sides there stand out over the castle's foot instead (OUTER_INSET, sites.ts
 * castleFoot), and a gate between two outward turns stands back between its flanks (GATE_RECESS). Each side's stretch of it runs from corner to
 * corner of the line; at every corner both pieces run on past it by the wall's half depth turned by the
 * corner (a mitre), so the outer and inner faces close. A stretch is cut where it enters a building that
 * stands on the line (the keep, the great hall, the barracks: whatever reaches it) and runs WALL_INTO
 * on into it, so the wall goes into the building's face. What is left is filled with whole wall pieces
 * stretched along their length to fit it exactly (`stretch`), never overlapping on a line. The gate's
 * side takes the gatehouse, drawn out to its opening's width (GATE_OPENING) on the side's middle, with
 * stretched fillers either side. Corner towers stand on every other corner where the line turns outward
 * (none where a side there stands out).
 */
import type { HexGrid } from "./grid.ts"
import { pieceSize } from "./sites.ts"
import { KENNEY_WOOD } from "./tiles.ts"

/** A piece the wall places (tiles.ts PlacedPiece's shape, kept here so this file stands alone). */
export interface CurtainPiece {
  piece: string
  x: number
  y: number
  z: number
  rot: number
  scale: number
  /** Stretch along the piece's own x (its length), on top of `scale`. */
  stretch?: number
  swatchMap?: Record<number, number>
}

/** A solid the wall may meet: a building standing on a castle tile. */
export interface CurtainBody {
  piece: string
  x: number
  z: number
  rot: number
  scale: number
}

/** The wall pieces' scale (a wall piece then spans about a tile's side). */
export const WALL_SCALE = 0.38
/** A wall piece's length and depth as imported (catalog size x, z). */
const WALL_LEN = 8.4
const WALL_DEPTH = 3.36
/** The gatehouse's length as imported. */
const GATE_LEN = 8.4
/**
 * The gatehouse drawn out along its length so its opening (between its posts, its leaves swung back:
 * 4 units at scale 1) is GATE_OPENING wide, the least a road keeps (roads.ts MIN_WIDTH) and a little.
 */
export const GATE_OPENING = 1.7
const GATE_STRETCH = GATE_OPENING / (4 * WALL_SCALE)
/** How far a corner tower keeps from the gate's middle: the way through and a tower's width. */
const GATE_CLEAR = 1.7
/** The corner towers' scale. */
export const CORNER_TOWER = 0.21
/** How far the wall's line is drawn in from the site's edge: its outer face a hair inside the edge. */
export const WALL_INSET = (WALL_SCALE * WALL_DEPTH) / 2 + 0.05
/**
 * Where the line turns inward and a way crosses the site's side at that corner, the wall's line stands
 * here instead (negative: outside the edge): its inner face half a metre in, so its inner corner keeps
 * to the corner's end of that side and the way passes the full width.
 */
export const OUTER_INSET = 0.5 - (WALL_SCALE * WALL_DEPTH) / 2
/**
 * How much further in the gatehouse stands where the line turns outward at both ends of its side: the
 * flanking walls then meet it clear of the way through (at the side's own corners their inner corners
 * would reach into the gate's passage), and the gate stands back between them.
 */
export const GATE_RECESS = 0.9
/** Whether the gate on side `d` of a tile (neighbours `nb`, the site `S`) stands set back (GATE_RECESS). */
export const gateRecessed = (nb: ArrayLike<number>, S: ReadonlySet<number>, d: number): boolean =>
  [d + 5, d + 1].every((e) => {
    const k = nb[e % 6]!
    return k < 0 || !S.has(k)
  })
/** How far a wall cut by a building runs on into it, so its end is hidden in the building's face. */
export const WALL_INTO = 0.4
/** Wall stretches shorter than this are dropped (nothing to see between a corner and a building). */
const MIN_RUN = 0.12
/** A piece is stretched no more than this either way before the run takes one more or one fewer. */
const STRETCH_MAX = 1.3

type P = [number, number]

/**
 * A building's outline for the wall: the hexagon it stands on (corners on its own ±x, as a tile's),
 * its width across the corners, turned and placed. Null for a piece with no listed size.
 */
export function bodyOutline(b: CurtainBody): P[] | null {
  const s = pieceSize(b.piece)
  if (!s) return null
  const r = (s[0] / 2) * b.scale
  const c = Math.cos(b.rot)
  const n = Math.sin(b.rot)
  const out: P[] = []
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3
    const lx = Math.cos(a) * r
    const lz = Math.sin(a) * r
    out.push([b.x + lx * c + lz * n, b.z - lx * n + lz * c])
  }
  return out
}

/** The part [t0, t1] (0–1) of segment a→b inside convex polygon `poly`, or null. */
function clipInside(a: P, b: P, poly: readonly P[]): [number, number] | null {
  let t0 = 0
  let t1 = 1
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  // the polygon's winding, so each edge's inside is known
  let area = 0
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k]!
    const q = poly[(k + 1) % poly.length]!
    area += p[0] * q[1] - q[0] * p[1]
  }
  const sgn = area > 0 ? 1 : -1
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k]!
    const q = poly[(k + 1) % poly.length]!
    // inside: cross(q - p, x - p) * sgn >= 0
    const ex = q[0] - p[0]
    const ez = q[1] - p[1]
    const f0 = (ex * (a[1] - p[1]) - ez * (a[0] - p[0])) * sgn
    const df = (ex * dz - ez * dx) * sgn
    if (Math.abs(df) < 1e-12) {
      if (f0 < 0) return null
      continue
    }
    const t = -f0 / df
    if (df > 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 >= t1) return null
  }
  return [t0, t1]
}

/** Where lines p + s·u and q + t·v cross. */
function cross(p: P, u: P, q: P, v: P): P {
  const den = u[0] * v[1] - u[1] * v[0]
  const s = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den
  return [p[0] + u[0] * s, p[1] + u[1] * s]
}

/** One side's stretch of the wall's line, before it is cut. */
interface Run {
  tile: number
  side: number
  a: P
  b: P
  /** The middle of its tile's side (a gate stands square to it). */
  mid: P
  /** Whether the line turns outward (a convex corner) at a and at b. */
  convexA: boolean
  convexB: boolean
}

/**
 * The curtain wall round `tiles` (a castle's site at its tier), every piece at height `y`: walls along
 * the outline, the gatehouse on side `gate.side` of `gate.tile` (with a banner either side), corner
 * towers with flags, all in the keep's `colour`; `bodies` are the buildings standing on the site.
 * `centre(i)` is a tile's centre (metres), `R` the tiles' centre-to-corner size.
 */
export function curtainWall(opts: {
  grid: HexGrid
  tiles: readonly number[]
  centre: (i: number) => P
  R: number
  y: number
  gate: { tile: number; side: number } | null
  bodies: readonly CurtainBody[]
  colour: string
  /** Whether a court's way (or a door's approach) crosses the side between site tiles a and b. */
  crossed?: (a: number, b: number) => boolean
  /** Whether the wall may stand half over tile `j`, outside the site (open dry ground at its level). */
  spill?: (j: number) => boolean
}): { pieces: CurtainPiece[]; runs: { a: P; b: P }[] } {
  const { grid: g, R, y } = opts
  const S = new Set(opts.tiles)
  const out: CurtainPiece[] = []
  const put = (q: CurtainPiece) => {
    if (q.piece.startsWith("kenney-")) q.swatchMap = KENNEY_WOOD
    out.push(q)
  }
  const dir = (d: number): P => {
    const a = (Math.PI / 180) * 60 * d
    return [Math.cos(a), -Math.sin(a)]
  }
  const corner = (i: number, deg: number): P => {
    const [cx, cz] = opts.centre(i)
    const a = (Math.PI / 180) * deg
    return [cx + Math.cos(a) * R, cz - Math.sin(a) * R]
  }
  const key = (p: P) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`
  // ---- the outline: each tile side facing out, its two corners, its offset line ----
  interface Edge {
    tile: number
    side: number
    p0: P
    p1: P
    /** A point on the wall's line and its direction (p0 → p1). */
    at: P
    u: P
  }
  /**
   * How far in from the edge a side's wall stands: WALL_INSET, or OUTER_INSET where the line turns
   * inward at either end of the side and a way crosses the site's own side there (the inner corner
   * would otherwise land in the middle of that side, across the way), when the ground outside takes it.
   */
  const insetOf = (i: number, d: number, nb: Int32Array | readonly number[]): number => {
    const j = nb[d]!
    // the gate between two outward turns: set back between its flanks
    if (opts.gate && i === opts.gate.tile && d === opts.gate.side)
      return gateRecessed(nb, S, d) ? WALL_INSET + GATE_RECESS : WALL_INSET
    if (j < 0 || !opts.spill?.(j) || !opts.crossed) return WALL_INSET
    for (const e of [d + 5, d + 1]) {
      const k = nb[e % 6]!
      if (k >= 0 && S.has(k) && opts.crossed(i, k)) return OUTER_INSET
    }
    return WALL_INSET
  }
  const edges: Edge[] = []
  for (const i of opts.tiles) {
    const nb = g.neighbours(i)
    for (let d = 0; d < 6; d++) {
      const j = nb[d]!
      if (j >= 0 && S.has(j)) continue
      const p0 = corner(i, 60 * d - 30)
      const p1 = corner(i, 60 * d + 30)
      const [nx, nz] = dir(d)
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
      const inset = insetOf(i, d, nb)
      edges.push({
        tile: i,
        side: d,
        p0,
        p1,
        at: [p0[0] - nx * inset, p0[1] - nz * inset],
        u: [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len],
      })
    }
  }
  // the edges at each outline corner (two each: hex tiles that share a corner share a side)
  const at = new Map<string, number[]>()
  edges.forEach((e, k) => {
    for (const p of [e.p0, e.p1]) {
      const kk = key(p)
      if (!at.has(kk)) at.set(kk, [])
      at.get(kk)!.push(k)
    }
  })
  /** Where the wall's line turns at each outline corner (by the corner's key). */
  const turns = new Map<string, P>()
  const runs: Run[] = edges.map((e, k) => {
    const end = (p: P): { p: P; convex: boolean } => {
      const other = (at.get(key(p)) ?? []).find((o) => o !== k)
      if (other === undefined) return { p: [p[0], p[1]], convex: false }
      const f = edges[other]!
      // both sides of one tile meet at an outward turn
      const c = cross(e.at, e.u, f.at, f.u)
      turns.set(key(p), c)
      return { p: c, convex: f.tile === e.tile }
    }
    const A = end(e.p0)
    const B = end(e.p1)
    const mid: P = [(e.p0[0] + e.p1[0]) / 2, (e.p0[1] + e.p1[1]) / 2]
    return { tile: e.tile, side: e.side, a: A.p, b: B.p, mid, convexA: A.convex, convexB: B.convex }
  })
  const outlines = opts.bodies.map(bodyOutline).filter((o): o is P[] => o !== null)
  const half = (WALL_SCALE * WALL_DEPTH) / 2
  // past each corner by the half depth turned through the corner's 60°: the faces close
  const mitre = half * Math.tan(Math.PI / 6)
  const L0 = WALL_LEN * WALL_SCALE
  const kept: { a: P; b: P }[] = []
  /** Fills [a, b] (metres along the run from its start) with whole pieces stretched to fit. */
  const fill = (run: Run, u: P, from: number, to: number) => {
    const len = to - from
    if (len < MIN_RUN) return
    let n = Math.max(1, Math.round(len / L0))
    while (len / n / L0 > STRETCH_MAX) n++
    const each = len / n
    const rot = Math.atan2(-u[1], u[0])
    for (let k = 0; k < n; k++) {
      const m = from + each * (k + 0.5)
      put({
        piece: "kaykit-hexagon/wall-straight",
        x: run.a[0] + u[0] * m,
        y,
        z: run.a[1] + u[1] * m,
        rot,
        scale: WALL_SCALE,
        stretch: each / L0,
      })
    }
    kept.push({
      a: [run.a[0] + u[0] * from, run.a[1] + u[1] * from],
      b: [run.a[0] + u[0] * to, run.a[1] + u[1] * to],
    })
  }
  for (const run of runs) {
    const len = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1])
    const u: P = [(run.b[0] - run.a[0]) / len, (run.b[1] - run.a[1]) / len]
    // the run with its mitres, then cut by every building it enters
    let parts: [number, number][] = [[-mitre, len + mitre]]
    for (const poly of outlines) {
      const a: P = [run.a[0] - u[0] * mitre, run.a[1] - u[1] * mitre]
      const b: P = [run.b[0] + u[0] * mitre, run.b[1] + u[1] * mitre]
      const t = clipInside(a, b, poly)
      if (!t) continue
      const full = len + 2 * mitre
      const lo = -mitre + t[0] * full
      const hi = -mitre + t[1] * full
      // each side runs on into the building, never past the middle of what it crosses (no two meet twice)
      const into = Math.min(WALL_INTO, (hi - lo) / 2)
      const next: [number, number][] = []
      for (const [p, q] of parts) {
        // what is left either side of the building (at the outline's corner, a short stub from the
        // corner into it: the corner stays closed)
        if (lo > p) next.push([p, Math.min(q, lo + into)])
        if (hi < q) next.push([Math.max(p, hi - into), q])
      }
      parts = next.filter(([p, q]) => q - p > 1e-6)
    }
    const isGate = opts.gate !== null && run.tile === opts.gate.tile && run.side === opts.gate.side
    const rot = Math.atan2(-u[1], u[0])
    // (the gate square to its side's middle, where the way comes through)
    const m = (run.mid[0] - run.a[0]) * u[0] + (run.mid[1] - run.a[1]) * u[1]
    for (const [p, q] of parts) {
      if (!isGate || p > m || q < m) {
        fill(run, u, p, q)
        continue
      }
      // the gatehouse at its own size (drawn out to its opening's width) on the side's middle,
      // stretched fillers either side
      const g0 = WALL_SCALE * GATE_LEN * GATE_STRETCH
      const ga = Math.max(p, m - g0 / 2)
      const gb = Math.min(q, m + g0 / 2)
      put({
        piece: "kaykit-hexagon/wall-straight-gate",
        x: run.a[0] + u[0] * m,
        y,
        z: run.a[1] + u[1] * m,
        rot,
        scale: WALL_SCALE,
        stretch: GATE_STRETCH,
      })
      kept.push({
        a: [run.a[0] + u[0] * ga, run.a[1] + u[1] * ga],
        b: [run.a[0] + u[0] * gb, run.a[1] + u[1] * gb],
      })
      fill(run, u, p, ga)
      fill(run, u, gb, q)
      // a banner either side of the gate, on its outer face
      const [ox, oz] = dir(run.side)
      for (const s of [-1, 1])
        put({
          piece: `kaykit-dungeon/banner-${opts.colour}`,
          x: run.a[0] + u[0] * (m + s * 1.05 * GATE_STRETCH) + ox * 0.42,
          y: y + 0.35,
          z: run.a[1] + u[1] * (m + s * 1.05 * GATE_STRETCH) + oz * 0.42,
          rot: Math.atan2(ox, oz),
          scale: 0.42,
        })
    }
  }
  // ---- corner towers: on every other outward corner along each tile's run of them ----
  const towers = new Set<string>()
  const insideBody = (p: P) =>
    outlines.some((poly) => clipInside([p[0] - 0.01, p[1]], [p[0] + 0.01, p[1]], poly) !== null)
  for (const i of opts.tiles) {
    const nb = g.neighbours(i)
    const walled = (d: number) => {
      const j = nb[((d % 6) + 6) % 6]!
      return j < 0 || !S.has(j)
    }
    const convex = (v: number) => walled(v) && walled(v + 1)
    const start = [0, 1, 2, 3, 4, 5].find((v) => convex(v) && !convex(v - 1)) ?? 0
    for (let k = 0, last = -2; k < 6; k++) {
      const v = (start + k) % 6
      if (!convex(v) || k - last < 2) continue
      last = k
      const b = (Math.PI / 180) * (60 * v + 30)
      const [cx, cz] = opts.centre(i)
      const r = (R * (Math.sqrt(3) / 2) - WALL_INSET) / (Math.sqrt(3) / 2) - 0.2
      const p: P = [cx + Math.cos(b) * r, cz - Math.sin(b) * r]
      // none where the line stands out over the ground outside (an inward turn's sides): the tower
      // would hang over the edge
      const turn = turns.get(key(corner(i, 60 * v + 30)))
      if (!turn || Math.hypot(turn[0] - p[0] - Math.cos(b) * 0.2, turn[1] - p[1] + Math.sin(b) * 0.2) > 0.05)
        continue
      // none beside the gate, where it would stand in the way through (the gatehouse has its own)
      const byGate = out.some(
        (q) => q.piece.endsWith("wall-straight-gate") && Math.hypot(q.x - p[0], q.z - p[1]) < GATE_CLEAR,
      )
      if (insideBody(p) || towers.has(key(p)) || byGate) continue
      towers.add(key(p))
      const face = Math.atan2(Math.cos(b), -Math.sin(b))
      put({
        piece: `kaykit-hexagon/building-tower-base-${opts.colour}`,
        x: p[0],
        y,
        z: p[1],
        rot: face,
        scale: CORNER_TOWER,
      })
      put({
        piece: "kenney-castle/flag",
        x: p[0],
        y: y + 12 * CORNER_TOWER - 0.1,
        z: p[1],
        rot: face,
        scale: 0.45,
      })
    }
  }
  return { pieces: out, runs: kept }
}
