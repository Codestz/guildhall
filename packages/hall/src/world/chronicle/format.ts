/**
 * A repo's Chronicle (format v1): its history, compact enough to ship as a lazy asset and to build
 * live from GitHub's API. What the hall reads to show a repo island's TIME (growth), PEOPLE
 * (contributors as townsfolk), EVENTS (releases, PRs, issues, milestones) and SCALE.
 *
 * Why snapshots of districts, not one tree with per-path birth dates: the question a timelapse asks
 * is "which districts exist, and how big, at time t" — answered by a few dozen samples of each
 * district (a "unit", below), not by 20 000 paths (react's final tree alone is ~1 MB of JSON; per-path
 * births would not fit a 150 KB budget). Births and deaths are kept exactly (to the day) per unit, so
 * a district appears when it truly did, and its size is interpolated between samples
 * (reconstruct.ts). The final island itself stays islandFromTree(today's tree), untouched; the
 * chronicle's units are named as summarize (world/gen/repo.ts) names its districts, so each maps
 * onto one (reconstruct.ts: districtsAt).
 *
 * Encoding rules (gzip-friendly JSON, no whitespace):
 * - A `Day` is whole days since 1970-01-01 UTC (`dayOf`, `isoOf`).
 * - Week `i` is the 7 days from `start + 7i`; every weekly series has `weeksOf(c)` entries.
 * - Per-snapshot series (`Unit.files`, `Unit.bytes`, `snapshots.*`) are columns aligned to
 *   `snapshots.day`, oldest first; 0 means the unit had no files then.
 * - `Contributor.weeks` is one character per week from week `Contributor.from`: '0'–'9' then 'a'–'z'
 *   for 0–35 commits that week (35 means 35 or more); trailing quiet weeks are trimmed.
 * - Optional fields are left out, never null. A section that could not be had is named in `partial`.
 *
 * An avatar is not stored: it is https://avatars.githubusercontent.com/<login> for any login.
 */

export const CHRONICLE_VERSION = 1

/** Whole days since 1970-01-01 UTC. */
export type Day = number

export interface Chronicle {
  v: typeof CHRONICLE_VERSION
  /** deep: built offline from a clone (scripts/chronicle.ts); quick: live from ~20 API calls (quick.ts). */
  depth: "deep" | "quick"
  /** ISO time it was built. */
  generatedAt: string
  repo: RepoMeta
  /** First day of history (the first commit; for quick, the repo's creation). Week 0 starts here. */
  start: Day
  /** Last day of history (the last commit, or the last push). */
  end: Day
  snapshots: Snapshots
  /** Districts over time, as summarize names them; the biggest first by peak files. */
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
  /** Dominant language name (biomes.ts' names) when last seen. */
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
  /** Lines added / deleted (GitHub's code_frequency). */
  additions?: number[]
  deletions?: number[]
  prsOpened?: number[]
  prsMerged?: number[]
  /** Closed without merging. */
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
  /** A short caption, e.g. "packages/react-dom appears". */
  text: string
  /** The unit it is about, when it is about one. */
  unit?: string
}

export const MAX_CONTRIBUTORS = 300
export const MAX_MILESTONES = 48

export class ChronicleError extends Error {
  override name = "ChronicleError"
}

const DAY_MS = 86_400_000

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

/** The week index a Day falls in, clamped to the chronicle's weeks. */
export function weekOf(c: Pick<Chronicle, "start" | "end">, day: Day): number {
  return Math.max(0, Math.min(weeksOf(c) - 1, Math.floor((day - c.start) / 7)))
}

/** One week's commit count as its activity character. */
export function activityChar(commits: number): string {
  return Math.max(0, Math.min(35, Math.round(commits))).toString(36)
}

/** A contributor's commits in week `week` (0 outside their span). */
export function activityAt(contributor: Pick<Contributor, "from" | "weeks">, week: number): number {
  const char = contributor.weeks[week - contributor.from]
  return char ? Number.parseInt(char, 36) : 0
}

/** The chronicle as compact JSON. */
export function encodeChronicle(c: Chronicle): string {
  return JSON.stringify(c)
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
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))
    return decodeChronicle(await new Response(stream).text())
  }
  return decodeChronicle(new TextDecoder().decode(bytes))
}
