/**
 * The timeline: ONE bar with two scales (plan §2 "Chronicle scrub"). History runs over the repo's years
 * (the island grows as the playhead moves); Session runs over the minutes of a guild's log (heroes replay
 * exactly). V1's tape: a brass play disc, the time, a brass rail with the beats on it; plus the scale
 * switch and, live, a way back to now. Props only: the caller owns the clock.
 */
import type { CSSProperties } from "react"
import { clock, day, month, ticks } from "./format.ts"
import { Glyphs } from "./glyphs.tsx"
import type { TimelineMarker, TimeScale } from "./types.ts"

const DAY_MS = 86_400_000

export interface TimelineProps {
  scale: TimeScale
  /** The switch between the scales; left out, the bar has one scale and no switch. */
  onScale?: (scale: TimeScale) => void
  /** Bounds and playhead in the scale's units: epoch ms for history, ms since the start for a session. */
  start: number
  end: number
  at: number
  markers?: readonly TimelineMarker[]
  playing: boolean
  onPlay: (playing: boolean) => void
  onSeek: (at: number) => void
  /** Session: the log is live. `onLive` jumps back to now when the playhead is behind it. */
  live?: boolean
  onLive?: () => void
  /** History cannot be shown (no chronicle for this repo): the History switch is off, with this reason. */
  historyUnavailable?: string
  /** False: a hairline of progress that opens into the bar on hover or keyboard focus (V1's Minimal). */
  pinned?: boolean
}

const MARKER_LABEL: Record<TimelineMarker["kind"], string> = {
  quest: "Quest sent",
  loot: "Loot returned",
  plea: "Plea",
  fail: "Deed failed",
  release: "Release",
  born: "A package is born",
}

export function Timeline({
  scale,
  onScale,
  start,
  end,
  at,
  markers = [],
  playing,
  onPlay,
  onSeek,
  live = false,
  onLive,
  historyUnavailable,
  pinned = true,
}: TimelineProps) {
  const history = scale === "history"
  const len = Math.max(1, end - start)
  const p = Math.max(0, Math.min(1, (at - start) / len))
  const now = history ? day(at) : clock(at - start)
  const total = history
    ? `${new Date(start).getUTCFullYear()} – ${new Date(end).getUTCFullYear()}`
    : clock(len)
  const what = history ? "Repo history" : "Session"
  const behind = live && end - at > 1500
  const say = (t: number) => (history ? month(t) : clock(t - start))

  return (
    <div
      className="hud-timeline"
      data-pinned={pinned}
      data-scale={scale}
      style={{ "--p": p } as CSSProperties}
    >
      <div className="hud-timeline-hint" aria-hidden="true">
        <i />
      </div>
      <section className="ui-panel hud-tape" aria-label={`Timeline: ${what}`}>
        <button
          type="button"
          className="hud-play"
          onClick={() => onPlay(!playing)}
          aria-label={playing ? `Pause the ${what.toLowerCase()}` : `Play the ${what.toLowerCase()}`}
          aria-pressed={playing}
        >
          {playing ? <Glyphs.pause /> : <Glyphs.play />}
        </button>
        <span className="hud-tape-time" aria-hidden="true">
          <b className="num">{now}</b>
          <small className="num">{history ? total : `/ ${total}`}</small>
        </span>
        <div className="hud-track">
          <div className="hud-track-rail" aria-hidden="true">
            <div className="hud-track-fill" />
            {markers.map((m, k) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: markers are positional for one scale
                key={k}
                className="hud-beat"
                data-kind={m.kind}
                data-past={m.at <= at}
                style={{ left: `${((m.at - start) / len) * 100}%` }}
                title={`${m.label ?? MARKER_LABEL[m.kind]} · ${say(m.at)}`}
              />
            ))}
          </div>
          <ol className="hud-ticks" aria-hidden="true">
            {ticks(scale, start, end).map((t) => (
              <li key={t.label} style={{ left: `${t.p * 100}%` }}>
                {t.label}
              </li>
            ))}
          </ol>
          <input
            type="range"
            min={start}
            max={end}
            step={history ? DAY_MS : 1000}
            value={Math.max(start, Math.min(end, at))}
            aria-label={history ? "Repo history: day" : "Session time"}
            aria-valuetext={history ? day(at) : `${clock(at - start)} of ${clock(len)}`}
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
          />
        </div>
        {live && !history && (
          <button
            type="button"
            className="hud-live"
            data-behind={behind}
            onClick={onLive}
            disabled={!behind || !onLive}
            aria-label={behind ? "Back to live" : "Live, at the newest event"}
          >
            <i aria-hidden="true" />
            Live
          </button>
        )}
        {onScale && (
          <fieldset className="hud-scale">
            <legend className="ui-visually-hidden">Timeline scale</legend>
            <button
              type="button"
              aria-pressed={history}
              disabled={Boolean(historyUnavailable)}
              title={historyUnavailable ?? "The repo's history, in years"}
              onClick={() => onScale("history")}
            >
              <Glyphs.history size={14} />
              <span className="hud-scale-word">History</span>
            </button>
            <button
              type="button"
              aria-pressed={!history}
              title="This session, in minutes"
              onClick={() => onScale("session")}
            >
              <Glyphs.session size={14} />
              <span className="hud-scale-word">Session</span>
            </button>
          </fieldset>
        )}
      </section>
    </div>
  )
}
