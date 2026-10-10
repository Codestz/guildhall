import { hash } from "./gen/hex.ts"
import { type Lane, type LanePoint, laneAt } from "./lanes.ts"

/**
 * A ferry's timetable: one boat on one lane, a pure function of story time (like scene/seas/fleet.ts:
 * a seek, a paused probe shot and a replay show the same sea). It lies at the first quay (A), sails
 * to the second (B), lies there, and sails back; round and round.
 *
 *   dwell at A → sail A→B → dwell at B → sail B→A
 *
 * Alongside the pier the boat arrives bow to land and, in the second half of its dwell, swings
 * round to face the lane again (so it never backs out).
 */

/** Seconds a ferry lies at a quay. */
export const DWELL_S = 16
/** World units a second under sail. */
export const SPEED = 5
/** Share of a dwell, from its start, the boat lies still before it swings round. */
const SWING_FROM = 0.45
/** …and the share by which the swing is done. */
const SWING_TO = 0.9
/** The boat eases in and out over this much of the lane's ends, as it casts off and comes alongside (world units). */
const EASE_DIST = 14

export type End = "a" | "b"

export interface Timetable {
  lane: Lane
  /** Seconds one sailing takes. */
  sail: number
  /** Seconds for the whole round: two dwells and two sailings. */
  period: number
  /** Seconds the cycle is shifted by, so ferries don't sail in step. */
  offset: number
}

export interface FerryState extends LanePoint {
  /** The quay it lies at, or undefined under sail. */
  moored: End | undefined
  /** Distance along the lane from A. */
  s: number
  /** 0 lying at a quay, 1 at cruising speed. */
  speed: number
}

/** The timetable of the ferry on `lane`; `id` (the link's name) spreads the ferries out in time. */
export function timetableOf(lane: Lane, id: string): Timetable {
  const sail = (lane.length + 2 * rampOf(lane.length)) / SPEED
  const period = 2 * (DWELL_S + sail)
  return { lane, sail, period, offset: (hash(id) % 1000) * 0.001 * period }
}

const ease = (u: number): number => u * u * (3 - 2 * u)

/** Where the ferry is at story time `t` (seconds), into `out`. */
export function ferryAt(table: Timetable, t: number, out: FerryState): FerryState {
  const { lane, sail, period } = table
  const local = (((t + table.offset) % period) + period) % period
  const half = DWELL_S + sail
  const leg = local < half ? 0 : 1
  const u = local - leg * half
  // Direction of this half: A→B, then B→A.
  const forward = leg === 0
  if (u < DWELL_S) {
    const dock = forward ? 0 : lane.length
    laneAt(lane, dock, out)
    // At A the boat arrived heading inward (against the lane); at B, along it.
    const arrived = forward ? out.heading + Math.PI : out.heading
    const swing = ease(Math.max(0, Math.min(1, (u / DWELL_S - SWING_FROM) / (SWING_TO - SWING_FROM))))
    out.heading = arrived + Math.PI * swing
    out.moored = forward ? "a" : "b"
    out.s = dock
    out.speed = 0
    return out
  }
  const run = Math.min(1, (u - DWELL_S) / sail)
  // Eased in and out over the last EASE_DIST of each end, so it comes alongside gently.
  const { s, v } = easedAlong(run, lane.length)
  const along = forward ? s : lane.length - s
  laneAt(lane, along, out)
  if (!forward) out.heading += Math.PI
  out.moored = undefined
  out.s = along
  out.speed = v
  return out
}

/** The ramp, as distance at cruise speed, at each end of a sailing: the boat starts from and comes to rest. */
const rampOf = (length: number): number => Math.min(EASE_DIST, length / 3)

/**
 * Distance covered after `run` (0…1) of a sailing, and the speed it has then (0…1 of cruise):
 * speeding up from rest over the first ramp, even in the middle, slowing to rest over the last (in
 * cruise units a ramp of distance R takes 2R).
 */
function easedAlong(run: number, length: number): { s: number; v: number } {
  const r = rampOf(length)
  const total = length + 2 * r
  const clock = run * total
  if (clock < 2 * r) return { s: (clock * clock) / (4 * r), v: clock / (2 * r) }
  if (clock < total - 2 * r) return { s: r + (clock - 2 * r), v: 1 }
  const left = total - clock
  return { s: length - (left * left) / (4 * r), v: left / (2 * r) }
}

/** The next time at or after `t` that the ferry leaves quay `from`. */
export function nextDeparture(table: Timetable, from: End, t: number): number {
  // Departures from A are at offset-relative cycle time DWELL_S; from B at DWELL_S + half.
  const at = DWELL_S + (from === "a" ? 0 : DWELL_S + table.sail)
  const cycle = Math.floor((t + table.offset - at) / table.period)
  const departure = (n: number): number => n * table.period + at - table.offset
  const next = departure(cycle)
  return next >= t ? next : departure(cycle + 1)
}
