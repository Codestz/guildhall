/**
 * The sea's life as pure functions of time (world events, Task D; V1's scene/Ships.tsx, seas/ and
 * events/GhostShip, Raid): where each hull is, which way it points and how much of it is seen, from the
 * sea's routes (sites.ts) and when things happened. No three: the layer (life.ts) only draws what these
 * say, so a seek, a paused shot and a replay all show the same water.
 *
 *   merchants   two ships on slow laps round the island (300 s and 260 s, the other way round)
 *   push        a cargo ship, crates on deck, casts off from the quay and sails out (16 s)
 *   release     a galleon sails in (11 s), anchors broadside between the laps for 120 s, sparks once as
 *               it drops anchor, then sails off (14 s)
 *   ghostship   a show: the ghost ship glides along the inner lap past a coast (36 s), fading in and out
 *   raid        a show: a pirate ship sails in along the quay's lane (20 s), anchors broadside off the
 *               quay, its rowboat pulling for the pier and back again and again; at the show's end it
 *               weighs anchor and sails off (18 s)
 *   lighthouse  the newest CI run: warm and steady (passed), a slow red pulse (failed), a spinning
 *               amber beam (queued, running), dark before any run
 *
 * Headings are radians from +x toward +z (as the harbour's ships, events/ships.ts); times are ms on the
 * sea's clock unless named `_S`.
 */
import type { CiState } from "@guildhall/core"
import type { SeaRing } from "@guildhall/world"
import { clamp01, easeIn, easeOut, smooth01 } from "../events/ease.ts"
import type { Mooring } from "./sites.ts"

export const SEA = {
  /** The merchants' laps, seconds a lap (inner, outer). */
  LAP_S: [300, 260] as const,
  /** A push's cargo ship, from casting off to over the horizon. */
  CARGO_S: 16,
  /** Cargo ships set out at least this far apart (they share the quay's lane). */
  CARGO_GAP_S: 5,
  /** Crates a cargo ship carries at most (one a commit). */
  CRATES: 6,
  GALLEON_IN_S: 11,
  GALLEON_STAY_S: 120,
  GALLEON_OUT_S: 14,
  /** The galleon's sparks as it drops anchor: three bursts over this long. */
  SPARKS_S: 3.6,
  GHOST_S: 36,
  /** The ghost's drift, metres a second (along the outer lap). */
  GHOST_SPEED: 2.8,
  RAID_IN_S: 20,
  RAID_OUT_S: 18,
  /** The raid's rowboat: a pull between ship and pier, and the wait at either end. */
  ROW_S: 13,
  ROW_WAIT_S: 5,
  /** Where the raid anchors: this far along the quay's lane from the pier, metres. */
  RAID_OFF: 24,
} as const

export type Hull = "merchant-large" | "merchant-medium" | "cargo" | "galleon" | "pirate" | "rowboat" | "ghost"

export interface ShipPose {
  hull: Hull
  key: string
  x: number
  z: number
  heading: number
  /** Seen, 0 … 1 (fades in from the open sea and out to it). */
  seen: number
  /** Under way (1) or at anchor (0): the swell's lean follows it. */
  way: number
  /** A cargo ship's crates. */
  crates: number
}

export type Point = [number, number]

// ── polylines ──

export interface Path {
  points: Point[]
  /** Distance from the first point to each, metres. */
  at: number[]
  length: number
  closed: boolean
}

