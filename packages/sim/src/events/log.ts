import { emptyWorld, type GuildWorld, reduce } from "./reduce.ts"
import type { WorldEvent } from "./world.ts"

/** Events between two checkpoints: a seek folds at most this many. */
export const CHECKPOINT_EVERY = 256

/**
 * The world's event log (plan-hud-events.md §3.3): append-only, ordered by `at` then `seq`, with the
 * world it folds to kept at its head (live: each event reduces once) and a checkpoint every
 * `CHECKPOINT_EVERY` events, so `stateAt(t)` (replay, a scrub) is the nearest checkpoint at or before
 * `t` folded forward: at most `CHECKPOINT_EVERY − 1` folds. Checkpoints are whole worlds, but a world
 * shares every part an event did not touch, so they cost little.
 */
export class EventLog {
  private readonly list: WorldEvent[] = []
  /** `checkpoints[k]` is the world after the first `k * every` events. */
  private readonly checkpoints: GuildWorld[]
  private now: GuildWorld

  constructor(
    readonly every: number = CHECKPOINT_EVERY,
    initial: GuildWorld = emptyWorld(),
  ) {
    if (!(every >= 1)) throw new RangeError(`checkpoint interval ${every}`)
    this.checkpoints = [initial]
    this.now = initial
  }

  get events(): readonly WorldEvent[] {
    return this.list
  }

  get length(): number {
    return this.list.length
  }

  /** The world after every event appended. */
  get head(): GuildWorld {
    return this.now
  }

  /** Appends events in order (what `normalize` makes is) and returns the head. */
  append(...events: WorldEvent[]): GuildWorld {
    for (const ev of events) {
      const last = this.list[this.list.length - 1]
      if (last && (ev.at < last.at || (ev.at === last.at && ev.seq <= last.seq)))
        throw new RangeError(
          `event ${ev.seq} at ${ev.at} is before the log's last (${last.seq} at ${last.at})`,
        )
      this.list.push(ev)
      this.now = reduce(this.now, ev)
      if (this.list.length % this.every === 0) this.checkpoints.push(this.now)
    }
    return this.now
  }

  /** How many events happened at or before `t`. */
  countAt(t: number): number {
    let lo = 0
    let hi = this.list.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if ((this.list[mid] as WorldEvent).at <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** The folds `stateAt(t)` costs. */
  foldsAt(t: number): number {
    const n = this.countAt(t)
    return n === this.list.length ? 0 : n % this.every
  }

  /** The world at `t`: every event at or before it folded (the head from the last event on). */
  stateAt(t: number): GuildWorld {
    const n = this.countAt(t)
    if (n === this.list.length) return this.now
    const k = Math.floor(n / this.every)
    let world = this.checkpoints[k] as GuildWorld
    for (let i = k * this.every; i < n; i++) world = reduce(world, this.list[i] as WorldEvent)
    return world
  }
}
