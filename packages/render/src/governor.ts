import { log } from "@guildhall/core"
import type { Stage } from "./stage.ts"

/** How far one governor move changes the DPR. */
export const DPR_STEP = 0.25
/** Consecutive over-budget windows (one a second) before the DPR steps down. */
export const DOWN_WINDOWS = 2
/** Consecutive comfortable windows before it steps back up; doubled each time a raise does not hold. */
export const UP_WINDOWS = 5
/** "Comfortable" is under this share of the budget: the gap between it and 1 is the hysteresis. */
export const UP_RATIO = 0.7
/** The longest the governor waits to raise, and how long a raise must hold to be trusted again. */
export const MAX_UP_WINDOWS = 60
const WINDOW_MS = 1000

const logger = log("render:dpr")

/**
 * The DPR after one more window, given the p95 frame cost (ms) of each recent window, newest last.
 * Steps down when the last `DOWN_WINDOWS` were all over `targetMs`, up when the last `upWindows` were
 * all under `UP_RATIO` of it; otherwise it stays. Never leaves `[min, max]`.
 */
export function nextDpr(
  p95History: readonly number[],
  dpr: number,
  [min, max]: readonly [number, number],
  targetMs: number,
  upWindows = UP_WINDOWS,
): number {
  const last = (n: number) => (p95History.length >= n ? p95History.slice(-n) : null)
  if (dpr > min && last(DOWN_WINDOWS)?.every((ms) => ms > targetMs)) return Math.max(min, dpr - DPR_STEP)
  if (dpr < max && last(upWindows)?.every((ms) => ms < targetMs * UP_RATIO))
    return Math.min(max, dpr + DPR_STEP)
  return dpr
}

export interface GovernorState {
  dpr: number
  /** The p95 cost of each window since the last move, newest last. */
  history: number[]
  /** How many comfortable windows the next raise needs. */
  upWindows: number
  lastMove: "up" | "down" | null
}

export const initialGovernor = (dpr: number): GovernorState => ({
  dpr,
  history: [],
  upWindows: UP_WINDOWS,
  lastMove: null,
})

/**
 * The governor after one window whose p95 frame cost was `p95` ms. A move clears the history, so the
 * next decision is made on frames drawn at the new DPR. A drop that comes soon after a raise means the
 * raise did not hold, so the next one waits twice as long: the DPR cannot oscillate.
 */
export function governorStep(
  state: GovernorState,
  p95: number,
  range: readonly [number, number],
  targetMs: number,
): GovernorState {
  const history = [...state.history, p95].slice(-MAX_UP_WINDOWS)
  const dpr = nextDpr(history, state.dpr, range, targetMs, state.upWindows)
  if (dpr === state.dpr) return { ...state, history }
  const move = dpr < state.dpr ? "down" : "up"
  let upWindows = state.upWindows
  if (move === "down" && state.lastMove === "up")
    upWindows = history.length < MAX_UP_WINDOWS ? Math.min(MAX_UP_WINDOWS, upWindows * 2) : UP_WINDOWS
  return { dpr, history: [], upWindows, lastMove: move }
}

/** The DPR a `?dpr=` query pins, or undefined when it names none (or nothing usable). */
export function parseDprPin(search: string): number | undefined {
  const text = new URLSearchParams(search).get("dpr")
  if (text === null) return undefined
  const dpr = Number(text)
  if (text.trim() === "" || !Number.isFinite(dpr) || dpr <= 0) {
    logger.warn("ignoring ?dpr=", { value: text })
    return undefined
  }
  return dpr
}

export interface GovernorOpts {
  /** The p95 frame cost (ms) the DPR is lowered to hold. */
  targetMs: number
  /** The DPR range. It never rises above where the stage started (a raise only wins back a drop). */
  dpr: [number, number]
  /** A fixed DPR (`?dpr=`): set once, and the governor never moves it. */
  pin?: number
}

export interface Governor {
  readonly pinned: boolean
  dispose(): void
}

/**
 * Holds the stage's frame cost under `targetMs` by trading resolution: once a second it reads the p95
 * cost of the frames drawn in that second and steps the DPR (see `governorStep`). Logs every change on
 * `render:dpr`.
 */
export function createGovernor(stage: Stage, opts: GovernorOpts): Governor {
  if (opts.pin !== undefined) {
    stage.setDpr(opts.pin)
    logger.info("pinned", { dpr: opts.pin })
    return { pinned: true, dispose() {} }
  }
  const start = stage.stats().dpr
  const hi = Math.min(opts.dpr[1], start)
  const range: [number, number] = [Math.min(opts.dpr[0], hi), hi]
  let state = initialGovernor(start)
  let running = true

  const loop = async () => {
    while (running) {
      const reading = await stage.sample(WINDOW_MS)
      // A hidden tab draws nothing: no frames is no evidence either way.
      if (!running || reading.fps === 0 || !reading.costMs) continue
      const next = governorStep(state, reading.costMs.p95, range, opts.targetMs)
      if (next.dpr !== state.dpr) {
        logger.info(next.dpr < state.dpr ? "down" : "up", {
          from: state.dpr,
          to: next.dpr,
          p95: Number(reading.costMs.p95.toFixed(2)),
          targetMs: opts.targetMs,
        })
        stage.setDpr(next.dpr)
      }
      state = next
    }
  }
  void loop()
  return {
    pinned: false,
    dispose() {
      running = false
    },
  }
}
