/**
 * What the story and sharing pieces are fed (plan-hud-events.md U3). Plain data, shaped like the sim's
 * own (`@guildhall/sim` story: `Legend`, `Recap`, `Caption`), so the hall hands those over as they are:
 * the ui never imports the sim. Colours are CSS; times are ms (session run time, or epoch for history).
 */

// ── the Legends book (sim `legendOf`) ──────────────────────────────

export type NotableKind = "plea" | "flaw" | "fall" | "rise" | "renown"

export interface LegendNotable {
  kind: NotableKind
  /** Run time, ms. */
  at: number
  text: string
  /** News from the GitHub sea, told in the guildmaster's chapter. */
  sea?: true
}

export interface LegendDeeds {
  /** `forge`, `test`, … (the story's word for the craft). */
  craft: string
  count: number
  /** `3 edits`. */
  label: string
}

export interface LegendChapter {
  /** `I`, `II`, … */
  numeral: string
  id: string
  /** `Implementer II`. */
  who: string
  /** Their banner colour. */
  color: string
  /** Who sent them; absent for the guildmaster's own chapter. */
  sentBy?: string
  quest: string
  /** Called back: the same adventurer as an earlier chapter. */
  resumed: boolean
  begin: number
  end?: number
  outcome: "done" | "fallen" | "underway"
  deeds: readonly LegendDeeds[]
  notables: readonly LegendNotable[]
  /** What they brought home: their last word. */
  loot?: string
  tokens?: number
  cost?: number
  /** `for both quests`. */
  usageNote?: string
}

export interface LegendRenown {
  /** `festival`, `ghost-ship`, `rainbow`, `raid`, `comet`, `dragon`. */
  kind: string
  id: string
  title: string
  text: string
  count: number
  forced: boolean
}

export interface LegendUnsung {
  kind: string
  hint: string
}

export interface LegendView {
  title: string
  /** Everyone in the party, the guildmaster included. */
  party: number
  /** Run time from the first moment to the last, ms. */
  span: number
  tokens: number
  /** US dollars. */
  cost: number
  outcome: "complete" | "lost" | "underway"
  opening: string
  chapters: readonly LegendChapter[]
  lastWord?: string
  closing: string
  renown: readonly LegendRenown[]
  unsung: readonly LegendUnsung[]
}

// ── the repo's history (Repo Chronicle, H1) ────────────────────────

/** A session the guild worked on this repo before: one book on the shelf. */
export interface PastSession {
  id: string
  /** The quest, as the book titles it. */
  title: string
  /** When it began, epoch ms. */
  at: number
  outcome: LegendView["outcome"]
  party: number
  /** How long it ran, ms. */
  span: number
  deeds?: number
  tokens?: number
  cost?: number
  /** Its hero line, when the card was made: `The Warden brings the loot home`. */
  hero?: string
}

/** A milestone of the repo's life: a package born, a release, a first commit. */
export interface Milestone {
  /** Epoch ms. */
  at: number
  kind: "born" | "release" | "merge" | "renown"
  title: string
  text?: string
}

export interface RepoHistory {
  /** `Codestz/guildhall`. */
  repo: string
  sessions: readonly PastSession[]
  milestones: readonly Milestone[]
  /**
   * The repo's own story by era (sim `repoLegendOf`): when given, History tells it chapter by chapter,
   * each with the island as it was, and the past sessions fall into the eras they belong to.
   */
  legend?: RepoLegendView
}

// ── a repository's story by era (sim `repoLegendOf`) ───────────────

/** `first-commit`, `release`, `founded`, `renamed`, `gone`, `joined`, `busiest`, `reshaped`, `grew`, `besides`. */
export type RepoMilestoneKind = string

/** One line of an era's annals. Text may hold code marks: `packages/ui` is drawn as code. */
export interface RepoMilestoneView {
  /** Epoch ms. */
  at: number
  kind: RepoMilestoneKind
  text: string
  unit?: string
}

export interface RepoEraView {
  /** `I`, `II`, … */
  numeral: string
  id: string
  title: string
  /** `May 2013 – April 2016`. */
  span: string
  /** The major release that opened it: `v16.0.0`. */
  release?: string
  /** Epoch ms. */
  begin: number
  end: number
  lede: string
  /** The island at the era's end: its file count. */
  files: number
  commits?: number
  milestones: readonly RepoMilestoneView[]
  /**
   * The island as it was at the era's end (`files(t)`): an image URL. The hall films it live (H1);
   * without one the page shows the count alone.
   */
  image?: string
}

export interface RepoLegendView {
  repo: string
  /** How the eras were cut: `release`, `year`, `quarter`, `month`, `week`, `day`. */
  rule: string
  /** `13 years · 19,117 commits · 1,952 contributors · 130 releases`. */
  meta: string
  opening: string
  eras: readonly RepoEraView[]
  closing: string
}

// ── the Chronicle card (sim `recapOf`) ─────────────────────────────

/** One line of a caption: plain text, or an adventurer's name in their colour. */
export interface StoryPart {
  text: string
  color?: string
}

export interface RecapView {
  /**
   * `session` (the default): a session's card, its hero moment tagged with its run time. `repo`: the
   * Repo Chronicle card (sim `repoRecapOf`), "The Chronicle of owner/repo" over the island today.
   */
  kind?: "session" | "repo"
  title: string
  /** The guild's name: the repo (`Codestz/guildhall`). */
  guild: string
  /** `The Saga · Act V`, `Live`. */
  story: string
  /** The line under the title, in place of `guild · story`: `Since May 2013 · 13 years`. */
  subtitle?: string
  outcome: LegendView["outcome"]
  numbers: readonly { value: string; label: string }[]
  lines: readonly { at: number; kind: string; parts: readonly StoryPart[]; text: string }[]
  /** The picture's tag. `mark` replaces the run-time clock: `7,252 files`. */
  hero?: { label: string; at: number; mark?: string }
  /** The footer's link, in place of the site's bare name: `guildhall.codestz.dev/hall/react/react`. */
  site?: string
}

// ── captions and chapters (sim `Narrator`) ─────────────────────────

export interface CaptionView {
  /** Grows by one per caption: a new key is a new line. */
  key: number
  /** The beat: `quest`, `plea`, `fall`, `complete`, `chapter`, `renown`, `sea`… */
  kind: string
  priority: number
  /** The whole line, for screen readers. */
  text: string
  parts: readonly StoryPart[]
  /** How long to show it, ms. */
  hold: number
}

/** An act of a told story: `III` · `The storm` · `The tests turn red`. */
export interface ChapterView {
  numeral: string
  title: string
  tagline: string
}

// ── a place on the island (Place dossier) ──────────────────────────

export interface PlaceView {
  id: string
  /** `The Market`. */
  name: string
  /** What kind of place: `Town · market`, `Capital district`, `Military camp`. */
  kind: string
  /** The package it stands for: `packages/ui`. */
  package: string
  /** One line about it, when the island says. */
  about?: string
}

/** A deed done at the place: who, what, when. */
export interface PlaceDeed {
  key: string
  /** Session time, ms. */
  at: number
  who: string
  banner: string
  /** `edit · Roster.tsx`. */
  text: string
  failed?: boolean
  /** The hero a press opens. */
  hero?: string
}
