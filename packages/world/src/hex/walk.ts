/**
 * The hex island's walk graph (decisions.md "Relief must be walkable", "Hex plan go"): where people can
 * walk, as nodes with height and edges between them, built from the tiles (pure).
 *
 *   road / square / bridge  one node at the centre of every tile a road runs over (bridges at their
 *                           deck's height, which meets both banks), joined along each road's own tile
 *                           path: the same links the path strips are drawn from, so people walk on them;
 *   door                    a spot outside the front of every building tile that faces a street (the
 *                           side the prefab is turned to: hexWorld turns a building to its first
 *                           road-like neighbour), joined to that street tile;
 *   path / dock             spurs out to tiles people work on that no road reaches (a field, a dock, a
 *                           forest edge): the cheapest steps over open land to the nearest node.
 *
 * `route(a, b)` is the shortest node path (A*), so any place reaches any other the roads join.
 */
import { discSolid, pieceSolids, type Solid, SolidGrid, solidDistance } from "./collide.ts"
import { hexCentre } from "./grid.ts"
import { type HexIsland, kindOf } from "./island.ts"
import { HEX_TILE_SIZE } from "./tiles.ts"
import type { HexWorld } from "./world.ts"
import { type HexZones, useOf } from "./zones.ts"

export const HEX_WALK_KINDS = ["road", "square", "bridge", "door", "path", "dock"] as const
export type HexWalkKind = (typeof HEX_WALK_KINDS)[number]

export interface HexWalkNode {
  x: number
  /** Where the feet are, metres: the tile's top, a bridge's or a dock's deck. */
  y: number
  z: number
  /** The tile it stands on. */
  tile: number
  kind: HexWalkKind
}

export interface HexWalkEdge {
  a: number
  b: number
  kind: HexWalkKind
  /** Metres, with height (along `via` when it has one). */
  len: number
  /**
   * Where the straight way between its ends would run through a wall, a building or a fence (a door
   * whose street lies past its own chapel, a court's node behind a well): the corners of the way round,
   * from `a` to `b` (decisions.md "one source of truth for space"). None: the straight way is clear.
   */
  via?: [number, number][]
  /** Through a wall with no way round it: left out of every route (its nodes keep their other edges). */
  walled?: boolean
}

export interface HexWalk {
  nodes: HexWalkNode[]
  edges: HexWalkEdge[]
  /** Edge ids out of each node. */
  out: number[][]
  /** The node at a tile's centre (road, square, bridge or a spur tile), −1 for none. */
  at(tile: number): number
  /** The door node of a building tile, −1 for none. */
  door(tile: number): number
  /** The heart node of each zone (−1 when its heart has no node). */
  hearts: number[]
  /** Shortest node path from `from` to `to` (both included), null when unreachable. */
  route(from: number, to: number): number[] | null
}

/** How far out from a building tile's centre its door spot is, metres (the prefab's front wall is ~1.3 m out). */
export const DOOR_OUT = 1.75
/**
 * A bridge deck stands this far over its banks (as world.ts lays it); a dock's deck this high (the
 * dock prefab's pier platforms, 0.75 m tall, stand on the shallows' bed at −0.4, as its crates do).
 */
export const DECK_LIFT = 0.08
export const DOCK_Y = 0.35
/** Most steps a spur takes to reach the graph. */
const SPUR_STEPS = 6

/** Clearance kept from a blocker's edge by a walker's middle, metres (a shoulder and a little). */
export const WALK_CLEAR = 0.3

type Pt = [number, number, number]

/** How near a door a walk in or out of it may cross its house (and what stands by it), metres. */
export const DOOR_SLACK = 1.0
/** A walk through a gate runs square to its wall this far either side of the opening, metres. */
const GATE_RUN = 0.7

/** A blocker a walk keeps clear of: a disc, or a solid's outline (collide.ts). */
export type WalkBlocker = { x: number; z: number; r: number } | Solid

const asSolids = new WeakMap<object, Solid>()
const solidOfBlocker = (b: WalkBlocker): Solid => {
  if ("pts" in b) return b
  let s = asSolids.get(b)
  if (!s) {
    s = discSolid("blocker", b.x, b.z, b.r, 0)
    asSolids.set(b, s)
  }
  return s
}

/** Whether segments a→b and c→d cross. */
function crosses(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx)
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** The least distance from segment a→b to a solid's outline (0 when it cuts in). */
function segmentDistance(s: Solid, ax: number, az: number, bx: number, bz: number): number {
  const p = s.pts
  const n = p.length / 2
  let best = Math.min(solidDistance(s, ax, az), solidDistance(s, bx, bz))
  if (best <= 0) return 0
  const lx = bx - ax
  const lz = bz - az
  const l2 = lx * lx + lz * lz || 1e-9
  for (let k = 0; k < n; k++) {
    const cx = p[k * 2]!
    const cz = p[k * 2 + 1]!
    const dx = p[((k + 1) % n) * 2]!
    const dz = p[((k + 1) % n) * 2 + 1]!
    if (crosses(ax, az, bx, bz, cx, cz, dx, dz)) return 0
    const f = Math.max(0, Math.min(1, ((cx - ax) * lx + (cz - az) * lz) / l2))
    best = Math.min(best, Math.hypot(cx - ax - lx * f, cz - az - lz * f))
  }
  return best
}

/**
 * Whether segment a→b runs through a wall, a building or a fence (a hard blocker: the soft places people
 * stand a while aside), those its ends stand in aside (`from`/`to`: how near an end a blocker may be
 * and still be the end's own, metres: a doorway's house, a seat).
 */
export function cutsHard(
  a: readonly number[],
  b: readonly number[],
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  ends: { from?: number; to?: number } = {},
): boolean {
  const ax = a[0]!
  const az = a[2]!
  const bx = b[0]!
  const bz = b[2]!
  const len = Math.hypot(bx - ax, bz - az)
  for (const o of near((ax + bx) / 2, (az + bz) / 2, len / 2 + 0.1)) {
    const so = solidOfBlocker(o)
    if (so.soft) continue
    if (solidDistance(so, ax, az) < (ends.from ?? 0.05) || solidDistance(so, bx, bz) < (ends.to ?? 0.05))
      continue
    if (segmentDistance(so, ax, az, bx, bz) < 0.02) return true
  }
  return false
}

