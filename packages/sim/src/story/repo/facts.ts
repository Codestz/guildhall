/**
 * What happened in an era, as facts read off the chronicle (no words yet): the island's size at both
 * ends, the commits, releases, places founded, renamed and gone, who joined, the busiest week, the
 * great reshapings. legend.ts tells them; recap.ts picks the card's highlights from the same reads.
 */
import {
  type Chronicle,
  type Contributor,
  type Day,
  filesAt,
  type Milestone,
  type Release,
  type Unit,
} from "../../repo/chronicle.ts"
import { commitsIn, type EraSpan } from "./eras.ts"
import { isMajor, isRelease } from "./words.ts"

export interface Renaming {
  day: Day
  from: string
  to: string
}

export interface Shrink {
  day: Day
  from: number
  to: number
}

export interface EraFacts {
  span: EraSpan
  index: number
  /** Files before the era began (0 for the first) and at its end. */
  filesFrom: number
  filesTo: number
  /** Commits in the era (the weekly counts shared out by day). */
  commits: number
  releases: Release[]
  /** The first release the repo ever made, when it is in this era. */
  firstRelease?: Release
  majors: Release[]
  /** Places founded (not renamed into, not the root, a pool or a dot folder), biggest first. */
  founded: Unit[]
  /** Places there in the first commit (the first era only), biggest first. */
  original: Unit[]
  /** The place that grew the most in the era (files), when one grew. */
  grew?: { unit: string; from: number; to: number }
  renamed: Renaming[]
  /** Places that went for good (not renamed away), with at least SIGNIFICANT files at their peak. */
  gone: Unit[]
  /** New hands (bots aside), most commits first. */
  joined: Contributor[]
  reshaped: Milestone[]
  shrink?: Shrink
  busiest?: { day: Day; commits: number }
  firstCommit?: Milestone
}

/** A place's least peak size to be told of when it goes. */
const SIGNIFICANT = 20

/** A unit the island shows as a place of its own (not the root's files, a pool, or a dot folder). */
export function isPlace(u: Pick<Unit, "name"> & { pooled?: true }): boolean {
  return u.name !== "/" && !u.pooled && !u.name.startsWith(".") && !u.name.endsWith("*")
}

export const peakOf = (u: Unit): number => Math.max(0, ...u.files)

/**
 * The places standing at the end of history: every unit still alive but the root's own files, dot
 * folders and the loose wilds (`*`); a workspace's pool of small packages (`packages/*`) is one hamlet.
 */
export function placesNow(c: Chronicle): number {
  return c.units.filter(
    (u) => u.name !== "/" && u.name !== "*" && !u.name.startsWith(".") && u.died === undefined,
  ).length
}

/** `internal/ becomes packages/tui/` → { from, to }. */
export function renamingsOf(c: Chronicle): Renaming[] {
  return c.milestones.flatMap((m) => {
    if (m.kind !== "rename") return []
    const match = /^(.+?)\/? becomes (.+?)\/?$/.exec(m.text)
    return match ? [{ day: m.day, from: match[1] as string, to: match[2] as string }] : []
  })
}

