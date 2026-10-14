/**
 * The dragon's flight as a pure function of time (no three): an uneven route round the peaks (a
 * closed spline through jittered waypoints), flown in acts. An act is a burst of three to five strong
 * wing beats, climbing, then a long glide on still wings held a little up, sinking; some acts end in a
 * swoop: the wings rise, it dives on the peaks, breathes fire at the bottom of the dive and beats
 * hard to climb away. Faster sinking, slower climbing. It comes in gliding down from the horizon onto
 * the route and leaves beating up and away into the haze, both on curves that meet the route with
 * its own speed and heading, so nothing ever jumps.
 *
 * Every value is a lookup in tables built once per show from its seed, so play, seek and a held
 * frame all show the same dragon.
 */

/** Seconds a wing beat takes (a downstroke and the recovery). */
export const BEAT_S = 0.6
/** The wing's angle about the shoulder, radians (+ up): gliding, diving, breathing, and a beat's reach. */
const GLIDE_WING = 0.14
const DIVE_WING = 0.34
const BREATH_WING = 0.05
const BEAT_MID = 0.1
const BEAT_REACH = 0.62
/** Metres a second climbing on a burst, sinking on a glide, diving, breathing, climbing hard. */
const CLIMB = { flap: 2.1, glide: -1.1, dive: -5.2, breath: -0.8, climb: 3.6 } as const
/** Cruising speed over the ground, metres a second; diving it goes faster, climbing slower. */
const CRUISE = 13
/**
 * The route's altitude band round its centre, metres (the swoop's bottom … the top of a climb): the
 * centre is 27 m over the peaks (dragon.ts), so a swoop comes down to about 10 m over the rock and its
 * fire licks it, then climbs back to over 30 m.
 */
const LOW = -17
const HIGH = 6
const DT = 1 / 120

type Mode = "flap" | "glide" | "dive" | "breath" | "climb"

/** A seeded uniform stream (mulberry32). */
function stream(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The acts of one cycle of flight, each segment a whole number of beats long. */
function schedule(rand: () => number): { mode: Mode; beats: number }[] {
  const out: { mode: Mode; beats: number }[] = []
  const act = (swoop: boolean) => {
    out.push({ mode: "flap", beats: 3 + Math.floor(rand() * 3) })
    out.push({ mode: "glide", beats: Math.round((2.6 + rand() * 1.8) / BEAT_S) })
    if (swoop) {
      out.push({ mode: "dive", beats: 3 })
      out.push({ mode: "breath", beats: 3 })
      out.push({ mode: "climb", beats: 4 + Math.floor(rand() * 2) })
      out.push({ mode: "glide", beats: Math.round((1.6 + rand() * 1.2) / BEAT_S) })
    }
  }
  act(true)
  act(false)
  act(true)
  act(rand() < 0.5)
  return out
}

/** A periodic table smoothed by a box of `half` samples either side, twice (a triangle filter). */
function smoothed(a: Float64Array, half: number): Float64Array {
  let src = a
  const n = a.length
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(n)
    let sum = 0
    for (let k = -half; k <= half; k++) sum += src[((k % n) + n) % n] as number
    for (let i = 0; i < n; i++) {
      out[i] = sum / (2 * half + 1)
      sum += (src[(i + half + 1) % n] as number) - (src[(((i - half) % n) + n) % n] as number)
    }
    src = out
  }
  return src
}

export interface FlightPlan {
  /** Seconds one cycle of acts takes (it repeats). */
  cycle: number
  /** The route's centre (x, y, z) and its length, metres. */
  centre: readonly [number, number, number]
  length: number
  /** Seconds on the route (from its first act) → its state. */
  at(tau: number): FlightState
  /** The route's point `d` metres round it (x, z). */
  route(d: number): [number, number]
}

export interface FlightState {
  /** Height over the route's centre, metres. */
  alt: number
  /** Metres round the route. */
  dist: number
  /** How much it is beating, 0 (still wings) … 1 (full beats). */
  beating: number
  /** The beat's clock, in beats (its fraction is where in the stroke the wings are). */
  beat: number
  /** The wings' angle when still (gliding, diving, breathing), radians. */
  still: number
  /** The fire, 0 … 1. */
  breath: number
  /** How hard it beats (a hard climb beats deeper), 1 … 1.3. */
  strength: number
}

/**
 * The flight round `centre` (the peaks' top plus the orbit's height) at about `radius` metres, from
 * `seed`: the route's waypoints, the acts and their tables.
 */
