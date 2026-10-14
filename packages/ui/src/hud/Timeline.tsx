/**
 * The timeline: ONE bar with two scales (plan §2 "Chronicle scrub"). History runs over the repo's years
 * (the island grows as the playhead moves); Session runs over the minutes of a guild's log (heroes replay
 * exactly). V1's tape: a brass play disc, the time, a brass rail with the beats on it; plus the scale
 * switch and, live, a way back to now. Props only: the caller owns the clock.
 */
import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
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
  /**
   * False: V1's hairline, a 180×6 line of progress that opens into the bar on hover, keyboard focus or a
   * tap (a press elsewhere, or Esc, folds it again). True (the default): the bar stays open.
   */
  pinned?: boolean
  /** The scrub's step in the scale's units (default: a day of history, a second of session). */
  step?: number
  /** The playback speed (1 = the caller's own pace); with `onRate`, a chip that steps through the speeds. */
  rate?: number
  onRate?: () => void
  /**
   * The line under the time in place of the span (V1's growth bar: `1,534 contributors · 60 in town ·
   * 1,113 files`); as parts, each its own span (`data-part` its index), so a narrow bar can drop one.
   */
  note?: TimelineNote
  /**
   * Moves the bar without a render (V1's growth tape): called once with a writer the caller runs as the
   * time goes (a frame, a clock's tick); it writes the fill, the time, the scrub and the note straight
   * into the bar. Returns the stop.
   */
  drive?: (write: TimelineWrite) => () => void
  /** The bar's first action in place of the play disc (History at today: "Watch it grow"). */
  primary?: { label: string; onClick: () => void; title?: string }
  /** A ✕ at the bar's end (History told: "Skip to today"). */
  onClose?: () => void
  closeLabel?: string
}

export type TimelineNote = string | readonly string[]
/** Writes the time `at` (and the note) into a driven bar. */
export type TimelineWrite = (at: number, note?: TimelineNote) => void

const MARKER_LABEL: Record<TimelineMarker["kind"], string> = {
  quest: "Quest sent",
  loot: "Loot returned",
  plea: "Plea",
  fail: "Deed failed",
  release: "Release",
  born: "A package is born",
  era: "An era opens",
  busiest: "The busiest week",
}

const partsOf = (note: TimelineNote): readonly string[] => (typeof note === "string" ? [note] : note)
const sameParts = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, k) => x === b[k])

