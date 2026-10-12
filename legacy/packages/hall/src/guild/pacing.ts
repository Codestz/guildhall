import type { Chapter } from "@guildhall/sim"
import { easeSpeed, fastForwardGoal } from "./director.ts"

/**
 * Replay pacing: the fast-forward through a replay's quiet stretches (roadmap S4, Gource's
 * auto-skip) and the chapter cards told as a replay's clock reaches each act. Pure helpers and a
 * small teller; the sim feed (guild/feeds/sim.ts) drives them.
 */

/** Index of the first value in sorted `times` greater than `t` (times.length if none). */
export function firstAfter(times: readonly number[], t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((times[mid] ?? 0) <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The fast-forward multiple after `realMs` more of a replay at run time `time`: eased towards the
 * goal the beats around it set (guild/director.ts `fastForwardGoal`). `enabled` is the viewer's
 * part (Cinematic, the Bard filming, nobody picked, not paused); `busy` the stage's (a plea, or an
 * excited director).
 */
export function fastForwardAt(input: {
  was: number
  time: number
  duration: number
  beats: readonly number[]
  enabled: boolean
  busy: boolean
  realMs: number
}): number {
  const { time, beats } = input
  const next = firstAfter(beats, time)
  const since = next > 0 ? time - (beats[next - 1] ?? 0) : time
  const until = (beats[next] ?? input.duration) - time
  const goal = fastForwardGoal({
    replay: true,
    enabled: input.enabled,
    sinceBeat: since,
    untilBeat: until,
    busy: input.busy,
  })
  return easeSpeed(input.was, goal, input.realMs)
}

/** Someone is waiting on a plea (no closure: runs every frame). */
export function pleading(views: readonly { phase: string }[]): boolean {
  for (let i = 0; i < views.length; i++) if (views[i]?.phase === "waiting") return true
  return false
}

/**
 * Tells each chapter as it begins while the hall watches (played into, or jumped to its start),
 * never one a seek passes over: the captions' title card between acts.
 */
export class ChapterCards {
  private listeners = new Set<(chapter: Chapter) => void>()
  /** The run time of the chapter last told, so standing on its start tells it once; a rebuild forgets it. */
  private told = Number.NaN

  on(listener: (chapter: Chapter) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  forget(): void {
    this.told = Number.NaN
  }

  /**
   * The replay's clock moved from `from` to `to` (-1: it looped back to the start): a chapter whose
   * start it reached is told, the one it stood on included (a jump lands exactly on a chapter).
   */
  turn(chapters: readonly Chapter[], from: number, to: number): void {
    if (to <= from) return
    for (const chapter of chapters) {
      if (chapter.at < from || chapter.at > to || chapter.at === this.told) continue
      this.told = chapter.at
      for (const listener of this.listeners) listener(chapter)
    }
  }
}
