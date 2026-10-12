import type { Chronicle, Milestone, MilestoneKind } from "./format.ts"
import { dayAt, type GrowthPlan, timeOfDay } from "./growth.ts"

/**
 * The growth timelapse's story layer (ADR 0021), pure: which of the chronicle's milestones are told
 * as captions (and when), which releases throw a festival, and the counters that tick under the
 * year. Everything is a function of film time, so scrubbing tells the same story.
 */

/** Least film time between two captions, and how long one stays up. */
export const CAPTION_GAP_S = 5
export const CAPTION_HOLD_S = 4.2
/** Least film time between two festivals (a festival's bunting stays up ~9 s of film). */
export const FESTIVAL_GAP_S = 12

export interface GrowthCaption {
  /** Film time it appears. */
  t: number
  kind: MilestoneKind | "gone" | "built"
  /** "2017", "Oct 2026" for a short history. */
  when: string
  /** The milestone's own words. */
  text: string
  /** One quiet line under it, by kind. */
  tagline: string
}

/** Listed contributors' first days, sorted; the total they stand for. */
export interface People {
  firsts: number[]
  contributors: number
}

/** A thing built the film marks on its tape (growthBuild.ts): "the castle is raised". Gen 2 films only. */
export interface BuiltMoment {
  t: number
  text: string
}

export interface GrowthStory extends People {
  captions: GrowthCaption[]
  /** Film times a major release throws a festival. */
  festivals: number[]
  moments: BuiltMoment[]
}

export function peopleOf(c: Chronicle): People {
  const firsts = c.contributors.filter((person) => !person.bot).map((person) => person.first)
  firsts.sort((a, b) => a - b)
  return { firsts, contributors: Math.max(c.repo.contributors, firsts.length) }
}

const TAGLINE: Record<GrowthCaption["kind"], string> = {
  "first-commit": "The first stone is laid",
  release: "A release goes out",
  born: "A new district rises from the sea",
  rename: "A district takes a new name",
  refactor: "The island is reshaped",
  surge: "New hands arrive",
  gone: "Its land sinks back into the sea",
  built: "Raised by the repo's own hands",
}
/** What wins a crowded moment: a birth, a major release, a rename… a minor release last. */
const PRIORITY: Record<GrowthCaption["kind"], number> = {
  "first-commit": 7,
  born: 5,
  rename: 3,
  gone: 3,
  refactor: 2,
  surge: 1,
  release: 1,
  built: 1,
}

