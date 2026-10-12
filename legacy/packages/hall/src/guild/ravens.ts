import type { Moment } from "./moments.ts"

/**
 * The ravens' rules (scene/life/Ravens.tsx flies them): which moments send one, and which
 * guildmaster a carrying raven flies from or to. Pure, so the rules are tested without a canvas.
 */

/** At most this many ravens in the sky (and waiting to launch). */
export const RAVENS_MAX = 8

/** A moment a raven carries: a join (sent out), loot (news home) or a plea (circling, calling). */
export function sendsRaven(moment: Pick<Moment, "kind">): boolean {
  return moment.kind === "join" || moment.kind === "loot" || moment.kind === "plea"
}

/**
 * Queue a live moment for launch in the next frame. While the tab is hidden the frame loop is
 * paused: nothing is queued, so coming back launches no flock of stale ravens (review-2 #20), and
 * the queue never holds more than the sky can (the newest kept).
 */
export function hear(news: Moment[], moment: Moment, hidden: boolean): void {
  if (hidden || !sendsRaven(moment)) return
  news.push(moment)
  if (news.length > RAVENS_MAX) news.splice(0, news.length - RAVENS_MAX)
}

/**
 * The guildmaster a join's raven flies from, or a loot's raven flies to: the moment's own party's
 * (review-2 #12: with several parties on the island it took the first in `views`, so one party's
 * news flew to another's guildmaster). Undefined when that guildmaster is not on stage.
 */
export function masterOf<V extends { id: string; master: boolean }>(
  moment: Pick<Moment, "master">,
  views: readonly V[],
): V | undefined {
  return views.find((v) => v.master && v.id === moment.master)
}
