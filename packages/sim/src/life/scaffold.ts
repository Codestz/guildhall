import type { EventLog } from "../events/log.ts"
import type { WorldEvent } from "../events/world.ts"

/**
 * How far a place's scaffold is built (the game-feel plan: task C draws its stages): the edits and
 * writes done there since it went up, as a share of `SCAFFOLD_EDITS`. A call that names files in
 * several places counts towards each in proportion; a failed one counts for nothing. Pure over the
 * log: the same at every t however it is reached.
 */

/** Edits at a place that build its scaffold whole. */
export const SCAFFOLD_EDITS = 12

/**
 * A place's scaffold at `t` (ms on the events' clock): 0 when it went up (`from`, by default the
 * log's start), 1 once `edits` edits (default `SCAFFOLD_EDITS`) were done there since.
 */
export function scaffoldProgress(
  log: EventLog | readonly WorldEvent[],
  place: number,
  t: number,
  opts: { from?: number; edits?: number } = {},
): number {
  const events = "events" in log ? log.events : log
  const need = opts.edits ?? SCAFFOLD_EDITS
  const from = opts.from ?? Number.NEGATIVE_INFINITY
  // the first event after t (the log is in time order)
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid]!.at <= t) lo = mid + 1
    else hi = mid
  }
  let done = 0
  for (let k = lo - 1; k >= 0; k--) {
    const ev = events[k]!
    if (ev.at < from) break
    if (ev.kind !== "actor.deed" || ev.failed || (ev.craft !== "edit" && ev.craft !== "write")) continue
    if (!ev.places.length) continue
    let here = 0
    for (const p of ev.places) if (p === place) here++
    done += here / ev.places.length
    if (done >= need) return 1
  }
  return Math.min(1, done / need)
}