/** The history's span under the date: its years, or its months (or month) when it is younger than a year. */
export function historySpan(start: number, end: number): string {
  const a = new Date(start).getUTCFullYear()
  const b = new Date(end).getUTCFullYear()
  if (a !== b) return `${a} – ${b}`
  const m0 = month(start)
  const m1 = month(end)
  return m0 === m1 ? m0 : `${m0.split(" ")[0]} – ${m1}`
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
  step,
  rate,
  onRate,
  note,
  drive,
  primary,
  onClose,
  closeLabel = "Close",
}: TimelineProps) {
  const history = scale === "history"
  const len = Math.max(1, end - start)
  const p = Math.max(0, Math.min(1, (at - start) / len))
  const now = history ? day(at) : clock(at - start)
  const total = history ? historySpan(start, end) : clock(len)
  const what = history ? "Repo history" : "Session"
  const behind = live && end - at > 1500
  const say = (t: number) => (history ? month(t) : clock(t - start))
  const root = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLElement>(null)
  const noteRef = useRef<HTMLElement>(null)
  const rangeRef = useRef<HTMLInputElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [opened, setOpened] = useState(false)
  const id = useId()
  const parts = note === undefined ? undefined : partsOf(note)

  // a driven bar: the caller's writer moves it between renders (no render a frame)
  const bounds = useRef({ start, end, history })
  bounds.current = { start, end, history }
  useEffect(() => {
    if (!drive) return
    let said = ""
    let shown: readonly string[] = []
    return drive((t, next) => {
      const { start: s, end: e, history: h } = bounds.current
      const span = Math.max(1, e - s)
      root.current?.style.setProperty("--p", String(Math.max(0, Math.min(1, (t - s) / span))))
      const label = h ? day(t) : clock(t - s)
      if (label !== said) {
        said = label
        if (timeRef.current) timeRef.current.textContent = label
        rangeRef.current?.setAttribute("aria-valuetext", h ? label : `${label} of ${clock(span)}`)
      }
      const range = rangeRef.current
      if (range && !dragging.current) range.value = String(Math.max(s, Math.min(e, t)))
      for (const beat of railRef.current?.querySelectorAll<HTMLElement>(".hud-beat") ?? []) {
        const past = String(Number(beat.dataset.at) <= t)
        if (beat.dataset.past !== past) beat.dataset.past = past
      }
      const want = next === undefined ? undefined : partsOf(next)
      const box = noteRef.current
      if (want && box && !sameParts(want, shown)) {
        shown = want
        if (box.children.length !== want.length)
          box.replaceChildren(...want.map(() => document.createElement("span")))
        want.forEach((text, k) => {
          const el = box.children[k] as HTMLElement
          el.dataset.part = String(k)
          if (el.textContent !== text) el.textContent = text
        })
      }
    })
  }, [drive])

  // a tapped-open hairline folds again on a press anywhere else
  useEffect(() => {
    if (!opened) return
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpened(false)
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [opened])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc folds a tapped-open hairline from inside it
    <div
      ref={root}
      className="hud-timeline"
      data-pinned={pinned}
      data-open={!pinned && opened}
      data-scale={scale}
      style={{ "--p": p } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !opened) return
        event.stopPropagation()
        setOpened(false)
      }}
    >
      {!pinned && (
        <button
          type="button"
          className="hud-timeline-hint"
          aria-expanded={opened}
          aria-label={`${what}: ${history ? day(at) : `${clock(at - start)} of ${clock(len)}`}. Show the timeline`}
          onClick={() => setOpened(true)}
        >
          <i />
        </button>
      )}
      <section className="ui-panel hud-tape" aria-label={`Timeline: ${what}`}>
        {primary ? (
          <button
            type="button"
            className="hud-grow"
            onClick={primary.onClick}
            {...(primary.title ? { title: primary.title } : {})}
          >
            <Glyphs.play />
            <span>{primary.label}</span>
          </button>
        ) : (
          <button
            type="button"
            className="hud-play"
            onClick={() => onPlay(!playing)}
            aria-label={playing ? `Pause the ${what.toLowerCase()}` : `Play the ${what.toLowerCase()}`}
            aria-pressed={playing}
            title={playing ? "Pause · Space" : "Play · Space"}
          >
            {playing ? <Glyphs.pause /> : <Glyphs.play />}
          </button>
        )}
        <span className="hud-tape-time" aria-hidden="true" data-note={parts ? "" : undefined}>
          <b ref={timeRef} className="num">
            {now}
          </b>
          <small ref={noteRef} className="num">
            {parts
              ? parts.map((text, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the note's parts are positional
                  <span key={k} data-part={k}>
                    {text}
                  </span>
                ))
              : history
                ? total
                : `/ ${total}`}
          </small>
        </span>
        <div className="hud-track">
          <div ref={railRef} className="hud-track-rail" aria-hidden="true">
            <div className="hud-track-fill" />
            {markers.map((m, k) => (
              <i
                // biome-ignore lint/suspicious/noArrayIndexKey: markers are positional for one scale
                key={k}
                className="hud-beat"
                data-kind={m.kind}
                data-at={m.at}
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
          {markers.length > 0 && (
            <p id={`${id}-beats`} className="ui-visually-hidden">
              {`Marks: ${markers.map((m) => `${m.label ?? MARKER_LABEL[m.kind]}, ${say(m.at)}`).join("; ")}`}
            </p>
          )}
          <input
            ref={rangeRef}
            type="range"
            min={start}
            max={end}
            step={step ?? (history ? DAY_MS : 1000)}
            value={Math.max(start, Math.min(end, at))}
            aria-label={history ? "Repo history: day" : "Session time"}
            {...(markers.length > 0 ? { "aria-describedby": `${id}-beats` } : {})}
            aria-valuetext={history ? day(at) : `${clock(at - start)} of ${clock(len)}`}
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
            onPointerDown={() => {
              dragging.current = true
            }}
            onPointerUp={() => {
              dragging.current = false
            }}
            onPointerCancel={() => {
              dragging.current = false
            }}
          />
        </div>
        {rate !== undefined && onRate && (
          <button
            type="button"
            className="hud-rate num"
            onClick={onRate}
            aria-label={`Speed ${rate} times; change the speed`}
            title="Speed"
          >
            {rate}×
          </button>
        )}
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
        {onClose && (
          <button
            type="button"
            className="hud-tape-close"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <Glyphs.close />
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
