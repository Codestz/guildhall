/**
 * The history's moments (user 10-14, "events while the island grows"): what the hall narrates while it
 * plays a repo's growth, read off the chronicle as V1's growth film told it (legacy growthStory.ts) and
 * then some: the first commit and its author, the notable hands arriving, the places founded, the
 * releases, the eras opening like acts, the island passing round sizes, the great reshapings and the
 * places that sink. Each moment carries its day, a weight (how notable: the hall's schedule keeps the
 * heaviest when they crowd) and its line in parts (names in their colour, as the narrator's pill draws
 * them). Present tense: the story is told as it happens.
 *
 * Pure and deterministic: the same chronicle (and eras) always gives the same moments, oldest first.
 */
import { fnv1a } from "@guildhall/core"
import { type Chronicle, type Contributor, type Day, filesAt, type Unit } from "../../repo/chronicle.ts"
import type { CaptionPart } from "../story.ts"
import { isPlace, peakOf, renamingsOf, reshapedFiles } from "./facts.ts"
import { nameOf } from "./legend.ts"
import { isMajor, isRelease, majorName, num } from "./words.ts"

export type HistoryMomentKind =
  /** The first commit: the island is founded. */
  | "founded"
  /** A notable hand's first commit. */
  | "arrival"
  /** A unit is born: a place rises. */
  | "place"
  | "release"
  /** An era opens (an act title: numeral, title, tagline). */
  | "era"
  /** The island passes a round size, or the guild a round number of hands. */
  | "milestone"
  /** One commit moves and remakes a great many files. */
  | "reshaped"
  /** A place sinks back into the sea (its unit's last file went). */
  | "gone"
  | "renamed"

export interface HistoryMoment {
  /** Stable id: kind and what it is about (`place:packages/react-dom`). */
  id: string
  day: Day
  kind: HistoryMomentKind
  /** How notable, ~0–100: a crowded stretch keeps the heaviest. */
  weight: number
  /** The line, for a screen reader, the feed and the toasts. */
  text: string
  /** The line as the narrator's pill draws it: names in their colour. */
  parts: CaptionPart[]
  /** An era's title card: `Chapter II`, `The Age of v15`, `v15.0.0 sets sail · April 2016`. */
  chapter?: { act: string; title: string; tagline: string }
  /** The unit it is about (a place's plate flashes). */
  unit?: string
  /** The contributor it is about. */
  who?: string
}

/** An era as the moments open it: the hall passes repoLegendOf's (its titles are the book's). */
export interface MomentEra {
  /** First day. */
  from: Day
  numeral: string
  title: string
  /** `April 2016 – September 2017`. */
  span: string
  /** The release that opened it. */
  release?: string
}

export interface MomentOptions {
  /** The book's eras (repoLegendOf); without them no era opens. */
  eras?: readonly MomentEra[]
  /** The place a unit stands for on the island: `the village of react-dom` (as the book names it). */
  placeOf?: (unit: string) => string | undefined
}

/** A place told when founded: at least this many files at its peak (a stub folder is no village). */
export const PLACE_MIN_FILES = 10
/** A hand told on arrival: among the busiest this many… */
export const ARRIVALS_MAX = 24
/** …with at least this many commits, and this share of the busiest hand's. */
export const ARRIVAL_MIN_COMMITS = 20
export const ARRIVAL_SHARE = 0.05
/** The round sizes the island passes, files. */
export const FILE_MARKS = [100, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000]
/** The round numbers of hands the guild passes. */
export const HAND_MARKS = [10, 100, 500, 1000, 5000]
/** A reshaping told: at least this many files moved in one commit. */
const RESHAPED_MIN = 300
/** A place told when it sinks: at least this many files at its peak. */
const GONE_MIN = 40

/** The colour a person's name is drawn in: a warm banner, fixed by the name. */
const HANDS = ["#dcb662", "#e08a5b", "#9fc27a", "#7fb4d9", "#c99ad6", "#e3c46d", "#d9796f", "#8fd1b8"]
/** A place's name is drawn in the hall's brass. */
const PLACE = "#dcb662"

export function handColour(name: string): string {
  return HANDS[fnv1a(name) % HANDS.length] as string
}

const short = (unit: string) => unit.replace(/\/$/, "")
const log10 = (n: number) => Math.log10(Math.max(1, n))

