/**
 * The hall's timeline bar (plan-hud-events T1; user picks 10-13): the HUD's one `Timeline` (ui, props
 * only) on the hall's clock, with ONE scale picked for you, never a switch. A hall with a session
 * (`?feed=`, a told story, the home's demo guild) shows the session's minutes; a repo's hall without one
 * shows its growth: the date and V1's line under it (`1,534 contributors · 60 in town · 1,113 files`).
 * The beats are few (eras and majors, a story's acts, a session's pleas, failures and quests) and only
 * marks: scrubbing moves the time, a beat is never a button.
 *
 * A session's bar starts in the HUD as V1's hairline (180×6) and opens on hover, keyboard focus or a tap;
 * Detailed pins it open. The history's is V1's growth tape, always open: at today with the clock still its
 * first action is "Watch it grow" (the history from the first commit); while it is told, its date and
 * figures count up without a render, Space plays and pauses and ✕ skips to today. A narrow tape (a
 * phone, a small window) puts its rail on a row of its own under the date. Off the HUD (a Studio lab, `mountTimeline`) it is pinned, with the captions and a story's act chip
 * over it.
 */
import {
  Captions,
  ChapterChip,
  holdHudStyle,
  Timeline,
  type TimelineNote,
  type TimelineWrite,
} from "@guildhall/ui"
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { type ClockState, type HallTime, type HistoryRange, nextRate } from "./clock.ts"
import { SESSION_RATES } from "./feeds/clock.ts"
import type { HallSession } from "./feeds/session.ts"
import { actMarkers, fewMarkers, markersOf } from "./feeds/view.ts"

/** How fine a scrub is: the history in this many steps (a 3-day history is no 3-stop slider). */
const STEPS = 1000

/** Which scale the bar shows, or none. */
export type BarScale = "history" | "session" | null

/**
 * The one scale, picked for you: a session's once it has been heard from (a live hall waiting for its
 * first event shows its history meanwhile, if it has one), else the history's, else no bar.
 */
export function barScale(hasHistory: boolean, hasSession: boolean, heard: boolean): BarScale {
  if (hasSession && (heard || !hasHistory)) return "session"
  return hasHistory ? "history" : null
}

export interface HallTimelineProps {
  time: HallTime
  /** Open for good (Detailed, a lab); else V1's hairline that opens on hover, focus or a tap. */
  pinned?: boolean
  /** The growth line under the history's date, for an epoch-ms day (the hall's chronicle): its parts. */
  growth?: (at: number) => TimelineNote
  /** The captions and a story's act chip over the bar (a lab); the HUD draws its own. */
  overlay?: boolean
}

export function HallTimeline({ time, pinned = true, growth, overlay = true }: HallTimelineProps) {
  const range = useSyncExternalStore(time.subscribe, time.range)
  const session = useSyncExternalStore(time.subscribe, time.session)
  useEffect(() => {
    const releaseHud = holdHudStyle()
    const releaseHall = holdHallStyle()
    return () => {
      releaseHud()
      releaseHall()
    }
  }, [])
  // a session with nothing in it yet (live, before the first event) leaves the bar to the history
  const heard = useSyncExternalStore(session?.subscribe ?? quiet, () => (session?.snapshot().events ?? 0) > 0)
  const scale = barScale(range !== null, session !== null, heard)
  if (scale === "session" && session)
    return <SessionBar session={session} pinned={pinned} overlay={overlay} />
  if (scale === "history" && range)
    return <HistoryBar time={time} range={range} {...(growth ? { growth } : {})} />
  return null
}

/**
 * What the history bar re-renders on: the transport (playing, the speed, a jump) and, while still, where
 * it rests. While it plays the time moves without a render (`drive`): the bar's date, fill, scrub and
 * figures are written straight in as the clock ticks. Pure.
 */
export function barKey(s: Pick<ClockState, "playing" | "rate" | "t" | "jumps">): string {
  return s.playing ? `play|${s.rate}|${s.jumps}` : `rest|${s.rate}|${s.jumps}|${s.t}`
}

