import { type Change, type GuildEvent, WIRE_VERSION } from "@guildhall/core"

/** Wrap a script's changes as wire events for one guild. */
export function toEvents(changes: readonly Change[], guild: string): GuildEvent[] {
  return changes.map((change, index) => ({ v: WIRE_VERSION, guild, seq: index + 1, change }))
}

/**
 * Plays a recorded or simulated run against a clock — the hall's replay mode and the website's
 * demo share it. Time is the run's own time (ms from its first event), scaled by `speed`.
 */
export class Player {
  /** Run time, ms. */
  time = 0
  speed = 1
  private next = 0
  private readonly start: number
  readonly duration: number

  constructor(
    private readonly events: readonly GuildEvent[],
    private readonly options: { loop?: boolean } = {},
  ) {
    this.start = events[0]?.change.at ?? 0
    this.duration = (events.at(-1)?.change.at ?? this.start) - this.start
  }

  /**
   * Move the clock by `realMs` of wall time and return what happened meanwhile, in order.
   * `restarted` is true when a loop wrapped: the caller should clear its state before applying.
   */
  tick(realMs: number): { events: GuildEvent[]; restarted: boolean } {
    this.time += realMs * this.speed
    let restarted = false
    if (this.time > this.duration && this.options.loop && this.next >= this.events.length) {
      this.time = 0
      this.next = 0
      restarted = true
    }
    return { events: this.drain(), restarted }
  }

  /** Jump to `time`: returns every event up to it, for the caller to rebuild from scratch. */
  seek(time: number): GuildEvent[] {
    this.time = Math.max(0, Math.min(time, this.duration))
    this.next = 0
    return this.drain()
  }

  private drain(): GuildEvent[] {
    const out: GuildEvent[] = []
    const until = this.start + this.time
    while (this.next < this.events.length) {
      const event = this.events[this.next]
      if (!event || event.change.at > until) break
      out.push(event)
      this.next++
    }
    return out
  }
}