/** `Ben Newman` from V1's first-commit milestone (`First commit, by Ben Newman`). */
function founderName(c: Chronicle): string | undefined {
  const m = c.milestones.find((x) => x.kind === "first-commit")
  return m ? /by (.+)$/.exec(m.text)?.[1]?.trim() : undefined
}

/** Builds a line from pieces: a string is plain text, `[text, colour]` a name. */
function line(...pieces: (string | readonly [string, string])[]): { text: string; parts: CaptionPart[] } {
  const parts = pieces.map((p) => (typeof p === "string" ? { text: p } : { text: p[0], color: p[1] }))
  return { text: parts.map((p) => p.text).join(""), parts }
}

/** A name a machine goes by that the chronicle did not mark a bot (`CommitSyncScript`, `renovate[bot]`). */
const MACHINE = /bot\b|\[bot\]|script$|^github-actions/i

/** The hands the hall tells of when they arrive: the busiest few, bots aside, not the founder's first day. */
export function notableHands(c: Chronicle): Contributor[] {
  const people = c.contributors
    .filter((p) => !p.bot && !MACHINE.test(p.name) && !MACHINE.test(p.login ?? ""))
    .sort((a, b) => b.commits - a.commits || a.first - b.first)
  const top = people[0]?.commits ?? 0
  const least = Math.max(ARRIVAL_MIN_COMMITS, ARRIVAL_SHARE * top)
  return people.slice(0, ARRIVALS_MAX).filter((p) => p.commits >= least && p.first > c.start)
}

/**
 * The chronicle's hands by `day`: the listed ones who had begun, scaled to the repo's whole count (the
 * list holds the busiest few hundred; V1 `contributorsAt`, the bar's growth line).
 */
export function handsAt(c: Chronicle, day: Day): number {
  const listed = c.contributors.filter((p) => !p.bot)
  if (day >= c.end) return c.repo.contributors
  if (listed.length === 0) return 0
  const begun = listed.filter((p) => p.first <= day).length
  return Math.round((begun / listed.length) * Math.max(c.repo.contributors, listed.length))
}

