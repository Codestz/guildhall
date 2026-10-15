/**
 * The demos play on (decisions.md "User review notes (10-14 evening)"): a told story on the home that has
 * played to its end rests a while (the world going on: heroes walking home, the day turning), then a
 * small pill top centre offers the next demo, counting down, and plays it when the count runs out. Any
 * input on the page (a drag, a key, the wheel, a tap) cancels it for this ending; the pill itself plays
 * the next one at once. The demo guild never ends: it goes round again (hall/hud/mount.tsx).
 *
 *   `nextStory`     the demo after one, in the Demos page's order, round again after the last
 *   `autoNextAt`    what the pill shows at a time of rest: pure
 *   `autoNext`      the countdown's state: frames, input, the play (no DOM: the tests drive it)
 *   `mountAutoNext` the pill, its listeners, and its frame (`rested`: the session's `restedMs`)
 */
import { STORY_IDS, type StoryId } from "@guildhall/sim"
import { STORIES } from "./stories.ts"

/** The pill shows after this long at rest (ms), and the next story plays at `NEXT_AT_MS`. */
export const PILL_AT_MS = 12_000
export const NEXT_AT_MS = 20_000

const isStory = (id: string): id is StoryId => (STORY_IDS as readonly string[]).includes(id)

/** The demos the home plays, in the Demos page's order (the stories its cards open as `?story=`). */
export const DEMO_ORDER: readonly StoryId[] = STORIES.flatMap((s) => {
  const id = s.link.startsWith("?story=") ? s.link.slice("?story=".length) : ""
  return isStory(id) ? [id] : []
})

/** The demo after `id` (the first after the last, or after one not in the order). */
export function nextStory(id: string): StoryId {
  const k = DEMO_ORDER.indexOf(id as StoryId)
  return DEMO_ORDER[(k + 1) % DEMO_ORDER.length] ?? "saga"
}

/** The title its card gives a demo. */
export const demoTitle = (id: StoryId): string => STORIES.find((s) => s.id === id)?.title ?? id

/** What the pill does `rested` ms into a story's rest: hidden, counting down (`left`, whole seconds), or going. */
export function autoNextAt(rested: number, cancelled: boolean): { show: boolean; left: number; go: boolean } {
  if (cancelled || rested < PILL_AT_MS) return { show: false, left: 0, go: false }
  const left = Math.max(0, Math.ceil((NEXT_AT_MS - rested) / 1000))
  return { show: true, left, go: rested >= NEXT_AT_MS }
}

/** What the pill shows now: the next demo's title and the seconds left, or nothing. */
export interface AutoNextView {
  title: string
  left: number
}

export interface AutoNext {
  /**
   * Once a frame: the playing story (null: the demo guild, which loops) and how long it has rested at
   * its end (ms; 0 while it plays). What the pill shows; the next story plays when the count runs out.
   */
  frame(story: StoryId | null, rested: number): AutoNextView | null
  /** Input on the page: on the pill it plays the next story now; anywhere else during the rest it cancels the countdown. */
  input(onPill: boolean): void
}

/** The countdown, without a page: `play(next)` plays a story. */
export function autoNext(play: (next: StoryId) => void): AutoNext {
  let story: StoryId | null = null
  let resting = false
  let cancelled = false
  let gone = false
  const go = () => {
    if (!story || gone) return
    gone = true
    play(nextStory(story))
  }
  return {
    frame(next, rested) {
      // a new story, or this one playing again: a fresh countdown for its end
      if (next !== story || rested <= 0) {
        story = next
        cancelled = false
        gone = false
      }
      resting = story !== null && rested > 0
      if (!resting || gone) return null
      const at = autoNextAt(rested, cancelled)
      if (!at.show) return null
      if (at.go) {
        go()
        return null
      }
      return { title: demoTitle(nextStory(story as StoryId)), left: at.left }
    },
    // (input while a story plays is watching it: only input during its rest cancels what comes after)
    input(onPill) {
      if (!resting || gone) return
      if (onPill && !cancelled) go()
      else cancelled = true
    },
  }
}

const STYLE_ID = "hall-next-style"
const CSS = `
.hall-next-slot {
  position: absolute; top: calc(var(--gut, 16px) + 58px); left: 50%; translate: -50% 0; z-index: 2;
  display: flex; justify-content: center; pointer-events: none;
}
.hall-next-slot > * { pointer-events: auto; }
.gh .hall-next {
  display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px 0 14px;
  border: 0; border-radius: 999px; cursor: pointer;
  background: rgba(14, 10, 7, 0.74); box-shadow: 0 0 0 1px var(--brass-line);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  color: var(--brass-hi); font: 600 13px/1 var(--sans, system-ui); letter-spacing: 0.01em; white-space: nowrap;
  transition: opacity 0.4s ease, translate 0.4s ease, visibility 0.4s, background 0.2s ease;
}
.gh .hall-next[data-on="false"] { opacity: 0; translate: 0 -4px; visibility: hidden; pointer-events: none; }
.gh .hall-next:hover { background: rgba(28, 20, 12, 0.86); }
.gh .hall-next-title { color: var(--parchment, #f1e6cf); }
.gh .hall-next-left { min-width: 2.4ch; padding: 4px 6px; border-radius: 999px; font: 12px/1 var(--mono);
  font-variant-numeric: tabular-nums; box-shadow: inset 0 0 0 1px var(--brass-line); text-align: center; }
@media (prefers-reduced-motion: reduce) { .gh .hall-next { transition: none; } }
`

/**
 * The pill in `layer` (the HUD's layer: top centre, under the crest's row), over `autoNext`: `play(next)`
 * plays a story (the site's link to it, so the address follows). Returns its frame and its unmount.
 */
export function mountAutoNext(
  layer: HTMLElement,
  play: (next: StoryId) => void,
): { frame(story: StoryId | null, rested: number): void; dispose(): void } {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.append(style)
  }
  const count = autoNext(play)
  const pill = document.createElement("button")
  pill.type = "button"
  pill.className = "hall-next"
  pill.dataset.on = "false"
  const label = document.createElement("span")
  label.textContent = "Next story →"
  const title = document.createElement("span")
  title.className = "hall-next-title"
  const left = document.createElement("span")
  left.className = "hall-next-left"
  left.setAttribute("aria-hidden", "true")
  pill.append(label, title, left)
  const slot = document.createElement("div")
  slot.className = "hall-next-slot"
  // (the chips' declutter keeps out of it, as out of the HUD's own slots)
  slot.dataset.keepout = ""
  slot.append(pill)
  layer.append(slot)
  const onInput = (e: Event) => count.input(e.target instanceof Node && pill.contains(e.target))
  const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const
  for (const ev of events) addEventListener(ev, onInput, { capture: true, passive: true })
  let shown = ""
  return {
    frame(story, rested) {
      const view = count.frame(story, rested)
      const key = view ? `${view.title}|${view.left}` : ""
      if (key === shown) return
      shown = key
      pill.dataset.on = view ? "true" : "false"
      if (!view) return
      title.textContent = view.title
      left.textContent = String(view.left)
      pill.setAttribute("aria-label", `Next story: ${view.title}, in ${view.left} seconds`)
    },
    dispose() {
      for (const ev of events) removeEventListener(ev, onInput, { capture: true })
      slot.remove()
    },
  }
}
