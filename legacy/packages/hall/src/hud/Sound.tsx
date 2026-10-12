import { useSyncExternalStore } from "react"
import { audio } from "../audio/engine.ts"
import { soundPrefs, useSoundPrefs } from "./prefs.ts"

/**
 * Turn the sound on or off. Must run inside the click or key handler: the first "on" creates the
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

/** Sound was left on by a returning viewer and waits for a tap to start (browsers' autoplay rule). */
export function useSoundWaiting(): boolean {
  const { on } = useSoundPrefs()
  const state = useSyncExternalStore(audio.subscribe, audio.snapshot)
  return on && state === "locked"
}

/** The speaker in the toolbar (desktop; phones reach sound through Settings). */
export function SoundToggle() {
  const { on } = useSoundPrefs()
  const waiting = useSoundWaiting()
  const label = waiting ? "Start sound" : on ? "Mute sound" : "Turn sound on"
  return (
    <button
      type="button"
      className="plaque tool sound-tool"
      aria-pressed={on && !waiting}
      aria-label={label}
      title={waiting ? "Sound is on: click to start it" : on ? "Sound on · click to mute" : "Sound off"}
      onClick={toggleSound}
    >
      <Speaker on={on} />
      {waiting && <i className="tab-dot" aria-hidden="true" />}
    </button>
  )
}

const LEVELS = [
  ["master", "Volume", "Everything"],
  ["notes", "Notes", "A note for every deed, and the moments' motifs"],
  ["ambience", "Ambience", "Wind, rain, the sea, fire and night insects"],
] as const

/** Settings › Sound: the switch and three levels. */
export function SoundLevers() {
  const prefs = useSoundPrefs()
  return (
    <>
      <button type="button" role="switch" className="toggle" aria-checked={prefs.on} onClick={toggleSound}>
        <span className="toggle-text">
          <b>Sound</b>
          <span>A soft note per deed, and the world around you</span>
        </span>
        <span className="switch" aria-hidden="true">
          <i />
        </span>
      </button>
      {LEVELS.map(([key, label, hint]) => (
        <fieldset className="lever" key={key} disabled={!prefs.on}>
          <legend title={hint}>
            {label} <span className="lever-value">{Math.round(prefs[key] * 100)}%</span>
          </legend>
          <input
            type="range"
            className="slider"
            min={0}
            max={1}
            step={0.05}
            value={prefs[key]}
            aria-label={`${label} level`}
            aria-valuetext={`${Math.round(prefs[key] * 100)}%`}
            onChange={(event) => soundPrefs.set({ [key]: Number(event.target.value) })}
          />
        </fieldset>
      ))}
    </>
  )
}

/** A speaker with waves (on) or a cross (off), drawn like hud/icons.tsx glyphs. */
function Speaker({ on }: { on: boolean }) {
  return (
    <svg
      className="glyph"
      width={16}
      height={16}
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
