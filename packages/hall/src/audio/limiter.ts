/**
 * Restraint, as rules (Townscaper's "no notifications"): a busy guild must never become noise.
 *
 *   polyphony  each bus sounds at most `voices` cues at once; a cue that would exceed it is dropped
 *              (not queued: a late note is worse than a missing one)
 *   cooldown   one sound (`deed:edit`, `sample:forge`…) at most once per `cooldown` seconds
 *
 * Pure bookkeeping on a clock the caller passes in (seconds), so it can be tested.
 */

export type Bus = "notes" | "sfx"

export const VOICES: Record<Bus, number> = { notes: 6, sfx: 3 }

/** Seconds between two cues of one sound. Unlisted sounds use `DEFAULT_COOLDOWN`. */
export const COOLDOWNS: Readonly<Record<string, number>> = {
  "deed-failed": 0.4,
  fail: 2.5,
  recover: 2,
  plea: 1.5,
  loot: 1.2,
  join: 1.5,
  "sample:forge": 1.4,
  "sample:build": 1.6,
  "sample:quarry": 1.6,
  "sample:chop": 1.6,
  "sample:book": 2,
  "sample:coins": 2.5,
  "sample:door": 5,
  "sample:creak": 8,
  "sample:bell": 12,
}
/** A deed note per kind: fast enough for a flurry to read as an arpeggio, never a machine gun. */
export const DEFAULT_COOLDOWN = 0.11

export type Verdict = "play" | "cooldown" | "polyphony"

export class Limiter {
  private ends: Record<Bus, number[]> = { notes: [], sfx: [] }
  private last = new Map<string, number>()

  constructor(
    private readonly voices: Record<Bus, number> = VOICES,
    private readonly cooldowns: Readonly<Record<string, number>> = COOLDOWNS,
  ) {}

  /** May `sound` start on `bus` at `now`, ringing for `length` s? Admitting it takes the voice. */
  admit(bus: Bus, sound: string, now: number, length: number): Verdict {
    const cooldown = this.cooldowns[sound] ?? DEFAULT_COOLDOWN
    const last = this.last.get(sound)
    if (last !== undefined && now - last < cooldown) return "cooldown"
    const ends = this.ends[bus].filter((end) => end > now)
    this.ends[bus] = ends
    if (ends.length >= this.voices[bus]) return "polyphony"
    ends.push(now + length)
    this.last.set(sound, now)
    return "play"
  }

  /** Cues sounding on `bus` at `now`. */
  sounding(bus: Bus, now: number): number {
    return this.ends[bus].filter((end) => end > now).length
  }

  /** Forget everything in flight (a rebuild). Cooldowns stay: a seek must not unlock a burst. */
  clear(): void {
    this.ends = { notes: [], sfx: [] }
  }
}

/** A plea's call repeats this often (s), each time softer, until answered or `PLEA_REPEATS` calls. */
export const PLEA_EVERY = 7
export const PLEA_REPEATS = 3
/** Each repeat is this much quieter than the one before. */
export const PLEA_FADE = 0.65

/**
 * Pleas still calling: one per adventurer, repeated softly until answered (or they fail, finish or
 * leave), capped at `PLEA_REPEATS` repeats after the first call.
 */
export class PleaCalls {
  private calls = new Map<string, { next: number; left: number; gain: number }>()

  start(id: string, now: number): void {
    this.calls.set(id, { next: now + PLEA_EVERY, left: PLEA_REPEATS, gain: PLEA_FADE })
  }

  stop(id: string): void {
    this.calls.delete(id)
  }

  clear(): void {
    this.calls.clear()
  }

  get size(): number {
    return this.calls.size
  }

  /** Calls due at `now`: who, and how loud (relative to the first call). */
  due(now: number): { id: string; gain: number }[] {
    const out: { id: string; gain: number }[] = []
    for (const [id, call] of this.calls) {
      if (now < call.next) continue
      out.push({ id, gain: call.gain })
      if (call.left <= 1) this.calls.delete(id)
      else this.calls.set(id, { next: now + PLEA_EVERY, left: call.left - 1, gain: call.gain * PLEA_FADE })
    }
    return out
  }
}
