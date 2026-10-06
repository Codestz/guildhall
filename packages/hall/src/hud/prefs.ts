import { useSyncExternalStore } from "react"

/**
 * The viewer's HUD choices, remembered per browser. Minimal by default: the world is the hero.
 * Storage can be missing (private mode, blocked site data); the choice then lasts for the visit.
 */
export type HudMode = "minimal" | "detailed" | "hidden"

export interface HudPrefs {
  mode: HudMode
  /** "Stats for nerds" panel. */
  stats: boolean
}

export const HUD_MODES: Record<HudMode, { label: string; next: HudMode; hint: string }> = {
  minimal: { label: "Minimal", next: "detailed", hint: "The world first, details on demand" },
  detailed: { label: "Detailed", next: "hidden", hint: "Every panel open" },
  hidden: { label: "Hidden", next: "minimal", hint: "Pure view. H or Esc brings the HUD back" },
}

const KEY = "guildhall.hud"
const DEFAULTS: HudPrefs = { mode: "minimal", stats: false }

function read(): HudPrefs {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const value = JSON.parse(raw) as Partial<HudPrefs>
    return {
      mode: value.mode && value.mode in HUD_MODES ? value.mode : DEFAULTS.mode,
      stats: typeof value.stats === "boolean" ? value.stats : DEFAULTS.stats,
    }
  } catch {
    return DEFAULTS
  }
}

let prefs: HudPrefs = typeof window === "undefined" ? DEFAULTS : read()
const listeners = new Set<() => void>()

export const hudPrefs = {
  get: (): HudPrefs => prefs,
  set(patch: Partial<HudPrefs>): void {
    prefs = { ...prefs, ...patch }
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // Unavailable storage: keep the choice in memory only.
    }
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useHudPrefs(): HudPrefs {
  return useSyncExternalStore(hudPrefs.subscribe, hudPrefs.get)
}