/** A solid's corners pushed out by `c` along their corner's bisector (so its edges stand `c` out). */
function grown(s: Solid, c: number): [number, number][] {
  const p = s.pts
  const n = p.length / 2
  const out: [number, number][] = []
  for (let k = 0; k < n; k++) {
    const px = p[((k + n - 1) % n) * 2]!
    const pz = p[((k + n - 1) % n) * 2 + 1]!
    const x = p[k * 2]!
    const z = p[k * 2 + 1]!
    const nx = p[((k + 1) % n) * 2]!
    const nz = p[((k + 1) % n) * 2 + 1]!
    // outward normals of the two edges at this corner (counter-clockwise outline: (dz, −dx))
    const l0 = Math.hypot(x - px, z - pz) || 1
    const l1 = Math.hypot(nx - x, nz - z) || 1
    const ax = (z - pz) / l0 + (nz - z) / l1
    const az = -(x - px) / l0 - (nx - x) / l1
    const m = Math.hypot(ax, az) || 1
    const k2 = Math.min(3, 2 / m)
    out.push([x + (ax / m) * c * k2, z + (az / m) * c * k2])
  }
  return out
}

/**
 * The way from a to b round a convex outline's corners: of the two chains of the hull of a, b and the
 * corners, the shorter (on a tie the one away from `side`'s sign: the side the straight way passes).
 * Empty when a or b is not on that hull (inside the corners).
 */
