/**
 * The hall's one clock (plan-hud-events §3.3): `Clock {mode, scale, t, rate}`, owned by the app, read by
 * the timeline bar and by whatever the time moves (the history reveal, history.ts). `t` runs 0 → 1 along
 * the scale (history: the first commit to the last; a session: its start to now). Live keeps `t` at now;
 * a replay plays at `rate`, the whole scale in `duration / rate` seconds. Pure: it moves only by `tick(dt)`
 * and the calls below, so the same calls give the same `t`.
 */
import type { HallSession } from "./feeds/session.ts"

export type ClockMode = "live" | "replay"
export type ClockScale = "history" | "session"

export interface ClockState {
  readonly mode: ClockMode
  readonly scale: ClockScale
  /** Where along the scale: 0 its start, 1 its end (now). */
  readonly t: number
  /** Speed: at 1 the whole scale plays in the clock's `duration` seconds. */
  readonly rate: number
  readonly playing: boolean
  /**
   * Counts the seeks that land at once (a shared link, a restart, a shot) rather than be followed: what the
   * time moves may ease toward an ordinary seek, and jumps when this changes.
   */
  readonly jumps: number
}

export interface Clock {
  get(): ClockState
  /** Moves to `t` (clamped to 0..1); a replay from there. `jump`: land at once (see `jumps`). */
  seek(t: number, how?: { jump?: boolean }): void
  /** Plays or pauses; playing from the end starts again from the start (a jump). */
  play(on: boolean): void
  setRate(rate: number): void
  /** Advances a playing clock by `dt` seconds (at most `MAX_DT`); true when `t` moved. */
  tick(dt: number): boolean
  /** Called after every change; returns the unsubscribe. */
  subscribe(fn: () => void): () => void
}

/** The speeds the bar offers. */
export const RATES: readonly number[] = [0.5, 1, 2, 4]
/** Seconds the whole history takes at 1×. */
export const HISTORY_SECONDS = 20
/** A tick never moves more than this (a tab coming back from the background does not skip the history). */
export const MAX_DT = 0.1

export interface ClockOpts {
  mode?: ClockMode
  scale?: ClockScale
  /** Where it opens (default 1: now). */
  t?: number
  rate?: number
  /** Seconds the whole scale takes at 1× (default `HISTORY_SECONDS`). */
  duration?: number
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)

export function createClock(opts: ClockOpts = {}): Clock {
  const duration = Math.max(1e-3, opts.duration ?? HISTORY_SECONDS)
  let state: ClockState = {
    mode: opts.mode ?? "replay",
    scale: opts.scale ?? "history",
    t: opts.mode === "live" ? 1 : clamp01(opts.t ?? 1),
    rate: opts.rate ?? 1,
    playing: false,
    jumps: 0,
  }
  const listeners = new Set<() => void>()
  const set = (next: Partial<ClockState>) => {
    state = { ...state, ...next }
    for (const fn of [...listeners]) fn()
  }
  return {
    get: () => state,
    seek(t, how = {}) {
      set({
        mode: "replay",
        t: clamp01(t),
        ...(how.jump ? { jumps: state.jumps + 1 } : {}),
      })
    },
    play(on) {
      if (on === state.playing) return
      if (on && state.t >= 1) set({ mode: "replay", t: 0, jumps: state.jumps + 1, playing: true })
      else set({ mode: "replay", playing: on })
    },
    setRate(rate) {
      if (rate > 0 && rate !== state.rate) set({ rate })
    },
    tick(dt) {
      if (state.mode === "live") return false
      if (!state.playing || !(dt > 0)) return false
      const t = Math.min(1, state.t + (Math.min(dt, MAX_DT) * state.rate) / duration)
      set(t >= 1 ? { t: 1, playing: false } : { t })
      return true
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

/** What the bar draws the history over, once it is ready: its bounds (epoch ms) and its beats. */
export interface HistoryRange {
  start: number
  end: number
  markers: readonly { at: number; kind: "release" | "born"; label?: string }[]
}

/**
 * The hall's time as the bar sees it: the clock, and the history's range once the island can be revealed
 * by it (null before, and for a repo with no chronicle: no bar).
 */
export interface HallTime {
  clock: Clock
  range(): HistoryRange | null
  setRange(range: HistoryRange | null): void
  /** The hall's session (hall/feeds, `?feed=`), once its HUD has started it: the bar's Session scale. */
  session(): HallSession | null
  setSession(session: HallSession | null): void
  /** Which scale the bar shows: Session while a session is up, unless History is picked. */
  scale(): ClockScale
  setScale(scale: ClockScale): void
  /** Called when the range, the session or the scale is set; returns the unsubscribe. */
  subscribe(fn: () => void): () => void
}

export function createHallTime(clock: Clock): HallTime {
  let range: HistoryRange | null = null
  let session: HallSession | null = null
  let scale: ClockScale = "history"
  const listeners = new Set<() => void>()
  const tell = () => {
    for (const fn of [...listeners]) fn()
  }
  return {
    clock,
    range: () => range,
    setRange(next) {
      range = next
      tell()
    },
    session: () => session,
    setSession(next) {
      session = next
      scale = next ? "session" : "history"
      tell()
    },
    scale: () => scale,
    setScale(next) {
      if (next === scale || (next === "session" && !session)) return
      scale = next
      tell()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

/** The next speed after `rate` in `RATES`, round to the first. */
export function nextRate(rate: number, rates: readonly number[] = RATES): number {
  const at = rates.indexOf(rate)
  return rates[(at + 1) % rates.length] ?? 1
}

/** "1×", "0.5×". */
export const rateLabel = (rate: number): string => `${rate}×`
