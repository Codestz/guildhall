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
import { discSolid, pieceSolids, type Solid, SolidGrid, solidBoxDistance, solidDistance } from "./collide.ts"
import { hexAt, hexCentre } from "./grid.ts"
import { type HexIsland, kindOf } from "./island.ts"
import { openTile } from "./pull.ts"
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
  /**
   * What taking it costs a route, when not its length: a shortcut over open ground (`crossEdges`) costs
   * more than its metres, so the roads stay the way people mostly take.
   */
  cost?: number
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
 * How far from a point standing in (or against) a solid a way may still be in it, metres: enough to get
 * out of it (a doorway's house, a seat, a spot set against the butts), and no further (the rest of the
 * way keeps out of it like anything else). `d`: the point's distance from the solid (negative inside).
 */
export const ownRoom = (d: number): number => Math.max(END_ROOM, OWN_OUT - d)
/** How far past its edge a way leaves a solid its end stands in before it must keep out, metres. */
const OWN_OUT = 0.3

/** How far along a→b (from a, standing in `so`) the way first comes out of it, metres (len: never). */
function outAlong(so: Solid, ax: number, az: number, bx: number, bz: number, len: number): number {
  for (let t = 0.05; t < len; t += 0.05)
    if (solidDistance(so, ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len) > 0) return t
  return len
}

/**
 * Whether segment a→b cuts into solid `so`: the stretch by an end that stands in it (within `ra`/`rb` of
 * it, metres: a doorway's house, a seat) aside, as far as `ownRoom` (not the whole segment: a spot set
 * against the butts is not walked to through them), and a doorway's own house (`ra`/`rb` past a body's
 * brush, the end inside it) as far as the way runs in it from the door (out under a forge's porch).
 */
export function cutsSolid(
  so: Solid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  ra = 0.05,
  rb = 0.05,
): boolean {
  const len = Math.hypot(bx - ax, bz - az)
  const da = solidDistance(so, ax, az)
  const db = solidDistance(so, bx, bz)
  let s0 = 0
  let s1 = len
  if (da < ra) s0 = Math.max(ownRoom(da), da < 0 && ra > 0.05 ? outAlong(so, ax, az, bx, bz, len) : 0)
  if (db < rb) s1 = len - Math.max(ownRoom(db), db < 0 && rb > 0.05 ? outAlong(so, bx, bz, ax, az, len) : 0)
  if (s1 <= s0) return false
  if (s0 === 0 && s1 === len) return segmentDistance(so, ax, az, bx, bz) < 0.02
  const ux = (bx - ax) / (len || 1)
  const uz = (bz - az) / (len || 1)
  return segmentDistance(so, ax + ux * s0, az + uz * s0, ax + ux * s1, az + uz * s1) < 0.02
}

/** A body's half-width at a prop's height and a little: nearer a prop's outline than this, a way brushes it, metres. */
export const PROP_TIGHT = 0.17
/** The room a way round a prop keeps from it (and from every wall), on the fine grid, metres. */
const PROP_ROOM = 0.24
/** … and where there is less, a body's half-width: the least room a way squeezes between props with, metres. */
const PROP_SQUEEZE = 0.2
/**
 * The ways a stretch too near a prop looks for, in order: the roomiest first round the stretch, as much
 * room as a body's half-width takes, and the least a body squeezes by; then from its far end, then wider.
 */
const ROOM_TRIES = (a: Pt, b: Pt): readonly (readonly [number, Pt, Pt, number])[] => [
  [PROP_ROOM, a, b, GRID_NEAR],
  [PROP_SQUEEZE, a, b, GRID_NEAR],
  [PROP_TIGHT, a, b, GRID_NEAR],
  [PROP_TIGHT, b, a, GRID_NEAR],
  [PROP_SQUEEZE, a, b, GRID_FAR],
]
/** How far round its ends a way round props may keep only the room its end has, metres. */
const ROOM_END = 0.35
/** How many corners either side of a tight bit of way are looked at again with it, at most. */
const ROOM_RUN = 6
/** How far off a way's own height the ground under a way round may be (a step, not a terrace's edge), metres. */
const ROOM_STEP = 0.3

/** What `near` may also tell (lifePlaces' `walkNear`): the ground's height, for a way round to keep to its level. */
export type NearWithGround = ((x: number, z: number, r: number) => readonly WalkBlocker[]) & {
  heightAt?: (x: number, z: number) => number
  /** A walkway's height at a point (a deck, a bridge, a flight), null off them. */
  walkwayAt?: (x: number, z: number) => number | null
  /** The open ground a way may be pulled taut over (pull.ts `openGround`): its level there, null off it. */
  openAt?: (x: number, z: number) => number | null
}
/** How near a prop a walk's end may stand and the prop still be the end's own (the bench it gets up from), metres. */
const PROP_OWN = 0.25

/**
 * Whether segment a→b comes nearer a prop (a cart, a crate, a lamp's post, a bench, a tree's trunk: not a
 * wall or a house, not a soft place) than PROP_TIGHT; by an end standing within `ra`/`rb` of one, only past
 * the stretch it takes to leave it (`cutsSolid`'s; a negative reach: no end there).
 */
export function brushesProp(
  a: readonly number[],
  b: readonly number[],
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  ra: number,
  rb: number,
): boolean {
  return nearerThan(a, b, near, ra, rb, PROP_TIGHT, false)
}

/**
 * Whether segment a→b comes nearer than `room` to a prop (`hard`: to a wall or a house), what its ends
 * stand at aside as `brushesProp` sets them aside.
 */
function nearerThan(
  a: readonly number[],
  b: readonly number[],
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  ra: number,
  rb: number,
  room: number,
  hard: boolean,
): boolean {
  return gapTo(a, b, near, ra, rb, room, hard) < room
}

/**
 * How near segment a→b comes to a prop (`hard`: a wall or a house), looked for within `room`, what its
 * ends stand at aside (`brushesProp`'s); `room` when none is nearer.
 */