/** Whether a key press is the bar's Space (play, pause): not in a field, not on a button of its own. */
export function isSpace(
  event: Pick<KeyboardEvent, "key" | "repeat" | "metaKey" | "ctrlKey" | "altKey" | "target">,
): boolean {
  if (event.key !== " " || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return false
  const el = event.target as { tagName?: string; isContentEditable?: boolean; type?: string } | null
  if (!el?.tagName) return true
  if (el.isContentEditable) return false
  if (/^(textarea|select|button|summary|a)$/i.test(el.tagName)) return false
  return !(el.tagName.toLowerCase() === "input" && el.type !== "range")
}

function HistoryBar({
  time,
  range,
  growth,
}: {
  time: HallTime
  range: HistoryRange
  growth?: (at: number) => TimelineNote
}) {
  const clock = time.clock
  useSyncExternalStore(clock.subscribe, () => barKey(clock.get()))
  const state = clock.get()
  const len = Math.max(1, range.end - range.start)
  const at = range.start + state.t * len
  const idle = state.t >= 1 && !state.playing
  // eras and majors, the busiest week: a package's birth is the Legends' to tell
  const markers = useMemo(
    () =>
      fewMarkers(
        range.markers.filter((m) => m.kind !== "born"),
        range.start,
        len,
      ),
    [range, len],
  )
  // the growth line moves a day at a time; a week is fine-grained enough for its figures
  const grow = useRef(growth)
  grow.current = growth
  const lineAt = useRef<{ week: number; note?: TimelineNote }>({ week: Number.NaN })
  const noteAt = (day: number): TimelineNote | undefined => {
    const week = Math.floor(day / (7 * 86_400_000))
    const memo = lineAt.current
    if (memo.week !== week || !memo.note) {
      const note = grow.current?.(day)
      lineAt.current = note === undefined ? { week } : { week, note }
    }
    return lineAt.current.note
  }
  const note = noteAt(at)
  // the clock's ticks move the bar, never a render
  // biome-ignore lint/correctness/useExhaustiveDependencies: noteAt reads refs only
  const drive = useMemo(
    () => (write: TimelineWrite) =>
      clock.subscribe(() => {
        const t = range.start + clock.get().t * len
        write(t, noteAt(t))
      }),
    [clock, range.start, len],
  )
  // Space plays and pauses (V1's tape), anywhere but in a field or on a button
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSpace(event)) return
      event.preventDefault()
      const s = clock.get()
      clock.play(!s.playing)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [clock])
  // the tape's height for what rides over it (the captions, a phone's foot): one row or two
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    const viewer = el?.closest<HTMLElement>(".ui-viewer")
    if (!el || !viewer) return
    const tape = el.querySelector<HTMLElement>(".hud-timeline")
    if (!tape) return
    const ro = new ResizeObserver(() =>
      viewer.style.setProperty("--tape-h", `${Math.round(tape.offsetHeight)}px`),
    )
    ro.observe(tape)
    return () => {
      ro.disconnect()
      viewer.style.removeProperty("--tape-h")
    }
  }, [])
  // the tape stays open (V1's growth tape): at today its first action is to watch it grow; while the
  // history is told its date and figures count up under the captions, and ✕ skips to today
  return (
    <div ref={box} className="hall-timeline" data-scale="history" data-pinned="true" data-telling={!idle}>
      <Timeline
        scale="history"
        start={range.start}
        end={range.end}
        at={at}
        markers={markers}
        pinned
        playing={state.playing}
        onPlay={(on) => clock.play(on)}
        onSeek={(v) => clock.seek((v - range.start) / len)}
        step={len / STEPS}
        rate={state.rate}
        onRate={() => clock.setRate(nextRate(state.rate))}
        drive={drive}
        {...(idle
          ? {
              primary: {
                label: "Watch it grow",
                onClick: () => clock.play(true),
                title: "Play the history from the first commit · Space",
              },
            }
          : {
              onClose: () => {
                clock.play(false)
                clock.seek(1, { jump: true })
              },
              closeLabel: "Skip to today",
            })}
        {...(note ? { note } : {})}
      />
    </div>
  )
}

const quiet = () => () => {}

/** A phone's width (the Viewer's): the chapter chip is its numeral alone. */
const NARROW = "(max-width: 600px)"
const onNarrow = (fn: () => void) => {
  const q = matchMedia(NARROW)
  q.addEventListener("change", fn)
  return () => q.removeEventListener("change", fn)
}
const isNarrow = () => matchMedia(NARROW).matches

