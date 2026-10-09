import {
  activityAt,
  type Chronicle,
  type Contributor,
  type Day,
  weekOf,
  weeksOf,
} from "../chronicle/format.ts"

/**
 * When a contributor is in town and how busy (ADR 0013), from their weekly commits alone: pure, so
 * the film, a seek and today all agree.
 *
 *   arriving   the first `window` days from their first commit: they come off the ferry
 *   busy       committed within the last `window` days: at work in their district
 *   quiet      no commit in that window, but not gone: resting at the harbour
 *   leaving    STAY_DAYS past their last commit (the hall can only tell someone has left once they
 *              have been quiet that long), for `window` days: they walk to the ferry
 *
 * `window` is a month for a town shown as it is; the film widens it so a week of film-time noise
 * never sends anyone back and forth across the island (townsfolk.ts `filmWindow`).
 */

/** A month: what "this week" means for a town at rest. */
export const WINDOW_DAYS = 28
/** Quiet this long past their last commit, a contributor is taken to have left. */
export const STAY_DAYS = 365

export type Presence = "busy" | "quiet" | "leaving"

export interface PresenceAt {
  presence: Presence
  /** Within `window` days of their first commit. */
  arriving: boolean
  /** Commits in the `window` days up to `day`. */
  recent: number
}

/** A contributor's state on `day`; undefined while not in town (before they came, after they left). */
export function presenceAt(
  c: Pick<Chronicle, "start" | "end">,
  person: Pick<Contributor, "first" | "last" | "from" | "weeks">,
  day: Day,
  window = WINDOW_DAYS,
): PresenceAt | undefined {
  if (day < person.first) return undefined
  const gone = person.last + STAY_DAYS
  if (day >= gone + window) return undefined
  const recent = recentCommits(c, person, day, window)
  const arriving = day < person.first + window
  if (day >= gone) return { presence: "leaving", arriving, recent }
  return { presence: recent > 0 ? "busy" : "quiet", arriving, recent }
}

/** Commits in the `window` days up to `day` (whole weeks: the chronicle keeps no finer grain). */
export function recentCommits(
  c: Pick<Chronicle, "start" | "end">,
  person: Pick<Contributor, "from" | "weeks">,
  day: Day,
  window = WINDOW_DAYS,
): number {
  const last = weekOf(c, day)
  const weeks = Math.max(1, Math.round(window / 7))
  let total = 0
  for (let w = last - weeks + 1; w <= last; w++) total += activityAt(person, w)
  return total
}

/** A contributor's weekly activity summed up week by week (index i: weeks `from`…`from + i`). */
export function weeklyTotals(person: Pick<Contributor, "weeks">): Int32Array {
  const out = new Int32Array(person.weeks.length)
  let sum = 0
  for (let i = 0; i < person.weeks.length; i++) {
    sum += Number.parseInt(person.weeks[i] as string, 36) || 0
    out[i] = sum
  }
  return out
}

/**
 * Commits made by `day` (inclusive of its week): their total spread over their weeks by each week's
 * activity, so a rank grows as the film plays and ends on their real total. `totals`: their
 * `weeklyTotals`, when the caller keeps them.
 */
export function commitsBy(
  c: Pick<Chronicle, "start" | "end">,
  person: Pick<Contributor, "first" | "last" | "commits" | "from" | "weeks">,
  day: Day,
  totals: Int32Array = weeklyTotals(person),
): number {
  if (day < person.first) return 0
  if (day >= person.last) return person.commits
  const all = totals[totals.length - 1] ?? 0
  if (all <= 0) return person.commits
  const upTo = Math.min(totals.length - 1, weekOf(c, day) - person.from)
  const before = upTo >= 0 ? (totals[upTo] ?? 0) : 0
  return Math.round((person.commits * before) / all)
}

export interface BusiestWeek {
  week: number
  /** Its first day. */
  day: Day
  commits: number
}

/**
 * The week with the most commits: the chronicle's weekly series, else its listed contributors'
 * weeks summed. Undefined for a history without a commit.
 */
export function busiestWeek(c: Chronicle): BusiestWeek | undefined {
  const weeks = weeksOf(c)
  let series = c.weekly.commits
  if (!series || series.length === 0) {
    const summed = new Array<number>(weeks).fill(0)
    for (const person of c.contributors)
      for (let i = 0; i < person.weeks.length; i++) {
        const w = person.from + i
        if (w < weeks) summed[w] = (summed[w] ?? 0) + activityAt(person, w)
      }
    series = summed
  }
  let best = -1
  for (let w = 0; w < series.length; w++) if ((series[w] ?? 0) > (series[best] ?? 0)) best = w
  if (best < 0 || (series[best] ?? 0) <= 0) return undefined
  return { week: best, day: c.start + best * 7, commits: series[best] ?? 0 }
}

/**
 * How far the ferry is in on `day`, 0 (out of sight) to 1 (moored at the quay): in while anyone
 * arrives or leaves within `window` days (`days`: sorted), sailing over the next `window` days.
 */
export function ferryAt(days: readonly Day[], day: Day, window = WINDOW_DAYS): number {
  let nearest = Number.POSITIVE_INFINITY
  let lo = 0
  let hi = days.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((days[mid] as number) < day) lo = mid + 1
    else hi = mid
  }
  for (const i of [lo - 1, lo]) {
    const d = days[i]
    if (d !== undefined) nearest = Math.min(nearest, Math.abs(d - day))
  }
  return Math.min(1, Math.max(0, (2 * window - nearest) / window))
}

/**
 * A contributor's commits over the whole history in `buckets` equal spans (the dossier's
 * sparkline): week by week from the chronicle's first, summed into each span.
 */
export function activityBuckets(
  c: Pick<Chronicle, "start" | "end">,
  person: Pick<Contributor, "from" | "weeks">,
  buckets: number,
): number[] {
  const weeks = weeksOf(c)
  const out = new Array<number>(Math.max(1, buckets)).fill(0)
  for (let i = 0; i < person.weeks.length; i++) {
    const w = person.from + i
    if (w >= weeks) break
    const b = Math.min(out.length - 1, Math.floor((w * out.length) / weeks))
    out[b] = (out[b] ?? 0) + activityAt(person, w)
  }
  return out
}
