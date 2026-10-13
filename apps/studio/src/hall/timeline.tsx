/**
 * The hall's timeline bar (plan-hud-events T1): the HUD's one `Timeline` (ui, props only) on the hall's
 * clock, at the bottom of the screen and thumb-sized on a phone. Play and pause, scrub, the speed, the
 * day, and the history's beats (its major releases, its eras, its packages' births). At today with the
 * clock still, "Watch it grow" plays the history from the first commit. It shows once the island can be
 * revealed by it (`HallTime.range`), never for a repo without a chronicle.
 */
import { Captions, ChapterChip, holdHudStyle, Timeline, type TimeScale } from "@guildhall/ui"
import { useEffect, useMemo, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { type HallTime, type HistoryRange, nextRate } from "./clock.ts"
import { SESSION_RATES } from "./feeds/clock.ts"
import type { HallSession } from "./feeds/session.ts"
import { markersOf } from "./feeds/view.ts"

/** How fine a scrub is: the history in this many steps (a 3-day history is no 3-stop slider). */
const STEPS = 1000

/**
 * The one bar with V1's two scales (plan §2): History (the island grows) and, with a `?feed=`, Session
 * (the heroes replay; hall/feeds). The switch shows when both can be shown; the session's captions and
 * a told story's chapter chip sit over the bar.
 */
export function HallTimeline({ time }: { time: HallTime }) {
  const range = useSyncExternalStore(time.subscribe, time.range)
  const session = useSyncExternalStore(time.subscribe, time.session)
  const scale = useSyncExternalStore(time.subscribe, time.scale)
  useEffect(() => {
    const releaseHud = holdHudStyle()
    const releaseHall = holdHallStyle()
    return () => {
      releaseHud()
      releaseHall()
    }
  }, [])
  const onScale = range && session ? (s: TimeScale) => time.setScale(s) : undefined
  if (session && (scale === "session" || !range))
    return <SessionBar session={session} onScale={onScale} historyless={!range} />
  if (!range) return null
  return <HistoryBar time={time} range={range} onScale={onScale} session={session} />
}

function HistoryBar({
  time,
  range,
  onScale,
  session,
}: {
  time: HallTime
  range: HistoryRange
  onScale: ((s: TimeScale) => void) | undefined
  session: HallSession | null
}) {
  const clock = time.clock
  const state = useSyncExternalStore(clock.subscribe, clock.get)
  const len = Math.max(1, range.end - range.start)
  const at = range.start + state.t * len
  const idle = state.t >= 1 && !state.playing
  return (
    <div className="hall-timeline">
      {session && <SessionCaptions session={session} />}
      {idle && (
        <button type="button" className="hall-grow" onClick={() => clock.play(true)}>
          Watch it grow
        </button>
      )}
      <Timeline
        scale="history"
        {...(onScale ? { onScale } : {})}
        start={range.start}
        end={range.end}
        at={at}
        markers={range.markers}
        playing={state.playing}
        onPlay={(on) => clock.play(on)}
        onSeek={(v) => clock.seek((v - range.start) / len)}
        step={len / STEPS}
        rate={state.rate}
        onRate={() => clock.setRate(nextRate(state.rate))}
      />
    </div>
  )
}

/** The narrated line over the bar (sim Narrator, through the session's snapshot). */
function SessionCaptions({ session }: { session: HallSession }) {
  const snap = useSyncExternalStore(session.subscribe, session.snapshot)
  return <Captions {...(snap.caption ? { caption: snap.caption } : {})} />
}

/** The Session scale: the log's minutes, its beats, live's way back to now, a told story's acts. */
function SessionBar({
  session,
  onScale,
  historyless,
}: {
  session: HallSession
  onScale: ((s: TimeScale) => void) | undefined
  historyless: boolean
}) {
  const snap = useSyncExternalStore(session.subscribe, session.snapshot)
  const { clock } = session
  const c = snap.clock
  const events = snap.events
  // biome-ignore lint/correctness/useExhaustiveDependencies: the beats change when the log grows
  const markers = useMemo(() => markersOf(session.log().events, c.start), [events, c.start, session])
  if (events === 0) return null
  const len = Math.max(1000, c.end - c.start)
  return (
    <div className="hall-timeline" data-scale="session">
      <Captions {...(snap.caption ? { caption: snap.caption } : {})} />
      {snap.chapters.length > 0 && (
        <ChapterChip
          chapters={snap.chapters}
          current={Math.max(0, snap.chapter)}
          onJump={(k) => clock.seek(c.start + (snap.chapters[k]?.at ?? 0), { jump: true })}
          className="hall-chapter"
        />
      )}
      <Timeline
        scale="session"
        {...(onScale ? { onScale } : {})}
        {...(historyless ? { historyUnavailable: "No history for this repo" } : {})}
        start={0}
        end={len}
        at={c.at - c.start}
        markers={markers}
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

/** The bar on its own (a Studio lab with no site around it): mounted into `host`; returns the unmount. */
export function mountTimeline(host: HTMLElement, time: HallTime): () => void {
  const el = document.createElement("div")
  el.className = "gh hall-timeline-host"
  host.append(el)
  const root = createRoot(el)
  root.render(<HallTimeline time={time} />)
  return () => {
    root.unmount()
    el.remove()
  }
}

/**
 * The bar's place: bottom centre; on a wide screen it keeps clear of the hall note at the bottom left,
 * on a phone it is the bottom edge (safe area kept) and the note is only moved up above it (its own look
 * is the note's; the HUD's bottom slot will take the bar from `mountTimeline`).
 */
const CSS = /* css */ `
.hall-timeline-host { position: absolute; inset: auto 0 0 0; height: 0; z-index: 20; }
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
/* beside the hall note (380 px at the bottom left) where there is room for both */
@media (min-width: 1100px) {
  .gh.site-root .hall-timeline { left: 412px; right: 16px; translate: none; width: auto; max-width: 680px; margin: 0 auto; }
}
/* a narrower screen: the bar full width at the bottom, the note above it */
@media (max-width: 1099px) {
  .gh.site-root:has(.hall-timeline) .site-note { bottom: 88px; }
  /* "Watch it grow" sits over the bar: the note steps up over it */
  .gh.site-root:has(.hall-grow) .site-note { bottom: 136px; }
}
@media (max-width: 720px) {
  .gh .hall-timeline { bottom: calc(8px + env(safe-area-inset-bottom)); width: calc(100% - 16px); gap: 8px; }
  .gh.site-root:has(.hall-timeline) .site-note { bottom: calc(68px + env(safe-area-inset-bottom)); }
  .gh.site-root:has(.hall-grow) .site-note { bottom: calc(122px + env(safe-area-inset-bottom)); }
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
