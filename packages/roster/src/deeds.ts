import type { Craft } from "@guildhall/core"

/**
 * How the hall shows a deed (CONTEXT.md: Deed) — one tool call, from start to end — by its craft
 * (@guildhall/core craft.ts), never by the host's tool name (ADR 0011).
 *
 * Clip names are the shared-rig animations from the KayKit Adventurers pack (ADR 0004).
 */

/** Animation clips every character has, because they all share one skeleton. */
export type Clip =
  | "Idle"
  | "Walking"
  | "Interact"
  | "Use_Item"
  | "Spellcasting"
  | "Cheer"
  | "Hit_A"
  | "Sit_Idle"

/** A small effect played at the adventurer's station alongside the clip. */
export type Effect = "pages" | "sparks" | "steam" | "scroll" | "portal" | "none"

export interface DeedLook {
  clip: Clip
  effect: Effect
  /** Walk somewhere first (e.g. to the library for a read)? `undefined` = act at own station. */
  goTo?: "library" | "forge" | "map-table" | "quest-board"
}

/** By craft: quests and the outside world are worth a walk; everything else happens at the station. */
const LOOKS: Record<Craft, DeedLook> = {
  delegate: { clip: "Use_Item", effect: "scroll", goTo: "quest-board" },
  fetch: { clip: "Interact", effect: "portal", goTo: "map-table" },
  read: { clip: "Interact", effect: "pages" },
  search: { clip: "Interact", effect: "pages" },
  edit: { clip: "Use_Item", effect: "sparks" },
  write: { clip: "Use_Item", effect: "sparks" },
  run: { clip: "Use_Item", effect: "steam" },
  test: { clip: "Use_Item", effect: "steam" },
  lint: { clip: "Use_Item", effect: "steam" },
  plan: { clip: "Interact", effect: "scroll" },
  // An MCP tool: a spell cast to somewhere beyond the hall.
  consult: { clip: "Spellcasting", effect: "portal" },
  other: { clip: "Interact", effect: "none" },
}

/**
 * The look for a deed of this craft (@guildhall/core `deedCraft`). Called for every adventurer at
 * work each time the hall recasts, so it is a lookup. Failure (`Hit_A`) and completion are the hall's
 * concern, not the deed's.
 */
export function deedLook(craft: Craft): DeedLook {
  return LOOKS[craft]
}