export function pathOf(points: readonly Point[], closed = false): Path {
  const pts = points.map((p) => [p[0], p[1]] as Point)
  if (closed && pts.length) pts.push([(pts[0] as Point)[0], (pts[0] as Point)[1]])
  const at = [0]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point
    const b = pts[i] as Point
    at.push((at[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  return { points: pts, at, length: at[at.length - 1] ?? 0, closed }
}

/** The point `d` metres along a path (wrapping round a closed one), and the way it runs there. */
export function pointAt(path: Path, d: number): { x: number; z: number; heading: number } {
  const n = path.points.length
  if (n === 0) return { x: 0, z: 0, heading: 0 }
  if (n === 1 || path.length === 0)
    return { x: (path.points[0] as Point)[0], z: (path.points[0] as Point)[1], heading: 0 }
  let s = path.closed
    ? ((d % path.length) + path.length) % path.length
    : Math.min(path.length, Math.max(0, d))
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((path.at[mid] as number) <= s) lo = mid
    else hi = mid
  }
  const a = path.points[lo] as Point
  const b = path.points[hi] as Point
  const span = (path.at[hi] as number) - (path.at[lo] as number) || 1
  s = (s - (path.at[lo] as number)) / span
  return {
    x: a[0] + (b[0] - a[0]) * s,
    z: a[1] + (b[1] - a[1]) * s,
    heading: Math.atan2(b[1] - a[1], b[0] - a[0]),
  }
}

/** Turns from `a` to `b` the short way round, `t` of the way. */
export function turn(a: number, b: number, t: number): number {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t
}

// ── the merchants ──

/** The two merchants at wall time `s` (seconds): the large one round the inner lap, the medium one the other way round the outer. */
export function merchants(laps: readonly Path[], s: number): ShipPose[] {
  const out: ShipPose[] = []
  const hulls: Hull[] = ["merchant-large", "merchant-medium"]
  laps.slice(0, 2).forEach((lap, k) => {
    const dir = k === 0 ? 1 : -1
    const f = (k === 0 ? 0.1 : 0.6) + (dir * s) / (SEA.LAP_S[k] as number)
    const p = pointAt(lap, f * lap.length)
    out.push({
      hull: hulls[k] as Hull,
      key: `merchant-${k}`,
      x: p.x,
      z: p.z,
      heading: dir > 0 ? p.heading : p.heading + Math.PI,
      seen: 1,
      way: 1,
      crates: 0,
    })
  })
  return out
}

// ── pushes: cargo ships ──

export interface Push {
  key: string
  at: number
  commits: number
}

/** When each push's cargo ship sets out: at its push, at least `CARGO_GAP_S` after the one before. */
export function cargoStarts(pushes: readonly Push[]): { push: Push; start: number }[] {
  const sorted = [...pushes].sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1))
  let last = Number.NEGATIVE_INFINITY
  return sorted.map((push) => {
    const start = Math.max(push.at, last + SEA.CARGO_GAP_S * 1000)
    last = start
    return { push, start }
  })
}

/** A cargo ship `age` seconds after it cast off: easing off the quay, then out along the lane, fading at the end. */
export function cargoPose(lane: Path, key: string, crates: number, age: number): ShipPose | null {
  if (age < 0 || age >= SEA.CARGO_S) return null
  const u = age / SEA.CARGO_S
  const p = pointAt(lane, easeIn(u) * lane.length)
  return {
    hull: "cargo",
    key,
    ...p,
    seen: smooth01(u / 0.06) * (1 - smooth01((u - 0.72) / 0.28)),
    way: smooth01(u / 0.2),
    crates: Math.max(1, Math.min(SEA.CRATES, crates)),
  }
}

// ── releases: the galleon ──

/** Where the galleon anchors: between the laps, a little along from the quay's bearing; broadside (along the laps). */
export function anchorage(
  laps: readonly SeaRing[],
  bearing: number,
): { x: number; z: number; heading: number; out: number } {
  const ring = (k: number) => laps[Math.min(k, laps.length - 1)] as SeaRing
  const [cx, cz] = ring(0).centre
  const b = bearing + 0.22
  const r = (radiusAt(ring(0), b) + radiusAt(ring(1), b)) / 2
  return { x: cx + Math.cos(b) * r, z: cz + Math.sin(b) * r, heading: b + Math.PI / 2, out: b }
}

function radiusAt(ring: SeaRing, bearing: number): number {
  const N = ring.points.length
  const f = ((((bearing / (Math.PI * 2)) * N) % N) + N) % N
  const k = Math.floor(f)
  const [cx, cz] = ring.centre
  const a = ring.points[k] as Point
  const b = ring.points[(k + 1) % N] as Point
  const ra = Math.hypot(a[0] - cx, a[1] - cz)
  const rb = Math.hypot(b[0] - cx, b[1] - cz)
  return ra + (rb - ra) * (f - k)
}

/** How far out the galleon comes from and goes to, metres past its anchorage. */
const OFFING = 140

