import type { Session } from "@guildhall/core"
import { renownOf } from "./events.ts"
import { costOf, duration, type Legend } from "./legends.ts"
import type { Moment } from "./moments.ts"
import { type BeatKind, beatOf, type CaptionPart, type Lookup, lineOf, renownLine } from "./story.ts"

/**
 * The Chronicle card (roadmap: "auto-made recaps — people share recaps, not dashboards"): a session
 * told as one picture. Pure, like guild/legends.ts: built from the moment history and the party's
 * sessions, so a seek gives the same recap as playing through. hud/Recap.tsx films the hero shot
 * and draws the card (hud/RecapDraw.ts); `recapQuery` is the link that reproduces the shot.
 *
 *   hero      the session's most notable moment, scored by the recap's own table (HERO_WEIGHTS)
 *             plus what makes a picture: a release's galleon, a red-then-green recovery, the
 *             biggest loot, a fall and a rise, the quest's end
 *   numbers   adventurers, deeds, quests, tokens and cost (when known), how long it ran
 *   lines     three captions (guild/story.ts lineOf / renownLine), the best beats, in story order
 */

/** What the hero shot frames: an adventurer (followed, by id; linked by title), or a sea place. */
export type HeroSubject =
  | { kind: "adventurer"; id: string; title: string; color: string }
  | { kind: "sea"; moment: "sea-release" | "sea-merged" | "sea-green" | "sea-red" }

export interface Hero {
  /** Why it was picked, for the card's caption tag: `The galleon comes in`. */
  label: string
  /** The moment's run time, ms. */
  at: number
  /**
   * Run time to film, ms: a little after the moment (the galleon anchored, the loot home), on a
   * whole second, because a link's `t` is `mm:ss`.
   */
  shot: number
  subject: HeroSubject
  /** Its score (for the tests). */
  score: number
}

export interface RecapNumber {
  /** `142`, `1.2k`, `17m 05s`. */
  value: string
  /** `deeds`. */
  label: string
}

export interface RecapLine {
  at: number
  kind: BeatKind | "renown"
  parts: CaptionPart[]
  text: string
}

export interface Recap {
  /** The quest, as the book titles it. */
  title: string
  /** The guild's name: the repo (`facebook/react`), the live guild, or the story's. */
  guild: string
  /** `The Saga · Act V`, `Live`, … */
  story: string
  outcome: Legend["outcome"]
  numbers: RecapNumber[]
  lines: RecapLine[]
  hero: Hero | undefined
}

/**
 * What each kind is worth as a hero picture: the recap's own table. The director's (WEIGHTS) is
 * about live attention and gives the sea 0 (nobody to film: the harbour is hinted instead), but a
 * release's galleon or a red-then-green lighthouse is exactly the picture a recap wants.
 */
export const HERO_WEIGHTS: Partial<Record<Moment["kind"], number>> = {
  "sea-release": 14,
  "sea-green": 11,
  recover: 10,
  "sea-merged": 9,
  loot: 7,
  fail: 5,
  "sea-red": 4,
  quest: 5,
  "deed-failed": 2,
}

/** How long after the moment the shot is taken, ms: the thing has happened and is on screen. */
const AFTER: Partial<Record<Moment["kind"], number>> = {
  "sea-release": 13_500, // GALLEON_MS (scene/seas/fleet.ts) and a beat at anchor: the flourish
  "sea-merged": 13_000, // MERGE_MS: moored at the quay
  "sea-green": 1500,
  "sea-red": 1500,
  loot: 1500,
  recover: 1500,
  fail: 1500,
  quest: 2000,
}

const LABEL: Partial<Record<Moment["kind"], (m: Moment) => string>> = {
  "sea-release": (m) =>
    "event" in m && m.event.kind === "release" ? `${m.event.tag}: a galleon comes in` : "A galleon comes in",
  "sea-merged": () => "A merged ship comes home",
  "sea-green": () => "The lighthouse burns warm again",
  "sea-red": () => "The lighthouse burns red",
  loot: (m) => (m.parent ? `The ${m.title} brings the loot home` : "The quest is done"),
  recover: (m) => `The ${m.title} rises again`,
  fail: (m) => `The ${m.title} falls`,
  quest: (m) => `The ${m.title} sends out a quest`,
  "deed-failed": (m) => `The ${m.title}'s trial fails`,
}

/**
 * The session's most notable moment, or undefined before anything happened. Every candidate is
 * scored by its kind's worth as a picture (HERO_WEIGHTS; kinds not in it are never heroes: a plea,
 * a join, a routine deed), and lifted by context:
 * a green after a red (a recovery), a rise after a fall, the loot of whoever did the most deeds, the
 * guildmaster's loot (the end). Ties go to the later moment: the story's climax over its opening.
 */
