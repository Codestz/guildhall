import { BRIDGE_CLEAR, clearOf, type Wall } from "./bridgeWalls.ts"
import { DMath } from "./dmath.ts"
import { searchPath } from "./laneSearch.ts"
import type { Spot } from "./layout.ts"
import type { Quay } from "./linkStub.ts"

/**
 * A ferry's sea lane (`?archipelago`): a smooth curve from one quay's berth to the other's, kept
 * clear of every other island by its reach and a margin of sea. Pure geometry, no three.
 *
 * The lane leaves each berth straight out from the pier (so a boat comes in along the pier and goes
 * out the same way), then runs between; where the straight way between would clip another island,
 * it bows round it. Sampled into a polyline with cumulative lengths for `laneAt`.
 */

/** A third island the lane must keep clear of. */
export interface Obstacle {
  center: Spot
  reach: number
}

/** Sea kept between a lane and any other island's furthest land (the ships' offing, world/archipelago.ts, and a little more). */
export const LANE_MARGIN = 30
/** A ferry's hull (the Kenney `ship-small`, scene/links/LinksLayer.tsx): half its beam, half its length. */
export const HULL_BEAM = 2.4
export const HULL_LENGTH = 4.6
/** A dock's landing stage and its fender reach this far from the pier's axis (scene/links/dockMesh.ts). */
export const STAGE_EDGE = 2.9
/** The boat lies this clear of the stage. */
const BERTH_GAP = 0.5
/** Where the boat lies: this far to the side of the pier's axis, alongside it: its hull clear of the stage. */
export const BERTH_SIDE = STAGE_EDGE + BERTH_GAP + HULL_BEAM
/** …and this far back from the pier's end, towards land. */
export const BERTH_BACK = 4
/** The lane runs straight out from a berth this far before it may turn. */
const LEAD = 16
/** A bow round an island clears it by this much more than the margin. */
const BOW_EXTRA = 14
/** Polyline spacing, world units. */
const STEP = 2.5
const MAX_BOWS = 6

export interface Lane {
  /** The lane's points, from the first quay's berth to the second's. */
  pts: readonly Spot[]
  /** Distance along the lane to each point. */
  at: readonly number[]
  length: number
  /** At each end, the unit vector from the pier out across the water to the berth: the way a boat turning there stands off. */
  away: readonly [Spot, Spot]
}

/**
 * How far from the pier's axis a hull turned `turn` radians off the pier's line must lie to clear the
 * stage: its beam when parallel (BERTH_SIDE), more as it swings, its length when it stands across.
 */
export const standOff = (turn: number): number =>
  STAGE_EDGE + BERTH_GAP + HULL_BEAM * Math.abs(DMath.cos(turn)) + HULL_LENGTH * Math.abs(DMath.sin(turn))

/** Where a boat lies at a quay: alongside the pier's end, on the quay's berth side. */
export function berthOf(quay: Quay): Spot {
  const dx = DMath.sin(quay.facing)
  const dz = DMath.cos(quay.facing)
  const side = BERTH_SIDE * quay.berthSide
  return [quay.end[0] - dx * BERTH_BACK + dz * side, quay.end[1] - dz * BERTH_BACK - dx * side]
}

/** Uniform Catmull-Rom between p1 and p2, with p0 and p3 their neighbours. */
function catmull(p0: Spot, p1: Spot, p2: Spot, p3: Spot, t: number): Spot {
  const t2 = t * t
  const t3 = t2 * t
  const at = (i: 0 | 1): number =>
    0.5 *
    (2 * p1[i] +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)
  return [at(0), at(1)]
}

/** The control points through a smooth polyline, ends continued straight on. */
function sample(control: readonly Spot[]): Spot[] {
  const first = control[0] as Spot
  const second = control[1] as Spot
  const last = control[control.length - 1] as Spot
  const before = control[control.length - 2] as Spot
  const pad: Spot[] = [
    [2 * first[0] - second[0], 2 * first[1] - second[1]],
    ...control,
    [2 * last[0] - before[0], 2 * last[1] - before[1]],
  ]
  const out: Spot[] = [first]
  for (let i = 1; i < pad.length - 2; i++) {
    const p1 = pad[i] as Spot
    const p2 = pad[i + 1] as Spot
    const steps = Math.max(2, Math.ceil(DMath.hypot(p2[0] - p1[0], p2[1] - p1[1]) / STEP))
    for (let k = 1; k <= steps; k++)
      out.push(catmull(pad[i - 1] as Spot, p1, p2, pad[i + 2] as Spot, k / steps))
  }
  return out
}

/** The nearest approach of a polyline to an obstacle: the point index and how close. */
function nearest(pts: readonly Spot[], o: Obstacle): { i: number; gap: number } {
  let best = { i: 0, gap: Number.POSITIVE_INFINITY }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Spot
    const gap = DMath.hypot(p[0] - o.center[0], p[1] - o.center[1]) - o.reach
    if (gap < best.gap) best = { i, gap }
  }
  return best
}

/**
 * The lane from `a`'s berth to `b`'s, round every obstacle that would otherwise be within
 * LANE_MARGIN of it. Deterministic. A lane never crosses a bridge (`walls`, world/bridgeWalls.ts): one
 * that would is found a way round, over the sea between the islands; see `laneClear`.
 */