/** The galleon `age` seconds after its release (null before and after its visit), and its sparks' progress (0 … 1, else null). */
export function galleonPose(
  anchor: ReturnType<typeof anchorage>,
  key: string,
  age: number,
): { pose: ShipPose; sparks: number | null } | null {
  const { GALLEON_IN_S: IN, GALLEON_STAY_S: STAY, GALLEON_OUT_S: OUT } = SEA
  if (age < 0 || age >= IN + STAY + OUT) return null
  const ox = Math.cos(anchor.out)
  const oz = Math.sin(anchor.out)
  const base = { hull: "galleon" as const, key, crates: 0 }
  if (age < IN) {
    // in from the offing, easing to a stop, swinging broadside for the last stretch
    const u = age / IN
    const d = OFFING * (1 - easeOut(u))
    const inward = anchor.out + Math.PI
    return {
      pose: {
        ...base,
        x: anchor.x + ox * d,
        z: anchor.z + oz * d,
        heading: turn(inward, anchor.heading, smooth01((u - 0.55) / 0.45)),
        seen: smooth01(u / 0.15),
        way: 1 - smooth01((u - 0.8) / 0.2),
      },
      sparks: null,
    }
  }
  if (age < IN + STAY) {
    const s = age - IN
    return {
      pose: { ...base, x: anchor.x, z: anchor.z, heading: anchor.heading, seen: 1, way: 0 },
      sparks: s < SEA.SPARKS_S ? s / SEA.SPARKS_S : null,
    }
  }
  // away: turning for the open sea, out and over the horizon
  const u = (age - IN - STAY) / OUT
  const d = OFFING * easeIn(u)
  return {
    pose: {
      ...base,
      x: anchor.x + ox * d,
      z: anchor.z + oz * d,
      heading: turn(anchor.heading, anchor.out, smooth01(u / 0.3)),
      seen: 1 - smooth01((u - 0.7) / 0.3),
      way: smooth01(u / 0.2),
    },
    sparks: null,
  }
}

// ── shows: the ghost ship and the raid ──

/** A world event's show (Task A's `Show`): the sea draws `ghostship` and `raid`, and lets the rest be. */
export interface SeaShow {
  kind: string
  /** When it starts and ends, ms on the sea's clock; no end (or Infinity) while it lasts. */
  start: number
  end?: number
  /** `near`: [x, z], the coast the ghost ship passes (the graveyard's); `key`, when shows repeat. */
  params?: { near?: readonly [number, number]; key?: string } & Record<string, unknown>
}

/** The ghost ship `age` seconds into its show (`left`: seconds after an early end, else null): along `lap` past `bearing`. */
export function ghostPose(
  lap: Path,
  centre: Point,
  bearing: number,
  age: number,
  left: number | null,
): ShipPose | null {
  const total = SEA.GHOST_S
  if (age < 0 || age >= total || (left !== null && left >= 6)) return null
  // the lap's point nearest the bearing, and a drift along it centred there
  const mid = nearestAlong(lap, centre[0] + Math.cos(bearing) * 1e4, centre[1] + Math.sin(bearing) * 1e4)
  const span = SEA.GHOST_SPEED * total
  const p = pointAt(lap, mid - span / 2 + SEA.GHOST_SPEED * age)
  const fade =
    smooth01(age / 5) * (1 - smooth01((age - (total - 6)) / 6)) * (left === null ? 1 : 1 - smooth01(left / 6))
  return { hull: "ghost", key: "ghost", ...p, seen: fade, way: 1, crates: 0 }
}

/** Distance along a path to its point nearest (x, z) (toward it from the centre: the far point of a ray). */
function nearestAlong(path: Path, x: number, z: number): number {
  let best = 0
  let bd = Number.POSITIVE_INFINITY
  for (let i = 0; i < path.points.length; i++) {
    const p = path.points[i] as Point
    const d = Math.hypot(p[0] - x, p[1] - z)
    if (d < bd) {
      bd = d
      best = path.at[i] as number
    }
  }
  return best
}

export interface RaidPoses {
  ship: ShipPose | null
  boat: ShipPose | null
}

/**
 * The raid `age` seconds in (`left`: seconds since its show ended, else null). The pirate ship sails in
 * along the quay's lane (`lane`, from the pier's water out to sea) to its anchorage `RAID_OFF` metres out,
 * swinging broadside; the rowboat pulls along the lane between it and the pier and back while it lies
 * there; told to go, the boat is taken up and the ship sails off the way it came.
 */