function roundAbout(corners: [number, number][], a: Pt, b: Pt, side: number): [number, number][] {
  const pts: [number, number, number][] = corners.map(([x, z]) => [x, z, -1])
  pts.push([a[0], a[2], 0], [b[0], b[2], 1])
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const cross = (o: number[], p: number[], q: number[]) =>
    (p[0]! - o[0]!) * (q[1]! - o[1]!) - (p[1]! - o[1]!) * (q[0]! - o[0]!)
  const lo: [number, number, number][] = []
  for (const q of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: [number, number, number][] = []
  for (const q of [...pts].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop()
    up.push(q)
  }
  const hull = [...lo.slice(0, -1), ...up.slice(0, -1)]
  const ia = hull.findIndex((p) => p[2] === 0)
  const ib = hull.findIndex((p) => p[2] === 1)
  if (ia < 0 || ib < 0) return []
  const chain = (step: number) => {
    const out: [number, number][] = []
    for (
      let i = (ia + step + hull.length) % hull.length;
      i !== ib;
      i = (i + step + hull.length) % hull.length
    )
      out.push([hull[i]![0], hull[i]![1]])
    return out
  }
  const length = (c: [number, number][]) => {
    let l = 0
    let px = a[0]
    let pz = a[2]
    for (const [x, z] of [...c, [b[0], b[2]] as [number, number]]) {
      l += Math.hypot(x - px, z - pz)
      px = x
      pz = z
    }
    return l
  }
  const f = chain(1)
  const r = chain(-1)
  const lf = length(f)
  const lr = length(r)
  if (Math.abs(lf - lr) > 1e-6) return lf < lr ? f : r
  // as long either way: the side away from the outline's middle
  const ux = b[0] - a[0]
  const uz = b[2] - a[2]
  const offOf = (c: [number, number][]) => (c[0] ? (c[0][0] - a[0]) * -uz + (c[0][1] - a[2]) * ux : 0)
  return offOf(f) * side < 0 ? f : r
}

const clusters = new WeakMap<object, WeakMap<Solid, Solid[]>>()
/**
 * The hard blockers whose outlines come within twice the clearance of `hit`'s, and of theirs (a row of
 * houses, a fence's lengths), at most 12; once per blocker and `near`.
 */
function clusterOf(hit: Solid, near: (x: number, z: number, r: number) => readonly WalkBlocker[]): Solid[] {
  let byNear = clusters.get(near)
  if (!byNear) {
    byNear = new WeakMap()
    clusters.set(near, byNear)
  }
  const have = byNear.get(hit)
  if (have) return have
  const C = WALK_CLEAR
  const cluster = [hit]
  for (let c = 0; c < cluster.length && cluster.length < 12; c++) {
    const s0 = cluster[c]!
    for (const o of near(s0.cx, s0.cz, s0.r + 2 * C)) {
      const so = solidOfBlocker(o)
      if (so.soft || so.gate || cluster.includes(so)) continue
      let touch = false
      for (let q = 0; q < so.pts.length && !touch; q += 2)
        touch = solidDistance(s0, so.pts[q]!, so.pts[q + 1]!) < 2 * C
      for (let q = 0; q < s0.pts.length && !touch; q += 2)
        touch = solidDistance(so, s0.pts[q]!, s0.pts[q + 1]!) < 2 * C
      if (touch) cluster.push(so)
    }
  }
  byNear.set(hit, cluster)
  return cluster
}

/**
 * The waypoints that take segment a→b round `hit` (none when it cannot): through a gate's opening square
 * to its wall; else the taut string round its corners grown by the clearance, the short way (the side the
 * straight way passes on a tie). A row of blockers (houses side by side, a fence's lengths) is gone round
 * as one: the hull of every blocker whose outline comes within twice the clearance of the hit's, and of
 * theirs, unless an end stands inside that hull.
 */
function detour(
  hit: Solid,
  a: Pt,
  b: Pt,
  ux: number,
  uz: number,
  len: number,
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  P: readonly Pt[],
  y: (t: number) => number,
): Pt[] {
  const C = WALK_CLEAR
  if (hit.gate) {
    const [gx, gz, nx, nz] = hit.gate
    const s0 = (gx - a[0]) * ux + (gz - a[2]) * uz
    const sgn = nx * ux + nz * uz >= 0 ? 1 : -1
    // only once, and only when the opening lies along the way (not off to one side of it)
    const done = P.some((p) => Math.hypot(p[0] - gx, p[2] - gz) < 0.05)
    // the way in and out of the opening must itself be clear (a hall may stand right behind a gate)
    const free = (x: number, z: number) =>
      near(x, z, C).every((o) => {
        const so = solidOfBlocker(o)
        return so.gate === hit.gate || solidDistance(so, x, z) >= C
      })
    if (!done && s0 > 0 && s0 < len)
      for (const run of [GATE_RUN, GATE_RUN / 2]) {
        const pts: Pt[] = [
          [gx - nx * sgn * run, y(s0 - run), gz - nz * sgn * run],
          [gx, y(s0), gz],
          [gx + nx * sgn * run, y(s0 + run), gz + nz * sgn * run],
        ]
        if (free(pts[0]![0], pts[0]![2]) && free(pts[2]![0], pts[2]![2])) return pts
      }
  }
  const side = (hit.cx - a[0]) * -uz + (hit.cz - a[2]) * ux
  const cluster = clusterOf(hit, near).filter(
    (so) => so === hit || (solidDistance(so, a[0], a[2]) >= 0.05 && solidDistance(so, b[0], b[2]) >= 0.05),
  )
  // grown by the clearance, or less where an end stands nearer than that (a spot by a wall)
  const by = (o: Solid) =>
    Math.max(
      0.05,
      Math.min(C * 1.12, solidDistance(o, a[0], a[2]) - 0.02, solidDistance(o, b[0], b[2]) - 0.02),
    )
  // a detour is only taken when its corners are clear of everything else
  const clear = (r: [number, number][]) =>
    r.every(([x, z]) =>
      near(x, z, C * 0.5).every((o) => {
        const so = solidOfBlocker(o)
        return so.soft || solidDistance(so, x, z) >= C * 0.5
      }),
    )
  let ring =
    cluster.length > 1
      ? roundAbout(
          cluster.flatMap((o) => grown(o, by(o))),
          a,
          b,
          side,
        )
      : []
  if (!ring.length || !clear(ring)) ring = roundAbout(grown(hit, by(hit)), a, b, side)
  if (!clear(ring)) return []
  return ring.map(([x, z]): Pt => [x, y((x - a[0]) * ux + (z - a[2]) * uz), z])
}

/** How near its ends a tight way may run as close to a wall as the end stands, metres. */
const END_ROOM = 0.2
/** The most cells a tight way's search opens before it gives up. */
const GRID_STEPS = 6000
/** How far round the segment a tight way is looked for, metres. */
const GRID_NEAR = 1.6
/** … and how far when that finds none (round a long fence, a row of houses). */
const GRID_FAR = 4.5
/** How an edge through a wall looks for its way round: clearance, cell and margin, the roomiest first. */
const EDGE_SEARCH: readonly (readonly [number, number, number])[] = [
  [WALK_CLEAR, 0.2, 4.5],
  [0.2, 0.2, 12],
]
/** … opening at most this many cells. */
const EDGE_STEPS = 40000
/** How far a part cut off by a wall looks for a node of the rest to join, metres. */
const REJOIN = HEX_TILE_SIZE * 4
const onDeckKind = (k: HexWalkKind) => k === "bridge" || k === "dock"
/** The least room a tight way keeps from a wall (a body's core: a narrow gate), metres. */
const TIGHT = 0.2
/** A body's core (spots.ts BODY_CORE): the narrowest gap a body squeezes through. */
const CORE = 0.12

/**
 * The way from a to b found on a fine grid round the segment (A*, eight ways, every cell nearer a blocker
 * than the clearance closed but those an end stands in), pulled taut; its corners, none when there is no
 * way (or it is no tighter than the straight one).
 */
export function gridWay(
  a: Pt,
  b: Pt,
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  C = WALK_CLEAR,
  GRID = 0.2,
  /** Answer [[b]] for any way found, even a straight one (whether there is a way at all). */
  any = false,
  GRID_MARGIN = GRID_NEAR,
  /** Keep clear of the soft blockers too (the places people stand a while), not only the walls. */
  soft = false,
  /** The most cells it opens (by default a few thousand, ten times that past GRID_FAR). */
  steps = GRID_MARGIN > GRID_FAR ? GRID_STEPS * 10 : GRID_STEPS,
): [number, number][] {
  // the box is on the world's own grid, so the cells' answers are shared by every way looked for
  const x0 = Math.floor((Math.min(a[0], b[0]) - GRID_MARGIN) / GRID) * GRID
  const z0 = Math.floor((Math.min(a[2], b[2]) - GRID_MARGIN) / GRID) * GRID
  const nx = Math.ceil((Math.max(a[0], b[0]) + GRID_MARGIN - x0) / GRID)
  const nz = Math.ceil((Math.max(a[2], b[2]) + GRID_MARGIN - z0) / GRID)
  if (nx * nz > 400000) return []
  const memo = memoOf(near, `${C},${GRID},${soft}`)
  const key = `${a[0].toFixed(2)},${a[2].toFixed(2)},${b[0].toFixed(2)},${b[2].toFixed(2)},${any},${GRID_MARGIN},${steps}`
  const had = memo.ways.get(key)
  if (had) return had
  const gi0 = Math.round(x0 / GRID)
  const gj0 = Math.round(z0 / GRID)
  // the blockers an end stands in (its own seat, its doorway) do not close cells
  const ends = new Set<Solid>()
  for (const p of [a, b])
    for (const o of near(p[0], p[2], C)) {
      const so = solidOfBlocker(o)
      if (solidDistance(so, p[0], p[2]) < 0.05) ends.add(so)
    }
  const state = new Int8Array(nx * nz) // 0 unknown, 1 open, 2 closed
  const cx = (i: number) => x0 + (i + 0.5) * GRID
  const cz = (j: number) => z0 + (j + 0.5) * GRID
  const open = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false
    const k = j * nx + i
    if (!state[k]) {
      // the world cell's closers (shared), less the ones an end stands in
      const wk = (gi0 + i + 32768) * 65536 + (gj0 + j + 32768)
      let by = memo.cells.get(wk)
      if (by === undefined) {
        by = null
        for (const o of near(cx(i), cz(j), C)) {
          const so = solidOfBlocker(o)
          if ((soft || !so.soft) && solidDistance(so, cx(i), cz(j)) < C) {
            if (!by) by = []
            by.push(so)
          }
        }
        memo.cells.set(wk, by)
      }
      // by either end (a spot set against a wall, a door) a body may come as near as the end itself does
      const x = cx(i)
      const z = cz(j)
      const byEnd = Math.hypot(x - a[0], z - a[2]) < END_ROOM || Math.hypot(x - b[0], z - b[2]) < END_ROOM
      const room = (so: Solid) =>
        Math.min(C, solidDistance(so, a[0], a[2]), solidDistance(so, b[0], b[2])) - 0.01
      state[k] =
        !by || by.every((so) => ends.has(so) || (byEnd && solidDistance(so, x, z) >= room(so))) ? 1 : 2
    }
    return state[k] === 1
  }
  const cell = (p: Pt): [number, number] => [Math.floor((p[0] - x0) / GRID), Math.floor((p[2] - z0) / GRID)]
  const [ai, aj] = cell(a)
  const [bi, bj] = cell(b)
  const goal = bj * nx + bi
  const g = new Float32Array(nx * nz).fill(Number.POSITIVE_INFINITY)
  const from = new Int32Array(nx * nz).fill(-1)
  const h = (i: number, j: number) => Math.hypot(i - bi, j - bj)
  // a binary heap of cells by f
  const hf: number[] = []
  const hk: number[] = []
  const swap = (p: number, q: number) => {
    const f = hf[p]!
    hf[p] = hf[q]!
    hf[q] = f
    const k = hk[p]!
    hk[p] = hk[q]!
    hk[q] = k
  }
  const push = (f: number, k: number) => {
    hf.push(f)
    hk.push(k)
    for (let c = hf.length - 1; c > 0; ) {
      const p = (c - 1) >> 1
      if (hf[p]! <= hf[c]!) break
      swap(p, c)
      c = p
    }
  }
  const pop = (): number => {
    const top = hk[0]!
    const lf = hf.pop()!
    const lk = hk.pop()!
    if (hf.length) {
      hf[0] = lf
      hk[0] = lk
      for (let c = 0; ; ) {
        const l = c * 2 + 1
        const r = l + 1
        let m = c
        if (l < hf.length && hf[l]! < hf[m]!) m = l
        if (r < hf.length && hf[r]! < hf[m]!) m = r
        if (m === c) break
        swap(m, c)
        c = m
      }
    }
    return top
  }
  const start = aj * nx + ai
  g[start] = 0
  push(h(ai, aj), start)
  let found = false
  for (let it = 0; hf.length && it < steps; it++) {
    const k = pop()
    if (k === goal) {
      found = true
      break
    }
    const i = k % nx
    const j = (k - i) / nx
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue
        const ni = i + di
        const nj = j + dj
        const nk = nj * nx + ni
        if (nk !== goal && !open(ni, nj)) continue
        // no corner cutting past a closed cell
        if (di && dj && (!open(i + di, j) || !open(i, j + dj))) continue
        const ng = g[k]! + (di && dj ? Math.SQRT2 : 1)
        if (ng >= g[nk]!) continue
        g[nk] = ng
        from[nk] = k
        push(ng + h(ni, nj), nk)
      }
  }
  if (!found) {
    memo.ways.set(key, [])
    return []
  }
  if (any) {
    memo.ways.set(key, [[b[0], b[2]]])
    return [[b[0], b[2]]]
  }
  const cells: [number, number][] = []
  for (let k = from[goal]!; k >= 0 && k !== start; k = from[k]!) {
    const i = k % nx
    cells.push([cx(i), cz((k - i) / nx)])
  }
  cells.reverse()
  // taut: from each corner, straight on to the furthest cell it sees over open ground
  const sees = (p: [number, number], q: [number, number]) => {
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (GRID / 2))
    for (let s = 1; s < n; s++) {
      const x = p[0] + ((q[0] - p[0]) * s) / n
      const z = p[1] + ((q[1] - p[1]) * s) / n
      if (!open(Math.floor((x - x0) / GRID), Math.floor((z - z0) / GRID))) return false
    }
    return true
  }
  const pts: [number, number][] = [[a[0], a[2]], ...cells, [b[0], b[2]]]
  const out: [number, number][] = []
  let at = 0
  while (at < pts.length - 1) {
    let next = pts.length - 1
    while (next > at + 1 && !sees(pts[at]!, pts[next]!)) next--
    if (next !== pts.length - 1) out.push(pts[next]!)
    at = next
  }
  memo.ways.set(key, out)
  return out
}

