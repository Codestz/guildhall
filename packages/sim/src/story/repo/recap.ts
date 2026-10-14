/**
 * The Repo Chronicle card's words: one shareable picture per repository, "The Chronicle of
 * owner/repo". The island as it stands today (the hall films it; `files` sizes it), the figures (age,
 * commits, contributors, releases, places, files) and three told highlights:
 *
 *   founding   the place that rose biggest after the first day ("In 2024 `compiler` was founded…"),
 *              when it is a real part of the island today; else its first major (or first release),
 *              else how it began
 *   busiest    the busiest month (a history of two months or more), else the day the island grew most
 *   people     the longest-standing hand, or the one who laid every stone alone
 *
 * If one of them has nothing to say, the first major release or the first release takes its place.
 * Shaped like the session recap (`Recap`), so the ui's card draws both. Pure and deterministic.
 */

import { fnv1a } from "@guildhall/core"
import { type Chronicle, DAY_MS, type Day } from "../../repo/chronicle.ts"
import { compactOf, countOf, type RecapNumber } from "../recap.ts"
import { pick } from "../story.ts"
import { majorsOf } from "./eras.ts"
import { factsOf, founderOf, isPlace, peakOf } from "./facts.ts"
import { figuresOf, nameOf, type RepoStoryOptions } from "./legend.ts"
import {
  code,
  dateOf,
  isRelease,
  MONTHS,
  monthIndex,
  monthOf,
  num,
  plain,
  plural,
  spanOf,
  yearOf,
} from "./words.ts"

/** The site the card's footer names: the hall of a repo is `/hall/<owner>/<repo>` there. */
export const HALL_SITE = "guildhall.codestz.dev"

export type HighlightKind = "founding" | "busiest" | "people" | "release"

export interface RepoHighlight {
  kind: HighlightKind
  /** Epoch ms of what it tells. */
  at: number
  /** The line as the book writes it (code marks kept). */
  text: string
  /** The line as the card draws it: one plain part (no code face on the card). */
  parts: { text: string }[]
}

export interface RepoRecap {
  /** `react/react`: the card reads "The Chronicle of react/react". */
  title: string
  repo: string
  /** The line under the title: `Since May 2013 · thirteen years`. */
  subtitle: string
  numbers: RecapNumber[]
  lines: RepoHighlight[]
  /** The picture's tag: the island today. */
  hero: { label: string; mark: string; at: number }
  /** The island today, for the picture (`files(t)` at the end). */
  files: number
  /** `guildhall.codestz.dev/hall/react/react`. */
  link: string
}

export function repoRecapOf(c: Chronicle, options: RepoStoryOptions = {}): RepoRecap {
  const f = figuresOf(c)
  const days = c.end - c.start + 1
  const since = days < 62 ? `Since ${dateOf(c.start)}` : `Since ${monthOf(c.start)}`
  const numbers: RecapNumber[] = [
    { value: String(f.age.n), label: f.age.unit },
    { value: countOf(f.commits), label: f.commits === 1 ? "commit" : "commits" },
    { value: countOf(f.contributors), label: f.contributors === 1 ? "contributor" : "contributors" },
    { value: countOf(f.releases), label: f.releases === 1 ? "release" : "releases" },
    { value: String(f.places), label: f.places === 1 ? "place" : "places" },
    { value: f.files < 100_000 ? countOf(f.files) : compactOf(f.files), label: "files" },
  ]
  return {
    title: c.repo.name,
    repo: c.repo.name,
    subtitle: `${since} · ${f.age.text}`,
    numbers,
    lines: highlightsOf(c, options),
    hero: { label: "The island today", mark: `${num(c.repo.files)} files`, at: c.end * DAY_MS },
    files: c.repo.files,
    link: `${HALL_SITE}/hall/${c.repo.name}`,
  }
}

const line = (kind: HighlightKind, day: Day, text: string): RepoHighlight => ({
  kind,
  at: day * DAY_MS,
  text,
  parts: [{ text: plain(text) }],
})