function gapTo(
  a: readonly number[],
  b: readonly number[],
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  ra: number,
  rb: number,
  room: number,
  hard: boolean,
): number {
  let gap = room
  const ax = a[0]!
  const az = a[2]!
  const bx = b[0]!
  const bz = b[2]!
  const len = Math.hypot(bx - ax, bz - az)
  if (len < 1e-6) return gap
  const ux = (bx - ax) / len
  const uz = (bz - az) / len
  for (const o of near((ax + bx) / 2, (az + bz) / 2, len / 2 + room)) {
    const so = solidOfBlocker(o)
    if (so.soft || (so.kind === "building" || so.kind === "wall") !== hard) continue
    const da = solidDistance(so, ax, az)
    const db = solidDistance(so, bx, bz)
    let s0 = 0
    let s1 = len
    if (da < ra) s0 = Math.max(ownRoom(da), da < 0 && ra > PROP_OWN ? outAlong(so, ax, az, bx, bz, len) : 0)
    if (db < rb)
      s1 = len - Math.max(ownRoom(db), db < 0 && rb > PROP_OWN ? outAlong(so, bx, bz, ax, az, len) : 0)
    if (s1 <= s0) continue
    gap = Math.min(gap, segmentDistance(so, ax + ux * s0, az + uz * s0, ax + ux * s1, az + uz * s1))
    if (gap <= 0) return 0
  }
  return gap
}

/** How many corners on a way may be dropped at once, and how long a pulled straight may be, metres. */
const PULL_AHEAD = 12
const PULL_MAX = 30
/** A corner is only dropped for at least this much less way, metres. */
const PULL_GAIN = 0.05
/** The room a pulled straight keeps from a wall or a house (what its ends stand in aside), metres. */
const PULL_WALL = 0.25
/** How near its ends a pulled straight may cross ground no shortcut goes over (a door's plot), metres. */
const PULL_END = 1.0
/** How far off a way's height the ground under a pulled straight may be (no terrace's edge), metres. */
const PULL_STEP = 0.25

/**
 * The corners of way `P` (its segments' ground flags `G`) it can do without, dropped in place (pull.ts):
 * from each corner kept, straight on to the furthest of the next PULL_AHEAD it reaches with the straight
 * line on the ground (no deck, no flight), over open ground (`openAt`, a door's own plot by an end
 * aside) at the way's own height, cutting no wall or house (`walls`; what the walk's ends stand in aside)
 * and keeping PULL_WALL off them, a body's room off every prop (`brushesProp`), and through no one's
 * place (a soft disc round a spot someone stands at, but the walk's own ends').
 */