interface GridMemo {
  /** Per world cell, the hard blockers that close it (null: open). */
  cells: Map<number, Solid[] | null>
  /** Ways already found (or not), by their ends. */
  ways: Map<string, [number, number][]>
}
const memos = new WeakMap<object, Map<string, GridMemo>>()
/** The fine grid's shared answers for one `near` at one clearance and cell size. */
/**
 * Whether a point is walled in: on the fine grid (a body's core from every wall), the open ground round
 * it reaches neither `to` (its walk node) nor `reach` metres out (a seat in a closed yard, a post behind
 * a gate too narrow to pass). Ground that reaches further out is taken to join the rest of the island.
 */
export function walledIn(
  x: number,
  z: number,
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  reach = 12,
  /** Ground within 1.6 m of this point (the walk node the place is reached from) is the way out. */
  to?: { x: number; z: number },
): boolean {
  const GRID = 0.1
  // a body's core: a narrow gate still lets one through
  const C = 0.12
  const memo = memoOf(near, `${C},${GRID}`)
  const key = `walled:${x.toFixed(2)},${z.toFixed(2)},${reach},${to?.x.toFixed(2)},${to?.z.toFixed(2)}`
  const had = memo.ways.get(key)
  if (had) return had.length > 0
  const i0 = Math.floor(x / GRID)
  const j0 = Math.floor(z / GRID)
  const open = (i: number, j: number): boolean => {
    const wk = (i + 32768) * 65536 + (j + 32768)
    let by = memo.cells.get(wk)
    const cx = (i + 0.5) * GRID
    const cz = (j + 0.5) * GRID
    if (by === undefined) {
      by = null
      for (const o of near(cx, cz, C)) {
        const so = solidOfBlocker(o)
        if (!so.soft && solidDistance(so, cx, cz) < C) {
          if (!by) by = []
          by.push(so)
        }
      }
      memo.cells.set(wk, by)
    }
    if (!by) return true
    // what the point stands in (its bench, its stall) closes nothing; by the point a body comes as near a
    // wall as the point does
    const byIt = Math.hypot(cx - x, cz - z) < END_ROOM
    return by.every(
      (so) =>
        own.has(so) || (byIt && solidDistance(so, cx, cz) >= Math.min(C, solidDistance(so, x, z)) - 0.01),
    )
  }
  const own = new Set<Solid>()
  for (const o of near(x, z, 0.05)) {
    const so = solidOfBlocker(o)
    if (solidDistance(so, x, z) < 0.05) own.add(so)
  }
  const seen = new Set<number>([(i0 + 32768) * 65536 + (j0 + 32768)])
  const queue: [number, number][] = [[i0, j0]]
  const far = (reach / GRID) ** 2
  let out = false
  for (let q = 0; q < queue.length && q < 120000; q++) {
    const [i, j] = queue[q]!
    if (
      (i - i0) ** 2 + (j - j0) ** 2 >= far ||
      (to && Math.hypot((i + 0.5) * GRID - to.x, (j + 0.5) * GRID - to.z) <= 1.6)
    ) {
      out = true
      break
    }
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const k = (i + di + 32768) * 65536 + (j + dj + 32768)
      if (seen.has(k) || !open(i + di, j + dj)) continue
      seen.add(k)
      queue.push([i + di, j + dj])
    }
  }
  memo.ways.set(key, out ? [] : [[x, z]])
  return !out
}

/**
 * The way out from a point to the nearest of `to` (walk nodes) a body's core gets through, round the
 * walls, houses and fences `near` gives, as `walledIn` floods it (its own seat and the point's own room
 * aside): which of `to` it reaches and the way's corners from there to the point, pulled taut; null when
 * none is reached within `reach` metres. One flood a spot (lifePlaces: a spot behind a wall from its
 * node, reached round by the gate).
 */