/** The Session scale: the log's minutes, its few beats (a told story's acts), live's way back to now. */
function SessionBar({
  session,
  pinned,
  overlay,
}: {
  session: HallSession
  pinned: boolean
  overlay: boolean
}) {
  const snap = useSyncExternalStore(session.subscribe, session.snapshot)
  const narrow = useSyncExternalStore(onNarrow, isNarrow)
  const { clock } = session
  const c = snap.clock
  const events = snap.events
  const len = Math.max(1000, c.end - c.start)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the beats change when the log grows
  const markers = useMemo(
    () =>
      snap.chapters.length > 0
        ? actMarkers(snap.chapters)
        : fewMarkers(markersOf(session.log().events, c.start), 0, len),
    [events, c.start, len, session, snap.chapters],
  )
  if (events === 0) return null
  return (
    <div className="hall-timeline" data-scale="session" data-pinned={pinned}>
      {overlay && <Captions {...(snap.caption ? { caption: snap.caption } : {})} />}
      {overlay && snap.chapters.length > 0 && (
        <ChapterChip
          chapters={snap.chapters}
          current={Math.max(0, snap.chapter)}
          onJump={(k) => clock.seek(c.start + (snap.chapters[k]?.at ?? 0), { jump: true })}
          compact={narrow}
          className="hall-chapter"
        />
      )}
      <Timeline
        scale="session"
        start={0}
        end={len}
        at={c.at - c.start}
        markers={markers}
        pinned={pinned}
        playing={c.mode === "live" || c.playing}
        onPlay={(on) => clock.play(on)}
        onSeek={(v) => clock.seek(c.start + v)}
        live={c.canLive}
        onLive={() => clock.goLive()}
        rate={c.rate}
        onRate={() => clock.setRate(nextRate(c.rate, SESSION_RATES))}
      />
    </div>
  )
}

/**
 * The bar's place off the HUD: bottom centre; on a phone the bottom edge (safe area kept). In the HUD
 * its bottom-centre slot places it (hall/hud/style.ts).
 */
