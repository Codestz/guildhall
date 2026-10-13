/**
 * The session scale's clock (plan §3.3; the History scale keeps hall/clock.ts, whose `t` reveals the
 * island): where along a session's log the hall is looking, in epoch ms. Live, it follows the newest
 * moment (now); a scrub or a pause turns it into a replay of the log at `at`, and playing on from there
 * catches up with live again when it reaches now. A recording is always a replay. Pure: it moves only
 * by the calls below, so the same calls give the same `at`.
 */

export type SessionMode = "live" | "replay"

export interface SessionClockState {
  readonly mode: SessionMode
  /** Where the hall looks, epoch ms. */
  readonly at: number
  /** The log's bounds: its first event, and its last (live: now). */
  readonly start: number
  readonly end: number
  readonly playing: boolean
  /** 1: real time. */
  readonly rate: number
  /** Counts the seeks that land at once (a link, a chapter jump): captions are not told across them. */
  readonly jumps: number
  /** Whether the source is live: `goLive` brings the clock back to now. */
  readonly canLive: boolean
}

export interface SessionClock {
  get(): SessionClockState
  /** The log's bounds moved (an event came in, live time went on). Live, `at` follows the end. */
  setRange(start: number, end: number): void
  /** Looks at `at` (clamped to the range): a replay from there, paused unless it was playing. */
  seek(at: number, how?: { jump?: boolean }): void
  /** Plays or pauses; playing from the end of a recording starts it again from its start. */
  play(on: boolean): void
  setRate(rate: number): void
  /** Back to now (a live source only). */
  goLive(): void
  /** A playing replay moves `dt` seconds (at most `MAX_DT`) at its rate; true when `at` moved. */
  tick(dt: number): boolean
  subscribe(fn: () => void): () => void
}

/** The speeds the bar offers a session (sessions are minutes long; 8× watches a long one quickly). */
export const SESSION_RATES: readonly number[] = [1, 2, 4, 8]
/** A tick never moves more than this (a tab back from the background does not skip the session). */
export const MAX_DT = 0.25

export function createSessionClock(opts: { live?: boolean; rate?: number } = {}): SessionClock {
  const canLive = opts.live === true
  let state: SessionClockState = {
    mode: canLive ? "live" : "replay",
    at: 0,
    start: 0,
    end: 0,
    playing: false,
    rate: opts.rate ?? 1,
    jumps: 0,
    canLive,
  }
  const listeners = new Set<() => void>()
  const set = (next: Partial<SessionClockState>) => {
    state = { ...state, ...next }
    for (const fn of [...listeners]) fn()
  }
  const clamp = (at: number) =>
    Math.min(state.end, Math.max(state.start, Number.isFinite(at) ? at : state.end))
  return {
    get: () => state,
    setRange(start, end) {
      if (start === state.start && end === state.end) return
      const e = Math.max(start, end)
      const at = state.mode === "live" ? e : Math.min(e, Math.max(start, state.at))
      set({ start, end: e, at })
    },
    seek(at, how = {}) {
      set({ mode: "replay", at: clamp(at), ...(how.jump ? { jumps: state.jumps + 1 } : {}) })
    },
    play(on) {
      if (state.mode === "live") {
        // live and playing is just live; pausing it holds the moment it is at
        if (!on) set({ mode: "replay", playing: false })
        return
      }
      if (on === state.playing) return
      if (on && state.at >= state.end && !canLive)
        set({ at: state.start, jumps: state.jumps + 1, playing: true })
      else set({ playing: on })
    },
    setRate(rate) {
      if (rate > 0 && rate !== state.rate) set({ rate })
    },
    goLive() {
      if (canLive) set({ mode: "live", at: state.end, playing: false })
    },
    tick(dt) {
      if (state.mode === "live" || !state.playing || !(dt > 0)) return false
      const at = Math.min(state.end, state.at + Math.min(dt, MAX_DT) * 1000 * state.rate)
      if (at >= state.end) set(canLive ? { mode: "live", at, playing: false } : { at, playing: false })
      else set({ at })
      return true
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
