import { type CSSProperties, useRef } from "react"
import type { GuildStore } from "../guild/store.ts"
import { clock, MARKER_LABEL } from "./format.ts"
import { Icon } from "./icons.tsx"

/**
 * The story's tape (local app, simulated stories only): play, time and a scrubber with the beats.
 * Pinned, it always shows; unpinned, a hairline of progress that opens on hover or keyboard focus.
 */
export function Timeline({ store, pinned }: { store: GuildStore; pinned: boolean }) {
  const resume = useRef(1)
  const paused = store.speed === 0
  const progress = store.duration > 0 ? store.time / store.duration : 0

  function togglePlay() {
    if (paused) store.setSpeed(resume.current)
    else {
      resume.current = store.speed
      store.setSpeed(0)
    }
  }

  return (
    <div className="timeline" data-pinned={pinned} style={{ "--p": progress } as CSSProperties}>
      <div className="timeline-hint" aria-hidden="true">
        <i />
      </div>
      <div className="plaque tape">
        <button
          type="button"
          className="play"
          onClick={togglePlay}
          aria-label={paused ? "Play the story" : "Pause the story"}
          title={paused ? "Play" : "Pause"}
        >
          {paused ? <Icon.play /> : <Icon.pause />}
        </button>
        <span className="tape-time mono" aria-hidden="true">
          <b>{clock(store.time)}</b>
          <span> / {clock(store.duration)}</span>
        </span>
        <div className="track">
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
                  title={`${m.label ?? MARKER_LABEL[m.kind]} · ${clock(m.at)}`}
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
    </div>
  )
}
