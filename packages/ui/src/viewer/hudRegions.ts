/**
 * The HUD's regions in the Viewer's DOM (types.ts `ViewerHud`, state in hud.ts): one layer over the
 * stage and under the Viewer's own chrome (so the loading cover covers it), with the five mount points,
 * and the root's `data-hud`, `data-hud-mode`, `data-hud-open` and `data-phone` for the sheet to lay
 * them out by. Nothing shows and no key is bound until a screen calls `use`.
 */
import {
  HUD_INITIAL,
  type HudAction,
  type HudState,
  hudReduce,
  loadHud,
  PHONE_MAX,
  saveHud,
  viewerStorage,
} from "./hud.ts"
import type { ViewerHud } from "./types.ts"

const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return (
    !!el &&
    typeof el.tagName === "string" &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
  )
}

export interface HudRegions {
  layer: HTMLElement
  api: ViewerHud
  /** The keys the HUD answers once in use (H, Esc); true when it took the key. */
  key(e: KeyboardEvent): boolean
  /** The viewer's width changed. */
  resize(width: number): void
  dispose(): void
}

export function createHudRegions(root: HTMLElement): HudRegions {
  const layer = document.createElement("div")
  layer.className = "ui-viewer-hud"
  const region = (name: string, label?: string) => {
    const el = document.createElement("div")
    el.className = `ui-hud-region ui-hud-${name}`
    el.dataset.region = name
    // labels pinned to the scene keep out of the HUD (hexworld places.ts reads `data-keepout`); the sheet
    // spans the height, so the panel in it carries the mark instead
    if (name !== "sheet") el.dataset.keepout = ""
    if (label) {
      el.setAttribute("role", "region")
      el.setAttribute("aria-label", label)
    }
    return el
  }
  const corner = region("corner")
  const rail = region("rail")
  const feed = region("feed")
  const bottom = region("bottom")
  const sheet = region("sheet")
  // in the order a keyboard reaches them: the brand, the rail, the open panel, the feed, the bar
  layer.append(corner, rail, sheet, feed, bottom)

  let state: HudState = HUD_INITIAL
  let key: string | null = null
  let remember: readonly string[] = []
  const fns = new Set<() => void>()
  const sync = () => {
    root.dataset.hudMode = state.mode
    if (state.open) root.dataset.hudOpen = state.open
    else delete root.dataset.hudOpen
  }
  const dispatch = (a: HudAction) => {
    const next = hudReduce(state, a)
    if (next === state || (next.mode === state.mode && next.open === state.open && next.back === state.back))
      return
    state = next
    sync()
    if (key) saveHud(viewerStorage(), key, state, remember)
    for (const fn of fns) fn()
  }
  let phone = false

  const api: ViewerHud = {
    corner,
    rail,
    feed,
    bottom,
    sheet,
    use(k, keep = []) {
      key = k
      remember = keep
      state = loadHud(viewerStorage(), k, keep)
      root.dataset.hud = "on"
      sync()
      for (const fn of fns) fn()
    },
    state: () => state,
    dispatch,
    subscribe(fn) {
      fns.add(fn)
      return () => fns.delete(fn)
    },
    phone: () => phone,
  }

  return {
    layer,
    api,
    key(e) {
      if (!key || e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return false
      if (e.code === "KeyH") {
        dispatch({ type: "cycle" })
        return true
      }
      if (e.key === "Escape" && state.open) {
        dispatch({ type: "close" })
        return true
      }
      return false
    },
    resize(width) {
      const now = width > 0 && width <= PHONE_MAX
      if (now === phone) return
      phone = now
      if (phone) root.dataset.phone = ""
      else delete root.dataset.phone
      for (const fn of fns) fn()
    },
    dispose() {
      fns.clear()
      layer.remove()
    },
  }
}