export function flightPlan(
  seed: number,
  centre: readonly [number, number, number],
  radius: number,
): FlightPlan {
  const rand = stream(seed)
  // the route: seven waypoints round the peaks, each a little off the circle, joined by a closed spline
  const N = 7
  const way: [number, number][] = []
  for (let i = 0; i < N; i++) {
    const a = ((i + (rand() - 0.5) * 0.5) / N) * Math.PI * 2
    const r = radius * (0.8 + rand() * 0.4)
    way.push([centre[0] + Math.cos(a) * r, centre[2] + Math.sin(a) * r])
  }
  const pts: [number, number][] = []
  const per = 64
  for (let i = 0; i < N; i++) {
    const p0 = way[(i - 1 + N) % N] as [number, number]
    const p1 = way[i] as [number, number]
    const p2 = way[(i + 1) % N] as [number, number]
    const p3 = way[(i + 2) % N] as [number, number]
    for (let k = 0; k < per; k++) {
      const t = k / per
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  pts.push(pts[0] as [number, number])
  const lens = new Float64Array(pts.length)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as [number, number]
    const b = pts[i] as [number, number]
    lens[i] = (lens[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  const length = lens[lens.length - 1] as number
  const route = (d: number): [number, number] => {
    const s = ((d % length) + length) % length
    let lo = 0
    let hi = lens.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if ((lens[mid] as number) <= s) lo = mid
      else hi = mid
    }
    const a = pts[lo] as [number, number]
    const b = pts[hi] as [number, number]
    const u = (s - (lens[lo] as number)) / ((lens[hi] as number) - (lens[lo] as number) || 1)
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
  }

  // the acts, laid out on the beat's clock
  const segs = schedule(rand)
  const beats = segs.reduce((n, s) => n + s.beats, 0)
  const cycle = beats * BEAT_S
  const n = Math.round(cycle / DT)
  const climb = new Float64Array(n)
  const beating = new Float64Array(n)
  const still = new Float64Array(n)
  const breath = new Float64Array(n)
  const strength = new Float64Array(n)
  let i = 0
  let lastStill = GLIDE_WING
  for (const seg of segs) {
    const m = Math.round((seg.beats * BEAT_S) / DT)
    const pose =
      seg.mode === "dive"
        ? DIVE_WING
        : seg.mode === "breath"
          ? BREATH_WING
          : seg.mode === "glide"
            ? GLIDE_WING
            : lastStill
    if (seg.mode !== "flap" && seg.mode !== "climb") lastStill = pose
    for (let k = 0; k < m && i < n; k++, i++) {
      climb[i] = CLIMB[seg.mode]
      beating[i] = seg.mode === "flap" || seg.mode === "climb" ? 1 : 0
      still[i] = seg.mode === "flap" || seg.mode === "climb" ? GLIDE_WING : pose
      breath[i] = seg.mode === "breath" ? 1 : 0
      strength[i] = seg.mode === "climb" ? 1.3 : 1
    }
  }
  const c = smoothed(climb, Math.round(0.45 / DT))
  const env = smoothed(beating, Math.round(0.12 / DT))
  const wing = smoothed(still, Math.round(0.25 / DT))
  const fire = smoothed(breath, Math.round(0.12 / DT))
  const hard = smoothed(strength, Math.round(0.3 / DT))
  // height: the climbs and sinks summed, the cycle's drift taken out, fitted to the band
  const alt = new Float64Array(n + 1)
  for (let k = 1; k <= n; k++) alt[k] = (alt[k - 1] as number) + (c[k - 1] as number) * DT
  const drift = (alt[n] as number) / n
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let k = 0; k <= n; k++) {
    alt[k] = (alt[k] as number) - drift * k
    lo = Math.min(lo, alt[k] as number)
    hi = Math.max(hi, alt[k] as number)
  }
  const fit = (HIGH - LOW) / Math.max(1e-6, hi - lo)
  for (let k = 0; k <= n; k++) alt[k] = LOW + ((alt[k] as number) - lo) * fit
  // way over the ground: quicker sinking, slower climbing (with the height fitted, as it is flown)
  const dist = new Float64Array(n + 1)
  for (let k = 1; k <= n; k++) {
    const rate = ((alt[k] as number) - (alt[k - 1] as number)) / DT
    dist[k] = (dist[k - 1] as number) + CRUISE * Math.min(1.35, Math.max(0.75, 1 - 0.07 * rate)) * DT
  }
  const lap = dist[n] as number

  const lerpAt = (a: Float64Array, f: number, wrap: boolean) => {
    const k = Math.floor(f)
    const u = f - k
    const len = wrap ? a.length : a.length - 1
    const x = a[((k % len) + len) % len] as number
    const y = a[(((k + 1) % len) + len) % len] as number
    return x + (y - x) * u
  }
  return {
    cycle,
    centre,
    length,
    route,
    at(tau) {
      const laps = Math.floor(tau / cycle)
      const r = tau - laps * cycle
      const f = r / DT
      const k = Math.min(n - 1, Math.floor(f))
      const u = f - k
      const between = (a: Float64Array) => (a[k] as number) + ((a[k + 1] as number) - (a[k] as number)) * u
      return {
        alt: between(alt),
        dist: laps * lap + between(dist),
        beating: lerpAt(env, f, true),
        beat: tau / BEAT_S,
        still: lerpAt(wing, f, true),
        breath: lerpAt(fire, f, true),
        strength: lerpAt(hard, f, true),
      }
    },
  }
}

/**
 * The wing's angle at a beat's clock `beat`: a quick, strong downstroke (two fifths of the beat) from
 * high to low and a slower recovery; `strength` deepens it.
 */
export function beatAngle(beat: number, strength = 1): number {
  const f = beat - Math.floor(beat)
  const w = f < 0.4 ? (0.5 * f) / 0.4 : 0.5 + (0.5 * (f - 0.4)) / 0.6
  return BEAT_MID + BEAT_REACH * strength * Math.cos(2 * Math.PI * w)
}

/** The wings at `s` (a flight state): beating as much as it beats, else held as it holds them. */
export function wingAngle(s: FlightState, beat = s.beat): number {
  return s.still + (beatAngle(beat, s.strength) - s.still) * s.beating
}

/** A cubic Hermite from (p0, v0) to (p1, v1) over `T` seconds, at `u` (0 … 1). */
export function hermite(
  p0: readonly number[],
  v0: readonly number[],
  p1: readonly number[],
  v1: readonly number[],
  T: number,
  u: number,
): [number, number, number] {
  const u2 = u * u
  const u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1
  const h10 = u3 - 2 * u2 + u
  const h01 = -2 * u3 + 3 * u2
  const h11 = u3 - u2
  const out: [number, number, number] = [0, 0, 0]
  for (let k = 0; k < 3; k++)
    out[k] =
      h00 * (p0[k] as number) +
      h10 * T * (v0[k] as number) +
      h01 * (p1[k] as number) +
      h11 * T * (v1[k] as number)
  return out
}
