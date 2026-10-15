/**
 * Keeping clear of the sheet (user 10-14): the captions and the timeline's progress line are centred on
 * the SCREEN, and step left only by as much as the sheet's panel would actually cover them (a panel that
 * ends above the foot, or lies clear of the strip's edge, moves nothing). `watchClear` measures it and
 * hands CSS `--caps-shift` and `--bar-shift` on the Viewer (px), which the strips' `translate` reads.
 */

/** Space kept between the strip's edge and the panel, CSS px. */
export const CLEAR_GAP = 12

export interface ClearBox {
  /** The Viewer's width. */
  viewW: number
  /** The strip's width (it is centred on the screen). */
  width: number
  /** The strip's top edge (from the Viewer's top). */
  top: number
  /** The panel's left edge and bottom edge, from the Viewer's top left; null with no panel. */
  panel: { left: number; bottom: number } | null
}

/** How far the centred strip steps left to stay clear of the panel: 0 when the panel would not cover it. Pure. */
export function clearShift({ viewW, width, top, panel }: ClearBox, gap = CLEAR_GAP): number {
  if (!panel || panel.bottom <= top - 4) return 0
  const right = viewW / 2 + width / 2
  return Math.max(0, Math.round(right - (panel.left - gap)))
}

/** What the strip really shows, CSS px: a caption's pill (not its whole slot), the bar's hairline until it is open. */
function shownWidth(strip: HTMLElement): number {
  const pill = strip.querySelector<HTMLElement>(".st-caption")
  if (pill) return pill.offsetWidth
  const bar = strip.querySelector<HTMLElement>(".hud-timeline")
  if (bar && bar.dataset.open !== "true" && bar.dataset.pinned !== "true") {
    return strip.querySelector<HTMLElement>(".hud-timeline-hint")?.offsetWidth ?? strip.offsetWidth
  }
  return strip.offsetWidth
}

/** Watches the sheet, the act chip, the captions' slot and the bottom bar, keeping the Viewer's shift variables true. Returns the stop. */
export function watchClear(root: HTMLElement): () => void {
  const sheet = root.querySelector<HTMLElement>(".ui-hud-sheet")
  const strips: [string, string][] = [
    [".hall-caps", "--caps-shift"],
    [".ui-hud-bottom", "--bar-shift"],
  ]
  const measure = () => {
    const view = root.getBoundingClientRect()
    const phone = root.hasAttribute("data-phone")
    const panelBox = sheet?.firstElementChild?.getBoundingClientRect()
    const chip = root.querySelector<HTMLElement>(".hall-acts > *")
    const chipBox = chip && chip.offsetWidth > 0 ? chip.getBoundingClientRect() : null
    for (const [selector, name] of strips) {
      const strip = root.querySelector<HTMLElement>(selector)
      let shift = 0
      if (strip && !phone) {
        const top = strip.getBoundingClientRect().top - view.top
        const width = shownWidth(strip)
        const base = { viewW: view.width, width, top }
        if (panelBox && panelBox.width > 0)
          shift = clearShift({
            ...base,
            panel: { left: panelBox.left - view.left, bottom: panelBox.bottom - view.top },
          })
        // the act chip sits at the foot: it covers whatever reaches it
        if (chipBox)
          shift = Math.max(
            shift,
            clearShift({ ...base, panel: { left: chipBox.left - view.left, bottom: view.height } }),
          )
      }
      root.style.setProperty(name, `${shift}px`)
    }
  }
  const resize = new ResizeObserver(measure)
  const watch = () => {
    resize.disconnect()
    resize.observe(root)
    if (sheet) {
      resize.observe(sheet)
      if (sheet.firstElementChild) resize.observe(sheet.firstElementChild)
    }
    for (const selector of [...strips.map(([s]) => s), ".hall-acts"]) {
      const el = root.querySelector(selector)
      if (el) resize.observe(el)
    }
    measure()
  }
  const mutate = new MutationObserver(watch)
  if (sheet) mutate.observe(sheet, { childList: true })
  const acts = root.querySelector(".hall-acts")
  if (acts) mutate.observe(acts, { childList: true })
  watch()
  return () => {
    resize.disconnect()
    mutate.disconnect()
    for (const [, name] of strips) root.style.removeProperty(name)
  }
}