export function laneOf(a: Quay, b: Quay, obstacles: readonly Obstacle[], walls: readonly Wall[] = []): Lane {
  const berthA = berthOf(a)
  const berthB = berthOf(b)
  const out = (q: Quay, berth: Spot): Spot => [
    berth[0] + DMath.sin(q.facing) * LEAD,
    berth[1] + DMath.cos(q.facing) * LEAD,
  ]
  const middle: Spot[] = []
  const control = (): Spot[] => [berthA, out(a, berthA), ...middle, out(b, berthB), berthB]
  let pts = sample(control())
  for (let bows = 0; bows < MAX_BOWS; bows++) {
    // The obstacle the lane is furthest inside of.
    let worst: { o: Obstacle; i: number; gap: number } | undefined
    for (const o of obstacles) {
      const near = nearest(pts, o)
      if (near.gap < LANE_MARGIN && (!worst || near.gap < worst.gap)) worst = { o, ...near }
    }
    if (!worst) break
    // Bow to the side the lane already passes it on, to a point clear of the margin.
    const p = pts[worst.i] as Spot
    const away: Spot = [p[0] - worst.o.center[0], p[1] - worst.o.center[1]]
    const norm = DMath.hypot(away[0], away[1]) || 1
    const clear = worst.o.reach + LANE_MARGIN + BOW_EXTRA
    const waypoint: Spot = [
      worst.o.center[0] + (away[0] / norm) * clear,
      worst.o.center[1] + (away[1] / norm) * clear,
    ]
    // Into `middle`, in order along the lane (by how far along the route it lies).
    const route = control()
    const slot = middle.findIndex((m) => along(route, m) > along(route, waypoint))
    middle.splice(slot < 0 ? middle.length : slot, 0, waypoint)
    pts = sample(control())
  }
  if (walls.length > 0 && !pointsClear(pts, walls))
    pts = aroundWalls(a, b, berthA, berthB, out, obstacles, walls) ?? pts
  const at = [0]
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1] as Spot
    const q = pts[i] as Spot
    at.push((at[i - 1] as number) + DMath.hypot(q[0] - p[0], q[1] - p[1]))
  }
  const away = (q: Quay): Spot => [DMath.cos(q.facing) * q.berthSide, -DMath.sin(q.facing) * q.berthSide]
  return { pts, at, length: at[at.length - 1] as number, away: [away(a), away(b)] }
}

const pointsClear = (pts: readonly Spot[], walls: readonly Wall[]): boolean =>
  pts.every((p) => clearOf(walls, p[0], p[1]))

/** Whether a lane keeps BRIDGE_CLEAR off every bridge, end to end. */
export const laneClear = (lane: Lane, walls: readonly Wall[]): boolean => pointsClear(lane.pts, walls)

/**
 * The way from berth to berth over the sea that keeps off every bridge and (as the bows do) the other
 * islands: found over a grid (world/laneSearch.ts), then drawn smooth if the smooth curve still clears
 * the walls, else as the straight legs it was found as. Undefined when there is no way.
 */
function aroundWalls(
  a: Quay,
  b: Quay,
  berthA: Spot,
  berthB: Spot,
  out: (q: Quay, berth: Spot) => Spot,
  obstacles: readonly Obstacle[],
  walls: readonly Wall[],
): Spot[] | undefined {
  const offA = out(a, berthA)
  const offB = out(b, berthB)
  const way = searchPath(
    offA,
    offB,
    (x, z) =>
      !clearOf(walls, x, z, BRIDGE_CLEAR + 3) ||
      obstacles.some((o) => DMath.hypot(x - o.center[0], z - o.center[1]) < o.reach + LANE_MARGIN - 4),
  )
  if (!way) return undefined
  const smooth = sample([berthA, ...way, berthB])
  if (pointsClear(smooth, walls)) return smooth
  const legs: Spot[] = [berthA, ...way, berthB]
  const dense: Spot[] = [berthA]
  for (let i = 1; i < legs.length; i++) {
    const p = legs[i - 1] as Spot
    const q = legs[i] as Spot
    const steps = Math.max(1, Math.ceil(DMath.hypot(q[0] - p[0], q[1] - p[1]) / STEP))
    for (let k = 1; k <= steps; k++)
      dense.push([p[0] + ((q[0] - p[0]) * k) / steps, p[1] + ((q[1] - p[1]) * k) / steps])
  }
  return dense
}

/** How far along the route's control polyline a point's nearest approach lies (to order bows). */
function along(route: readonly Spot[], p: Spot): number {
  let best = Number.POSITIVE_INFINITY
  let at = 0
  let run = 0
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Spot
    const b = route[i] as Spot
    const ex = b[0] - a[0]
    const ez = b[1] - a[1]
    const length = DMath.hypot(ex, ez) || 1
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (length * length)))
    const d = DMath.hypot(a[0] + ex * t - p[0], a[1] + ez * t - p[1])
    if (d < best) {
      best = d
      at = run + length * t
    }
    run += length
  }
  return at
}

export interface LanePoint {
  x: number
  z: number
  /** Direction of travel from the first quay to the second (radians, 0 = +z). */
  heading: number
}

/** The lane at distance `s` from its first berth (clamped to the lane), into `out`. */
export function laneAt(lane: Lane, s: number, out: LanePoint): LanePoint {
  const clamped = Math.max(0, Math.min(lane.length, s))
  // Binary search for the segment holding `clamped`.
  let lo = 0
  let hi = lane.at.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((lane.at[mid] as number) <= clamped) lo = mid
    else hi = mid
  }
  const a = lane.pts[lo] as Spot
  const b = lane.pts[hi] as Spot
  const span = (lane.at[hi] as number) - (lane.at[lo] as number) || 1
  const t = (clamped - (lane.at[lo] as number)) / span
  out.x = a[0] + (b[0] - a[0]) * t
  out.z = a[1] + (b[1] - a[1]) * t
  out.heading = DMath.atan2(b[0] - a[0], b[1] - a[1])
  return out
}
