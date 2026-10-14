/**
 * How a hull keeps its course (pure, no three): a route's corners rounded off (a ship turns on a
 * curve, it does not pivot at a waypoint), its heading read off the rounded route over a hull's
 * length so it turns smoothly, and its way along the route eased: it gathers way casting off, carries
 * it, and comes up to its berth or its anchor slowly, running a little past and settling back.
 */
import { clamp01, smooth01 } from "../events/ease.ts"
import { type Path, type Point, pathOf, pointAt } from "./plan.ts"

/** Metres between a rounded route's points: fine enough that its bends read as curves, not corners. */
const STEP = 0.5

/** A route resampled every `step` metres along it (a closed one round to its start). */
function resample(points: readonly Point[], closed: boolean, step: number): Point[] {
  const path = pathOf(points, closed)
  const n = Math.max(2, Math.ceil(path.length / step))
  const out: Point[] = []
  const last = closed ? n - 1 : n
  for (let i = 0; i <= last; i++) {
    const p = pointAt(path, (i / n) * path.length)
    out.push([p.x, p.z])
  }
  return out
}

/**
 * A route with its corners rounded to about `radius` metres: resampled finely, then averaged twice
 * over a window of the radius (a triangle filter), so a hull on it turns on a curve. An open route
 * keeps its ends (the window narrows toward them); a closed one stays closed.
 */
export function rounded(points: readonly Point[], closed = false, radius = 6): Point[] {
  if (points.length < 3) return points.map((p) => [p[0], p[1]] as Point)
  let pts = resample(points, closed, STEP)
  const n = pts.length
  const h = Math.max(1, Math.round(radius / STEP / 1.5))
  for (let pass = 0; pass < 2; pass++) {
    const out: Point[] = []
    for (let i = 0; i < n; i++) {
      const w = closed ? h : Math.min(h, i, n - 1 - i)
      let x = 0
      let z = 0
      for (let k = -w; k <= w; k++) {
        const p = pts[(((i + k) % n) + n) % n] as Point
        x += p[0]
        z += p[1]
      }
      out.push([x / (2 * w + 1), z / (2 * w + 1)])
    }
    pts = out
  }
  return pts
}

/** A route as a path with its corners rounded (`rounded`). */
export function roundedPath(points: readonly Point[], closed = false, radius = 6): Path {
  return pathOf(rounded(points, closed, radius), closed)
}

/**
 * The point `d` metres along a path and its heading, read over `span` metres either side: the way
 * the hull points turns smoothly through the path's bends (never a step at a vertex).
 */
export function courseAt(path: Path, d: number, span = 2): { x: number; z: number; heading: number } {
  const p = pointAt(path, d)
  let a = d - span
  let b = d + span
  if (!path.closed) {
    // at an open path's ends, read the chord from the end inward
    a = Math.max(0, Math.min(path.length - 2 * span, a))
    b = Math.min(path.length, Math.max(2 * span, b))
  }
  const pa = pointAt(path, a)
  const pb = pointAt(path, b)
  const h = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 1e-6 ? Math.atan2(pb.z - pa.z, pb.x - pa.x) : p.heading
  // past an open path's ends (a hull running on past its berth): on along the way it was going
  const past = path.closed ? 0 : d > path.length ? d - path.length : d < 0 ? d : 0
  return { x: p.x + Math.cos(h) * past, z: p.z + Math.sin(h) * past, heading: h }
}

/** ∫₀ˣ smoothstep, for x in [0, 1]. */
const rampArea = (x: number) => x * x * x - (x * x * x * x) / 2

export interface WayOpts {
  /** Seconds gathering way from rest at the start (0: it comes in already under way). */
  gather?: number
  /** Seconds losing way to rest at the end (0: it goes out under way). */
  slow?: number
  /** Metres it runs past the end and settles back over its last `settle` seconds (docking). */
  overshoot?: number
  settle?: number
}