export function factsOf(c: Chronicle, spans: readonly EraSpan[]): EraFacts[] {
  const renamings = renamingsOf(c)
  const renamedInto = new Set(renamings.map((r) => `${r.to}@${r.day}`))
  const renamedAway = new Set(renamings.map((r) => `${r.from}@${r.day}`))
  const releases = c.releases.filter(isRelease).sort((a, b) => a.day - b.day)
  const firstRelease = releases[0]
  const people = c.contributors.filter((p) => !p.bot)
  const weekly = c.weekly.commits ?? []
  const snaps = c.snapshots

  return spans.map((span, index) => {
    const inside = (day: Day) => day >= span.from && day <= span.to
    const units = c.units.filter((u) => isPlace(u))
    const founded = units
      .filter((u) => inside(u.born) && u.born > c.start && !renamedInto.has(`${u.name}@${u.born}`))
      .sort((a, b) => peakOf(b) - peakOf(a) || a.born - b.born)
    const original =
      index === 0
        ? units.filter((u) => (u.files[0] ?? 0) > 0).sort((a, b) => (b.files[0] ?? 0) - (a.files[0] ?? 0))
        : []
    let grew: EraFacts["grew"]
    for (const u of units) {
      const from = index === 0 ? 0 : unitFilesAt(c, u, span.from - 1)
      const to = unitFilesAt(c, u, span.to)
      if (to - from > (grew ? grew.to - grew.from : 0)) grew = { unit: u.name, from, to }
    }
    const gone = units
      .filter(
        (u) =>
          u.died !== undefined &&
          inside(u.died) &&
          !renamedAway.has(`${u.name}@${u.died}`) &&
          peakOf(u) >= SIGNIFICANT,
      )
      .sort((a, b) => peakOf(b) - peakOf(a))
    const joined = people.filter((p) => inside(p.first)).sort((a, b) => b.commits - a.commits)

    // The biggest drop between two samples ending in the era: a quarter of the island or more, 100+ files.
    let shrink: Shrink | undefined
    for (let k = 1; k < snaps.day.length; k++) {
      const day = snaps.day[k] as Day
      const from = snaps.files[k - 1] ?? 0
      const to = snaps.files[k] ?? 0
      if (!inside(day) || from - to < 100 || to > from * 0.75) continue
      if (!shrink || from - to > shrink.from - shrink.to) shrink = { day, from, to }
    }

    // The busiest whole week inside an era of three weeks or more.
    let busiest: EraFacts["busiest"]
    if (span.to - span.from >= 20)
      weekly.forEach((n, w) => {
        const day = c.start + 7 * w
        if (day >= span.from && day + 6 <= span.to && n > (busiest?.commits ?? 0))
          busiest = { day, commits: n }
      })

    const mine = releases.filter((r) => inside(r.day))
    const first = c.milestones.find((m) => m.kind === "first-commit" && inside(m.day))
    return {
      span,
      index,
      filesFrom: index === 0 ? 0 : filesAt(c, span.from - 1),
      filesTo: filesAt(c, span.to),
      commits: commitsIn(c, span.from, span.to),
      releases: mine,
      ...(firstRelease && inside(firstRelease.day) ? { firstRelease } : {}),
      majors: mine.filter(isMajor),
      founded,
      original,
      ...(grew ? { grew } : {}),
      renamed: renamings.filter((r) => inside(r.day)),
      gone,
      joined,
      reshaped: c.milestones.filter((m) => m.kind === "refactor" && inside(m.day)),
      ...(shrink ? { shrink } : {}),
      ...(busiest && busiest.commits >= 5 ? { busiest } : {}),
      ...(first ? { firstCommit: first } : {}),
    }
  })
}

/**
 * A unit's files at the END of `day`, from the samples (as `filesAt` reads the whole tree): the last
 * sample on or before the day, eased toward the next; 0 before it was born or after it died.
 */
export function unitFilesAt(c: Chronicle, u: Unit, day: Day): number {
  if (day < u.born || (u.died !== undefined && day >= u.died)) return 0
  const days = c.snapshots.day
  let i = -1
  for (let k = 0; k < days.length; k++) if ((days[k] as Day) <= day) i = k
  if (i < 0) return 0
  const here = u.files[i] ?? 0
  const nextDay = days[i + 1]
  if (nextDay === undefined) return here
  const next = u.files[i + 1] ?? here
  return Math.round(here + ((next - here) * (day - (days[i] as Day))) / (nextDay - (days[i] as Day)))
}

/** Reshaped files of a refactor milestone (`1433 files reshaped in one commit`). */
export function reshapedFiles(m: Milestone): number {
  return Number(/(\d+)/.exec(m.text)?.[1] ?? 0)
}

/** The first commit's author, from its milestone (`First commit, by Ben Newman`). */
export function founderOf(c: Chronicle): string | undefined {
  const m = c.milestones.find((x) => x.kind === "first-commit")
  return m ? /by (.+)$/.exec(m.text)?.[1]?.trim() : undefined
}
