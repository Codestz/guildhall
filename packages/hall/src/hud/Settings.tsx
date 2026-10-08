import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useSyncExternalStore } from "react"
import type { DirectorStyle } from "../guild/director.ts"
import { MODE } from "../guild/mode.ts"
import { type QualityChoice, quality, TIERS, type Tier } from "../guild/quality.ts"
import { type GuildStore, SCENARIOS, type ScenarioId } from "../guild/store.ts"
import { active, BACKEND_NAME, type Backend, backendUrl, webgpuAvailable } from "../render/backend.ts"
import { MOODS, type Mood } from "../world/moods.ts"
import { Icon } from "./icons.tsx"
import { HUD_MODES, type HudMode, hudPrefs, useHudPrefs } from "./prefs.ts"
import { SoundLevers } from "./Sound.tsx"
import { WeatherLevers } from "./Weather.tsx"

/** How the Bard films (guild/director.ts). */
const DIRECTORS: Record<DirectorStyle, { label: string; hint: string }> = {
  calm: {
    label: "Calm",
    hint: "Eases toward the action and drifts slowly. Never changes the replay's pace.",
  },
  cinematic: {
    label: "Cinematic",
    hint: "Cuts to the best action like a broadcast: close-ups, follows, reaction shots. Replays skip quiet stretches.",
  },
}

const QUALITY: QualityChoice[] = ["auto", 0, 1, 2, 3]
const BACKENDS: Backend[] = ["webgl", "webgpu"]
const SPEEDS = [0.5, 1, 2, 4] as const
const STORIES: Record<ScenarioId, string> = {
  saga: "Saga",
  party: "Party",
  solo: "Solo",
  rush: "Rush",
  parties: "Parties",
  factions: "Factions",
  seas: "Seas",
}
const KEYS: [string, string][] = [
  ["Drag", "Pan"],
  ["Right-drag", "Turn"],
  ["Wheel", "Zoom"],
  ["W A S D", "Move"],
  ["Q E · R F", "Turn · tilt"],
  ["+ −", "Zoom"],
  ["Click", "Follow someone"],
  ["V", "Diorama / Explore"],
  ["B", "Bard on / off"],
  ["H", "Minimal / Detailed / Hidden"],
  ["Esc", "Back to the Bard"],
]

/**
 * Everything the viewer can tune, in one place: quality, the world, the camera, the story and the
 * HUD itself. A side drawer on desktop, a bottom sheet on phones. Non-modal: the hall stays live
 * behind it, Esc closes it and focus returns to the gear.
 *
 * `onLegends` (phones): the toolbar there keeps only HUD mode and Settings, so the Legends book and
 * Sound lead the sheet instead of sitting in the bar.
 */
