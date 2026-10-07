import type { TimeMode, Weather } from "../guild/environment.ts"
import type { GuildStore } from "../guild/store.ts"

const TIMES: Record<TimeMode, { label: string; title: string }> = {
  real: { label: "Real", title: "Your clock: at night the hall is at night" },
  cycle: { label: "Day cycle", title: "A whole day every few minutes" },
  fixed: { label: "Fixed", title: "Always the hour you pick" },
  story: { label: "Story", title: "The story's own hours: the Saga runs from dawn to night" },
}
const WEATHERS: Record<Weather | "auto", string> = {
  auto: "Auto",
  clear: "Clear",
  rain: "Rain",
  storm: "Storm",
  snow: "Snow",
  cloudy: "Cloudy",
}
/** The pinnable choices, in lever order: cloudy only ever comes from the guild itself. */
const LEVER: (Weather | "auto")[] = ["auto", "clear", "rain", "storm", "snow"]

/**
 * The world's levers (ADR 0007): how the time of day is chosen, and whether the weather follows the
 * guild's health (Auto) or is pinned. Shows what the world is doing now: weather and temperature.
 */
export function WeatherLevers({ store }: { store: GuildStore }) {
  const settings = store.environmentSettings
  const env = store.environment
  const hour = Math.round(settings.hour * 2) / 2

  return (
    <>
      <fieldset className="lever">
        <legend>
          Time <span className="lever-value">{clockOf(env.hour)}</span>
        </legend>
        <div className="seg seg-fill">
          {(Object.keys(TIMES) as TimeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={settings.time === mode}
              title={TIMES[mode].title}
              onClick={() =>
                store.setEnvironment(mode === "fixed" ? { time: mode, hour: env.hour } : { time: mode })
              }
            >
              {TIMES[mode].label}
            </button>
          ))}
        </div>
        {settings.time === "fixed" && (
          <input
            type="range"
            className="slider"
            min={0}
            max={23.5}
            step={0.5}
            value={hour}
            aria-label="Hour of day"
            aria-valuetext={clockOf(hour)}
            onChange={(event) => store.setEnvironment({ hour: Number(event.target.value) })}
          />
        )}
      </fieldset>

      <fieldset className="lever">
        <legend>
          Weather{" "}
          <span className="lever-value">
            {WEATHERS[env.weather]} · {Math.round(env.temperature)}°C
          </span>
        </legend>
        <div className="seg seg-fill">
          {LEVER.map((weather) => (
            <button
              key={weather}
              type="button"
              aria-pressed={settings.weather === weather}
              title={
                weather === "auto" ? "Follows the guild: failures bring clouds, rain and storms" : undefined
              }
              onClick={() => store.setEnvironment({ weather })}
            >
              {WEATHERS[weather]}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  )
}

/** 13.5 → "13:30". */
function clockOf(hour: number): string {
  const minutes = Math.floor((((hour % 24) + 24) % 24) * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}