function pullTaut(
  P: Pt[],
  G: boolean[],
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
  openAt: (x: number, z: number) => number | null,
  walls: (x: number, z: number, r: number) => readonly WalkBlocker[],
  door: { from?: boolean; to?: boolean },
): void {
  if (P.length < 3) return
  const level = (near as NearWithGround).heightAt
  const last = P.length - 1
  const reach = (k: number) =>
    k === 0 ? (door.from ? DOOR_SLACK : PROP_OWN) : k === last ? (door.to ? DOOR_SLACK : PROP_OWN) : -1
  const canPull = (i: number, j: number, walked: number): boolean => {
    for (let k = i; k < j; k++) if (!G[k]) return false
    const a = P[i]!
    const b = P[j]!
    const len = Math.hypot(b[0] - a[0], b[2] - a[2])
    if (len > PULL_MAX || walked - len < PULL_GAIN) return false
    // over open ground of one level, at the way's own height
    const n = Math.max(1, Math.ceil(len / 0.5))
    let lv: number | null = null
    for (let s = 0; s <= n; s++) {
      const f = s / n
      const x = a[0] + (b[0] - a[0]) * f
      const z = a[2] + (b[2] - a[2]) * f
      const here = openAt(x, z)
      if (here === null) {
        if (Math.min(f, 1 - f) * len >= PULL_END) return false
      } else if (lv === null) lv = here
      else if (here !== lv) return false
      if (level && Math.abs(level(x, z) - (a[1] + (b[1] - a[1]) * f)) > PULL_STEP) return false
    }
    // through no wall or house, and a little off them; a body's room off the props
    const ra = i === 0 ? (door.from ? DOOR_SLACK : 0.05) : Number.NEGATIVE_INFINITY
    const rb = j === last ? (door.to ? DOOR_SLACK : 0.05) : Number.NEGATIVE_INFINITY
    for (const o of walls((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, len / 2 + 0.1))
      if (cutsSolid(solidOfBlocker(o), a[0], a[2], b[0], b[2], ra, rb)) return false
    if (nearerThan(a, b, near, reach(i), reach(j), PULL_WALL, true)) return false
    if (nearerThan(a, b, near, reach(i), reach(j), PROP_TIGHT, false)) return false
    // through no one's place but the walk's own ends'
    for (const o of near((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, len / 2 + 0.3)) {
      const so = solidOfBlocker(o)
      if (!so.soft || so.kind !== "blocker") continue
      if (solidDistance(so, P[0]![0], P[0]![2]) < 0.05 || solidDistance(so, P[last]![0], P[last]![2]) < 0.05)
        continue
      if (segmentDistance(so, a[0], a[2], b[0], b[2]) < 0.05) return false
    }
    return true
  }
  const keep: Pt[] = [P[0]!]
  const flags: boolean[] = []
  let i = 0
  while (i < last) {
    let j = i + 1
    let walked = Math.hypot(P[j]![0] - P[i]![0], P[j]![2] - P[i]![2])
    while (j < last && j + 1 - i <= PULL_AHEAD) {
      const w = walked + Math.hypot(P[j + 1]![0] - P[j]![0], P[j + 1]![2] - P[j]![2])
      if (!canPull(i, j + 1, w)) break
      walked = w
      j++
    }
    flags.push(j === i + 1 ? G[i]! : true)
    keep.push(P[j]!)
    i = j
  }
  if (keep.length === P.length) return
  P.splice(0, P.length, ...keep)
  G.splice(0, G.length, ...flags)
}

/**
 * Whether segment a→b runs through a wall, a building or a fence (a hard blocker: the soft places people
 * stand a while aside), by its ends what they stand in aside (`from`/`to`: how near an end a blocker may
 * be and still be the end's own, metres: a doorway's house, a seat; `cutsSolid`).
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
    if (cutsSolid(so, ax, az, bx, bz, ends.from ?? 0.05, ends.to ?? 0.05)) return true
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
/** Whether the last `gridWay` found no way at all (its [] is also a straight way's: no corners). */
let gridMissed = false

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
  /** How far round either end a cell may be as near what stands there as the end itself is, metres. */
  endRoom = END_ROOM,
): [number, number][] {
  // the box is on the world's own grid, so the cells' answers are shared by every way looked for
  const x0 = Math.floor((Math.min(a[0], b[0]) - GRID_MARGIN) / GRID) * GRID
  const z0 = Math.floor((Math.min(a[2], b[2]) - GRID_MARGIN) / GRID) * GRID
  const nx = Math.ceil((Math.max(a[0], b[0]) + GRID_MARGIN - x0) / GRID)
  const nz = Math.ceil((Math.max(a[2], b[2]) + GRID_MARGIN - z0) / GRID)
  gridMissed = true
  if (nx * nz > 400000) return []
  const memo = memoOf(near, `${C},${GRID},${soft}`)
  const key = `${a[0].toFixed(2)},${a[2].toFixed(2)},${b[0].toFixed(2)},${b[2].toFixed(2)},${any},${GRID_MARGIN},${steps},${endRoom}`
  const had = memo.ways.get(key)
  if (had) {
    gridMissed = memo.none.has(key)
    return had
  }
  const gi0 = Math.round(x0 / GRID)
  const gj0 = Math.round(z0 / GRID)
  // the blockers an end stands in (its own seat, its doorway) do not close cells
  const ends = new Set<Solid>()
  for (const p of [a, b])
    for (const o of near(p[0], p[2], C)) {
      const so = solidOfBlocker(o)
      if (solidDistance(so, p[0], p[2]) < 0.05) ends.add(so)
    }
  // the search's per-cell state, g and parent live in a scratch kept between searches: a cell this search
  // has not touched reads as unknown / infinite / no parent (`touch` stamps it), in place of three fresh
  // arrays filled per call (up to 400k cells each, thousands of calls an island)
  const { stamp, g, from, state, mark } = gridScratchOf(nx * nz)
  const touch = (k: number) => {
    if (stamp[k] !== mark) {
      stamp[k] = mark
      g[k] = Number.POSITIVE_INFINITY
      from[k] = -1
      state[k] = 0 // 0 unknown, 1 open, 2 closed
    }
  }
  const cx = (i: number) => x0 + (i + 0.5) * GRID
  const cz = (j: number) => z0 + (j + 0.5) * GRID
  const ax = a[0]
  const az = a[2]
  const bx = b[0]
  const bz = b[2]
  /**
   * Whether `so` lets a cell at (x, z), `d` from the end `p`, be open: by either end (a spot set against
   * a wall, a door) a body may come as near as the end itself does, and out of what the end stands in
   * (its seat, its doorway) as far as it takes to leave it, no further.
   */
  const byEnd = (so: Solid, px: number, pz: number, d: number, x: number, z: number) => {
    const dp = solidDistance(so, px, pz)
    const r = dp < 0.05 && ends.has(so) ? Math.max(ownRoom(dp), endRoom) : endRoom
    return d < r && solidDistance(so, x, z) >= Math.min(C, dp) - 0.01
  }
  const open = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false
    const k = j * nx + i
    touch(k)
    if (!state[k]) {
      // the world cell's closers (shared), less the ones an end stands in
      let by = memo.cells.get(gi0 + i, gj0 + j)
      const x = cx(i)
      const z = cz(j)
      if (by === undefined) {
        by = null
        for (const o of near(x, z, C)) {
          const so = solidOfBlocker(o)
          // (its box first: a wall's round covers whole streets its outline is nowhere near)
          if ((soft || !so.soft) && solidBoxDistance(so, x, z) < C && solidDistance(so, x, z) < C) {
            if (!by) by = []
            by.push(so)
          }
        }
        memo.cells.set(gi0 + i, gj0 + j, by)
      }
      let ok = true
      if (by) {
        const fromA = Math.hypot(x - ax, z - az)
        const fromB = Math.hypot(x - bx, z - bz)
        for (const so of by)
          if (!(byEnd(so, ax, az, fromA, x, z) || byEnd(so, bx, bz, fromB, x, z))) {
            ok = false
            break
          }
      }
      state[k] = ok ? 1 : 2
    }
    return state[k] === 1
  }
  const ai = Math.floor((ax - x0) / GRID)
  const aj = Math.floor((az - z0) / GRID)
  const bi = Math.floor((bx - x0) / GRID)
  const bj = Math.floor((bz - z0) / GRID)
  const goal = bj * nx + bi
  // A binary heap of cells by f, on typed arrays kept between searches (`heapOf`): the same pushes,
  // the same comparisons and so the same pops as the array pair it replaces (a tie between equal f
  // values settles the same way), at a fraction of the cost under V8.
  const heap = heapOf(8 * steps + 8)
  const hf = heap.f
  const hk = heap.k
  let hn = 0
  const push = (f: number, k: number) => {
    let c = hn++
    hf[c] = f
    hk[c] = k
    while (c > 0) {
      const p = (c - 1) >> 1
      const pf = hf[p] as number
      if (pf <= f) break
      hf[c] = pf
      hk[c] = hk[p] as number
      c = p
    }
    hf[c] = f
    hk[c] = k
  }
  const pop = (): number => {
    const top = hk[0] as number
    hn--
    if (hn > 0) {
      const lf = hf[hn] as number
      const lk = hk[hn] as number
      let c = 0
      for (;;) {
        const l = c * 2 + 1
        const r = l + 1
        let m = c
        let mf = lf
        if (l < hn && (hf[l] as number) < mf) {
          m = l
          mf = hf[l] as number
        }
        if (r < hn && (hf[r] as number) < mf) {
          m = r
          mf = hf[r] as number
        }
        if (m === c) break
        hf[c] = mf
        hk[c] = hk[m] as number
        c = m
      }
      hf[c] = lf
      hk[c] = lk
    }
    return top
  }
  const start = aj * nx + ai
  touch(start)
  touch(goal)
  g[start] = 0
  push(Math.hypot(ai - bi, aj - bj), start)
  let found = false
  for (let it = 0; hn > 0 && it < steps; it++) {
    const k = pop()
    if (k === goal) {
      found = true
      break
    }
    const i = k % nx
    const j = (k - i) / nx
    const gk = g[k] as number
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue
        const ni = i + di
        const nj = j + dj
        const nk = nj * nx + ni
        if (nk !== goal && !open(ni, nj)) continue
        // no corner cutting past a closed cell
        if (di && dj && (!open(i + di, j) || !open(i, j + dj))) continue
        const ng = gk + (di && dj ? Math.SQRT2 : 1)
        touch(nk)
        if (ng >= (g[nk] as number)) continue
        g[nk] = ng
        from[nk] = k
        push(ng + Math.hypot(ni - bi, nj - bj), nk)
      }
  }
  if (!found) {
    memo.ways.set(key, [])
    memo.none.add(key)
    return []
  }
  gridMissed = false
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