export function historyMomentsOf(c: Chronicle, options: MomentOptions = {}): HistoryMoment[] {
  const out: HistoryMoment[] = []
  const add = (m: HistoryMoment) => out.push(m)
  const repo = c.repo.name.split("/").pop() ?? c.repo.name

  // the founding: the first commit's author, the island rising
  const founder = founderName(c)
  {
    const l = founder
      ? line(
          [nameOf(founder), handColour(founder)],
          " makes the first commit: the island of ",
          [repo, PLACE],
          " is founded",
        )
      : line("The first commit: the island of ", [repo, PLACE], " is founded")
    add({
      id: "founded",
      day: c.start,
      kind: "founded",
      weight: 100,
      ...l,
      ...(founder ? { who: founder } : {}),
    })
  }

  // the eras, as acts; the first opens with the founding, which tells it (its heading weighs nothing)
  const eras = options.eras ?? []
  eras.forEach((e, i) => {
    const opening = i === 0 || e.from <= c.start
    const tagline = e.release ? `${e.release} sets sail · ${e.span}` : e.span
    add({
      id: `era:${i + 1}`,
      day: Math.max(c.start, e.from),
      kind: "era",
      weight: opening ? 0 : 90,
      text: `Chapter ${e.numeral}: ${e.title}. ${tagline}.`,
      parts: [{ text: `Chapter ${e.numeral}` }, { text: e.title }, { text: tagline }],
      chapter: { act: `Chapter ${e.numeral}`, title: e.title, tagline },
    })
  })
  const opened = new Set(eras.slice(1).flatMap((e) => (e.release ? [e.release] : [])))

  // releases: the first ever, and every main-line major an era does not already open
  const releases = c.releases.filter(isRelease).sort((a, b) => a.day - b.day)
  const first = releases[0]
  const told = new Set<string>()
  if (first && first.day >= c.start) {
    told.add(first.tag)
    add({
      id: `release:${first.tag}`,
      day: first.day,
      kind: "release",
      weight: 62,
      ...line([first.tag, PLACE], ", the first release, sets sail from the harbour"),
    })
  }
  for (const r of releases) {
    if (!isMajor(r) || told.has(r.tag) || opened.has(r.tag) || r.day <= c.start) continue
    told.add(r.tag)
    add({
      id: `release:${r.tag}`,
      day: r.day,
      kind: "release",
      weight: 72,
      ...line([r.tag, PLACE], ` is released: the age of ${majorName(r.tag)} begins`),
    })
  }

  // the places founded (renamed into is not founded), biggest first by weight
  const renamings = renamingsOf(c)
  const renamedInto = new Set(renamings.map((r) => `${short(r.to)}@${r.day}`))
  const renamedAway = new Set(renamings.map((r) => `${short(r.from)}@${r.day}`))
  for (const u of c.units) {
    if (!isPlace(u) || u.born <= c.start || renamedInto.has(`${short(u.name)}@${u.born}`)) continue
    const peak = peakOf(u)
    if (peak < PLACE_MIN_FILES) continue
    const place = options.placeOf?.(u.name)
    const l = place
      ? line([short(u.name), PLACE], ` is founded: ${place} rises`)
      : line([short(u.name), PLACE], " is founded: a new place rises from the sea")
    add({
      id: `place:${u.name}`,
      day: u.born,
      kind: "place",
      weight: 38 + 8 * log10(peak),
      ...l,
      unit: u.name,
    })
  }

  // the notable hands, on their first commit
  for (const p of notableHands(c)) {
    add({
      id: `arrival:${p.login ?? p.name}`,
      day: p.first,
      kind: "arrival",
      weight: 28 + 8 * log10(p.commits),
      ...line([nameOf(p.name), handColour(p.name)], ` arrives: the first of ${num(p.commits)} commits`),
      who: p.name,
    })
  }

  // the island passing round sizes (not one it was born past)
  // read a few hundred days along the history, not every one (filesAt reads the whole chronicle)
  const step = Math.max(1, Math.floor((c.end - c.start) / 400))
  const born = filesAt(c, c.start)
  let mark = 0
  for (let d = c.start; d <= c.end && mark < FILE_MARKS.length; d += step) {
    const files = filesAt(c, d)
    while (mark < FILE_MARKS.length && files >= (FILE_MARKS[mark] as number)) {
      const n = FILE_MARKS[mark] as number
      if (born < n)
        add({
          id: `files:${n}`,
          day: d,
          kind: "milestone",
          weight: 44 + 3 * log10(n),
          ...line(`The island passes ${num(n)} files`),
        })
      mark++
    }
  }
  // …and the guild round numbers of hands
  if (c.contributors.some((p) => !p.bot)) {
    let hand = 0
    for (let d = c.start; d <= c.end && hand < HAND_MARKS.length; d += step) {
      const hands = handsAt(c, d)
      while (hand < HAND_MARKS.length && hands >= (HAND_MARKS[hand] as number)) {
        const n = HAND_MARKS[hand] as number
        if (d > c.start)
          add({
            id: `hands:${n}`,
            day: d,
            kind: "milestone",
            weight: 42 + 3 * log10(n),
            ...line(`${num(n)} hands have now worked on `, [repo, PLACE]),
          })
        hand++
      }
    }
  }

  // the great reshapings
  for (const m of c.milestones) {
    if (m.kind !== "refactor") continue
    const files = reshapedFiles(m)
    if (files < RESHAPED_MIN) continue
    add({
      id: `reshaped:${m.day}`,
      day: m.day,
      kind: "reshaped",
      weight: 30 + 6 * log10(files),
      ...line(`A single commit reshapes ${num(files)} files`),
    })
  }

  // places sinking (renamed away is not gone)
  for (const u of c.units as Unit[]) {
    if (!isPlace(u) || u.died === undefined || renamedAway.has(`${short(u.name)}@${u.died}`)) continue
    const peak = peakOf(u)
    if (peak < GONE_MIN) continue
    add({
      id: `gone:${u.name}`,
      day: u.died,
      kind: "gone",
      weight: 30 + 6 * log10(peak),
      ...line([short(u.name), PLACE], " is cleared away: its land sinks back into the sea"),
      unit: u.name,
    })
  }

  // renamings, quietly
  for (const r of renamings)
    add({
      id: `renamed:${short(r.from)}>${short(r.to)}`,
      day: r.day,
      kind: "renamed",
      weight: 26,
      ...line([short(r.from), PLACE], " takes a new name: ", [short(r.to), PLACE]),
      unit: short(r.to),
    })

  return (
    out
      .filter((m) => m.day >= c.start && m.day <= c.end)
      // a day's era heading before its moments
      .sort(
        (a, b) =>
          a.day - b.day ||
          Number(b.kind === "era") - Number(a.kind === "era") ||
          b.weight - a.weight ||
          (a.id < b.id ? -1 : 1),
      )
  )
}
