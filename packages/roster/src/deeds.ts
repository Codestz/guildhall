/**
 * How the hall shows a deed (CONTEXT.md: Deed) — one tool call, from start to end.
 *
 * Tool names arrive as OpenCode spells them, and the two versions differ:
 *   v1: read, glob, grep, list, edit, write, patch, bash, webfetch, task, todowrite, …
 *   v2: read, glob, grep, edit, write, shell, webfetch, subagent, …
 *   plus anything from MCP servers, usually `<server>_<tool>` (e.g. `context7_query-docs`).
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

/** Same deed, different name across OpenCode versions → one canonical name. */
const ALIASES: Record<string, string> = {
  shell: "bash",
  subagent: "task",
  patch: "edit",
  multiedit: "edit",
  list: "glob",
  websearch: "webfetch",
}

const LOOKS: Record<string, DeedLook> = {
  // Quests and the outside world are worth a walk; everything else happens at the station.
  task: { clip: "Use_Item", effect: "scroll", goTo: "quest-board" },
  webfetch: { clip: "Interact", effect: "portal", goTo: "map-table" },
  read: { clip: "Interact", effect: "pages" },
  grep: { clip: "Interact", effect: "pages" },
  glob: { clip: "Interact", effect: "pages" },
  edit: { clip: "Use_Item", effect: "sparks" },
  write: { clip: "Use_Item", effect: "sparks" },
  bash: { clip: "Use_Item", effect: "steam" },
  todowrite: { clip: "Interact", effect: "scroll" },
}

/** MCP tools arrive as `<server>_<tool>`; built-in tool names never contain `_`. */
const MCP_LOOK: DeedLook = { clip: "Spellcasting", effect: "portal" }
const DEFAULT_LOOK: DeedLook = { clip: "Interact", effect: "none" }

/**
 * Pick the look for a tool call. Called on every `tool` change the hall sees, so it must be
 * pure and cheap, and it must return something for tools it has never heard of.
 * Failure (`Hit_A`) and completion are the hall's concern, not the tool's.
 */
export function deedLook(tool: string): DeedLook {
  const name = tool.toLowerCase()
  const look = LOOKS[ALIASES[name] ?? name]
  if (look) return look
  return name.includes("_") ? MCP_LOOK : DEFAULT_LOOK
}