export function heroOf(told: readonly Moment[], sessions: readonly Session[]): Hero | undefined {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const deedsOf = (id: string) =>
    byId.get(id)?.entries.filter((e) => e.kind === "tool" && e.state === "completed").length ?? 0
  let best: Hero | undefined
  for (let i = 0; i < told.length; i++) {
    const m = told[i] as Moment
    const weight = HERO_WEIGHTS[m.kind]
    if (weight === undefined) continue
    let score = weight
    if (m.kind === "recover" && told.slice(0, i).some((o) => o.kind === "fail" && o.id === m.id)) score += 1
    if (m.kind === "loot") score += Math.min(4, deedsOf(m.id) / 6) + (m.parent ? 0 : 2)
    if (best && score < best.score) continue
    const subject: HeroSubject =
      m.kind === "sea-release" || m.kind === "sea-merged" || m.kind === "sea-green" || m.kind === "sea-red"
        ? { kind: "sea", moment: m.kind }
        : { kind: "adventurer", id: m.id, title: m.title, color: m.color }
    const shot = Math.ceil((m.at + (AFTER[m.kind] ?? 1500)) / 1000) * 1000
    best = { label: LABEL[m.kind]?.(m) ?? m.title, at: m.at, shot, subject, score }
  }
  return best
}

/**
 * The three best lines, in story order: each beat as the captions would tell it, ranked for a
 * recap (LINE_RANK: renown, the end, the sea, a rise, loot…), one per kind of beat where the story
 * has enough, and never the same words twice. Pleas are not highlights: a wait on the user is a
 * live call to act, not something to boast of afterwards.
 */
export function linesOf(told: readonly Moment[], sessions: readonly Session[], lookup: Lookup): RecapLine[] {
  interface Candidate extends RecapLine {
    score: number
  }
  const candidates: Candidate[] = []
  for (const m of told) {
    const kind = beatOf(m)
    const rank = kind ? LINE_RANK[kind] : undefined
    if (!kind || rank === undefined) continue
    const parts = sentenceCase(lineOf(kind, [m], lookup))
    const text = parts.map((p) => p.text).join("")
    if (!text) continue
    candidates.push({ at: m.at, kind, parts, text, score: rank })
  }
  for (const r of renownOf(told, sessions)) {
    const parts = sentenceCase(renownLine(r))
    candidates.push({ at: r.at, kind: "renown", parts, text: parts.map((p) => p.text).join(""), score: 9 })
  }
  // Best first (ties: later); one per kind, then fill with the rest.
  candidates.sort((a, b) => b.score - a.score || b.at - a.at)
  const chosen: Candidate[] = []
  const kinds = new Set<string>()
  for (const c of candidates) {
    if (chosen.length === 3) break
    if (kinds.has(c.kind) || chosen.some((o) => o.text === c.text)) continue
    kinds.add(c.kind)
    chosen.push(c)
  }
  for (const c of candidates) {
    if (chosen.length === 3) break
    if (!chosen.includes(c) && !chosen.some((o) => o.text === c.text)) chosen.push(c)
  }
  return chosen.sort((a, b) => a.at - b.at).map(({ score: _, ...line }) => line)
}

/** How much a beat is worth as a recap line; beats not listed (pleas, joins, deeds) never are. */
export const LINE_RANK: Partial<Record<BeatKind, number>> = {
  complete: 8,
  sea: 7,
  rise: 6,
  loot: 5,
  fall: 4,
  flaw: 3,
  quest: 2,
}

/**
 * Parts joined as one sentence reads: a name part (`the Guildmaster`) that opens a sentence — the
 * line's start, or after `. ` / `: ` ending the part before — takes a capital (`lineOf` capitalises
 * only the first part, so "complete. the Guildmaster" read wrong).
 */
export function sentenceCase(parts: readonly CaptionPart[]): CaptionPart[] {
  return parts.map((part, i) => {
    const before = i === 0 ? "" : (parts[i - 1] as CaptionPart).text
    const opens = i === 0 || /[.!?]\s*$/.test(before)
    return opens && /^[a-z]/.test(part.text)
      ? { ...part, text: part.text[0]?.toUpperCase() + part.text.slice(1) }
      : part
  })
}

/** `1,284`, `12.4k`. */
export function countOf(n: number): string {
  return n < 10_000 ? n.toLocaleString("en") : `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`
}

