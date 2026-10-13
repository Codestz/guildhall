/**
 * What the clock plays through, heard once (V1's "only live moments sound", for a log and a clock): each
 * step, the events between where the clock was and where it is now are heard, in order. Anything else
 * the clock does is a rebuild, heard by nobody: a seek (a jump, or going back), a new log (a hub's
 * hello), a leap further than `maxGap` (a tab back from the background), and the first look. A loop
 * (the site's demo guild, which plays round and round) is played through, not rebuilt. Pure: no
 * WebAudio, no DOM; the engine hears what it says.
 */
import type { WorldEvent } from "@guildhall/sim"

/** Where a guild's events are along a clock. */
export interface Timeline {
  /** The log, in time order; it only grows, and a new array is a new log. */
  events(): readonly WorldEvent[]
  /** The clock (ms on the events' clock) and how many seeks have landed at once. */
  clock(): { at: number; jumps: number }
  /** The clock goes round: going back is the next round, not a seek. */
  loops?: boolean
}

/** A leap further than this (ms on the events' clock) is a jump: 8× of the session clock's longest tick is 2 s. */
export const MAX_GAP_MS = 3000

export class CueDriver {
  private log: readonly WorldEvent[] | null = null
  private cursor = 0
  private last = Number.NEGATIVE_INFINITY
  private jumps = -1

  constructor(
    private readonly hear: (ev: WorldEvent) => void,
    private readonly rebuild: () => void,
    private readonly maxGap = MAX_GAP_MS,
  ) {}

  /** Hears what the clock played through since the last step; returns how many events. */
  step(timeline: Timeline): number {
    const events = timeline.events()
    const { at, jumps } = timeline.clock()
    const fresh = events !== this.log || jumps !== this.jumps
    const back = at < this.last
    if (fresh || (back && !timeline.loops) || at - this.last > this.maxGap) {
      this.seat(events, at, jumps)
      return 0
    }
    let heard = 0
    if (back) {
      // round again: the end of the last round, then the start of this one
      while (this.cursor < events.length) {
        this.hear(events[this.cursor++] as WorldEvent)
        heard++
      }
      this.cursor = 0
    }
    while (this.cursor < events.length && (events[this.cursor] as WorldEvent).at <= at) {
      this.hear(events[this.cursor++] as WorldEvent)
      heard++
    }
    this.last = at
    return heard
  }

  /** Forget where it was: the next step only finds its place. */
  reset(): void {
    this.log = null
  }

  private seat(events: readonly WorldEvent[], at: number, jumps: number): void {
    this.log = events
    this.jumps = jumps
    this.last = at
    // what is exactly where the clock lands is still to come (a story opening at its first event)
    let lo = 0
    let hi = events.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((events[mid] as WorldEvent).at < at) lo = mid + 1
      else hi = mid
    }
    this.cursor = lo
    this.rebuild()
  }
}