/** When, in a highlight's words: `In 2024` over a long history, `On 8 October` over a short one. */
function whenOf(c: Chronicle, day: Day): string {
  if (c.end - c.start < 400) {
    const d = new Date(day * DAY_MS)
    return `On ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  }
  return `In ${yearOf(day)}`
}

export function highlightsOf(c: Chronicle, options: RepoStoryOptions = {}): RepoHighlight[] {
  const out: RepoHighlight[] = []
  const seed = (key: string) => fnv1a(`${c.repo.name}:${key}`)

  // A release: the first major, else the first release.
  const major = majorsOf(c)[0]
  const firstRelease = c.releases.filter(isRelease)[0]
  const release = (): RepoHighlight | undefined => {
    const r = major ?? firstRelease
    if (!r) return undefined
    return line(
      "release",
      r.day,
      major
        ? `${whenOf(c, r.day)} ${code(r.tag)} set sail, its first major.`
        : `${whenOf(c, r.day)} its first release, ${code(r.tag)}, set sail.`,
    )
  }

  // The founding: the biggest place still standing that rose after the first day, when it is a real
  // part of the island today (50 files and a twentieth of them); else the first release, else how it began.
  const later = c.units
    .filter((u) => isPlace(u) && u.born > c.start && u.died === undefined)
    .sort((a, b) => (b.files.at(-1) ?? 0) - (a.files.at(-1) ?? 0) || a.born - b.born)[0]
  const big = later && (later.files.at(-1) ?? 0) >= Math.max(50, 0.05 * c.repo.files)
  const sailed = big ? undefined : release()
  if (sailed) out.push(sailed)
  else if (later && big) {
    const now = later.files.at(-1) ?? peakOf(later)
    const place = options.placeOf?.(later.name)
    const holds = now >= 10 ? `; today it holds ${num(now)} files` : ""
    out.push(
      line(
        "founding",
        later.born,
        place
          ? `${whenOf(c, later.born)} ${place} rose when ${code(later.name)} was founded${holds}.`
          : `${whenOf(c, later.born)} ${code(later.name)} was founded, and a new place rose from the sea${holds}.`,
      ),
    )
  } else {
    const founder = founderOf(c)
    out.push(
      line(
        "founding",
        c.start,
        `${founder ? `${founder} laid` : "It began with"} the first stone on ${dateOf(c.start)}: ${num(c.snapshots.files[0] ?? 0)} files.`,
      ),
    )
  }

  // The busiest stretch.
  const busy = busiestOf(c)
  if (busy) out.push(busy)

  // The longest-standing hand (or the only one).
  const people = c.contributors.filter((p) => !p.bot)
  if (people.length === 1) {
    const p = people[0] as (typeof people)[number]
    const all = c.repo.commits ?? p.commits
    out.push(
      line(
        "people",
        p.first,
        p.commits < all
          ? `${p.name} has laid ${num(p.commits)} of its ${plural(all, "commit")}; bots laid the rest.`
          : `${p.name} has laid every one of its ${plural(p.commits, "commit")} alone.`,
      ),
    )
  } else if (people.length > 1) {
    const p = [...people].sort(
      (a, b) => b.last - b.first - (a.last - a.first) || b.commits - a.commits,
    )[0] as (typeof people)[number]
    const span = spanOf(p.first, p.last)
    out.push(
      line(
        "people",
        p.first,
        pick(
          [
            `${nameOf(p.name)} has stood with it longest: ${span}, ${plural(p.commits, "commit")}.`,
            `No hand has stayed longer than ${nameOf(p.name)}’s: ${span}, ${plural(p.commits, "commit")}.`,
          ],
          seed(`people:${p.name}`),
        ),
      ),
    )
  }

  // A release fills a gap.
  const gap = out.length < 3 && !sailed ? release() : undefined
  if (gap) out.push(gap)
  return out.slice(0, 3)
}

/** The busiest month by commits; over a short history, the day the island grew the most. */
function busiestOf(c: Chronicle): RepoHighlight | undefined {
  const weekly = c.weekly.commits
  if (c.end - c.start >= 61 && weekly) {
    const months = new Map<number, number>()
    weekly.forEach((n, w) => {
      const m = monthIndex(c.start + 7 * w + 3)
      months.set(m, (months.get(m) ?? 0) + n)
    })
    let best: [number, number] | undefined
    for (const entry of months) if (!best || entry[1] > best[1]) best = entry
    if (!best || best[1] === 0) return undefined
    const [m, n] = best
    const day = Math.floor(Date.UTC(Math.floor(m / 12), m % 12, 15) / DAY_MS)
    return line(
      "busiest",
      day,
      pick(
        [
          `The busiest month was ${monthOf(day)}, with ${plural(Math.round(n), "commit")}.`,
          `${monthOf(day)} was its busiest month: ${plural(Math.round(n), "commit")}.`,
        ],
        fnv1a(`${c.repo.name}:busy`),
      ),
    )
  }
  // A short history: the day the island grew the most, from the samples.
  const facts = factsOf(c, dayRange(c))
  let best = facts[0]
  for (const f of facts) if (best && f.filesTo - f.filesFrom > best.filesTo - best.filesFrom) best = f
  if (!best) return undefined
  const grew = best.filesTo - best.filesFrom
  if (grew <= 0) return undefined
  return line(
    "busiest",
    best.span.from,
    best.index === 0
      ? `Its busiest day was its first, ${dateOf(best.span.from)}: the island rose to ${num(best.filesTo)} files by nightfall.`
      : `Its busiest day was ${dateOf(best.span.from)}, when the island grew by ${num(grew)} files.`,
  )
}

function dayRange(c: Chronicle) {
  const out = []
  for (let d = c.start; d <= c.end; d++) out.push({ from: d, to: d })
  return out
}

/** The card's file name: `guildhall-chronicle-react-react.png`. */
export function repoCardName(recap: Pick<RepoRecap, "repo">, format: "landscape" | "portrait"): string {
  const slug = recap.repo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `guildhall-chronicle-${slug || "repo"}${format === "portrait" ? "-portrait" : ""}.png`
}
