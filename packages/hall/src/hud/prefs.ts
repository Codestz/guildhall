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
  /** Deed sigils over working adventurers (scene/Sigils.tsx). Decorative; on by default. */
  sigils: boolean
  /** Story captions: one narrated line at a time, lower centre (hud/Captions.tsx). On by default. */
  captions: boolean
}

export const HUD_MODES: Record<HudMode, { label: string; next: HudMode; hint: string }> = {
  minimal: { label: "Minimal", next: "detailed", hint: "The world first, details on demand" },
  detailed: { label: "Detailed", next: "hidden", hint: "Every panel open" },
  hidden: { label: "Hidden", next: "minimal", hint: "Pure view. H or Esc brings the HUD back" },
}

const KEY = "guildhall.hud"
const DEFAULTS: HudPrefs = { mode: "minimal", stats: false, sigils: true, captions: true }

function read(): HudPrefs {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const value = JSON.parse(raw) as Partial<HudPrefs>
    return {
      mode: value.mode && value.mode in HUD_MODES ? value.mode : DEFAULTS.mode,
      stats: typeof value.stats === "boolean" ? value.stats : DEFAULTS.stats,
      sigils: typeof value.sigils === "boolean" ? value.sigils : DEFAULTS.sigils,
      captions: typeof value.captions === "boolean" ? value.captions : DEFAULTS.captions,
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

/**
 * Sound (audio/README.md): off until the viewer turns it on, then remembered with its levels.
 * Its own key, so it reads and writes apart from the HUD's choices. Being "on" here never starts
 * audio by itself: browsers need a click, so a returning viewer's first click on the speaker
 * starts it (audio/engine.ts `unlock`).
 */
export interface SoundPrefs {
  on: boolean
  /** 0–1 each. */
  master: number
  notes: number
  ambience: number
}

const SOUND_KEY = "guildhall.sound"
export const SOUND_DEFAULTS: SoundPrefs = { on: false, master: 0.7, notes: 0.8, ambience: 0.5 }

/** Stored sound prefs, checked: anything missing or out of range is the default. */
export function soundPrefsOf(raw: string | null): SoundPrefs {
  if (!raw) return SOUND_DEFAULTS
  try {
    const value = JSON.parse(raw) as Partial<SoundPrefs>
    const level = (v: unknown, fallback: number) => (typeof v === "number" && v >= 0 && v <= 1 ? v : fallback)
    return {
      on: typeof value.on === "boolean" ? value.on : SOUND_DEFAULTS.on,
      master: level(value.master, SOUND_DEFAULTS.master),
      notes: level(value.notes, SOUND_DEFAULTS.notes),
      ambience: level(value.ambience, SOUND_DEFAULTS.ambience),
    }
  } catch {
    return SOUND_DEFAULTS
  }
}

function readSound(): SoundPrefs {
  try {
    return soundPrefsOf(window.localStorage.getItem(SOUND_KEY))
  } catch {
    return SOUND_DEFAULTS
  }
}

let sound: SoundPrefs = typeof window === "undefined" ? SOUND_DEFAULTS : readSound()
const soundListeners = new Set<() => void>()

export const soundPrefs = {
  get: (): SoundPrefs => sound,
  set(patch: Partial<SoundPrefs>): void {
    sound = { ...sound, ...patch }
    try {
      window.localStorage.setItem(SOUND_KEY, JSON.stringify(sound))
    } catch {
      // Unavailable storage: keep the choice in memory only.
    }
    for (const listener of soundListeners) listener()
  },
  subscribe(listener: () => void): () => void {
    soundListeners.add(listener)
    return () => soundListeners.delete(listener)
  },
}

export function useSoundPrefs(): SoundPrefs {
  return useSyncExternalStore(soundPrefs.subscribe, soundPrefs.get)
}
