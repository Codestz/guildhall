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
}

// ── the Chronicle card (sim `recapOf`) ─────────────────────────────

/** One line of a caption: plain text, or an adventurer's name in their colour. */
export interface StoryPart {
  text: string
  color?: string
}

export interface RecapView {
  title: string
  /** The guild's name: the repo (`Codestz/guildhall`). */
  guild: string
  /** `The Saga · Act V`, `Live`. */
  story: string
  outcome: LegendView["outcome"]
  numbers: readonly { value: string; label: string }[]
  lines: readonly { at: number; kind: string; parts: readonly StoryPart[]; text: string }[]
  hero?: { label: string; at: number }
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
