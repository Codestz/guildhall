/**
 * Settings (V1's hud/Settings.tsx), fed by props, in V1's order: Your repo, Quality, the Director's
 * controls (the story's pace, the world's hour and weather, the Bard and how it films), Camera, Sound (a
 * slot: the sound agent fills it), Display. A side drawer on desktop, a bottom sheet on a phone.
 * Non-modal: the world stays live behind it; it takes focus on open and Esc inside it closes it. Dev
 * controls (`dev`) only show where the caller allows them (`?dev=1`). A section whose values are left
 * out is not drawn.
 */
import { type ReactNode, useEffect, useId, useRef } from "react"
import { Kbd, Segmented, Slider, Toggle } from "../components/controls.tsx"
import { Glyphs } from "./glyphs.tsx"
import type {
  DirectorStyle,
  HudMode,
  Names,
  Quality,
  SeasonPick,
  SettingsValues,
  TimeMode,
  WeatherPick,
} from "./types.ts"

const NAMES: readonly { value: Names; label: string; hint: string }[] = [
  { value: "world", label: "World", hint: "The guild's names, the source's under them: Warden · verifier" },
  { value: "source", label: "Source", hint: "The source's own names: Verifier" },
]
const PACES = [0.5, 1, 2, 4] as const
const QUALITIES: readonly { value: Quality; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "ultra", label: "Ultra" },
]
const HUD_MODES: readonly { value: HudMode; label: string }[] = [
  { value: "detailed", label: "Detailed" },
  { value: "minimal", label: "Minimal" },
  { value: "hidden", label: "Hidden" },
]
/** How the Bard films (V1 DirectorControls). */
const DIRECTORS: Readonly<Record<DirectorStyle, { label: string; hint: string }>> = {
  calm: {
    label: "Calm",
    hint: "Eases toward the action and drifts slowly. Never changes the replay's pace.",
  },
  cinematic: {
    label: "Cinematic",
    hint: "Cuts to the best action like a broadcast: close-ups, follows, reaction shots. Replays skip quiet stretches.",
  },
}
const TIMES: readonly { value: TimeMode; label: string; hint: string }[] = [
  { value: "real", label: "Real", hint: "Your clock: at night the hall is at night" },
  { value: "cycle", label: "Day cycle", hint: "A whole day every few minutes" },
  { value: "fixed", label: "Fixed", hint: "Always the hour you pick" },
  { value: "story", label: "Story", hint: "The story's own hours: the Saga runs from dawn to night" },
]
/** The pinnable weathers, in lever order: cloudy only ever comes from the guild itself. */
const WEATHERS: readonly { value: WeatherPick; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "clear", label: "Clear" },
  { value: "rain", label: "Rain" },
  { value: "storm", label: "Storm" },
  { value: "snow", label: "Snow" },
]

/** The seasons, in the year's order; Auto follows the world's date. */
const SEASONS: readonly { value: SeasonPick; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer" },
  { value: "autumn", label: "Autumn" },
  { value: "winter", label: "Winter" },
]

/** The camera's keys, as the Settings sheet lists them. */
export const SETTINGS_KEYS: readonly (readonly [string, string])[] = [
  ["Drag", "Pan"],
  ["Right-drag", "Turn"],
  ["Wheel", "Zoom"],
  ["W A S D", "Move"],
  ["Click", "Follow someone"],
  ["B", "Bard on / off"],
  ["H", "Detailed / Minimal / Hidden"],
  ["Esc", "Back to the director"],
]

const pace = (p: number) => (p === 0.5 ? "½×" : `${p}×`)

