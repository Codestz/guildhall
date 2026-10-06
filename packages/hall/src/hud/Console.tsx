import { type CSSProperties, useRef } from "react"
import { type GuildStore, SCENARIOS, type ScenarioId } from "../guild/store.ts"
import { MOODS, type Mood } from "../world/moods.ts"
import { clock, MARKER_LABEL } from "./format.ts"
import { Icon } from "./icons.tsx"

const SPEEDS = [0.5, 1, 2, 4] as const
const STORIES: Record<ScenarioId, string> = { party: "Party", solo: "Solo", rush: "Rush" }

/**
 * The instrument panel along the bottom: the tape (play, time, scrubber with the story's beats)
 * over the stage levers (story, pace, mood, camera). `stageOpen` lets phones fold the levers away.
 */
export function Console({ store, stageOpen }: { store: GuildStore; stageOpen: boolean }) {
  const resume = useRef(1)
  const paused = store.speed === 0
  const progress = store.duration > 0 ? store.time / store.duration : 0
  const following = store.selected ? store.views.find((v) => v.id === store.selected) : undefined
  const watched = store.focus ? store.views.find((v) => v.id === store.focus?.id) : undefined
  const camera = following
    ? `Following ${following.title}`
    : store.bard
      ? watched
        ? `Filming ${watched.title}`
        : "Directing"
      : "Free camera"

  function togglePlay() {
    if (paused) store.setSpeed(resume.current)
    else {
      resume.current = store.speed
      store.setSpeed(0)
    }
  }

  return (
    <div className="plaque console">
      <div className="tape">
        <button
          type="button"
          className="play"
          onClick={togglePlay}
          aria-label={paused ? "Play" : "Pause"}
          title={paused ? "Play" : "Pause"}
        >
          {paused ? <Icon.play /> : <Icon.pause />}
        </button>
        <span className="tape-time mono" aria-hidden="true">
          <b>{clock(store.time)}</b>
          <span> / {clock(store.duration)}</span>
        </span>
        <div className="track" style={{ "--p": progress } as CSSProperties}>
          <div className="track-rail" aria-hidden="true">
            <div className="track-fill" />
            {store.markers
              .filter((m) => m.kind !== "walk")
              .map((m, i) => (
                <i
                  // biome-ignore lint/suspicious/noArrayIndexKey: markers are a fixed list per story
                  key={i}
                  className="beat"
                  data-kind={m.kind}
                  data-past={m.at <= store.time}
                  style={{ left: `${(m.at / Math.max(1, store.duration)) * 100}%` }}
                  title={`${MARKER_LABEL[m.kind]} · ${clock(m.at)}`}
                />
              ))}
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            step={1}
            value={Math.round(progress * 1000)}
            aria-label="Story time"
            aria-valuetext={`${clock(store.time)} of ${clock(store.duration)}`}
            onChange={(event) => store.seek((Number(event.target.value) / 1000) * store.duration)}
          />
        </div>
      </div>

      <div className="stage" data-open={stageOpen} id="stage-levers">
        <fieldset className="lever">
          <legend>Story</legend>
          <div className="seg">
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
            <button type="button" aria-pressed={store.mode === "live"} onClick={() => store.live()}>
              Live
            </button>
          </div>
        </fieldset>

        <fieldset className="lever">
          <legend>Pace</legend>
          <div className="seg mono">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={store.speed === speed || (paused && resume.current === speed)}
                aria-label={`${speed} times speed`}
                onClick={() => {
                  resume.current = speed
                  store.setSpeed(speed)
                }}
              >
                {speed === 0.5 ? "½" : speed}×
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="lever">
          <legend>
            Mood <span className="lever-value">{store.mood.name}</span>
          </legend>
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
        </fieldset>

        <fieldset className="lever lever-bard">
          <legend>Camera</legend>
          <button
            type="button"
            role="switch"
            className="bard"
            aria-checked={store.bard}
            onClick={() => store.setBard(!store.bard)}
          >
            <span className="switch" aria-hidden="true">
              <i />
            </span>
            <span className="bard-text">
              <b>Bard</b>
              <span>{camera}</span>
            </span>
          </button>
        </fieldset>
      </div>
    </div>
  )
}