export function raidPose(lane: Path, age: number, left: number | null): RaidPoses {
  const anchorAt = Math.min(SEA.RAID_OFF, lane.length * 0.4)
  const anchor = pointAt(lane, anchorAt)
  const broadside = anchor.heading + Math.PI / 2
  const base = { key: "raid", crates: 0 }
  if (age < 0) return { ship: null, boat: null }
  if (left !== null) {
    if (left >= SEA.RAID_OUT_S) return { ship: null, boat: null }
    const u = left / SEA.RAID_OUT_S
    const p = pointAt(lane, anchorAt + easeIn(u) * (lane.length - anchorAt))
    // the ship may be told to go before it arrived: it leaves from where it got to
    const from = Math.min(1, age / SEA.RAID_IN_S)
    return {
      ship: {
        ...base,
        hull: "pirate",
        ...p,
        heading: turn(from < 1 ? anchor.heading + Math.PI : broadside, p.heading, smooth01(u / 0.3)),
        seen: (1 - smooth01((u - 0.65) / 0.35)) * smooth01(from / 0.15),
        way: smooth01(u / 0.2),
      },
      boat: null,
    }
  }
  if (age < SEA.RAID_IN_S) {
    const u = age / SEA.RAID_IN_S
    const p = pointAt(lane, lane.length - easeOut(u) * (lane.length - anchorAt))
    return {
      ship: {
        ...base,
        hull: "pirate",
        ...p,
        heading: turn(p.heading + Math.PI, broadside, smooth01((u - 0.65) / 0.35)),
        seen: smooth01(u / 0.15),
        way: 1 - smooth01((u - 0.8) / 0.2),
      },
      boat: null,
    }
  }
  const ship: ShipPose = { ...base, hull: "pirate", ...anchor, heading: broadside, seen: 1, way: 0 }
  // the rowboat: from the ship's landward side to the pier, wait, back, wait
  const s = age - SEA.RAID_IN_S - 2
  if (s < 0) return { ship, boat: null }
  const cycle = 2 * (SEA.ROW_S + SEA.ROW_WAIT_S)
  const c = s % cycle
  const { ROW_S: ROW, ROW_WAIT_S: WAIT } = SEA
  let k: number
  let back = false
  if (c < WAIT) k = 0
  else if (c < WAIT + ROW) k = smooth01((c - WAIT) / ROW)
  else if (c < 2 * WAIT + ROW) k = 1
  else {
    k = 1 - smooth01((c - 2 * WAIT - ROW) / ROW)
    back = true
  }
  const from = anchorAt - 3.5
  const p = pointAt(lane, from * (1 - k))
  const boat: ShipPose = {
    ...base,
    key: "raid-boat",
    hull: "rowboat",
    ...p,
    // toward the pier (down the lane) going in, out to the ship coming back
    heading: back ? p.heading : p.heading + Math.PI,
    seen: s < 1 ? s : 1,
    way: k > 0 && k < 1 ? 1 : 0,
  }
  return { ship, boat }
}

// ── the quay's rowboat ──

/** The rowboat tied up by the pier: alongside it, bobbing. */
export function mooredBoat(mooring: Mooring): ShipPose {
  const [px, pz] = mooring.pier
  const [x, z] = mooring.at
  return {
    hull: "rowboat",
    key: "quay-boat",
    x,
    z,
    heading: Math.atan2(z - pz, x - px) + Math.PI / 2,
    seen: 1,
    way: 0,
    crates: 0,
  }
}

// ── the lighthouse ──

export interface Lamp {
  /** Linear RGB. */
  colour: [number, number, number]
  /** How lit, 0 … 1 (0: dark, no beam). */
  glow: number
  /** The beam's bearing (radians from +x toward +z); null: a steady beam out to sea. */
  beam: number | null
}

/** The lamp for the newest CI run (`state`, since `since`) at `now` (ms). */
export function lampOf(state: CiState | null, since: number, now: number): Lamp {
  const s = (now - since) / 1000
  switch (state) {
    case "passed":
      return { colour: [1, 0.72, 0.4], glow: 1, beam: null }
    case "failed":
      // a slow red pulse, about 2.5 s a beat, never quite out
      return {
        colour: [1, 0.08, 0.04],
        glow: 0.3 + 0.7 * (0.5 + 0.5 * Math.cos((s * Math.PI * 2) / 2.5)),
        beam: null,
      }
    case "queued":
    case "running":
      return { colour: [1, 0.45, 0.04], glow: 0.9, beam: s * 1.6 }
    default:
      return { colour: [0, 0, 0], glow: 0, beam: null }
  }
}

// ── pull requests' hulls by their diff (for F1's ships to adopt) ──

export interface PrHull {
  /** The library piece. */
  piece: string
  /** Metres per model unit. */
  scale: number
}

/**
 * A pull request's ship by the size of its diff (lines added and removed): a sloop for a small change,
 * the medium ship for a feature, the large one for a big change, each growing a little within its band
 * (the log of the lines). F1's harbour ships draw the small ship today; this is the mapping they adopt.
 */
export function prHull(lines: number): PrHull {
  const n = Math.max(1, Number.isFinite(lines) ? lines : 1)
  const band = (lo: number, hi: number) => clamp01(Math.log(n / lo) / Math.log(hi / lo))
  if (n < 80) return { piece: "kenney-pirate/ship-small", scale: 0.34 + 0.06 * band(1, 80) }
  if (n < 600) return { piece: "kenney-pirate/ship-medium", scale: 0.36 + 0.05 * band(80, 600) }
  return { piece: "kenney-pirate/ship-large", scale: 0.38 + 0.06 * band(600, 6000) }
}
