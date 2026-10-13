/**
 * The words the sound speaks in, kept here so nothing in audio/ reads a scene or a HUD module: V1's
 * moment kinds (what a cue is about), the four moods' ids (the key), and the sigil a deed's craft shows
 * (its instrument), with V1's craft → sigil table (legacy scene/sigilBoard.ts BY_CRAFT).
 */
import type { Craft } from "@guildhall/core"

/**
 * What a cue is about: V1's moment kinds (legacy guild/moments.ts `MomentKind`), the guild's and the
 * sea's. V2's world events become these in cues.ts.
 */
export type CueKind =
  | "join"
  | "quest"
  | "deed"
  | "deed-failed"
  | "fail"
  | "recover"
  | "loot"
  | "plea"
  | "plea-answered"
  | "leave"
  | "sea-push"
  | "sea-merged"
  | "sea-red"
  | "sea-green"
  | "sea-release"

/** The moods (render post/lut.ts `MoodId`): each its own home key. */
export type MoodId = "keep" | "hearth" | "moonstone" | "arcane"

/** The sigil a deed shows while it runs (V1 scene/sigilBoard.ts), which picks its instrument. */
export type SigilKind =
  | "read"
  | "edit"
  | "search"
  | "test"
  | "run"
  | "think"
  | "dispatch"
  | "consult"
  | "work"

const BY_CRAFT: Record<Craft, SigilKind> = {
  read: "read",
  search: "search",
  edit: "edit",
  write: "edit",
  run: "run",
  test: "test",
  lint: "test",
  fetch: "consult",
  consult: "consult",
  plan: "think",
  delegate: "dispatch",
  other: "work",
}

/** The sigil for a deed of this craft. */
export function sigilOfCraft(craft: Craft): SigilKind {
  return BY_CRAFT[craft]
}
