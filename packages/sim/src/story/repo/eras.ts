/**
 * The era rule: how a repo's history is cut into the Legends book's chapters.
 *
 *   1. Releases first. When the main line has three or more majors (`v1.0.0` and up, never a
 *      prerelease, a 0.x or a package's own tag), each major opens an era and the time before the
 *      first is the founding era: react reads as "before 15", "15", "16" … "19".
 *   2. Otherwise the calendar, at the coarsest unit that gives at least four eras: years, then
 *      quarters, months, weeks (the chronicle's own weeks) and days. A three-day-old repo is three
 *      days; nothing finer is honest, because the chronicle counts commits by the week.
 *   3. Then merged to fit a book: while there are more than ten (seven, day by day), the two
 *      neighbours with the fewest commits between them become one; while there are more than four, an era holding under 3% of
 *      the commits joins its quieter neighbour. A merged era keeps the release that opened its first part.
 *
 * Pure and deterministic: the same chronicle always gives the same eras.
 */
import type { Chronicle, Day, Release } from "../../repo/chronicle.ts"
import { isMajor, monthIndex, monthStart, yearOf } from "./words.ts"

export type EraRule = "release" | "year" | "quarter" | "month" | "week" | "day"

export interface EraSpan {
  /** First and last day of the era, both inside it. */
  from: Day
  to: Day
  /** The major release that opened it (release eras; the founding era has none). */
  opens?: Release
}

export const MIN_ERAS = 4
export const MAX_ERAS = 10
/** Day by day, a book stops at a week's worth of chapters. */
const MAX_DAYS = 7
/** An era with less than this share of the commits is folded into a neighbour (while above MIN_ERAS). */
const SLIVER = 0.03

export interface Eras {
  rule: EraRule
  spans: EraSpan[]
}

export function erasOf(c: Chronicle): Eras {
  const { rule, spans } = cutsOf(c)
  return { rule, spans: merge(c, spans, rule === "day" ? MAX_DAYS : MAX_ERAS) }
}

/** The main-line majors inside the history, one per day, oldest first. */
export function majorsOf(c: Chronicle): Release[] {
  const out: Release[] = []
  for (const r of [...c.releases].sort((a, b) => a.day - b.day))
    if (isMajor(r) && r.day > c.start && r.day <= c.end && out.at(-1)?.day !== r.day) out.push(r)
  return out
}

function cutsOf(c: Chronicle): Eras {
  const majors = majorsOf(c)
  if (majors.length >= MIN_ERAS - 1) {
    const spans: EraSpan[] = [{ from: c.start, to: (majors[0] as Release).day - 1 }]
    majors.forEach((r, i) => {
      const next = majors[i + 1]
      spans.push({ from: r.day, to: next ? next.day - 1 : c.end, opens: r })
    })
    return { rule: "release", spans }
  }
  const units: Exclude<EraRule, "release">[] = ["year", "quarter", "month", "week", "day"]
  let last: Eras = { rule: "day", spans: [] }
  for (const unit of units) {
    last = { rule: unit, spans: calendar(c, unit) }
    if (last.spans.length >= MIN_ERAS) return last
  }
  return last
}

/** The calendar's buckets of `unit` that meet [start, end], clipped to it. */
function calendar(c: Chronicle, unit: Exclude<EraRule, "release">): EraSpan[] {
  const starts: Day[] = []
  if (unit === "day") for (let d = c.start; d <= c.end; d++) starts.push(d)
  else if (unit === "week") for (let d = c.start; d <= c.end; d += 7) starts.push(d)
  else {
    const step = unit === "year" ? 12 : unit === "quarter" ? 3 : 1
    const first = unit === "year" ? yearOf(c.start) * 12 : Math.floor(monthIndex(c.start) / step) * step
    for (let m = first; monthStart(m) <= c.end; m += step) starts.push(Math.max(c.start, monthStart(m)))
  }
  return starts.map((from, i) => ({ from, to: (starts[i + 1] ?? c.end + 1) - 1 }))
}

/** Commits in [from, to], the weekly counts shared out by the days each week overlaps. */
export function commitsIn(c: Chronicle, from: Day, to: Day): number {
  const weekly = c.weekly.commits
  if (!weekly) return 0
  let sum = 0
  weekly.forEach((n, w) => {
    const a = c.start + 7 * w
    const overlap = Math.min(to, a + 6) - Math.max(from, a) + 1
    if (overlap > 0) sum += (n * overlap) / 7
  })
  return sum
}

function merge(c: Chronicle, input: readonly EraSpan[], max: number): EraSpan[] {
  const spans = input.map((s) => ({ ...s, w: commitsIn(c, s.from, s.to) }))
  const join = (i: number) => {
    const a = spans[i] as (typeof spans)[number]
    const b = spans[i + 1] as (typeof spans)[number]
    spans.splice(i, 2, { ...a, to: b.to, w: a.w + b.w })
  }
  while (spans.length > max) {
    let best = 0
    for (let i = 1; i < spans.length - 1; i++) {
      const pair = (k: number) => (spans[k]?.w ?? 0) + (spans[k + 1]?.w ?? 0)
      if (pair(i) < pair(best)) best = i
    }
    join(best)
  }
  const total = spans.reduce((sum, s) => sum + s.w, 0)
  for (;;) {
    if (spans.length <= MIN_ERAS || total <= 0) break
    const i = spans.findIndex((s) => s.w < SLIVER * total)
    if (i < 0) break
    const before = spans[i - 1]
    const after = spans[i + 1]
    join(!after || (before && before.w <= after.w) ? i - 1 : i)
  }
  return spans.map(({ w: _, ...s }) => s)
}
