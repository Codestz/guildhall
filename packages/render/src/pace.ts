/**
 * Frame pacing (perf round 3, the user: "rather a steady 30 than a rate jumping between 60, 40 and 30,
 * and quality never drops to buy fps"). The stage draws on every n-th vsync: 1 is the display's own rate,
 * `divisorFor` the one that gives a cadence of ~30 evenly spaced frames (every 2nd on 60 Hz, every 4th
 * on 120 Hz). Skipped vsyncs draw nothing and run no hook, so they cost no GPU work; a hook's dt is the
 * real time since the last drawn frame, so nothing runs slower at 30.
 *
 * Auto (the default) measures each second's drawn frames: when the display's rate is not held (a share
 * of the frames missed a vsync, two seconds running) it steps to the 30 cadence; it steps back up only
 * after a long calm stretch, and a step down soon after a step up doubles the next wait, so it never
 * flaps. The pacing comes before the quality ladder: a device that holds a steady 30 at full quality
 * keeps full quality; the ladder (governor.ts) only steps down once even 30 cannot hold. The viewer's
 * pick (Settings, Motion) overrides it: Smooth 30 holds the 30 cadence, Max the display's rate.
 */

/** The cadence a paced stage keeps, ms a frame (~30 fps). */
export const PACE_MS = 33.3
/** A drawn frame that took over this many of its due interval missed a vsync. */
export const MISS_RATIO = 1.5
/** The share of a second's frames that may miss before it counts as a bad second. */
export const MISS_SHARE = 0.1
/** Bad seconds in a row before the pace steps down. */
export const DOWN_WINDOWS = 2
/** Calm seconds in a row before it steps back up; doubled each time a raise did not hold. */
export const UP_WINDOWS = 8
export const MAX_UP_WINDOWS = 120
/** "Calm" is a frame cost under this share of the display's interval: room to hold the rate. */
export const CALM_RATIO = 0.7

export type PacePick = "auto" | "smooth" | "max"
export const PACE_PICKS: readonly PacePick[] = ["auto", "smooth", "max"]

/** A stored or chosen pick, or Auto when it names none. */
export const paceOf = (value: unknown): PacePick =>
  typeof value === "string" && (PACE_PICKS as readonly string[]).includes(value)
    ? (value as PacePick)
    : "auto"

/**
 * The vsync divisor that paces a display of `vsyncMs` a frame at about PACE_MS: 2 on 60 Hz, 4 on
 * 120 Hz, 5 on 144; never under 2 (a 30 Hz display is paced already, and keeps 1).
 */
export function divisorFor(vsyncMs: number): number {
  if (!(vsyncMs > 0) || vsyncMs >= PACE_MS * 0.75) return 1
  return Math.max(2, Math.round(PACE_MS / vsyncMs))
}

/** One second of drawn frames, as the pacer reads it. */
export interface PaceWindow {
  /** The display's interval (ms), from the raw rAF timestamps. */
  vsyncMs: number
  /** The intervals between drawn frames (ms). */
  intervals: readonly number[]
  /** The p95 frame cost (ms): the main thread's time inside the frame. */
  costP95: number
}

export interface PaceState {
  divisor: number
  /** Bad (over) or calm (under) seconds in a row. */
  bad: number
  calm: number
  /** How many calm seconds the next raise needs. */
  upWindows: number
  lastMove: "up" | "down" | null
}

export const initialPace = (): PaceState => ({
  divisor: 1,
  bad: 0,
  calm: 0,
  upWindows: UP_WINDOWS,
  lastMove: null,
})

/** The share of `intervals` over MISS_RATIO of the due interval (`dueMs`). */
export function missShare(intervals: readonly number[], dueMs: number): number {
  if (!intervals.length) return 0
  let missed = 0
  for (const ms of intervals) if (ms > dueMs * MISS_RATIO) missed++
  return missed / intervals.length
}

/** The pacer after one window, in Auto. */
export function paceStep(state: PaceState, w: PaceWindow): PaceState {
  const paced = divisorFor(w.vsyncMs)
  if (paced === 1) return state.divisor === 1 ? state : { ...state, divisor: 1 }
  if (state.divisor === 1) {
    const bad = missShare(w.intervals, w.vsyncMs) > MISS_SHARE
    const run = bad ? state.bad + 1 : 0
    if (run >= DOWN_WINDOWS) {
      // a drop soon after a raise: the raise did not hold, so the next one waits twice as long
      const upWindows =
        state.lastMove === "up" ? Math.min(MAX_UP_WINDOWS, state.upWindows * 2) : state.upWindows
      return { divisor: paced, bad: 0, calm: 0, upWindows, lastMove: "down" }
    }
    return { ...state, bad: run }
  }
  // paced: back up only after a long calm stretch with room to hold the display's rate
  const calm = w.costP95 < w.vsyncMs * CALM_RATIO ? state.calm + 1 : 0
  if (calm >= state.upWindows) return { ...state, divisor: 1, bad: 0, calm: 0, lastMove: "up" }
  return { ...state, divisor: paced, calm }
}

/**
 * The divisor in force for a pick: Max is the display's rate, Smooth 30 the paced cadence, Auto the
 * pacer's own; a pick keeps no pacer history (Auto again starts afresh).
 */
export function paceWindow(state: PaceState, w: PaceWindow, pick: PacePick): PaceState {
  if (pick === "max") return { ...initialPace(), divisor: 1 }
  if (pick === "smooth") return { ...initialPace(), divisor: divisorFor(w.vsyncMs) }
  return paceStep(state, w)
}

/** The display's interval from raw rAF gaps: the median, so a stall or a dropped frame does not move it. */
export function vsyncOf(rawGaps: readonly number[], fallback = 1000 / 60): number {
  const gaps = rawGaps.filter((g) => g > 1 && g < 200).sort((a, b) => a - b)
  if (gaps.length < 8) return fallback
  return gaps[Math.floor(gaps.length / 2)] as number
}