export function Settings({
  store,
  onClose,
  onLegends,
}: {
  store: GuildStore
  onClose: () => void
  onLegends?: () => void
}) {
  const tier = useSyncExternalStore(quality.subscribe, quality.snapshot)
  const prefs = useHudPrefs()
  const showcase = MODE === "showcase"
  const head = useRef<HTMLHeadingElement>(null)
  const paused = store.speed === 0

  useEffect(() => {
    head.current?.focus()
  }, [])

  const camera = store.selected
    ? `Following ${store.views.find((v) => v.id === store.selected)?.title ?? "someone"}`
    : store.bard
      ? "Directs the shots for you"
      : "Yours until you turn it back on"

  return (
    <aside className="plaque settings" role="dialog" aria-labelledby="settings-h">
      <header className="settings-head">
        <h2 id="settings-h" ref={head} tabIndex={-1}>
          Settings
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings (Esc)">
          <Icon.close />
        </button>
      </header>

      <div className="settings-body">
        {onLegends && (
          <Section title="Legends">
            <button type="button" className="set-link" aria-haspopup="dialog" onClick={onLegends}>
              <Icon.book />
              <span className="toggle-text">
                <b>Open the Legends</b>
                <span>The story so far, chapter by chapter</span>
              </span>
              <Icon.chevron />
            </button>
          </Section>
        )}
        {onLegends && (
          <Section title="Sound">
            <SoundLevers />
          </Section>
        )}

        <Section title="Quality" value={quality.auto ? `Auto · now ${TIERS[tier].name}` : TIERS[tier].name}>
          <Lever label="Quality" quiet>
            <div className="seg seg-fill">
              {QUALITY.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={quality.choice === choice}
                  onClick={() => quality.choose(choice)}
                >
                  {choice === "auto" ? "Auto" : TIERS[choice as Tier].name}
                </button>
              ))}
            </div>
          </Lever>
          <p className="hint">
            {quality.choice === 3
              ? "Ultra: tilt-shift miniature look and full Retina sharpness. Heavier; for a strong GPU."
              : quality.auto
                ? "Steps between Low and High to keep the frame rate smooth. Ultra is never picked for you."
                : "Pinned. Ultra adds the tilt-shift miniature look, and is heavier."}
          </p>
          {webgpuAvailable() && <RendererLever />}
        </Section>

        <Section title="World">
          <WeatherLevers store={store} />
          <Lever label="Mood" value={store.mood.name}>
            <div className="moods">
              {(Object.values(MOODS) as Mood[]).map((mood) => (
                <button
                  key={mood.id}
                  type="button"
                  className="mood"
                  aria-pressed={store.mood.id === mood.id}
                  aria-label={mood.name}
                  title={mood.name}
                  onClick={() => store.setMood(mood.id)}
                  style={{ "--sky": mood.ground, "--fire": mood.fire } as CSSProperties}
                />
              ))}
            </div>
          </Lever>
        </Section>

        <Section title="Camera">
          <Lever label="View">
            <div className="seg seg-fill">
              <button
                type="button"
                aria-pressed={store.view === "diorama"}
                onClick={() => store.setView("diorama")}
              >
                Diorama
              </button>
              <button
                type="button"
                aria-pressed={store.view === "explore"}
                onClick={() => store.setView("explore")}
              >
                Explore
              </button>
            </div>
          </Lever>
          <Switch label="Bard" hint={camera} checked={store.bard} onChange={(on) => store.setBard(on)} />
          <Lever label="Director" value={DIRECTORS[store.directorStyle].label}>
            <div className="seg seg-fill">
              {(Object.keys(DIRECTORS) as DirectorStyle[]).map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={store.directorStyle === style}
                  onClick={() => store.setDirector(style)}
                >
                  {DIRECTORS[style].label}
                </button>
              ))}
            </div>
          </Lever>
          <p className="hint">{DIRECTORS[store.directorStyle].hint}</p>
          <details className="keys">
            <summary>Controls</summary>
            <dl>
              {KEYS.map(([key, what]) => (
                <div key={key}>
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Section>

        {(store.mode === "sim" || !showcase) && (
          <Section title="Story">
            <Lever label="Story" quiet>
              <div className="seg seg-fill">
                {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={store.mode === "sim" && store.scenario === id}
                    onClick={() => store.load(id)}
                  >
                    {STORIES[id]}
                  </button>
                ))}
                {!showcase && (
                  <button type="button" aria-pressed={store.mode === "live"} onClick={() => store.live()}>
                    Live
                  </button>
                )}
              </div>
            </Lever>
            {store.mode === "sim" && (
              <Lever label="Pace" value={paused ? "Paused" : undefined}>
                <div className="seg seg-fill mono">
                  {SPEEDS.map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      aria-pressed={store.speed === speed}
                      aria-label={`${speed} times speed`}
                      onClick={() => store.setSpeed(speed)}
                    >
                      {speed === 0.5 ? "½" : speed}×
                    </button>
                  ))}
                </div>
              </Lever>
            )}
          </Section>
        )}

        {!onLegends && (
          <Section title="Sound">
            <SoundLevers />
          </Section>
        )}

        <Section title="Display">
          <Lever label="HUD" value="press H">
            <div className="seg seg-fill">
              {(Object.keys(HUD_MODES) as HudMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={prefs.mode === mode}
                  title={HUD_MODES[mode].hint}
                  onClick={() => hudPrefs.set({ mode })}
                >
                  {HUD_MODES[mode].label}
                </button>
              ))}
            </div>
          </Lever>
          <Switch
            label="Sigils over agents"
            hint="An icon for each deed in progress, readable with the HUD hidden"
            checked={prefs.sigils}
            onChange={(sigils) => hudPrefs.set({ sigils })}
          />
          <Switch
            label="Story captions"
            hint="A narrated line for each beat, like subtitles. Shown in Minimal and Hidden"
            checked={prefs.captions}
            onChange={(captions) => hudPrefs.set({ captions })}
          />
          <Switch
            label="Stats for nerds"
            hint="Frame rate, draw calls, triangles"
            checked={prefs.stats}
            onChange={(stats) => hudPrefs.set({ stats })}
          />
        </Section>
      </div>
    </aside>
  )
}

/**
 * WebGL or WebGPU (experimental): the renderer is chosen once, at load (`?renderer=`,
 * render/backend.ts), so a choice reloads the page with every other parameter kept. Only offered
 * where the browser has WebGPU. Two tabs side by side, Stats for nerds open in each, compare them.
 */
function RendererLever() {
  const live = active.backend
  return (
    <>
      <Lever label="Renderer" value={BACKEND_NAME[live]}>
        <div className="seg seg-fill">
          {BACKENDS.map((backend) => (
            <button
              key={backend}
              type="button"
              aria-pressed={live === backend}
              onClick={() => {
                if (backend !== live) location.assign(backendUrl(location.href, backend))
              }}
            >
              {backend === "webgpu" ? "WebGPU (experimental)" : BACKEND_NAME[backend]}
            </button>
          ))}
        </div>
      </Lever>
      <p className="hint">
        Reloads the page. WebGPU is a preview: ambient occlusion isn't drawn there yet, and the event shows
        (dragon, festival, comet, ghost ship, rainbow) only partly.
      </p>
    </>
  )
}

function Section({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="set-section" aria-labelledby={id}>
      <h3 id={id}>
        {title}
        <LeverValue value={value} />
      </h3>
      {children}
    </section>
  )
}

/** A labelled group of choices; `value` says what is in effect now. */
export function Lever({
  label,
  value,
  quiet = false,
  children,
}: {
  label: string
  value?: string
  /** The section heading already names it: keep the legend for screen readers only. */
  quiet?: boolean
  children: ReactNode
}) {
  return (
    <fieldset className="lever">
      <legend className={quiet ? "visually-hidden" : undefined}>
        {label}
        <LeverValue value={value} />
      </legend>
      {children}
    </fieldset>
  )
}

/**
 * What is in effect now, after a label. The comma is for screen readers only: without it a legend
 * reads as one word ("MoodMorning Keep"); the gap you see is CSS.
 */
function LeverValue({ value }: { value: string | undefined }) {
  if (!value) return null
  return (
    <>
      <span className="visually-hidden">, </span>
      <span className="lever-value">{value}</span>
    </>
  )
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      className="toggle"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-text">
        <b>{label}</b>
        <span>{hint}</span>
      </span>
      <span className="switch" aria-hidden="true">
        <i />
      </span>
    </button>
  )
}
