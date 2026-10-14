/**
 * The hall's timeline bar (plan-hud-events T1; user picks 10-13): the HUD's one `Timeline` (ui, props
 * only) on the hall's clock, with ONE scale picked for you, never a switch. A hall with a session
 * (`?feed=`, a told story, the home's demo guild) shows the session's minutes; a repo's hall without one
 * shows its growth: the date and V1's line under it (`1,534 contributors · 60 in town · 1,113 files`).
 * The beats are few (eras and majors, a story's acts, a session's pleas, failures and quests) and only
 * marks: scrubbing moves the time, a beat is never a button.
 *
 * In the HUD it starts as V1's hairline (180×6) and opens on hover, keyboard focus or a tap; Detailed
 * pins it open. At today with the clock still, "Watch it grow" plays the history from the first commit.
 * Off the HUD (a Studio lab, `mountTimeline`) it is pinned, with the captions and a story's act chip
 * over it.
 */
import { Captions, ChapterChip, holdHudStyle, Timeline } from "@guildhall/ui"
import { useEffect, useMemo, useSyncExternalStore } from "react"
import { type HallTime, type HistoryRange, nextRate } from "./clock.ts"
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
  /** The growth line under the history's date, for an epoch-ms day (the hall's chronicle). */
  growth?: (at: number) => string
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
    return <HistoryBar time={time} range={range} pinned={pinned} {...(growth ? { growth } : {})} />
  return null
}

function HistoryBar({
  time,
  range,
  pinned,
  growth,
}: {
  time: HallTime
  range: HistoryRange
  pinned: boolean
  growth?: (at: number) => string
}) {
  const clock = time.clock
  const state = useSyncExternalStore(clock.subscribe, clock.get)
  const len = Math.max(1, range.end - range.start)
  const at = range.start + state.t * len
  const idle = state.t >= 1 && !state.playing
  // eras and majors only: a package's birth is the Legends' to tell
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
  const week = Math.floor(at / (7 * 86_400_000))
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once a week of history
  const note = useMemo(() => growth?.(at), [growth, week])
  return (
    <div className="hall-timeline" data-scale="history" data-pinned={pinned}>
      {idle && (
        <button type="button" className="hall-grow" onClick={() => clock.play(true)}>
          Watch it grow
        </button>
      )}
      <Timeline
        scale="history"
        start={range.start}
        end={range.end}
        at={at}
        markers={markers}
        pinned={pinned}
        playing={state.playing}
        onPlay={(on) => clock.play(on)}
        onSeek={(v) => clock.seek((v - range.start) / len)}
        step={len / STEPS}
        rate={state.rate}
        onRate={() => clock.setRate(nextRate(state.rate))}
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
.gh .hall-grow {
  display: inline-flex; align-items: center; height: 36px; padding: 0 18px; border: 0; border-radius: 999px;
  color: var(--on-brass); background: var(--brass); font: 700 var(--t-md)/1 var(--body); letter-spacing: 0.04em;
  box-shadow: 0 0 0 3px rgba(20, 15, 11, 0.9), 0 0 0 4px var(--brass-line), 0 6px 18px rgba(0, 0, 0, 0.35);
  cursor: pointer; transition: background 0.15s, transform 0.1s;
}
.gh .hall-grow:hover { background: var(--brass-hi); }
.gh .hall-grow:active { transform: scale(0.97); }
@media (max-width: 720px) {
  .gh .hall-timeline { bottom: calc(8px + env(safe-area-inset-bottom)); width: calc(100% - 16px); gap: 8px; }
  .gh .hall-grow { height: 44px; padding: 0 22px; }
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
