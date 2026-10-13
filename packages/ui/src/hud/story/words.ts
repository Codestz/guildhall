/**
 * The book's numbers in V1's words (main:packages/hall/src/guild/legends.ts and story.ts), so the page
 * reads as the Markdown the sim writes: `3m 05s`, `732k tokens`, `$0.483`, `a party of three`.
 */

const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
const MORE = ["eleven", "twelve"]

/** `three`: a storyteller spells small numbers out. */
export function spell(n: number): string {
  return [...NUMBERS, ...MORE][n] ?? String(n)
}

/** `42s`, `3m 05s`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
}

/** `m:ss` run time. */
export function clockOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** `840 tokens`, `12.4k tokens`, `732k tokens`. */
export function tokensOf(n: number): string {
  if (n < 1000) return `${n} tokens`
  return `${n < 100_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)}k tokens`
}

/** `$0.483`, `$6.40`. */
export function costOf(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`
}

const MONTHS = [
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

/** `2 March`: a day of the year, in the book's hand (UTC, so a fixture reads the same everywhere). */
export function dayOf(epoch: number): string {
  const d = new Date(epoch)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** `Apr 2016`: a long era's lines are dated by the month. */
export function monthOf(epoch: number): string {
  const d = new Date(epoch)
  return `${MONTHS[d.getUTCMonth()]?.slice(0, 3)} ${d.getUTCFullYear()}`
}

export function yearOf(epoch: number): number {
  return new Date(epoch).getUTCFullYear()
}

/** `2026-03-02`, for a `<time>`'s machine value. */
export function isoDay(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10)
}
