/**
 * The repo story's words: dates and spans as the book writes them, counts spelled the storyteller's way,
 * and the release tags that count as releases. Dates are UTC days (the chronicle's `Day`).
 */
import { DAY_MS, type Day, type Release } from "../../repo/chronicle.ts"
import { spell } from "../story.ts"

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const parts = (day: Day) => {
  const d = new Date(day * DAY_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }
}

export const yearOf = (day: Day): number => parts(day).y
export const monthIndex = (day: Day): number => parts(day).y * 12 + parts(day).m

/** `29 May 2013`. */
export function dateOf(day: Day): string {
  const p = parts(day)
  return `${p.d} ${MONTHS[p.m]} ${p.y}`
}

/** `May 2013`. */
export function monthOf(day: Day): string {
  const p = parts(day)
  return `${MONTHS[p.m]} ${p.y}`
}

/** The first day of the month `index` (year × 12 + month). */
export function monthStart(index: number): Day {
  return Math.floor(Date.UTC(Math.floor(index / 12), index % 12, 1) / DAY_MS)
}

/**
 * A span as the book heads it, as precise as its length wants: `6 October 2026`, `6 – 8 October
 * 2026`, `March – May 2025`, `May 2013 – April 2016`, `2017`, `2013 – 2014`.
 */
export function spanOf(from: Day, to: Day, years = false): string {
  const a = parts(from)
  const b = parts(to)
  if (years) return a.y === b.y ? String(a.y) : `${a.y} – ${b.y}`
  if (to - from < 62) {
    if (from === to) return dateOf(from)
    if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${MONTHS[a.m]} ${a.y}`
    if (a.y === b.y) return `${a.d} ${MONTHS[a.m]} – ${b.d} ${MONTHS[b.m]} ${a.y}`
    return `${dateOf(from)} – ${dateOf(to)}`
  }
  if (a.y === b.y && a.m === b.m) return monthOf(from)
  if (a.y === b.y) return `${MONTHS[a.m]} – ${MONTHS[b.m]} ${a.y}`
  return `${monthOf(from)} – ${monthOf(to)}`
}

/** How long, in the book's words: `three days`, `two weeks`, `five months`, `thirteen years`. */
export function ageOf(days: number): { n: number; unit: string; text: string } {
  const out = (n: number, one: string) => {
    const unit = n === 1 ? one : `${one}s`
    return { n, unit, text: `${spell(n)} ${unit}` }
  }
  if (days < 14) return out(Math.max(1, days), "day")
  if (days < 61) return out(Math.round(days / 7), "week")
  if (days < 730) return out(Math.round(days / 30.44), "month")
  return out(Math.round(days / 365.25), "year")
}

/** `Three`, `Forty-two`: a count that opens a sentence (spelled to twelve, digits after). */
export function Count(n: number): string {
  const s = spell(n)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** `1,284`. */
export function num(n: number): string {
  return Math.round(n).toLocaleString("en")
}

/** `1 commit`, `3,245 commits`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`
}

/**
 * Tags that are releases of the work: version numbers, a package's own (`eslint-plugin-react-hooks@5.0.0`)
 * included. Marker tags (`latest`, `status`, a PR's screenshots, `github-v1`) are not, and neither are
 * prereleases (`v16.0.0-rc.2`, `v0.0.0-experimental-27659559e`, or one GitHub marks so).
 */
const VERSION = /^(?:@?[\w./-]+@)?v?\d+(?:\.\d+){1,3}$/

export function isRelease(r: Pick<Release, "tag" | "prerelease">): boolean {
  return !r.prerelease && VERSION.test(r.tag)
}

/** A main-line major (`v16.0.0`, `2.0.0`; never a package's own, a 0.x, or a prerelease). */
export function isMajor(r: Pick<Release, "tag" | "prerelease">): boolean {
  const match = /^v?(\d+)\.0\.0$/.exec(r.tag)
  return !r.prerelease && match !== null && Number(match[1]) >= 1
}

/** `v16` of `v16.0.0`. */
export function majorName(tag: string): string {
  return tag.replace(/\.0\.0$/, "")
}

/** `packages/react-dom/` → `packages/react-dom`, as the book writes a place's package (in code marks). */
export function code(unit: string): string {
  return `\`${unit.replace(/\/$/, "")}\``
}

/** Text without its code marks: for the card, which draws no code face. */
export function plain(text: string): string {
  return text.replace(/`/g, "")
}