const CSS = /* css */ `
.gh .hall-timeline {
  position: absolute; z-index: 20; bottom: 16px; left: 50%; translate: -50% 0;
  width: min(680px, calc(100% - 32px)); display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.gh .hall-timeline .hud-timeline { width: 100%; }
.gh .hall-timeline .hud-tape { background: rgba(21, 17, 13, 0.95); }
/* the scrub over the whole track, its thumb on the rail's line (--thumb-y: the rail's middle less half the
   thumb), a ring round it on keyboard focus: stronger than the studio's every-range look (browser/style.ts),
   which would make it a 20 px strip with a thumb of its own */
.gh .hall-timeline { --thumb-y: 13px; }
.gh .hall-timeline .hud-track input[type="range"]:not(.ui-range) { position: absolute; inset: 0; width: 100%; height: 100%; }
.gh .hall-timeline .hud-track input[type="range"]:not(.ui-range)::-webkit-slider-runnable-track { height: 100%; background: transparent; }
.gh .hall-timeline .hud-track input[type="range"]:not(.ui-range)::-moz-range-track { background: transparent; }
.gh .hall-timeline .hud-track input[type="range"]:not(.ui-range)::-moz-range-progress { background: transparent; }
.gh .hall-timeline .hud-track input[type="range"]:not(.ui-range)::-webkit-slider-thumb {
  width: 16px; height: 16px; margin-top: var(--thumb-y); border-radius: 50%; background: var(--brass-hi); border: 3px solid var(--ink-solid); box-shadow: 0 0 0 1px var(--brass);
}
.gh .hall-timeline .hud-track input[type="range"]:not(.ui-range):focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 1px var(--brass), 0 0 0 5px rgba(241, 213, 144, 0.6); }
.gh .hall-timeline .hud-track input[type="range"]:not(.ui-range):focus-visible::-moz-range-thumb { box-shadow: 0 0 0 1px var(--brass), 0 0 0 5px rgba(241, 213, 144, 0.6); }
/* the history's tape (V1's growth tape): the date in the title serif in brass, its figures counting under
   it in mono, never cut: a part that does not fit goes to a line of its own */
.gh .hall-timeline[data-scale="history"] { container: tape / inline-size; }
.gh .hall-timeline[data-scale="history"] .hud-tape-time { flex: 0 1 auto; min-width: 128px; }
.gh .hall-timeline[data-scale="history"] .hud-tape-time b {
  font: 400 18px/1.15 var(--display); letter-spacing: 0.04em; color: var(--brass-hi); font-variant-numeric: tabular-nums;
}
.gh .hall-timeline[data-scale="history"] .hud-tape-time small {
  display: block; max-width: none; overflow: visible; white-space: normal;
  font: 11px/1.35 var(--mono); font-variant-numeric: tabular-nums; color: var(--faint);
}
.gh .hall-timeline[data-scale="history"] .hud-tape-time small > span { display: inline-block; white-space: pre; }
.gh .hall-timeline[data-scale="history"] .hud-track { min-width: 140px; }
/* a narrow tape (a phone, a small window, a phone on its side): two rows, the transport and the date
   over the rail, which takes the whole width */
@container tape (max-width: 600px) {
  .gh .hall-timeline[data-scale="history"] .hud-timeline { height: auto; }
  .gh .hall-timeline[data-scale="history"] .hud-tape {
    position: relative; inset: auto; display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "play time close" "track track rate"; align-items: center;
    column-gap: 10px; row-gap: 0; padding: 9px 8px 4px 11px;
  }
  .gh .hall-timeline[data-scale="history"] :is(.hud-play, .hud-grow) { grid-area: play; }
  .gh .hall-timeline[data-scale="history"] .hud-tape-time { grid-area: time; min-width: 0; }
  .gh .hall-timeline[data-scale="history"] .hud-rate { grid-area: rate; height: 32px; min-width: 44px; }
  .gh .hall-timeline[data-scale="history"] .hud-tape-close { grid-area: close; }
  .gh .hall-timeline[data-scale="history"] .hud-track { grid-area: track; height: var(--track-h, 30px); min-width: 0; }
  .gh .hall-timeline[data-scale="history"] .hud-track-rail { top: calc(var(--track-h, 30px) / 2 - 2px); margin-top: 0; }
  .gh .hall-timeline[data-scale="history"] .hud-timeline { --thumb-y: calc(var(--track-h, 30px) / 2 - 8px); }
  .gh .hall-timeline[data-scale="history"] .hud-ticks { display: none; }
}
/* very narrow: the figures keep the contributors and the files */
@container tape (max-width: 420px) {
  .gh .hall-timeline[data-scale="history"] .hud-tape-time small > [data-part="1"] { display: none; }
}
@media (max-width: 720px) {
  .gh .hall-timeline { bottom: calc(8px + env(safe-area-inset-bottom)); width: calc(100% - 16px); gap: 8px; --thumb-y: 14px; }
  .gh .hall-timeline[data-scale="history"] .hud-grow { height: var(--hit, 40px); }
  .gh .hall-timeline[data-scale="history"] .hud-tape-close { width: var(--hit, 40px); height: var(--hit, 40px); }
}
/* touch (a phone, a coarse pointer: --hit, ui viewer/style.ts): the rail's row and the thumb a finger's
   size, the thumb drawn as the touch thumb (a ring at the old size inside it) on the rail's line */
.gh .ui-viewer[data-phone] .hall-timeline[data-scale="history"] { --track-h: var(--hit, 30px); }
.gh .ui-viewer[data-phone] .hall-timeline[data-scale="history"] .hud-rate { height: var(--hit, 32px); }
.gh .ui-viewer[data-phone] .hall-timeline .hud-track input[type="range"]:not(.ui-range)::-webkit-slider-thumb {
  width: var(--hit); height: var(--hit); margin-top: calc(var(--thumb-y) + 8px - var(--hit) / 2); border: 0; background: var(--thumb); box-shadow: none;
}
@media (pointer: coarse) {
  .gh .hall-timeline[data-scale="history"] { --track-h: var(--hit, 30px); }
  .gh .hall-timeline .hud-track input[type="range"]:not(.ui-range)::-webkit-slider-thumb {
    width: var(--hit); height: var(--hit); margin-top: calc(var(--thumb-y) + 8px - var(--hit) / 2); border: 0; background: var(--thumb); box-shadow: none;
  }
}
`

let users = 0
let node: HTMLStyleElement | null = null

/** The bar's sheet, while a bar is up. */
export function holdHallStyle(): () => void {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "hall-timeline"
    node.textContent = CSS
    document.head.append(node)
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--users > 0) return
    node?.remove()
    node = null
  }
}
