/**
 * What the HUD panels are fed. Plain data, shaped for drawing: the sim layer (or a fixture) builds it,
 * the panels only read it. No store, no clock: time comes in as numbers, changes go out as callbacks.
 */

/**
 * A hero's body: the KayKit adventurer it is drawn with. Heroes are grouped by family; roles within a
 * family are told apart by their props and banner colour (decisions.md "HUD + agents + events").
 */
export type Family = "mage" | "knight" | "ranger" | "barbarian" | "rogue"

/** Every family, in the order the roster lists them. */
export const FAMILIES: readonly Family[] = ["mage", "knight", "ranger", "barbarian", "rogue"]

/** What a hero is doing, broadly (V1's phases). Always shown as a glyph and a word, never colour alone. */
export type Phase = "working" | "waiting" | "loot" | "resting" | "idle" | "leaving" | "failed"

/** How seasoned a hero is (V1 roster ranks). */
export type Rank = "apprentice" | "journeyman" | "master"

/** A party: one conversation's heroes, under one banner. */
export interface PartyView {
  id: string
  name: string
  /** The pennant's colour (CSS). */
  colour: string
}

export interface HeroView {
  id: string
  /** The world's name for them: `Warden`. */
  name: string
  /** The source's own name, shown quieter beside it: `verifier`. */
  source?: string
  family: Family
  /** The banner colour (CSS): the role's identity, never a status. */
  banner: string
  /** The second and later of a name carry a numeral (II, III). */
  ordinal?: number
  /** The party's root, seated in the great hall. */
  master?: boolean
  /** The party it belongs to (`PartyView.id`). */
  party?: string
  phase: Phase
  /** The deed in progress, short: `edit · routes.ts`. */
  doing?: string
  /** Where they are now: `Monastery`. */
  place?: string
  rank?: Rank
}

export type EntryKind = "join" | "quest" | "deed" | "fail" | "plea" | "loot" | "thought"

/** One line of the chronicle. */
export interface ChronicleEntry {
  /** Stable across renders. */
  key: string
  /** Session time, ms. */
  at: number
  kind: EntryKind
  /** Who it is about: their name, and their banner for the mark before it. */
  who: string
  banner: string
  text: string
  /** The hero a press opens (their dossier). */
  hero?: string
  /** The party it belongs to (`PartyView.id`): shown as a pennant when several are on the island. */
  party?: string
}

/** A toast: a chronicle line with how long it has left (ms); it fades over its last second. */
export interface ToastItem extends ChronicleEntry {
  left?: number
}

export type ToolState = "pending" | "running" | "completed" | "failed"

/** One line of a hero's transcript. */
export type TranscriptLine =
  | { kind: "prompt"; key: string; text: string; first?: boolean }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "reply"; key: string; text: string }
  | { kind: "tool"; key: string; name: string; target?: string; state: ToolState; note?: string }

/** A file the hero touched, and the place on the island it belongs to. */
export interface FilePlace {
  path: string
  place: string
  /** Deeds on it so far. */
  deeds?: number
}

export interface Ledger {
  tokens: number
  /** US dollars. */
  cost: number
  deeds: number
  /** Time on the quest, ms. */
  ms: number
}

/** A hero waiting on a human. */
export interface PleaView {
  hero: HeroView
  /** What they ask: `bash · bun run migrate`. */
  ask?: string
}

/** Where the HUD's events come from, for the brand's status line. */
export interface SourceState {
  /** `history`: a repo's past, told from its chronicle; `sketch`: no chronicle, the generator's own island. */
  kind: "live" | "replay" | "story" | "history" | "sketch"
  /** Live only: whether the hub answers. */
  link?: "connecting" | "connected" | "lost"
  /** What is being shown: `Codestz/guildhall`, `pagination.jsonl`. */
  name?: string
}

/** A beat on the timeline, in the bar's own units (ms of session, or epoch ms of history). */
export interface TimelineMarker {
  at: number
  kind: "quest" | "loot" | "plea" | "fail" | "release" | "born"
  label?: string
}

/** The two scales of the one timeline bar (plan §2 "Chronicle scrub"). */
export type TimeScale = "history" | "session"

export type Names = "world" | "source"
export type HudMode = "detailed" | "minimal" | "hidden"
export type Quality = "auto" | "low" | "medium" | "high" | "ultra"

/** What Settings tunes. */
export interface SettingsValues {
  names: Names
  /** Story speed: 0.5, 1, 2, 4. */
  pace: number
  /** The director (Bard camera) follows the story. */
  director: boolean
  quality: Quality
  /** Auto quality's pick right now, shown beside "Auto". */
  qualityNow?: Exclude<Quality, "auto">
  hud: HudMode
  captions: boolean
}