export function floodWay(
  x: number,
  z: number,
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  to: readonly { x: number; z: number }[],
  reach = 20,
): { to: number; way: [number, number][] } | null {
  const GRID = 0.1
  const C = CORE
  const memo = memoOf(near, `${C},${GRID}`)
  const own = new Set<Solid>()
  for (const o of near(x, z, 0.05)) {
    const so = solidOfBlocker(o)
    if (solidDistance(so, x, z) < 0.05) own.add(so)
  }
  const open = (i: number, j: number): boolean => {
    const wk = (i + 32768) * 65536 + (j + 32768)
    let by = memo.cells.get(wk)
    const cx = (i + 0.5) * GRID
    const cz = (j + 0.5) * GRID
    if (by === undefined) {
      by = null
      for (const o of near(cx, cz, C)) {
        const so = solidOfBlocker(o)
        if (!so.soft && solidDistance(so, cx, cz) < C) {
          if (!by) by = []
          by.push(so)
        }
      }
      memo.cells.set(wk, by)
    }
    if (!by) return true
    const byIt = Math.hypot(cx - x, cz - z) < END_ROOM
    return by.every(
      (so) =>
        own.has(so) || (byIt && solidDistance(so, cx, cz) >= Math.min(C, solidDistance(so, x, z)) - 0.01),
    )
  }
  const i0 = Math.floor(x / GRID)
  const j0 = Math.floor(z / GRID)
  const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)
  const from = new Map<number, number>([[key(i0, j0), -1]])
  const queue: [number, number][] = [[i0, j0]]
  const far = (reach / GRID) ** 2
  let hit = -1
  let end: [number, number] | null = null
  for (let q = 0; q < queue.length && q < 160000 && hit < 0; q++) {
    const [i, j] = queue[q]!
    const cx = (i + 0.5) * GRID
    const cz = (j + 0.5) * GRID
    for (const [t, n] of to.entries())
      if (Math.hypot(cx - n.x, cz - n.z) <= FLOOD_AT) {
        hit = t
        end = [i, j]
        break
      }
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di
      const nj = j + dj
      const k = key(ni, nj)
      if (from.has(k) || (ni - i0) ** 2 + (nj - j0) ** 2 >= far || !open(ni, nj)) continue
      from.set(k, key(i, j))
      queue.push([ni, nj])
    }
  }
  if (hit < 0 || !end) return null
  // the cells back from the node to the point, pulled taut over open cells
  const cells: [number, number][] = []
  for (let k = key(end[0], end[1]); k >= 0; k = from.get(k)!) {
    const i = Math.floor(k / 65536) - 32768
    const j = (k % 65536) - 32768
    cells.push([(i + 0.5) * GRID, (j + 0.5) * GRID])
  }
  const sees = (p: [number, number], q: [number, number]) => {
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (GRID / 2))
    for (let s = 1; s < n; s++) {
      const px = p[0] + ((q[0] - p[0]) * s) / n
      const pz = p[1] + ((q[1] - p[1]) * s) / n
      if (!open(Math.floor(px / GRID), Math.floor(pz / GRID))) return false
    }
    return true
  }
  const node = to[hit]!
  const pts: [number, number][] = [[node.x, node.z], ...cells, [x, z]]
  const out: [number, number][] = []
  let at = 0
  while (at < pts.length - 1) {
    let next = pts.length - 1
    while (next > at + 1 && !sees(pts[at]!, pts[next]!)) next--
    if (next !== pts.length - 1) out.push(pts[next]!)
    at = next
  }
  return { to: hit, way: out }
}
/** A flood reaches a walk node this near it, metres. */
const FLOOD_AT = 0.6

function memoOf(near: object, kind: string): GridMemo {
  let byKind = memos.get(near)
  if (!byKind) {
    byKind = new Map()
    memos.set(near, byKind)
  }
  let m = byKind.get(kind)
  if (!m) {
    m = { cells: new Map(), ways: new Map() }
    byKind.set(kind, m)
  }
  return m
}

/**
 * A polyline that keeps clear of what `near` finds (decisions.md "Activity spots": paths go round carts,
 * stalls and houses; collide.ts outlines or plain discs): a waypoint inside one (grown by WALK_CLEAR) is
 * moved out of it; where a segment would cut one, the way goes round it by the corners on the side the
 * segment already passes, and the new segments are checked again (a few rounds). One either end stands
 * in is left alone (a spot on a bench, a door in a doorway): that is where the walk starts or ends.
 * `ground[k]` is segment k's flag; the segments a detour adds take the flag of the one they replace.
 */