/** A real major version (1.0.0 and up, not a prerelease): the ones worth a festival. */
export function isMajor(tag: string, prerelease?: boolean): boolean {
  const match = /^v?(\d+)\.0\.0$/.exec(tag)
  return !prerelease && match !== null && Number(match[1]) >= 1
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** A day as the HUD names it: "May 2013", or "Oct 6, 2026" when the whole history is a few months. */
export function dateLabel(day: number, span: number): string {
  const date = new Date(Math.floor(day) * 86_400_000)
  const month = MONTHS[date.getUTCMonth()] ?? ""
  return span < 120
    ? `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
    : `${month} ${date.getUTCFullYear()}`
}

/** The year (or, for a short history, the date) a caption is headed with. */
function whenOf(day: number, span: number): string {
  return span < 730 ? dateLabel(day, span) : String(new Date(day * 86_400_000).getUTCFullYear())
}

export function storyOf(c: Chronicle, g: GrowthPlan, moments: BuiltMoment[] = []): GrowthStory {
  const span = c.end - c.start
  // Ghosts that were a big part of their island get a line when they go.
  const gone: Milestone[] = g.ghosts
    .filter((ghost) => Number.isFinite(ghost.died) && ghost.hexes.length >= 6)
    .slice(0, 2)
    .flatMap((ghost) => {
      const unit = c.units.find((u) => u.name === ghost.name)
      return unit?.died === undefined
        ? []
        : [
            {
              day: unit.died,
              kind: "gone" as MilestoneKind,
              text: `${ghost.name}/ is gone`,
              unit: ghost.name,
            },
          ]
    })
  // Between two of a kind, the one more people call home wins (where the work is).
  const homes = new Map<string, number>()
  for (const person of c.contributors)
    if (person.home) homes.set(person.home, (homes.get(person.home) ?? 0) + 1)
  const most = Math.max(1, ...homes.values())
  const wanted = [...c.milestones, ...gone]
    .map((m) => {
      const release = c.releases.find((r) => m.kind === "release" && m.text.startsWith(r.tag))
      const major = release ? isMajor(release.tag, release.prerelease) : false
      const people = (homes.get(m.unit ?? "") ?? 0) / most
      return { m, rank: PRIORITY[m.kind as GrowthCaption["kind"]] + (major ? 3 : 0) + 0.9 * people }
    })
    .sort((a, b) => b.rank - a.rank || a.m.day - b.m.day)
  const captions: GrowthCaption[] = []
  for (const { m } of wanted) {
    const t = timeOfDay(g, m.day)
    if (captions.some((caption) => Math.abs(caption.t - t) < CAPTION_GAP_S)) continue
    const kind = m.kind as GrowthCaption["kind"]
    captions.push({ t, kind, when: whenOf(m.day, span), text: m.text, tagline: TAGLINE[kind] })
  }
  captions.sort((a, b) => a.t - b.t)

  const festivals: number[] = []
  for (const release of c.releases) {
    if (!isMajor(release.tag, release.prerelease)) continue
    const t = timeOfDay(g, release.day)
    if (festivals.every((f) => Math.abs(f - t) >= FESTIVAL_GAP_S)) festivals.push(t)
  }

  return { captions, festivals, moments, ...peopleOf(c) }
}

/** The caption up at film time `t`, if any. */
export function captionAt(story: GrowthStory, t: number): GrowthCaption | undefined {
  for (let i = story.captions.length - 1; i >= 0; i--) {
    const caption = story.captions[i] as GrowthCaption
    if (caption.t <= t) return t < caption.t + CAPTION_HOLD_S ? caption : undefined
  }
  return undefined
}

/** The moment built just now (growthBuild.ts), told like a caption when no milestone is being told. */
export function momentAt(story: GrowthStory, g: GrowthPlan, t: number): GrowthCaption | undefined {
  const moment = story.moments.find((m) => t >= m.t && t < m.t + CAPTION_HOLD_S)
  if (!moment) return undefined
  const span = g.end - g.start
  return {
    t: moment.t,
    kind: "built",
    when: whenOf(dayAt(g, moment.t), span),
    text: moment.text,
    tagline: TAGLINE.built,
  }
}

/** The festival whose window holds `t` (index into `festivals`), or -1. */
export function festivalAt(story: GrowthStory, t: number, window: number): number {
  return story.festivals.findIndex((f) => t >= f && t < f + window)
}

/**
 * Contributors by `day`: the listed ones who had started, scaled up to the repo's whole count (the
 * list holds the busiest few hundred), exactly the whole count by the last day.
 */
export function contributorsAt(story: People, day: number, end: number): number {
  if (day >= end) return story.contributors
  const { firsts } = story
  let lo = 0
  let hi = firsts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((firsts[mid] as number) <= day) lo = mid + 1
    else hi = mid
  }
  return firsts.length === 0 ? 0 : Math.round((lo / firsts.length) * story.contributors)
}

/** Files in the tree on `day`: the chronicle's samples, linear between them, today's at the end. */
export function filesAt(c: Chronicle, day: number): number {
  if (day >= c.end) return c.repo.files
  let d0 = c.start
  let f0 = 0
  for (let i = 0; i < c.snapshots.day.length; i++) {
    const d = c.snapshots.day[i] as number
    const f = c.snapshots.files[i] as number
    if (d >= day) return Math.round(d <= d0 ? f : f0 + ((f - f0) * (day - d0)) / (d - d0))
    d0 = d
    f0 = f
  }
  return Math.round(f0 + ((c.repo.files - f0) * (day - d0)) / Math.max(1, c.end - d0))
}