/**
 * A world cell's key in a GridMemo: one integer under 2^31 for cells within MEMO_HALF of the origin
 * (2 km at the finest grid; V8 keeps such Map keys as small integers, a heap number costs the lookup
 * several times over), the wide key beyond, offset past them.
 */
const MEMO_HALF = 20000
const MEMO_SPAN = 2 * MEMO_HALF
function memoKey(gi: number, gj: number): number {
  const i = gi + MEMO_HALF
  const j = gj + MEMO_HALF
  if (i >= 0 && i < MEMO_SPAN && j >= 0 && j < MEMO_SPAN) return i * MEMO_SPAN + j
  return 2 ** 31 + (gi + 32768) * 65536 + (gj + 32768)
}

/** The grid searches' heap arrays, grown to the largest asked for and kept. */
let heap = { f: new Float64Array(0), k: new Int32Array(0) }
function heapOf(capacity: number): { f: Float64Array; k: Int32Array } {
  if (heap.f.length < capacity) heap = { f: new Float64Array(capacity), k: new Int32Array(capacity) }
  return heap
}

/** A page of the cell cache is this many cells a side. */
const PAGE = 64
/**
 * Per world cell, the blockers that close it (null: open; undefined: not asked yet), in pages of
 * PAGE × PAGE cells in a small Map: one Map over every cell of an island (millions at a fine grid, on a
 * repo the size of react) made each lookup a cache miss on a giant hash table.
 */
class CellCache {
  private pages = new Map<number, (Solid[] | null | undefined)[]>()
  get(gi: number, gj: number): Solid[] | null | undefined {
    const page = this.pages.get(((gi >> 6) + 4096) * 8192 + ((gj >> 6) + 4096))
    return page ? page[(gi & 63) * PAGE + (gj & 63)] : undefined
  }
  set(gi: number, gj: number, by: Solid[] | null): void {
    const key = ((gi >> 6) + 4096) * 8192 + ((gj >> 6) + 4096)
    let page = this.pages.get(key)
    if (!page) {
      page = new Array<Solid[] | null | undefined>(PAGE * PAGE).fill(undefined)
      this.pages.set(key, page)
    }
    page[(gi & 63) * PAGE + (gj & 63)] = by
  }
}

/** The grid searches' per-cell scratch (cost, parent, open state), stamped per search and kept between them. */
interface GridScratch {
  stamp: Int32Array
  g: Float32Array
  from: Int32Array
  state: Int8Array
}
let gridScratch: GridScratch = {
  stamp: new Int32Array(0),
  g: new Float32Array(0),
  from: new Int32Array(0),
  state: new Int8Array(0),
}
let gridSearches = 0
function gridScratchOf(cells: number): GridScratch & { mark: number } {
  if (gridScratch.stamp.length < cells) {
    gridScratch = {
      stamp: new Int32Array(cells),
      g: new Float32Array(cells),
      from: new Int32Array(cells),
      state: new Int8Array(cells),
    }
    gridSearches = 0
  }
  return { ...gridScratch, mark: ++gridSearches }
}