export function clearWay(
  pts: readonly Pt[],
  ground: readonly boolean[],
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  /** A walk out of a building's door (`from`) or in at one (`to`): its last metre may cross the house. */
  door: { from?: boolean; to?: boolean; thorough?: boolean } = {},
): { pts: Pt[]; ground: boolean[] } {
  const P = [...pts]
  /** Whether segment k's ends stand in (or, at a door, by) a blocker: the walk starts or ends there. */
  const endsIn = (so: Solid, k: number): boolean => {
    const a = P[k]!
    const b = P[k + 1]!
    // (only the walk's own ends: a corner on the way that touches a house is no reason to cross it)
    const ra = k === 0 ? (door.from ? DOOR_SLACK : 0.05) : Number.NEGATIVE_INFINITY
    const rb = k + 1 === P.length - 1 ? (door.to ? DOOR_SLACK : 0.05) : Number.NEGATIVE_INFINITY

    return solidDistance(so, a[0], a[2]) < ra || solidDistance(so, b[0], b[2]) < rb
  }
  const G = [...ground]
  const C = WALK_CLEAR
  const dir: [number, number] = [0, 0]
  // a way point inside a blocker (a square's middle under its well) is set out of it, the shortest way
  for (let k = 1; k < P.length - 1; k++) {
    let x = P[k]![0]
    let z = P[k]![2]
    for (let round = 0; round < 3; round++) {
      let moved = false
      for (const b of near(x, z, C)) {
        const d = solidDistance(solidOfBlocker(b), x, z, dir)
        if (d >= C) continue
        x += dir[0] * (C * 1.05 - d)
        z += dir[1] * (C * 1.05 - d)
        moved = true
      }
      if (!moved) break
    }
    P[k] = [x, P[k]![1], z]
  }
  for (let k = 0, added = 0; k < P.length - 1 && added < 32; k++) {
    const a = P[k]!
    const b = P[k + 1]!
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    const ux = dx / len
    const uz = dz / len
    // the blockers the segment cuts, nearest along it first
    const hits: { s: Solid; t: number }[] = []
    for (const o of near((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, len / 2 + C + 0.5)) {
      const s = solidOfBlocker(o)
      // an end standing in it is where the walk starts or ends; one near it may leave it, not cut in
      const da = solidDistance(s, a[0], a[2])
      const db = solidDistance(s, b[0], b[2])
      if (endsIn(s, k)) continue
      if (segmentDistance(s, a[0], a[2], b[0], b[2]) >= Math.min(C, da, db) - 0.02) continue
      hits.push({ s, t: (s.cx - a[0]) * ux + (s.cz - a[2]) * uz })
    }
    if (!hits.length) continue
    hits.sort((p, q) => p.t - q.t)
    const y = (t: number) => a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t / len))
    let way: Pt[] = []
    for (const { s: hit } of hits) {
      way = detour(hit, a, b, ux, uz, len, near, P, y)
      if (way.length) break
    }
    if (!way.length) continue
    P.splice(k + 1, 0, ...way)
    G.splice(k, 0, ...way.map(() => G[k]!))
    added++
    // look at the new first segment again
    k--
  }
  // last, a segment that still runs through a wall (round one thing into another) goes the tight way
  const hard = (x: number, z: number, r: number) => near(x, z, r).filter((o) => !solidOfBlocker(o).soft)
  /** Whether segment k runs through a wall (what its ends stand in aside). */
  const cutAt = (k: number): boolean => {
    const a = P[k]!
    const b = P[k + 1]!
    const len = Math.hypot(b[0] - a[0], b[2] - a[2])
    if (len < 1e-6) return false
    return hard((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, len / 2 + 0.1).some((o) => {
      const so = solidOfBlocker(o)
      if (endsIn(so, k)) return false
      return segmentDistance(so, a[0], a[2], b[0], b[2]) < 0.02
    })
  }
  for (let k = 0, fixed = 0; k < P.length - 1 && fixed < (door.thorough ? 40 : 16); k++) {
    const a = P[k]!
    const b = P[k + 1]!
    const len = Math.hypot(b[0] - a[0], b[2] - a[2])
    if (!cutAt(k)) continue
    // in a tight spot (a courtyard, a gate in front of a hall) the way is found on a fine grid
    // a way found from either end (one standing in a tight corner is easier left than reached)
    const either = (C: number, grid: number, margin = GRID_NEAR, steps?: number) => {
      const there = gridWay(a, b, near, C, grid, false, margin, false, steps)
      return there.length ? there : [...gridWay(b, a, near, C, grid, false, margin, false, steps)].reverse()
    }
    // round the places people stand too where there is room, else only round the walls
    let found = gridWay(a, b, near, TIGHT, 0.1, false, GRID_NEAR, true)
    if (!found.length) found = either(TIGHT, 0.1)
    if (!found.length) found = either(TIGHT, 0.2, GRID_FAR)
    // a walk that must be clean (an agent's) looks further on the fine grid
    if (!found.length && door.thorough) found = either(TIGHT, 0.1, GRID_FAR * 2)
    // (… and squeezes through a gap a body's core passes, as a spot is judged reachable: walledIn)
    if (!found.length && door.thorough) found = either(CORE, 0.1, GRID_FAR * 2)
    // (… and last, wide and coarse, as an edge of the walk graph looks for its way round: a spot whose
    // node is across a chapel from it)
    if (!found.length && door.thorough) found = either(0.2, 0.2, 12, EDGE_STEPS)
    if (!found.length) continue
    const ux = (b[0] - a[0]) / len
    const uz = (b[2] - a[2]) / len
    const y = (t: number) => a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t / len))
    const way = found.map(([x, z]): Pt => [x, y((x - a[0]) * ux + (z - a[2]) * uz), z])
    P.splice(k + 1, 0, ...way)
    G.splice(k, 0, ...way.map(() => G[k]!))
    k += way.length
    fixed++
  }
  return { pts: P, ground: G }
}

/** Unit vector out through side d (60°·d counter-clockwise from +x, toward −z), as tilePath. */
const side = (d: number): [number, number] => {
  const a = (Math.PI / 180) * (60 * d)
  return [Math.cos(a), -Math.sin(a)]
}

/**
 * The walk graph of a built island. `reach` lists tiles people must be able to walk to (work tiles off
 * the roads); each gets a spur to the graph when one is found within a few steps.
 */