/** 13.5 → `13:30`. */
export function hourWords(hour: number): string {
  const minutes = Math.floor((((hour % 24) + 24) % 24) * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

export interface SettingsPanelProps {
  values: SettingsValues
  onChange: (patch: Partial<SettingsValues>) => void
  onClose: () => void
  /** "Your repo as an island": opens the repo door. Left out, the section is not drawn. */
  onRepo?: () => void
  /** What the world is doing now, beside Weather: `Cloudy · 23°C`. */
  weatherNow?: string
  /** The season shown now, beside Season: `Autumn`. */
  seasonNow?: string
  /** The hour the world shows now (0–24), beside Time. */
  hourNow?: number
  /** Who the camera is on, under the Bard switch (`Following the Warden`); default from `director`. */
  cameraNote?: string
  /** The Sound section's levers (the sound agent's); left out, no Sound section. */
  sound?: ReactNode
  /** Dev-only controls, drawn last under "Developer"; leave out unless `?dev=1`. */
  dev?: ReactNode
  /** The weathers offered (default V1's five); the world's own kinds where they differ. */
  weathers?: readonly { value: WeatherPick; label: string }[]
  /** The quality tiers offered (default Auto to Ultra). */
  qualities?: readonly { value: Quality; label: string }[]
  /** More of the Display section's levers (a hall's name plates), after the HUD mode. */
  display?: ReactNode
  /** Keys to list (default: the camera's). */
  keys?: readonly (readonly [string, string])[]
  className?: string
}

function Section({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
  return (
    <section className="hud-set-section">
      <h3 className="ui-section-head">
        {title}
        {value && <span className="meta">{value}</span>}
      </h3>
      {children}
    </section>
  )
}

/** A sub-section of the Director's controls: a small brass head, V1's `h4`. */
function Sub({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
  return (
    <section className="hud-set-sub">
      <h4>
        {title}
        {value && <span className="meta">{value}</span>}
      </h4>
      {children}
    </section>
  )
}

export function SettingsPanel({
  values,
  onChange,
  onClose,
  onRepo,
  weatherNow,
  seasonNow,
  hourNow,
  cameraNote,
  sound,
  dev,
  weathers = WEATHERS,
  qualities = QUALITIES,
  display,
  keys = SETTINGS_KEYS,
  className,
}: SettingsPanelProps) {
  const head = useRef<HTMLHeadingElement>(null)
  const directorId = useId()
  useEffect(() => {
    head.current?.focus()
  }, [])
  const auto = values.quality === "auto"
  const qualityNow = values.qualityNow && qualities.find((q) => q.value === values.qualityNow)?.label
  const world = values.time !== undefined || values.weather !== undefined || values.season !== undefined
  const style = values.directorStyle

  return (
    <aside
      className={`ui-panel hud-settings${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-labelledby="hud-settings-h"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        e.stopPropagation()
        onClose()
      }}
    >
      <header className="hud-settings-head">
        <h2 id="hud-settings-h" ref={head} tabIndex={-1}>
          Settings
        </h2>
        <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close settings (Esc)">
          <Glyphs.close />
        </button>
      </header>
      <div className="hud-settings-body">
        {onRepo && (
          <Section title="Your repo">
            <button type="button" className="hud-set-link" aria-haspopup="dialog" onClick={onRepo}>
              <Glyphs.island size={20} />
              <span className="ui-toggle-text">
                <b>Your repo as an island</b>
                <span>Grow one from any public GitHub repo</span>
              </span>
              <Glyphs.chevron size={16} />
            </button>
          </Section>
        )}

        <Section title="Quality" value={auto && qualityNow ? `Auto · now ${qualityNow}` : undefined}>
          <Segmented
            label="Tier"
            value={values.quality}
            options={qualities}
            onChange={(v) => onChange({ quality: v as Quality })}
          />
          <p className="ui-hint">
            {qualities.some((q) => q.value === "ultra")
              ? auto
                ? "Steps between Low and High to keep the frame rate smooth. Ultra is never picked for you."
                : "Pinned. Ultra is heavier; for a strong GPU."
              : auto
                ? "Steps between Low and High to keep the frame rate smooth."
                : "Pinned, and kept for your next visits. Low is lightest on a phone or an old laptop."}
          </p>
        </Section>

        <section className="hud-set-section hud-set-director" aria-labelledby={directorId}>
          <header className="hud-director-head">
            <h3 id={directorId}>Director's controls</h3>
            <p className="ui-hint">
              The story's pace, the hour, the weather and the season, and how the Bard films them.
            </p>
          </header>
          <Sub title="Story" value={values.pace === 0 ? "Paused" : undefined}>
            <Segmented
              label="Pace"
              value={String(values.pace)}
              options={PACES.map((p) => ({ value: String(p), label: pace(p) }))}
              onChange={(v) => onChange({ pace: Number(v) })}
            />
          </Sub>
          {world && (
            <Sub title="World">
              {values.time !== undefined && (
                <>
                  <Segmented
                    label={`Time${hourNow !== undefined ? ` · ${hourWords(hourNow)}` : ""}`}
                    value={values.time}
                    options={TIMES}
                    onChange={(v) => onChange({ time: v as TimeMode })}
                  />
                  {values.time === "fixed" && (
                    <Slider
                      label="Hour of day"
                      value={values.hour ?? hourNow ?? 12}
                      min={0}
                      max={23.5}
                      step={0.5}
                      format={hourWords}
                      onChange={(hour) => onChange({ hour })}
                    />
                  )}
                  <p className="ui-hint">{TIMES.find((t) => t.value === values.time)?.hint}</p>
                </>
              )}
              {values.weather !== undefined && (
                <>
                  <Segmented
                    label={`Weather${weatherNow ? ` · ${weatherNow}` : ""}`}
                    value={values.weather}
                    options={weathers}
                    onChange={(v) => onChange({ weather: v as WeatherPick })}
                  />
                  {values.weather === "auto" && (
                    <p className="ui-hint">Follows the guild: failures bring clouds, rain and storms.</p>
                  )}
                </>
              )}
              {values.season !== undefined && (
                <>
                  <Segmented
                    label={`Season${seasonNow ? ` · ${seasonNow}` : ""}`}
                    value={values.season}
                    options={SEASONS}
                    onChange={(v) => onChange({ season: v as SeasonPick })}
                  />
                  {values.season === "auto" && (
                    <p className="ui-hint">
                      Follows the date: the timeline's in a history, the story's own, else today's.
                    </p>
                  )}
                </>
              )}
            </Sub>
          )}
          <Sub title="The Bard">
            <Toggle
              label="Bard"
              hint={
                cameraNote ??
                (values.director ? "Directs the shots for you" : "Yours until you turn it back on")
              }
              checked={values.director}
              onChange={(director) => onChange({ director })}
            />
            {style && (
              <>
                <Segmented
                  label="Director"
                  value={style}
                  options={(Object.keys(DIRECTORS) as DirectorStyle[]).map((s) => ({
                    value: s,
                    label: DIRECTORS[s].label,
                  }))}
                  onChange={(v) => onChange({ directorStyle: v as DirectorStyle })}
                />
                <p className="ui-hint">{DIRECTORS[style].hint}</p>
              </>
            )}
          </Sub>
        </section>

        <Section title="Camera">
          <details className="hud-keys">
            <summary>
              <Glyphs.chevron size={12} />
              Controls
            </summary>
            <dl>
              {keys.map(([key, what]) => (
                <div key={key}>
                  <dt>
                    <Kbd>{key}</Kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Section>

        {sound && <Section title="Sound">{sound}</Section>}

        <Section title="Display">
          <Segmented
            label="HUD (press H)"
            value={values.hud}
            options={HUD_MODES}
            onChange={(v) => onChange({ hud: v as HudMode })}
          />
          {display}
          {values.names !== undefined && (
            <>
              <Segmented
                label="Names"
                value={values.names}
                options={NAMES}
                onChange={(v) => onChange({ names: v as Names })}
              />
              <p className="ui-hint">{NAMES.find((n) => n.value === values.names)?.hint}</p>
            </>
          )}
          <Toggle
            label="Story captions"
            hint="A narrated line for each beat, like subtitles. Shown in Minimal and Hidden"
            checked={values.captions}
            onChange={(captions) => onChange({ captions })}
          />
        </Section>

        {dev && (
          <Section title="Developer" value="?dev=1">
            {dev}
          </Section>
        )}
      </div>
    </aside>
  )
}
