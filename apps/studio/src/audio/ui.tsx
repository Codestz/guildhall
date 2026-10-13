// From V1 hall (legacy/packages/hall/src/hud/Sound.tsx): the speaker and Settings › Sound.
import { Slider, Toggle } from "@guildhall/ui"
import { useSyncExternalStore } from "react"
import { audio } from "./engine.ts"
import { type SoundPrefs, soundPrefs } from "./prefs.ts"

/**
 * Turns the sound on or off. Must run inside the click or key handler: the first "on" creates the
 * AudioContext there (browsers allow audio only after a gesture). A returning viewer whose sound
 * was left on finds it waiting: their first click starts it rather than turning it off.
 */
export function toggleSound(): void {
  const { on } = soundPrefs.get()
  if (on && audio.state === "locked") {
    audio.unlock()
    return
  }
  soundPrefs.set({ on: !on })
  if (!on) audio.unlock()
}

export function useSoundPrefs(): SoundPrefs {
  return useSyncExternalStore(soundPrefs.subscribe, soundPrefs.get)
}

/** Sound was left on by a returning viewer and waits for a gesture to start (browsers' autoplay rule). */
export function useSoundWaiting(): boolean {
  const { on } = useSoundPrefs()
  const state = useSyncExternalStore(audio.subscribe, audio.snapshot)
  return on && state === "locked"
}

/** The speaker on the hall's rail: on, off, or a dot while a returning viewer's sound waits. */
export function SoundButton({ className = "ui-icon-btn hall-rail-btn" }: { className?: string }) {
  const { on } = useSoundPrefs()
  const waiting = useSoundWaiting()
  const label = waiting ? "Start sound" : on ? "Mute sound" : "Turn sound on"
  return (
    <button
      type="button"
      className={className}
      data-plaque=""
      data-panel="sound"
      aria-pressed={on && !waiting}
      aria-label={label}
      title={waiting ? "Sound is on: click to start it" : on ? "Sound on · click to mute" : "Sound off"}
      onClick={toggleSound}
    >
      <Speaker on={on} />
      {waiting && <i className="hud-tab-dot" aria-hidden="true" />}
    </button>
  )
}

const LEVELS = [
  ["master", "Volume", "Everything"],
  ["notes", "Notes", "A note for every deed, and the moments' motifs"],
  ["ambience", "Ambience", "Wind, rain and thunder, the sea, a town's crowd, birds and night insects"],
] as const

const percent = (v: number) => `${Math.round(v * 100)}%`

/** Settings › Sound: the switch and three levels. */
export function SoundSettings() {
  const prefs = useSoundPrefs()
  const waiting = useSoundWaiting()
  return (
    <section className="hud-set-section" aria-label="Sound">
      <h3 className="ui-section-head">Sound</h3>
      <Toggle
        label="Sound"
        hint={waiting ? "On: click to start it" : "A soft note per deed, and the world around you"}
        checked={prefs.on && !waiting}
        onChange={toggleSound}
      />
      {LEVELS.map(([key, label, hint]) => (
        <Slider
          key={key}
          label={label}
          hint={hint}
          value={prefs[key]}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          disabled={!prefs.on}
          onChange={(v) => soundPrefs.set({ [key]: v })}
        />
      ))}
    </section>
  )
}

/** A speaker with waves (on) or a cross (off), drawn like the HUD's glyphs. */
function Speaker({ on }: { on: boolean }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.5 6v4h2.5L8.5 13V3L5 6z" />
      {on ? (
        <path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.8a6 6 0 0 1 0 8.4" />
      ) : (
        <path d="m11 6 3 4M14 6l-3 4" />
      )}
    </svg>
  )
}