export function hexWalk(
  h: HexIsland,
  z: HexZones,
  w: Pick<HexWorld, "tiles"> & Partial<Pick<HexWorld, "pieces">>,
  opts: { reach?: readonly number[] } = {},
): HexWalk {
  const g = h.grid
  const R = HEX_TILE_SIZE
  const top = new Float64Array(g.size).fill(Number.NaN)
  /** Where the world turned each building (a scene may turn to another street than its first). */
  const turnedTo = new Map<number, number>()
  /** Tiles under a neighbour's scene: no door, no spur of their own. */
  const parts = new Set<number>()
  for (const t of w.tiles) {
    top[t.i] = t.top
    if (t.door !== undefined) turnedTo.set(t.i, t.door)
    if (t.prefab === "scene-part") parts.add(t.i)
  }
  const centre = (i: number): [number, number] => {
    const [x, y] = hexCentre({ q: g.q[i]!, r: g.r[i]! })
    return [x * R, y * R]
  }
  const nodes: HexWalkNode[] = []
  const edges: HexWalkEdge[] = []
  const out: number[][] = []
  const byTile = new Map<number, number>()
  const doors = new Map<number, number>()
  const add = (n: HexWalkNode): number => {
    nodes.push(n)
    out.push([])
    return nodes.length - 1
  }
  const join = (a: number, b: number, kind: HexWalkKind) => {
    if (a === b || out[a]!.some((e) => edges[e]!.a === b || edges[e]!.b === b)) return
    const p = nodes[a]!
    const q = nodes[b]!
    edges.push({ a, b, kind, len: Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) })
    out[a]!.push(edges.length - 1)
    out[b]!.push(edges.length - 1)
  }

  // ---- road tiles, joined along each road ----
  const links = new Map<number, Set<number>>()
  const link = (a: number, b: number) => {
    if (!links.has(a)) links.set(a, new Set())
    links.get(a)!.add(b)
  }
  for (const r of z.roads)
    for (let k = 1; k < r.tiles.length; k++) {
      link(r.tiles[k - 1]!, r.tiles[k]!)
      link(r.tiles[k]!, r.tiles[k - 1]!)
    }
  const tileKind = (i: number): HexWalkKind => {
    const u = useOf(z, i)
    return u === "bridge" ? "bridge" : u === "square" || u === "landmark" || u === "court" ? "square" : "road"
  }
  const ground = (i: number) => (Number.isNaN(top[i]!) ? 0 : Math.max(0, top[i]!))
  const centreNode = (i: number, kind: HexWalkKind): number => {
    const have = byTile.get(i)
    if (have !== undefined) return have
    const [x, zz] = centre(i)
    let y = ground(i)
    if (kind === "bridge") {
      // the deck at its banks' height, as world.ts lays it
      let bank = 0
      let n = 0
      for (const j of links.get(i) ?? []) {
        if (useOf(z, j) === "bridge") continue
        bank += ground(j)
        n++
      }
      y = (n ? bank / n : y + 0.4) + DECK_LIFT
    } else if (kind === "dock") y = DOCK_Y
    const id = add({ x, y, z: zz, tile: i, kind })
    byTile.set(i, id)
    return id
  }
  for (const [i, to] of links) {
    const a = centreNode(i, tileKind(i))
    for (const j of to) join(a, centreNode(j, tileKind(j)), tileKind(j) === "bridge" ? "bridge" : tileKind(i))
  }
  // every place's heart, even one no road reached
  const hearts = z.zones.map((zone) => (zone.tiles.length ? centreNode(zone.tile, "square") : -1))
  // bridge legs: a bridge's edges take its kind whichever end they were made from
  for (const e of edges) if (nodes[e.a]!.kind === "bridge" || nodes[e.b]!.kind === "bridge") e.kind = "bridge"

  // ---- doors: outside the front of every building that faces a street ----
  const roadLike = (i: number) => {
    const u = useOf(z, i)
    return u === "road" || u === "bridge" || u === "square"
  }
  for (let i = 0; i < g.size; i++) {
    const u = useOf(z, i)
    if ((u !== "building" && u !== "farmstead" && u !== "homestead" && u !== "landmark") || parts.has(i))
      continue
    const nb = g.neighbours(i)
    // the side hexWorld turns a building to: its first road-like neighbour (or the street a scene turned
    // to, or the court a castle's building opens onto)
    let d = -1
    for (let k = 0; k < 6; k++)
      if (nb[k]! >= 0 && roadLike(nb[k]!)) {
        d = k
        break
      }
    const turned = turnedTo.get(i)
    if (turned !== undefined && nb[turned]! >= 0 && (roadLike(nb[turned]!) || byTile.has(nb[turned]!)))
      d = turned
    if (d < 0) continue
    const street = byTile.get(nb[d]!)
    // a building over a street more than a step below it has no way down: no door
    if (street === undefined || Math.abs(h.level[nb[d]!]! - h.level[i]!) > 1) continue
    const [cx, cz] = centre(i)
    const [ux, uz] = side(d)
    const id = add({ x: cx + ux * DOOR_OUT, y: ground(i), z: cz + uz * DOOR_OUT, tile: i, kind: "door" })
    doors.set(i, id)
    join(id, street, "door")
  }

  // ---- spurs out to work tiles off the roads ----
  const open = (i: number) => {
    const k = kindOf(h, i)
    if (useOf(z, i) === "dock") return true
    return k !== "sea" && k !== "shallows" && k !== "lake" && k !== "river" && k !== "rock"
  }
  const level = (i: number) => (useOf(z, i) === "dock" ? 0 : h.level[i]!)
  for (const start of opts.reach ?? []) {
    if (byTile.has(start) || !open(start) || parts.has(start)) continue
    // breadth first (a few steps) to the nearest tile with a node, round buildings where it can
    const prev = new Map<number, number>([[start, -1]])
    let frontier = [start]
    let hit = -1
    for (let step = 0; step < SPUR_STEPS && hit < 0 && frontier.length; step++) {
      const next: number[] = []
      const ordered = [...frontier].sort(
        (a, b) => Number(useOf(z, a) === "building") - Number(useOf(z, b) === "building"),
      )
      for (const i of ordered) {
        for (const j of g.neighbours(i)) {
          if (j < 0 || prev.has(j)) continue
          if (Math.abs(level(j) - level(i)) > 1) continue
          if (byTile.has(j) && nodes[byTile.get(j)!]!.kind !== "bridge") {
            prev.set(j, i)
            hit = j
            break
          }
          if (!open(j)) continue
          prev.set(j, i)
          next.push(j)
        }
        if (hit >= 0) break
      }
      frontier = next
    }
    if (hit < 0) continue
    let cur = hit
    let node = byTile.get(hit)!
    for (let i = prev.get(cur)!; i >= 0; i = prev.get(i)!) {
      const dock = useOf(z, i) === "dock"
      const id = centreNode(i, dock ? "dock" : "path")
      join(node, id, dock || nodes[node]!.kind === "dock" ? "dock" : "path")
      node = id
      cur = i
    }
  }

  // ---- A* over it ----
  const route = (from: number, to: number): number[] | null => {
    if (from < 0 || to < 0 || from >= nodes.length || to >= nodes.length) return null
    if (from === to) return [from]
    const n = nodes.length
    const dist = new Float64Array(n).fill(Infinity)
    const prev = new Int32Array(n).fill(-1)
    const done = new Uint8Array(n)
    const goal = nodes[to]!
    const guess = (i: number) => Math.hypot(nodes[i]!.x - goal.x, nodes[i]!.z - goal.z)
    const heap: [number, number][] = []
    const push = (f: number, i: number) => {
      heap.push([f, i])
      let j = heap.length - 1
      while (j > 0) {
        const p = (j - 1) >> 1
        if (heap[p]![0] <= f) break
        ;[heap[p], heap[j]] = [heap[j]!, heap[p]!]
        j = p
      }
    }
    const pop = (): number => {
      const topItem = heap[0]!
      const last = heap.pop()!
      if (heap.length) {
        heap[0] = last
        let j = 0
        for (;;) {
          const l = 2 * j + 1
          const r = l + 1
          let m = j
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r
          if (m === j) break
          ;[heap[m], heap[j]] = [heap[j]!, heap[m]!]
          j = m
        }
      }
      return topItem[1]
    }
    dist[from] = 0
    push(guess(from), from)
    while (heap.length) {
      const i = pop()
      if (done[i]) continue
      done[i] = 1
      if (i === to) break
      for (const e of out[i]!) {
        const edge = edges[e]!
        const j = edge.a === i ? edge.b : edge.a
        const d = dist[i]! + edge.len
        if (d < dist[j]!) {
          dist[j] = d
          prev[j] = i
          push(d + guess(j), j)
        }
      }
    }
    if (!Number.isFinite(dist[to]!)) return null
    const path = [to]
    for (let k = to; prev[k]! >= 0; ) {
      k = prev[k]!
      path.push(k)
    }
    return path.reverse()
  }

  // a node inside a building or a wall (a square's middle under a hall that fills its tile) moves out of
  // it, toward the neighbour it is walked to from that comes out soonest (collide.ts outlines)
  if (w.pieces) {
    const hard = new SolidGrid(
      w.pieces.flatMap(pieceSolids).filter((s) => s.kind === "building" || s.kind === "wall"),
    )
    const inside = (x: number, z: number) =>
      hard.near(x, z, WALK_CLEAR).some((s) => solidDistance(s, x, z) < WALK_CLEAR)
    for (const [i, n] of nodes.entries()) {
      if (!inside(n.x, n.z)) continue
      let best: [number, number] | null = null
      let bestD = Number.POSITIVE_INFINITY
      for (const e of out[i]!) {
        const o = nodes[edges[e]!.a === i ? edges[e]!.b : edges[e]!.a]!
        const len = Math.hypot(o.x - n.x, o.z - n.z)
        for (let d = 0.2; d < len - 0.2; d += 0.2) {
          const x = n.x + ((o.x - n.x) * d) / len
          const z = n.z + ((o.z - n.z) * d) / len
          if (inside(x, z)) continue
          if (d < bestD) {
            bestD = d
            best = [x, z]
          }
          break
        }
      }
      if (best) {
        n.x = best[0]
        n.z = best[1]
      }
    }
    for (const e of edges) e.len = Math.hypot(nodes[e.b]!.x - nodes[e.a]!.x, nodes[e.b]!.z - nodes[e.a]!.z)
    // an edge whose straight way cuts through a wall, a house or a fence goes round it: the way found
    // once here, on the fine grid, so everyone walking it walks round (ways on decks are the decks')
    const near = (x: number, z: number, r: number) => hard.near(x, z, r)
    for (const e of edges) {
      const p = nodes[e.a]!
      const q = nodes[e.b]!
      if (onDeckKind(p.kind) || onDeckKind(q.kind) || e.kind === "bridge") continue
      const a: Pt = [p.x, p.y, p.z]
      const b: Pt = [q.x, q.y, q.z]
      if (!cutsHard(a, b, near)) continue
      let way: [number, number][] = []
      for (const [C, grid, margin] of EDGE_SEARCH) {
        way = gridWay(a, b, near, C, grid, false, margin, false, EDGE_STEPS)
        if (!way.length) way = [...gridWay(b, a, near, C, grid, false, margin, false, EDGE_STEPS)].reverse()
        if (way.length) break
      }
      if (!way.length) {
        // no way round at all (a spur across a wall): no way, nobody walks it
        e.walled = true
        const id = edges.indexOf(e)
        out[e.a] = out[e.a]!.filter((x) => x !== id)
        out[e.b] = out[e.b]!.filter((x) => x !== id)
        // a door with no way out to its street (a fence across it) is no door: nobody lives behind it
        for (const n of [e.a, e.b])
          if (nodes[n]!.kind === "door" && !out[n]!.length) doors.delete(nodes[n]!.tile)
        continue
      }
      e.via = way
      let len = 0
      let [px, pz] = [p.x, p.z]
      for (const [x, z] of [...way, [q.x, q.z] as [number, number]]) {
        len += Math.hypot(x - px, z - pz)
        px = x
        pz = z
      }
      e.len = len
    }
    // what an edge through a wall alone joined to the rest (a spur into a castle court over its
    // curtain) is joined again to the nearest node of the rest a way round the walls reaches (the
    // court's own), else is no node of any tile: nobody is sent there to walk out through the wall
    if (edges.some((e) => e.walled)) {
      const joined = new Uint8Array(nodes.length)
      const spread = (from: number[]) => {
        const queue = from.filter((n) => !joined[n])
        for (const n of queue) joined[n] = 1
        for (let k = 0; k < queue.length; k++)
          for (const id of out[queue[k]!]!) {
            const ed = edges[id]!
            const o = ed.a === queue[k] ? ed.b : ed.a
            if (!joined[o]) {
              joined[o] = 1
              queue.push(o)
            }
          }
      }
      spread(hearts.filter((n) => n >= 0))
      for (const e of edges) {
        if (!e.walled) continue
        for (const start of [e.a, e.b]) {
          if (joined[start]) continue
          // the part cut off
          const part = [start]
          const inPart = new Set(part)
          for (let k = 0; k < part.length; k++)
            for (const id of out[part[k]!]!) {
              const ed = edges[id]!
              const o = ed.a === part[k] ? ed.b : ed.a
              if (!inPart.has(o)) {
                inPart.add(o)
                part.push(o)
              }
            }
          let link: { a: number; b: number; via: [number, number][]; len: number } | null = null
          for (const n of part) {
            const p = nodes[n]!
            const close = nodes
              .map((q, i) => ({ i, d: Math.hypot(q.x - p.x, q.z - p.z) }))
              .filter(({ i, d }) => joined[i] && d < REJOIN && Math.abs(nodes[i]!.y - p.y) < 0.6)
              .sort((x, y) => x.d - y.d)
            for (const { i, d } of close) {
              if (link && d >= link.len) break
              const q = nodes[i]!
              const pa: Pt = [p.x, p.y, p.z]
              const pb: Pt = [q.x, q.y, q.z]
              let via: [number, number][] | null = cutsHard(pa, pb, near) ? null : []
              for (const [C, grid, margin] of via ? [] : EDGE_SEARCH) {
                const w = gridWay(pa, pb, near, C, grid, false, margin, false, EDGE_STEPS)
                if (w.length) {
                  via = w
                  break
                }
              }
              if (!via) continue
              let len = 0
              let [px, pz] = [p.x, p.z]
              for (const [x, z] of [...via, [q.x, q.z] as [number, number]]) {
                len += Math.hypot(x - px, z - pz)
                px = x
                pz = z
              }
              if (!link || len < link.len) link = { a: n, b: i, via, len }
              break
            }
          }
          if (link) {
            edges.push({
              a: link.a,
              b: link.b,
              kind: "path",
              len: link.len,
              ...(link.via.length ? { via: link.via } : {}),
            })
            out[link.a]!.push(edges.length - 1)
            out[link.b]!.push(edges.length - 1)
            spread([link.b])
            continue
          }
          for (const n of part) {
            const node = nodes[n]!
            if (byTile.get(node.tile) === n) byTile.delete(node.tile)
            if (doors.get(node.tile) === n) doors.delete(node.tile)
          }
        }
      }
    }
  }

  return {
    nodes,
    edges,
    out,
    at: (tile) => byTile.get(tile) ?? -1,
    door: (tile) => doors.get(tile) ?? -1,
    hearts,
    route,
  }
}
