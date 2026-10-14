import type { Craft } from "@guildhall/core"
import type { HeroPose } from "@guildhall/world"
import { craftRoutine, type HeroClip } from "../life/craft.ts"

/**
 * How the hall shows a deed (CONTEXT.md: Deed) — one tool call, from start to end — by its craft
 * (@guildhall/core craft.ts), never by the host's tool name (ADR 0011).
 *
 * The clip is the first of the craft's routine (life/craft.ts) at the spot the craft is most at home
 * at: real clips of the shared KayKit rig (ADR 0004), what heroes play on the island.
 */

/** A clip of the shared rig a hero plays (life/craft.ts `CLIP_SECONDS`). */
export type Clip = HeroClip

/** A small effect played at the adventurer's station alongside the clip. */
export type Effect = "pages" | "sparks" | "steam" | "scroll" | "portal" | "none"

export interface DeedLook {
  clip: Clip
  effect: Effect
  /** Walk somewhere first (e.g. to the library for a read)? `undefined` = act at own station. */
  goTo?: "library" | "forge" | "map-table" | "quest-board"
}

/** Where each craft is most at home: an edit or a run at the forge, a test at the targets, the rest at a desk. */
const AT: Record<Craft, HeroPose> = {
  delegate: "board",
  fetch: "desk",
  read: "desk",
  search: "desk",
  edit: "anvil",
  write: "anvil",
  run: "anvil",
  test: "drill",
  lint: "drill",
  plan: "desk",
  consult: "desk",
  other: "desk",
}

const look = (craft: Craft, effect: Effect, goTo?: DeedLook["goTo"]): DeedLook => ({
  clip: craftRoutine(craft, AT[craft]).moves[0]!.clip,
  effect,
  ...(goTo ? { goTo } : {}),
})

/** By craft: quests and the outside world are worth a walk; everything else happens at the station. */
const LOOKS: Record<Craft, DeedLook> = {
  delegate: look("delegate", "scroll", "quest-board"),
  fetch: look("fetch", "portal", "map-table"),
  read: look("read", "pages"),
  search: look("search", "pages"),
  edit: look("edit", "sparks"),
  write: look("write", "sparks"),
  run: look("run", "steam"),
  test: look("test", "steam"),
  lint: look("lint", "steam"),
  plan: look("plan", "scroll"),
  // An MCP tool: a spell cast to somewhere beyond the hall.
  consult: look("consult", "portal"),
  other: look("other", "none"),
}

/**
 * The look for a deed of this craft (@guildhall/core `deedCraft`). Called for every adventurer at
 * work each time the hall recasts, so it is a lookup. Failure (`Hit_A`) and completion are the hall's
 * concern, not the deed's.
 */
export function deedLook(craft: Craft): DeedLook {
  return LOOKS[craft]
}
