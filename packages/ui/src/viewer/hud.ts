/**
 * The Viewer's HUD regions, as state (plan-hud-events U2; decisions.md "HUD stays light"): which panel is
 * open, how much of the HUD shows, and what a viewer left open last time. Pure: the Viewer holds it and
 * draws `data-*` from it, a screen's HUD reads it and dispatches to it.
 *
 * - **One panel at a time.** Opening a panel closes the one before; a panel opened from another
 *   (a place's dossier from the places list) remembers it, and closing goes back to it.
 * - **Minimal by default.** H cycles Detailed → Minimal → Hidden → Detailed.
 * - **Remembered.** The mode, and whether a panel a screen marks `remember` (a list, a feed) was left
 *   open or folded to its icon, are kept per screen key in local storage (never a dossier or a dialog).
 */
import type { HudMode } from "../hud/types.ts"

export type { HudMode }

/** The order H walks the modes in. */
export const HUD_MODES: readonly HudMode[] = ["detailed", "minimal", "hidden"]

export interface HudState {
  mode: HudMode
  /** The panel open now (a screen's own id), or null: every panel folded to its icon. */
  open: string | null
  /** The panel `open` was opened from: closing `open` goes back to it. */
  back: string | null
}

export type HudAction =
  /** Opens `id`, or folds it back to its icon if it is the one open. */
  | { type: "toggle"; id: string }
  /** Opens `id` (from `from`, which closing returns to). */
  | { type: "open"; id: string; from?: string }
  /** Folds the open panel (back to the one it came from, if any). */
  | { type: "close" }
  /** Folds every panel. */
  | { type: "closeAll" }
  | { type: "mode"; mode: HudMode }
  /** H: the next mode. */
  | { type: "cycle" }

export const HUD_INITIAL: HudState = { mode: "minimal", open: null, back: null }

export const nextMode = (mode: HudMode): HudMode =>
  HUD_MODES[(HUD_MODES.indexOf(mode) + 1) % HUD_MODES.length] ?? "minimal"

export function hudReduce(s: HudState, a: HudAction): HudState {
  switch (a.type) {
    case "toggle":
      return s.open === a.id ? { ...s, open: null, back: null } : { ...s, open: a.id, back: null }
    case "open":
      return { ...s, open: a.id, back: a.from && a.from !== a.id ? a.from : null }
    case "close":
      return { ...s, open: s.back, back: null }
    case "closeAll":
      return { ...s, open: null, back: null }
    case "mode":
      return { ...s, mode: a.mode }
    case "cycle":
      return { ...s, mode: nextMode(s.mode) }
  }
}

/** What a viewer's HUD keeps between visits. */
export interface HudMemory {
  mode: HudMode
  /** The remembered panel left open (null: all folded). */
  open: string | null
}

/** The part of `s` worth remembering: the mode, and the open panel if it is one of `remember`. */
export function hudMemory(s: HudState, remember: readonly string[]): HudMemory {
  const keep = (id: string | null) => (id !== null && remember.includes(id) ? id : null)
  return { mode: s.mode, open: keep(s.open) ?? keep(s.back) }
}

/** The smallest storage the HUD needs (`localStorage`, or a stand-in in tests). */
export type HudStorage = Pick<Storage, "getItem" | "setItem">

const storeKey = (key: string) => `gh.hud.${key}`

/** The state a screen opens with: what was remembered under `key`, else minimal with all folded. Never throws. */
export function loadHud(storage: HudStorage | null, key: string, remember: readonly string[]): HudState {
  try {
    const text = storage?.getItem(storeKey(key))
    if (!text) return HUD_INITIAL
    const read = JSON.parse(text) as Partial<HudMemory>
    const mode = HUD_MODES.includes(read.mode as HudMode) ? (read.mode as HudMode) : HUD_INITIAL.mode
    const open = typeof read.open === "string" && remember.includes(read.open) ? read.open : null
    return { mode, open, back: null }
  } catch {
    return HUD_INITIAL
  }
}

/** Remembers `s` under `key` (private windows and blocked storage are ignored). */
export function saveHud(
  storage: HudStorage | null,
  key: string,
  s: HudState,
  remember: readonly string[],
): void {
  try {
    storage?.setItem(storeKey(key), JSON.stringify(hudMemory(s, remember)))
  } catch {
    // storage full or blocked: the HUD still works, it just forgets
  }
}

/** The viewer's own storage, or null where reading it throws (sandboxed frames). */
export function viewerStorage(): HudStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

/** At or below this viewer width (CSS px) the HUD is a phone's: one bottom sheet. */
export const PHONE_MAX = 600
