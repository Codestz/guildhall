import { type CSSProperties, useId } from "react"
import type { DirectorStyle } from "../guild/director.ts"
import { MODE } from "../guild/mode.ts"
import { type GuildStore, SCENARIOS, type ScenarioId } from "../guild/store.ts"
import { MOODS, type Mood } from "../world/moods.ts"
import { sitePage } from "./directing.ts"
import { Icon } from "./icons.tsx"
import { Lever, Section, Switch } from "./levers.tsx"
import { WeatherLevers } from "./Weather.tsx"
import "./wayfinding.css"

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

/**
 * The Director's controls (hud/directing.ts decides who sees them): which story plays and how fast,
 * the hour, weather and mood, and the Bard and how it films. One group inside Settings, so a demo's
 * levers read as a set apart from the viewer's own preferences.
 */
export function DirectorControls({ store }: { store: GuildStore }) {
  const id = useId()
  const showcase = MODE === "showcase"
  const paused = store.speed === 0
  const camera = store.selected
    ? `Following ${store.views.find((v) => v.id === store.selected)?.title ?? "someone"}`
    : store.bard
      ? "Directs the shots for you"
      : "Yours until you turn it back on"

  return (
    <section className="set-section director" aria-labelledby={id}>
      <header className="director-head">
        <h3 id={id}>Director's controls</h3>
        <p className="hint">The story, the hour and the weather, and how the Bard films them.</p>
      </header>

      {(store.mode === "sim" || !showcase) && (
        <Section title="Story" sub>
          <Lever label="Story" quiet>
            <div className="seg seg-fill seg-stories">
              {(Object.keys(SCENARIOS) as ScenarioId[]).map((scenario) => (
                <button
                  key={scenario}
                  type="button"
                  aria-pressed={store.mode === "sim" && store.scenario === scenario}
                  onClick={() => store.load(scenario)}
                >
                  {STORIES[scenario]}
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

      <Section title="World" sub>
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

      <Section title="The Bard" sub>
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
      </Section>
    </section>
  )
}

/**
 * Where the Director's controls went, on a plain showcase visit: one row to /demos, where every
 * story, hour and weather is a link that opens with them.
 */
export function DirectorsElsewhere() {
  const demos = sitePage("/demos")
  return (
    <Section title="Director's controls">
      <a
        className="set-link"
        href={demos.href}
        {...(demos.away ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        <Icon.play />
        <span className="toggle-text">
          <b>Direct a scene</b>
          <span>
            Pick the story, the hour and the weather on Demos
            {demos.away && <span className="visually-hidden"> (opens in a new tab)</span>}
          </span>
        </span>
        <Icon.chevron />
      </a>
    </Section>
  )
}