/** `950`, `96.8k`, `136k`, `9.9M`: a big count at a glance. */
export function compactOf(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`
  return `${(n / 1e6).toFixed(n < 1e8 ? 1 : 0).replace(/\.0$/, "")}M`
}

/** The card's numbers: who, how much, how long (tokens and cost only when the harness said). */
export function numbersOf(legend: Legend, told: readonly Moment[]): RecapNumber[] {
  const deeds = legend.chapters.reduce((sum, c) => sum + c.deeds.reduce((n, d) => n + d.count, 0), 0)
  const quests = told.filter((m) => m.kind === "quest").length
  const out: RecapNumber[] = [
    { value: String(legend.party), label: legend.party === 1 ? "adventurer" : "adventurers" },
    { value: countOf(deeds), label: deeds === 1 ? "deed" : "deeds" },
    { value: countOf(quests), label: quests === 1 ? "quest" : "quests" },
  ]
  if (legend.tokens > 0) out.push({ value: compactOf(legend.tokens), label: "tokens" })
  if (legend.cost > 0) out.push({ value: costOf(legend.cost), label: "spent" })
  out.push({ value: duration(legend.span), label: "on the clock" })
  return out
}

/** Everything the card says, from the book and the history it was written from. */
export function recapOf(input: {
  legend: Legend
  history: readonly Moment[]
  sessions: readonly Session[]
  lookup: Lookup
  guild: string
  story: string
}): Recap {
  const { legend, history, sessions, lookup } = input
  const root = sessions.find((s) => !s.parentID)
  const told = root ? history.filter((m) => m.master === root.id) : []
  return {
    title: legend.title,
    guild: input.guild,
    story: input.story,
    outcome: legend.outcome,
    numbers: numbersOf(legend, told),
    lines: linesOf(told, sessions, lookup),
    hero: heroOf(told, sessions),
  }
}

/** Where the hero shot is, as a deep link reproduces it (guild/deeplink.ts). */
export interface ShotLink {
  /** A told story; absent live (a live session can't be sought). */
  story?: string
  /** Run time, ms (rounded down to the second: `t` is `mm:ss`). */
  t?: number
  /** Rush's crowd. */
  n?: number
  /** A repo's island: `owner/name` or `sample`. */
  repo?: string
  hour?: number
  weather?: string
  view?: "diorama" | "explore"
  /** An adventurer's title: followed, dossier open. */
  select?: string
  /** A point to frame, world units. */
  look?: { x: number; z: number }
}

/** `mm:ss`. */
function clockOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * The deep link's query for a shot (no leading `?`): the story paused at the moment, the hour and
 * weather it had, the camera on the subject and the Bard off, so it opens on the picture. Every
 * value is one guild/deeplink.ts `parseDeepLink` accepts (test/recap.test.ts parses them back).
 */
export function recapQuery(link: ShotLink): string {
  const q = new URLSearchParams()
  if (link.story) q.set("story", link.story)
  if (link.n !== undefined && link.story === "rush") q.set("n", String(link.n))
  if (link.repo) q.set("repo", link.repo)
  if (link.t !== undefined) q.set("t", clockOf(link.t))
  if (link.hour !== undefined) q.set("hour", String(Math.round(link.hour * 10) / 10))
  if (link.weather) q.set("weather", link.weather)
  if (link.view && link.view !== "diorama") q.set("view", link.view)
  if (link.select) q.set("select", link.select)
  else if (link.look) q.set("look", `${Math.round(link.look.x)},${Math.round(link.look.z)}`)
  if (link.t !== undefined) q.set("paused", "1")
  q.set("bard", "0")
  return q.toString()
}

/** The story's name for the card: `The Saga · Act V`, `The Seas`, `Live`. */
export const STORY_NAME: Record<string, string> = {
  saga: "The Saga",
  party: "A Party",
  solo: "Alone",
  rush: "The Rush",
  parties: "Three Parties",
  factions: "Two Harnesses",
  seas: "The Seas",
}

const SLUG_MAX = 60

/** The PNG's file name: `guildhall-chronicle-facebook-react.png`. */
export function fileNameOf(recap: Pick<Recap, "guild" | "title">, format: "landscape" | "portrait"): string {
  const full = `${recap.guild} ${recap.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  // At most SLUG_MAX characters, cut between words.
  const slug = full.length <= SLUG_MAX ? full : full.slice(0, SLUG_MAX + 1).replace(/-[^-]*$/, "")
  return `guildhall-chronicle-${slug || "session"}${format === "portrait" ? "-portrait" : ""}.png`
}
