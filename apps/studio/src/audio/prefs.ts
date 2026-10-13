// From V1 hall (legacy/packages/hall/src/hud/prefs.ts, its sound half), held to its goldens.
/**
 * Sound prefs: off until the viewer turns it on, then remembered with its levels under V1's own key
 * (`guildhall.sound`, so a V1 visitor's choice carries over). Being "on" here never starts audio by
 * itself: browsers need a gesture, so a returning viewer's first click starts it (engine.ts `unlock`).
 * Storage that throws (a private window, blocked site data) keeps the choice in memory only.
 */
export interface SoundPrefs {
  on: boolean
  /** 0–1 each. */
  master: number
  notes: number
  ambience: number
}

export const SOUND_KEY = "guildhall.sound"
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

let sound: SoundPrefs | null = null
const soundListeners = new Set<() => void>()

export const soundPrefs = {
  get: (): SoundPrefs => {
    sound ??= typeof window === "undefined" ? SOUND_DEFAULTS : readSound()
    return sound
  },
  set(patch: Partial<SoundPrefs>): void {
    sound = { ...soundPrefs.get(), ...patch }
    try {
      window.localStorage.setItem(SOUND_KEY, JSON.stringify(sound))
    } catch {
      // Unavailable storage: keep the choice in memory only.
    }
    for (const listener of [...soundListeners]) listener()
  },
  subscribe(listener: () => void): () => void {
    soundListeners.add(listener)
    return () => soundListeners.delete(listener)
  },
}