interface GridMemo {
  /** Per world cell, the hard blockers that close it (null: open). */
  cells: CellCache
  /** Ways already found (or not), by their ends. */
  ways: Map<string, [number, number][]>
  /** The ways' keys that found none (`ways` has [] for them and for a straight way alike). */
  none: Set<string>
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
    let by = memo.cells.get(i, j)
    const cx = (i + 0.5) * GRID
    const cz = (j + 0.5) * GRID
    if (by === undefined) {
      by = null
      for (const o of near(cx, cz, C)) {
        const so = solidOfBlocker(o)
        if (!so.soft && solidBoxDistance(so, cx, cz) < C && solidDistance(so, cx, cz) < C) {
          if (!by) by = []
          by.push(so)
        }
      }
      memo.cells.set(i, j, by)
    }
    if (!by) return true
    // by the point a body comes as near a wall as the point does, and out of what it stands in (its
    // bench, its stall) as far as it takes to leave it (`ownRoom`)
    const off = Math.hypot(cx - x, cz - z)
    return by.every((so) => {
      const d = solidDistance(so, x, z)
      return off < (own.has(so) ? ownRoom(d) : END_ROOM) && solidDistance(so, cx, cz) >= Math.min(C, d) - 0.01
    })
  }
  const own = new Set<Solid>()
  for (const o of near(x, z, 0.05)) {
    const so = solidOfBlocker(o)
    if (solidDistance(so, x, z) < 0.05) own.add(so)
  }
  const seen = new Set<number>([memoKey(i0, j0)])
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
    for (let s = 0; s < 4; s++) {
      const ni = i + FLOOD_DI[s]!
      const nj = j + FLOOD_DJ[s]!
      const k = memoKey(ni, nj)
      if (seen.has(k) || !open(ni, nj)) continue
      seen.add(k)
      queue.push([ni, nj])
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
    let by = memo.cells.get(i, j)
    const cx = (i + 0.5) * GRID
    const cz = (j + 0.5) * GRID
    if (by === undefined) {
      by = null
      for (const o of near(cx, cz, C)) {
        const so = solidOfBlocker(o)
        if (!so.soft && solidBoxDistance(so, cx, cz) < C && solidDistance(so, cx, cz) < C) {
          if (!by) by = []
          by.push(so)
        }
      }
      memo.cells.set(i, j, by)
    }
    if (!by) return true
    const off = Math.hypot(cx - x, cz - z)
    for (const so of by) {
      const d = solidDistance(so, x, z)
      if (
        !(off < (own.has(so) ? ownRoom(d) : END_ROOM) && solidDistance(so, cx, cz) >= Math.min(C, d) - 0.01)
      )
        return false
    }
    return true
  }
  const i0 = Math.floor(x / GRID)
  const j0 = Math.floor(z / GRID)
  const far = (reach / GRID) ** 2
  // The flood's cells live in a box of `reach` round the point (every cell within `far` is inside it),
  // indexed by offset: a stamped scratch array says which were reached and from where (in place of a Map
  // keyed per cell, and a pair per queued cell), the same cells in the same order. The scratch is kept
  // between floods and only grows (one per spot: a few hundred floods a plan, 160k cells at most each).
  const half = Math.ceil(reach / GRID) + 1
  const W = 2 * half + 1
  const cellOf = (i: number, j: number) => (i - i0 + half) * W + (j - j0 + half)
  const { stamp, parent, queue, mark } = floodScratch(W * W)
  const root = cellOf(i0, j0)
  stamp[root] = mark
  parent[root] = -1
  queue[0] = root
  let length = 1
  let hit = -1
  let end = -1
  const nearSq = (FLOOD_AT * 0.99) ** 2
  const farSq = (FLOOD_AT * 1.01) ** 2
  for (let q = 0; q < length && q < 160000 && hit < 0; q++) {
    const cell = queue[q] as number
    const i = Math.floor(cell / W) - half + i0
    const j = (cell % W) - half + j0
    const cx = (i + 0.5) * GRID
    const cz = (j + 0.5) * GRID
    for (let t = 0; t < to.length; t++) {
      const n = to[t] as { x: number; z: number }
      const dx = cx - n.x
      const dz = cz - n.z
      // the exact `hypot <= FLOOD_AT`, its square root taken only where the squares cannot settle it
      const d2 = dx * dx + dz * dz
      if (d2 > farSq) continue
      if (d2 > nearSq && !(Math.hypot(dx, dz) <= FLOOD_AT)) continue
      hit = t
      end = cell
      break
    }
    for (let s = 0; s < 4; s++) {
      const ni = i + FLOOD_DI[s]!
      const nj = j + FLOOD_DJ[s]!
      if ((ni - i0) ** 2 + (nj - j0) ** 2 >= far) continue
      const k = cellOf(ni, nj)
      if (stamp[k] === mark || !open(ni, nj)) continue
      stamp[k] = mark
      parent[k] = cell
      queue[length++] = k
    }
  }
  if (hit < 0 || end < 0) return null
  // the cells back from the node to the point, pulled taut over open cells
  const cells: [number, number][] = []
  for (let k = end; k >= 0; k = parent[k] as number) {
    const i = Math.floor(k / W) - half + i0
    const j = (k % W) - half + j0
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
/** The flood's four ways out of a cell, in the order it takes them (east, west, south, north). */
const FLOOD_DI = [1, -1, 0, 0] as const
const FLOOD_DJ = [0, 0, 1, -1] as const

interface FloodScratch {
  /** Which flood last reached each cell of the box (its `stamp`), and from which cell. */
  stamp: Int32Array
  parent: Int32Array
  /** The cells in the order they were reached. */
  queue: Int32Array
}
let scratch: FloodScratch = { stamp: new Int32Array(0), parent: new Int32Array(0), queue: new Int32Array(0) }
/** Floods so far on the scratch: the next one's stamp (a fresh scratch's cells all read 0, so it starts over). */
let floods = 0
/** The flood's scratch arrays, at least `cells` long, and this flood's stamp. */
function floodScratch(cells: number): FloodScratch & { mark: number } {
  if (scratch.stamp.length < cells) {
    scratch = { stamp: new Int32Array(cells), parent: new Int32Array(cells), queue: new Int32Array(cells) }
    floods = 0
  }
  return { ...scratch, mark: ++floods }
}

function memoOf(near: object, kind: string): GridMemo {
  let byKind = memos.get(near)
  if (!byKind) {
    byKind = new Map()
    memos.set(near, byKind)
  }
  let m = byKind.get(kind)
  if (!m) {
    m = { cells: new CellCache(), ways: new Map(), none: new Set() }
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
): { pts: Pt[]; ground: boolean[]; cut?: boolean } {
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
  const walls = wallsOf(near)
  /**
   * Whether a→b runs into a solid `within` gives (anything not soft by default; `walls`: a building or a
   * wall itself), what the walk's own ends stand in aside (`first`/`last`: a→b starts or ends the walk).
   */
  const cutBy = (a: Pt, b: Pt, first: boolean, last: boolean, within = near): boolean => {
    const len = Math.hypot(b[0] - a[0], b[2] - a[2])
    if (len < 1e-6) return false
    const ra = first ? (door.from ? DOOR_SLACK : 0.05) : Number.NEGATIVE_INFINITY
    const rb = last ? (door.to ? DOOR_SLACK : 0.05) : Number.NEGATIVE_INFINITY
    return within((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, len / 2 + 0.1).some((o) => {
      const so = solidOfBlocker(o)
      return !so.soft && cutsSolid(so, a[0], a[2], b[0], b[2], ra, rb)
    })
  }
  // a way point inside a blocker (a square's middle under its well, a lane pushed into a house) is set
  // out of it, the shortest way: out of everything when that lands clear of the solids, else out of the
  // solids alone (never set out of a place someone stands through or into a wall: the butts' line)
  const setOut = (ox: number, oz: number, all: boolean): [number, number] => {
    let x = ox
    let z = oz
    for (let round = 0; round < (all ? 3 : 6); round++) {
      let moved = false
      for (const b of near(x, z, C)) {
        const so = solidOfBlocker(b)
        if (!all && so.soft) continue
        const d = solidDistance(so, x, z, dir)
        if (d >= C) continue
        x += dir[0] * (C * 1.05 - d)
        z += dir[1] * (C * 1.05 - d)
        moved = true
      }
      if (!moved) break
    }
    return [x, z]
  }
  /** Whether a way point set from (ox, oz) to (x, z) stands clear of the solids and got there clear. */
  const fair = (ox: number, oz: number, x: number, z: number): boolean =>
    near((x + ox) / 2, (z + oz) / 2, Math.hypot(x - ox, z - oz) / 2 + C).every((o) => {
      const so = solidOfBlocker(o)
      if (so.soft) return true
      const was = solidDistance(so, ox, oz)
      const now = solidDistance(so, x, z)
      if (was <= 0) return now > 0.02
      return segmentDistance(so, ox, oz, x, z) >= 0.02 && now >= Math.min(was, C * 0.5)
    })
  for (let k = 1; k < P.length - 1; k++) {
    const ox = P[k]![0]
    const oz = P[k]![2]
    let [x, z] = setOut(ox, oz, true)
    if (!fair(ox, oz, x, z)) [x, z] = setOut(ox, oz, false)
    if (!fair(ox, oz, x, z)) continue
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
    // (a way round a place someone stands that cuts through a wall is no way: round the butts' far side)
    const was = cutBy(a, b, k === 0, k + 2 === P.length)
    for (const { s: hit } of hits) {
      way = detour(hit, a, b, ux, uz, len, near, P, y)
      if (way.length && !was) {
        const pts = [a, ...way, b]
        for (let j = 0; j + 1 < pts.length; j++)
          if (cutBy(pts[j]!, pts[j + 1]!, k === 0 && j === 0, k + 2 === P.length && j + 2 === pts.length)) {
            way = []
            break
          }
      }
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
  /** Whether segment k runs through a wall (what its ends stand in aside). */
  const cutAt = (k: number): boolean => cutBy(P[k]!, P[k + 1]!, k === 0, k + 2 === P.length)
  /** Whether segment k runs through a building or a wall (a fence, a hedge) itself, not a prop. */
  const wallCutAt = (k: number): boolean => cutBy(P[k]!, P[k + 1]!, k === 0, k + 2 === P.length, walls)
  /** The tight way round the buildings and walls alone (a body's core where it must squeeze). */
  const wallsWay = (a: Pt, b: Pt): [number, number][] => {
    const there = gridWay(a, b, walls, TIGHT, 0.1, false, GRID_FAR)
    return there.length ? there : [...gridWay(b, a, walls, CORE, 0.1, false, GRID_FAR)].reverse()
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
    // a walk that must be clean (an agent's), or one through a wall or a house, looks further
    const walled = wallCutAt(k)
    const further = door.thorough || walled
    // (… round the walls and the buildings alone first, for a townsperson: brushing a bale, never
    // through a well, where props close every way in, as a shed's posts and bales round its node)
    if (!found.length && walled && !door.thorough) found = wallsWay(a, b)
    if (!found.length && further) found = either(TIGHT, 0.1, GRID_FAR * 2)
    // (… and squeezes through a gap a body's core passes, as a spot is judged reachable: walledIn)
    if (!found.length && further) found = either(CORE, 0.1, GRID_FAR * 2)
    // (… and last, wide and coarse, as an edge of the walk graph looks for its way round: a spot whose
    // node is across a chapel from it)
    if (!found.length && further) found = either(0.2, 0.2, 12, EDGE_STEPS)
    if (!found.length && walled && door.thorough) found = wallsWay(a, b)
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
  // pulled taut (pull.ts): the corners the way can do without are dropped, so it goes straight where it
  // can, not from lane to lane and corner to corner round the middle of a square or a bend
  const openAt = (near as NearWithGround).openAt
  if (openAt) pullTaut(P, G, near, openAt, walls, door)
  // last, a body's room off the props (a cart, a crate, a lamp's post, a bench): a bit of way that brushes
  // one nearer than a body's half-width (what its ends stand at aside: the bench it gets up from, the
  // stall it works at) goes the way a fine grid finds with that room, round the gap too narrow for a body
  // (between a fountain and a lamp) instead of through it; where there is no such way it stays
  // The stretch looked at again runs from the last corner before it with a body's room (or the walk's
  // start) to the first after it (or its end), so a corner set in a tight spot is no reason to squeeze.
  const level = (near as NearWithGround).heightAt
  const onWay = (near as NearWithGround).walkwayAt
  /** Where feet stand at a point: a walkway's planks, else the ground (null: `near` does not say). */
  const heightOf = (x: number, z: number): number | null => onWay?.(x, z) ?? level?.(x, z) ?? null
  const brushAt = (k: number) =>
    brushesProp(
      P[k]!,
      P[k + 1]!,
      near,
      k === 0 ? (door.from ? DOOR_SLACK : PROP_OWN) : -1,
      k + 2 === P.length ? (door.to ? DOOR_SLACK : PROP_OWN) : -1,
    )
  const roomy = (k: number) => {
    const p = P[k]!
    return near(p[0], p[2], PROP_ROOM).every((o) => {
      const so = solidOfBlocker(o)
      return (
        so.soft || so.kind === "building" || so.kind === "wall" || solidDistance(so, p[0], p[2]) >= PROP_ROOM
      )
    })
  }
  for (let k = 0, fixed = 0; k < P.length - 1 && fixed < (door.thorough ? 40 : 24); k++) {
    if (!brushAt(k)) continue
    let s = k
    let e = k + 1
    while (s > 0 && k - s < ROOM_RUN && !roomy(s)) s--
    while (e < P.length - 1 && e - k < ROOM_RUN && !roomy(e)) e++
    // (a stretch over a deck or a flight keeps to it: a grid knows no steps)
    // (over a deck or a flight only where `near` says where the walkways are: a way round keeps to them)
    const deck = G.slice(s, e).some((g) => !g)
    if (deck && !onWay) continue
    const a = P[s]!
    const b = P[e]!
    const first = s === 0
    const last = e === P.length - 1
    // (roomy first; where the props stand close, as much room as a body's half-width takes; out of a nook
    // its ends stand in, as near what stands there as the end is, for a step or two)
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1
    const ux = (b[0] - a[0]) / len
    const uz = (b[2] - a[2]) / len
    const y = (t: number) => a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t / len))
    /** How deep `line`'s bits brush props, summed (its walk's own ends' aside), Infinity if it is no way. */
    const brushes = (line: readonly Pt[]): number => {
      let n = 0
      for (let j = 0; j + 1 < line.length; j++) {
        const p = line[j]!
        const q = line[j + 1]!
        const ra = first && j === 0 ? (door.from ? DOOR_SLACK : PROP_OWN) : -1
        const rb = last && j + 2 === line.length ? (door.to ? DOOR_SLACK : PROP_OWN) : -1
        // (it must keep out of the walls, and on the level: never off a terrace's edge)
        if (cutBy(p, q, first && j === 0, last && j + 2 === line.length, walls))
          return Number.POSITIVE_INFINITY
        for (let f = j > 0 ? 0 : 0.25; f < 1; f += 0.25) {
          const x = p[0] + (q[0] - p[0]) * f
          const z = p[2] + (q[2] - p[2]) * f
          const under = heightOf(x, z)
          if (under === null ? deck : Math.abs(under - (p[1] + (q[1] - p[1]) * f)) > ROOM_STEP)
            return Number.POSITIVE_INFINITY
        }
        n += PROP_TIGHT - gapTo(p, q, near, ra, rb, PROP_TIGHT, false)
      }
      return n
    }
    // the first way found that brushes nothing, else the one that brushes least, if less than now
    let best = brushes(P.slice(s, e + 1))
    let way: Pt[] | null = null
    for (const [room, p, q, margin] of ROOM_TRIES(a, b)) {
      const w = gridWay(p, q, near, room, 0.1, false, margin, false, undefined, ROOM_END)
      // (no corners: no way at all, or the straight one is clear, the corners between left out)
      if (gridMissed) continue
      const found = p === a ? w : [...w].reverse()
      if (!found.length && e === s + 1) continue
      const cand = found.map(([x, z]): Pt => [x, y((x - a[0]) * ux + (z - a[2]) * uz), z])
      const n = brushes([a, ...cand, b])
      if (n >= best - 1e-3) continue
      best = n
      way = cand
      if (n < 1e-6) break
    }
    if (!way) continue
    const pts = [a, ...way, b]
    P.splice(s + 1, e - s - 1, ...way)
    // (a new bit of way is on a walkway's planks where its middle is, else on the ground)
    G.splice(
      s,
      e - s,
      ...pts.slice(0, -1).map((p, j) => {
        const q = pts[j + 1]!
        return !deck || onWay?.((p[0] + q[0]) / 2, (p[2] + q[2]) / 2) == null
      }),
    )
    k = s + way.length
    fixed++
  }
  // (what still runs through a wall, a house or a fence: the walk has no clean way, for its planner to
  // drop or take another)
  let cut = false
  for (let k = 0; k < P.length - 1 && !cut; k++) cut = wallCutAt(k)
  return cut ? { pts: P, ground: G, cut } : { pts: P, ground: G }
}

const wallsMemo = new WeakMap<object, (x: number, z: number, r: number) => readonly WalkBlocker[]>()
/** Of the blockers `near` gives, the buildings and the walls (fences, hedges) alone: one per `near`. */
function wallsOf(
  near: (x: number, z: number, r: number) => readonly WalkBlocker[],
): (x: number, z: number, r: number) => readonly WalkBlocker[] {
  let w = wallsMemo.get(near)
  if (!w) {
    w = (x, z, r) =>
      near(x, z, r).filter((o) => {
        const k = solidOfBlocker(o).kind
        return k === "building" || k === "wall"
      })
    wallsMemo.set(near, w)
  }
  return w
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
/** How far apart two nodes a shortcut joins may be at most, metres (two tiles' width and a little). */
const CROSS_REACH = 11.5
/** A shortcut is made where the walk graph's own way is this many times the straight line or more. */
const CROSS_GAIN = 1.3
/** A shortcut costs a route this many times its metres: the roads stay the way people mostly take. */
const CROSS_COST = 1.25
/** The room a shortcut keeps from a wall, a house and a prop, metres. */
const CROSS_ROOM = 0.35
/** How near its ends a shortcut may cross ground that is no open ground (a door's own plot), metres. */
const CROSS_END = 1.2

/**
 * Shortcuts over open ground (pull.ts `openTile`: a square, a court, a yard, a garden, a green, a street):
 * a node joined straight to another within CROSS_REACH where the graph's own way between them is
 * CROSS_GAIN times the straight line or more, the line on open, dry ground of the one level all the way
 * (a door's own plot by its end aside) and CROSS_ROOM clear of every wall, house and prop. Each costs a
 * route CROSS_COST its length (`HexWalkEdge.cost`). Not over a bridge or a dock (their decks are their own).
 */
function crossEdges(
  nodes: HexWalkNode[],
  edges: HexWalkEdge[],
  out: number[][],
  open: (tile: number) => boolean,
  h: HexIsland,
  near: (x: number, z: number, r: number) => readonly Solid[],
): void {
  const g = h.grid
  const usable = (n: HexWalkNode) =>
    n.kind === "road" || n.kind === "square" || n.kind === "door" || n.kind === "path"
  const tileOf = (x: number, z: number) => {
    const { q, r } = hexAt(x / HEX_TILE_SIZE, z / HEX_TILE_SIZE)
    return g.index(q, r)
  }
  // nodes in bins as wide as a shortcut's reach
  const bins = new Map<string, number[]>()
  const bin = (x: number, z: number) => `${Math.floor(x / CROSS_REACH)},${Math.floor(z / CROSS_REACH)}`
  for (const [i, n] of nodes.entries()) {
    if (!usable(n) || !out[i]!.length) continue
    const k = bin(n.x, n.z)
    const list = bins.get(k)
    if (list) list.push(i)
    else bins.set(k, [i])
  }
  /** The graph's way from `from` to every node within `max` metres of way (its own edges, before any shortcut). */
  const within = (from: number, max: number): Map<number, number> => {
    const dist = new Map<number, number>([[from, 0]])
    const queue: [number, number][] = [[0, from]]
    while (queue.length) {
      let m = 0
      for (let k = 1; k < queue.length; k++) if (queue[k]![0] < queue[m]![0]) m = k
      const [d, i] = queue.splice(m, 1)[0]!
      if (d > (dist.get(i) ?? Number.POSITIVE_INFINITY)) continue
      for (const id of out[i]!) {
        const e = edges[id]!
        const j = e.a === i ? e.b : e.a
        const nd = d + e.len
        if (nd > max || nd >= (dist.get(j) ?? Number.POSITIVE_INFINITY)) continue
        dist.set(j, nd)
        queue.push([nd, j])
      }
    }
    return dist
  }
  /** Whether the straight way a→b is open ground of a's level all along, and clear by CROSS_ROOM. */
  const clear = (a: HexWalkNode, b: HexWalkNode, len: number): boolean => {
    const level = h.level[a.tile]!
    const n = Math.ceil(len / 0.5)
    for (let s = 0; s <= n; s++) {
      const x = a.x + ((b.x - a.x) * s) / n
      const z = a.z + ((b.z - a.z) * s) / n
      const t = tileOf(x, z)
      if (t < 0 || h.level[t] !== level) return false
      const byEnd = Math.min((len * s) / n, len - (len * s) / n) < CROSS_END
      if (!open(t) && !byEnd) return false
    }
    for (const o of near((a.x + b.x) / 2, (a.z + b.z) / 2, len / 2 + CROSS_ROOM))
      if (!o.soft && segmentDistance(o, a.x, a.z, b.x, b.z) < CROSS_ROOM) return false
    return true
  }
  const made: HexWalkEdge[] = []
  for (const [i, a] of nodes.entries()) {
    if (!usable(a) || !out[i]!.length) continue
    const cx = Math.floor(a.x / CROSS_REACH)
    const cz = Math.floor(a.z / CROSS_REACH)
    let dist: Map<number, number> | null = null
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const j of bins.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (j <= i) continue
          const b = nodes[j]!
          const len = Math.hypot(b.x - a.x, b.z - a.z)
          if (len > CROSS_REACH || len < 1 || Math.abs(b.y - a.y) > 0.2) continue
          if (h.level[a.tile] !== h.level[b.tile]) continue
          dist ??= within(i, CROSS_REACH * CROSS_GAIN)
          if ((dist.get(j) ?? Number.POSITIVE_INFINITY) < len * CROSS_GAIN) continue
          if (!clear(a, b, len)) continue
          made.push({ a: i, b: j, kind: "path", len, cost: len * CROSS_COST })
        }
  }
  for (const e of made) {
    edges.push(e)
    out[e.a]!.push(edges.length - 1)
    out[e.b]!.push(edges.length - 1)
  }
}

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

  // ---- the graveyard (graveyard.ts): its front tile is walked into by its gate, from the road it faces
  // (not by the nearest road, over its fence) ----
  const yard = z.graveyard
  if (yard) {
    const road = byTile.get(g.neighbours(yard.tile)[yard.door]!)
    if (road !== undefined) join(road, centreNode(yard.tile, "path"), "path")
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
        const d = dist[i]! + (edge.cost ?? edge.len)
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
    // once here, on the fine grid, so everyone walking it walks round (ways on decks are the decks'; a
    // quay's way in from the street goes round the houses on the shore like any other)
    const near = (x: number, z: number, r: number) => hard.near(x, z, r)
    for (const e of edges) {
      const p = nodes[e.a]!
      const q = nodes[e.b]!
      if ((onDeckKind(p.kind) && onDeckKind(q.kind)) || e.kind === "bridge") continue
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
    // ---- shortcuts over open ground: across a square, a green or a yard between two streets ----
    const props = new SolidGrid(
      w.pieces.flatMap(pieceSolids).filter((s) => s.kind !== "building" && s.kind !== "wall"),
    )
    crossEdges(
      nodes,
      edges,
      out,
      (i) => openTile(h, z, i),
      h,
      (x, zz, r) => [...hard.near(x, zz, r), ...props.near(x, zz, r)],
    )
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
