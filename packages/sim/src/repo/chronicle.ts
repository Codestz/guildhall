// From V1 hall (main:packages/hall/src/world/chronicle/format.ts and reconstruct.ts' `unitsAt`).
/**
 * A repo's Chronicle (format v1): its history, compact enough to ship as a lazy asset and to build
 * live from GitHub's API. The types are V1's, unchanged, so V1's bundled chronicles (and the
 * chronicles repo's CDN) read as they are; plan-hud-events.md E3 builds the binding (`placeSpecs`,
 * `bindPlaces`) on them. Pure: no DOM, no node.
 *
 * Encoding rules (gzip-friendly JSON, no whitespace):
 * - A `Day` is whole days since 1970-01-01 UTC (`dayOf`, `isoOf`).
 * - Week `i` is the 7 days from `start + 7i`; every weekly series has `weeksOf(c)` entries.
 * - Per-snapshot series (`Unit.files`, `Unit.bytes`, `snapshots.*`) are columns aligned to
 *   `snapshots.day`, oldest first; 0 means the unit had no files then.
 * - `Contributor.weeks` is one character per week from week `Contributor.from`: '0'–'9' then 'a'–'z'
 *   for 0–35 commits that week (35 means 35 or more); trailing quiet weeks are trimmed.
 * - Optional fields are left out, never null. A section that could not be had is named in `partial`.
 */

export const CHRONICLE_VERSION = 1

/** Whole days since 1970-01-01 UTC. */
export type Day = number

export interface Chronicle {
  v: typeof CHRONICLE_VERSION
  /** deep: built offline from a clone; quick: live from ~20 API calls. */
  depth: "deep" | "quick"
  /** ISO time it was built. */
  generatedAt: string
  repo: RepoMeta
  /** First day of history (the first commit; for quick, the repo's creation). Week 0 starts here. */
  start: Day
  /** Last day of history (the last commit, or the last push). */
  end: Day
  snapshots: Snapshots
  /** Districts over time; the biggest first by peak files. */
  units: Unit[]
  weekly: Weekly
  /** Biggest first (commits), at most MAX_CONTRIBUTORS. */
  contributors: Contributor[]
  /** Oldest first. */
  releases: Release[]
  /** Oldest first, at most MAX_MILESTONES. */
  milestones: Milestone[]
  /** Quick only: GitHub calls spent building it, and the budget it had. */
  budget?: { calls: number; limit: number }
  /** Sections that failed soft and are missing or approximate (e.g. "bytes", "prs", "contributors"). */
  partial?: string[]
}

export interface RepoMeta {
  /** "owner/name", as GitHub spells it now. */
  name: string
  branch: string
  description?: string
  stars?: number
  forks?: number
  /** When the GitHub repo was created (may be after the first commit, for imported history). */
  created?: Day
  /** [language, percent of bytes] biggest first, one decimal. */
  languages: [string, number][]
  /** Today's size: files and bytes in the final snapshot. */
  files: number
  bytes: number
  /** Commits on the default branch (deep: non-merge commits; quick: absent). */
  commits?: number
  /** Distinct contributors seen (deep: authors; quick: GitHub's contributor list, at most 100). */
  contributors: number
}

export interface Snapshots {
  day: Day[]
  /** Short commit id of each sample (8 hex), where known. */
  sha?: string[]
  /** Totals at each sample (all files, not only the units kept). */
  files: number[]
  bytes: number[]
  /** Indices of samples whose tree GitHub cut short (their counts are low). */
  truncated?: number[]
}

export interface Unit {
  /** "/" (the root's own files), a top-level folder ("src"), or a workspace package ("packages/react"). */
  name: string
  /** The workspace container of a package ("packages"). */
  group?: string
  /** First day it had a file (deep: exact; quick: the first sample that shows it). */
  born: Day
  /** The day its last file went, when it has none at the end. */
  died?: Day
  /** Dominant language name when last seen. */
  language: string
  files: number[]
  bytes: number[]
  /** Several small units pooled into one ("packages/*" or "*"). */
  pooled?: true
}

/** Each series has one entry per week (weeksOf). All optional: what the depth could get. */
export interface Weekly {
  commits?: number[]
  /** Files in the tree at the week's end (deep). */
  files?: number[]
  additions?: number[]
  deletions?: number[]
  prsOpened?: number[]
  prsMerged?: number[]
  prsClosed?: number[]
  issuesOpened?: number[]
  issuesClosed?: number[]
}

export interface Contributor {
  /** Display name (the login when no name is known). */
  name: string
  login?: string
  bot?: true
  first: Day
  last: Day
  commits: number
  /** Week index of `weeks`' first character. */
  from: number
  /** Commits per week from `from` (see the encoding rules above). */
  weeks: string
  /** The unit they touch most (deep only). */
  home?: string
  /** Up to two other units they often touch. */
  also?: string[]
}

export interface Release {
  tag: string
  day: Day
  name?: string
  /** A new major version (x.0.0, or the first release). */
  major?: true
  prerelease?: true
}

export type MilestoneKind = "first-commit" | "born" | "rename" | "refactor" | "release" | "surge"

export interface Milestone {
  day: Day
  kind: MilestoneKind
  /** A short caption, e.g. "packages/react-dom/ appears". */
  text: string
  /** The unit it is about, when it is about one. */
  unit?: string
}

