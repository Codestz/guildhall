/**
 * The hall's timeline bar (plan-hud-events T1): the HUD's one `Timeline` (ui, props only) on the hall's
 * clock, at the bottom of the screen and thumb-sized on a phone. Play and pause, scrub, the speed, the
 * day, and the history's beats (its major releases, its eras, its packages' births). At today with the
 * clock still, "Watch it grow" plays the history from the first commit. It shows once the island can be
 * revealed by it (`HallTime.range`), never for a repo without a chronicle.
 */
import { holdHudStyle, Timeline } from "@guildhall/ui"
import { useEffect, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { type HallTime, nextRate } from "./clock.ts"

/** How fine a scrub is: the history in this many steps (a 3-day history is no 3-stop slider). */
const STEPS = 1000

export function HallTimeline({ time }: { time: HallTime }) {
  const range = useSyncExternalStore(time.subscribe, time.range)
  const clock = time.clock
  const state = useSyncExternalStore(clock.subscribe, clock.get)
  useEffect(() => {
    const releaseHud = holdHudStyle()
    const releaseHall = holdHallStyle()
    return () => {
      releaseHud()
      releaseHall()
    }
  }, [])
  if (!range) return null
  const len = Math.max(1, range.end - range.start)
  const at = range.start + state.t * len
  const idle = state.t >= 1 && !state.playing
  return (
    <div className="hall-timeline">
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
 * on a phone it is the bottom edge (safe area kept) and the note sits above it.
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
  .gh .site-root .hall-timeline { left: calc(50% + 100px); width: min(680px, calc(100% - 444px)); }
}
/* a narrower screen: the bar full width at the bottom, the note above it */
@media (max-width: 1099px) {
  .gh .site-root:has(.hall-timeline) .site-note { bottom: 88px; }
}
@media (max-width: 720px) {
  .gh .hall-timeline { bottom: calc(8px + env(safe-area-inset-bottom)); width: calc(100% - 16px); gap: 8px; }
  .gh .site-root:has(.hall-timeline) .site-note { bottom: calc(68px + env(safe-area-inset-bottom)); }
  .gh .hall-grow { height: 44px; padding: 0 22px; }
}
@media (max-width: 560px) {
  .gh .site-root:has(.hall-timeline) .site-note { border-radius: 14px; left: 8px; right: 8px; width: auto; padding-bottom: 12px; border-bottom: 1px solid var(--hair); }
  .gh .site-root:has(.hall-timeline) .site-note p { display: none; }
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