/**
 * How far along a voyage of `length` metres and `seconds` long a hull is at `t`: it gathers way over
 * `gather` seconds (its speed a smoothstep up from rest), carries it, and loses it over `slow`
 * seconds to rest exactly at the end, running `overshoot` metres past it near the end and back.
 * Speed is continuous throughout; the voyage takes exactly `seconds`.
 */
export function wayAlong(t: number, seconds: number, length: number, o: WayOpts = {}): number {
  const T = Math.max(1e-6, seconds)
  const gather = Math.min(o.gather ?? 0, T * 0.6)
  const slow = Math.min(o.slow ?? 0, T - gather)
  const s = Math.min(T, Math.max(0, t))
  const v = length / (T - gather / 2 - slow / 2)
  let d: number
  if (s < gather) d = v * gather * rampArea(s / gather)
  else if (s <= T - slow) d = v * (gather / 2 + (s - gather))
  else {
    const x = (s - (T - slow)) / slow
    d = v * (gather / 2 + (T - slow - gather) + slow * (x - rampArea(x)))
  }
  const settle = Math.min(o.settle ?? 0, T)
  if (o.overshoot && settle > 0) {
    const w = clamp01((s - (T - settle)) / settle)
    d += o.overshoot * 16 * w * w * (1 - w) * (1 - w)
  }
  return d
}

/** A pace through time warped by `pace` (1 the mean): a rowboat's strokes surge it on and let it run. */
export function strokes(u: number, n: number, surge = 0.55): number {
  const x = clamp01(u)
  return x + (surge / (2 * Math.PI * n)) * Math.sin(2 * Math.PI * n * x)
}

/**
 * A lap whose pace varies along it (a sailing ship slower into the wind, quicker off it): a table of
 * the time to reach each point, so the distance at any time is a lookup. One lap takes `seconds`.
 */
export interface PacedLap {
  path: Path
  seconds: number
  /** Distance and time at each step, the time scaled so the lap is `seconds` exactly. */
  at: Float64Array
  time: Float64Array
}

export function pacedLap(path: Path, seconds: number, pace: (heading: number) => number, step = 2): PacedLap {
  const n = Math.max(2, Math.ceil(path.length / step))
  const at = new Float64Array(n + 1)
  const time = new Float64Array(n + 1)
  for (let i = 1; i <= n; i++) {
    const d0 = ((i - 1) / n) * path.length
    const d1 = (i / n) * path.length
    const h = courseAt(path, (d0 + d1) / 2, 4).heading
    at[i] = d1
    time[i] = (time[i - 1] as number) + (d1 - d0) / Math.max(0.2, pace(h))
  }
  const total = time[n] as number
  for (let i = 0; i <= n; i++) time[i] = ((time[i] as number) / total) * seconds
  return { path, seconds, at, time }
}

/** The distance round a paced lap at `s` seconds into it (any `s`: laps repeat). */
export function pacedAt(lap: PacedLap, s: number): number {
  const laps = Math.floor(s / lap.seconds)
  const r = s - laps * lap.seconds
  const { time, at } = lap
  let lo = 0
  let hi = time.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((time[mid] as number) <= r) lo = mid
    else hi = mid
  }
  const t0 = time[lo] as number
  const t1 = time[hi] as number
  const f = t1 > t0 ? (r - t0) / (t1 - t0) : 0
  return laps * lap.path.length + (at[lo] as number) + ((at[hi] as number) - (at[lo] as number)) * f
}

/** A turn from heading `a` to `b` the short way, along a smoothstep of `u`. */
export function swing(a: number, b: number, u: number): number {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * smooth01(u)
}

/** A cubic Bézier sampled into a route (a hull swinging from one heading to another on a curve). */
export function bezier(p0: Point, p1: Point, p2: Point, p3: Point, n = 256): Point[] {
  const out: Point[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = (1 - t) ** 3
    const b = 3 * (1 - t) ** 2 * t
    const c = 3 * (1 - t) * t * t
    const d = t ** 3
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]])
  }
  return out
}