export const MAX_CONTRIBUTORS = 300
export const MAX_MILESTONES = 48

export class ChronicleError extends Error {
  override name = "ChronicleError"
}

export const DAY_MS = 86_400_000

/** The Day of an instant (ms since the epoch, or an ISO string). */
export function dayOf(when: number | string): Day {
  const ms = typeof when === "string" ? Date.parse(when) : when
  return Math.floor(ms / DAY_MS)
}

/** "YYYY-MM-DD" of a Day. */
export function isoOf(day: Day): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** How many weeks every weekly series holds. */
export function weeksOf(c: Pick<Chronicle, "start" | "end">): number {
  return Math.floor((c.end - c.start) / 7) + 1
}

/** A chronicle from its JSON; throws a ChronicleError on another version or a broken shape. */
export function decodeChronicle(text: string): Chronicle {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ChronicleError("not a chronicle: not JSON")
  }
  const c = value as Partial<Chronicle> | null
  if (!c || typeof c !== "object") throw new ChronicleError("not a chronicle")
  if (c.v !== CHRONICLE_VERSION) throw new ChronicleError(`unsupported chronicle version ${String(c.v)}`)
  if (
    (c.depth !== "deep" && c.depth !== "quick") ||
    typeof c.start !== "number" ||
    typeof c.end !== "number" ||
    !c.repo ||
    !c.snapshots ||
    !Array.isArray(c.snapshots.day) ||
    !Array.isArray(c.units) ||
    !Array.isArray(c.contributors) ||
    !Array.isArray(c.releases) ||
    !Array.isArray(c.milestones) ||
    !c.weekly
  )
    throw new ChronicleError("not a chronicle: missing sections")
  const samples = c.snapshots.day.length
  for (const unit of c.units)
    if (unit.files.length !== samples || unit.bytes.length !== samples)
      throw new ChronicleError(`not a chronicle: unit ${unit.name} has the wrong number of samples`)
  return c as Chronicle
}

/** A chronicle from a bundled asset's bytes: gzip (magic 1f 8b) or plain JSON. */
export async function readChronicle(bytes: Uint8Array): Promise<Chronicle> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
    return decodeChronicle(await new Response(stream).text())
  }
  return decodeChronicle(new TextDecoder().decode(bytes))
}

// ── reading it at a day ──

export interface UnitAt {
  name: string
  group?: string
  born: Day
  language: string
  files: number
  bytes: number
}

/** The units alive on `day`, with their interpolated size (at least one file once born). */
export function unitsAt(c: Chronicle, day: Day): UnitAt[] {
  const days = c.snapshots.day
  const out: UnitAt[] = []
  for (const unit of c.units) {
    if (day < unit.born || (unit.died !== undefined && day >= unit.died)) continue
    const files = sample(days, unit.files, unit.born, day)
    const bytes = sample(days, unit.bytes, unit.born, day)
    out.push({
      name: unit.name,
      ...(unit.group ? { group: unit.group } : {}),
      born: unit.born,
      language: unit.language,
      files: Math.max(1, Math.round(files)),
      bytes: Math.max(0, Math.round(bytes)),
    })
  }
  return out
}

/**
 * A column's value on `day`: linear between the samples around it. A unit grows from nothing on its
 * `born` day to the first sample that holds it; after the last sample it holds.
 */
function sample(days: readonly Day[], column: readonly number[], born: Day, day: Day): number {
  const points: [Day, number][] = []
  days.forEach((d, i) => {
    const value = column[i] ?? 0
    if (d >= born || value > 0) points.push([d, value])
  })
  const first = points[0]
  if (!first || first[0] > born) points.unshift([born, 0])
  const after = points.findIndex(([d]) => d >= day)
  if (after === -1) return points[points.length - 1]?.[1] ?? 0
  const [toDay, to] = points[after] as [Day, number]
  const before = points[after - 1]
  if (!before || toDay === day) return to
  const [fromDay, from] = before
  return from + ((to - from) * (day - fromDay)) / (toDay - fromDay)
}

/**
 * The repo's file count at the END of `day` (the growth clock: the island then is `files(t)`, the
 * first N tiles of today's). Read off every count the chronicle holds, oldest first: the sampled
 * commits and, in a deep chronicle, the tree at each week's end (so a drop lands in its week, not
 * smeared between two samples months apart). The last count on or before the day, eased toward the
 * next by the days between; 0 before the first, today's count after the last.
 */
export function filesAt(c: Pick<Chronicle, "snapshots" | "weekly" | "start" | "end">, day: Day): number {
  const points: [Day, number][] = c.snapshots.day.map((d, k) => [d, c.snapshots.files[k] ?? 0])
  c.weekly.files?.forEach((n, w) => {
    points.push([Math.min(c.end, c.start + 7 * w + 6), n])
  })
  // Stable: a week's end-of-week count stays after the samples of its last day.
  points.sort((a, b) => a[0] - b[0])
  let i = -1
  for (let k = 0; k < points.length; k++) if ((points[k] as [Day, number])[0] <= day) i = k
  if (i < 0) return 0
  const [lastDay, here] = points[i] as [Day, number]
  const next = points[i + 1]
  if (!next) return here
  return Math.round(here + ((next[1] - here) * (day - lastDay)) / (next[0] - lastDay))
}
