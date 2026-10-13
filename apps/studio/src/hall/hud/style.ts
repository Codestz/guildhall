/**
 * The hall HUD's own pieces on the `.gh` tokens (the panels are ui's `hud-*`): the icon rail, the Places
 * list, the sheet's frame and the about card's links. The regions themselves are the Viewer's
 * (viewer/style.ts); a phone's sheet is laid out there.
 */
const CSS = /* css */ `
.hall-hud-root { display: contents; }
.hall-rail { display: flex; gap: 6px; }
.gh .hall-rail-btn { width: 40px; height: 40px; }
.gh .hall-rail-btn[aria-expanded="true"] { color: var(--brass-hi); border-color: var(--brass); background: rgba(38, 29, 19, 0.95); box-shadow: 0 0 0 1px var(--brass-line), 0 0 18px -8px rgba(220, 182, 98, 0.7); }

/* the brand under the site's crest: compact, the name its own fold */
.ui-hud-corner .hud-brand { width: 304px; max-width: 100%; background: rgba(21, 17, 13, 0.92); }
.ui-hud-corner .hud-brand[data-compact="true"]:not([data-open="true"]) { width: max-content; max-width: 304px; }
.hud-about .hall-about-quiet { font: 12px/1.45 var(--mono); color: var(--faint); }
.hud-about .hall-about-links { display: flex; flex-wrap: wrap; gap: 4px 16px; }

/* places: a list folded under the brand */
.gh .hall-places { width: 304px; max-width: 100%; min-height: 0; flex: 0 1 auto; background: rgba(21, 17, 13, 0.92); }
.hall-place-list { list-style: none; margin: 0; padding: 4px; display: grid; gap: 1px; }
.hall-place-row {
  position: relative; width: 100%; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 5px 8px 7px;
  border: 1px solid transparent; border-radius: var(--r-sm); background: none; color: var(--paper); text-align: left; cursor: pointer; overflow: hidden;
}
.hall-place-row:hover { background: var(--raise-2); }
.hall-place-row[aria-current="true"] { border-color: var(--brass-line); background: var(--brass-wash); }
.hall-place-name { flex: 1; min-width: 0; display: grid; gap: 1px; }
.hall-place-name b { font: 500 var(--t-md)/1.2 var(--body); font-variant: all-small-caps; letter-spacing: 0.06em; color: var(--brass-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hall-place-name small { font-size: 11px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hall-place-meta { flex: none; display: grid; justify-items: end; gap: 1px; }
.hall-place-meta .num { font-size: 12px; color: var(--paper); }
.hall-place-meta small { font-size: 11px; color: var(--muted); }
.hall-place-bar { position: absolute; left: 8px; bottom: 3px; height: 2px; max-width: calc(100% - 16px); border-radius: 1px; background: var(--brass-line); }

/* the timeline bar (hall/timeline.tsx) in the HUD's bottom-centre slot: the slot places it, between the
   Chronicle chip and the right edge; on a phone it is the bottom edge and the chip steps up over it */
.gh.site-root .ui-hud-bottom .hall-timeline, .gh .ui-hud-bottom .hall-timeline {
  position: static; translate: none; left: auto; right: auto; margin: 0;
  width: min(680px, calc(100cqw - 2 * var(--gut) - 2 * 250px));
}
.gh.site-root .ui-viewer[data-phone] .ui-hud-bottom .hall-timeline, .gh .ui-viewer[data-phone] .ui-hud-bottom .hall-timeline { width: 100%; }
.ui-viewer[data-phone]:has(.ui-hud-bottom .hall-timeline) .ui-hud-feed { bottom: calc(var(--gut) + 64px + env(safe-area-inset-bottom)); }
/* a phone: "Watch it grow" sits right on the Chronicle chip's row (timeline.tsx), not stacked over it */
.ui-viewer[data-phone] .ui-hud-bottom .hall-grow { align-self: flex-end; }

/* the folded feed is its chip alone (its box is what the plates keep out of) */
.ui-hud-feed .hud-toasts { width: auto; }

/* the feed's open form keeps to the screen */
.gh .hall-feed { max-height: min(460px, 100%); }
.gh .hall-feed .hud-chron-text b { color: var(--brass-hi); }

/* panels over the world are near opaque: the plates under them never read through */
.gh .ui-hud-region .ui-panel { background: rgba(20, 15, 11, 0.96); }

/* the sheet: the panel fills it, scrolling inside */
.hall-sheet { display: flex; flex-direction: column; min-height: 0; max-height: 100%; outline: none; }
.hall-sheet > * { min-height: 0; max-height: 100%; }
.ui-viewer:not([data-phone]) .hall-sheet { align-items: flex-end; }
.ui-viewer[data-phone] .hall-sheet > * { width: 100%; max-width: none; border-radius: 14px 14px 0 0; }
.ui-viewer[data-phone] .hall-sheet .hud-panel { max-height: min(64cqh, 620px); }

.hall-keys { margin: 0; display: grid; gap: 6px; }
.hall-keys div { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: var(--t-sm); color: var(--muted); }
.hall-keys dd { margin: 0; text-align: right; }

/* a phone: the brand stays a strip, the rail a little smaller */
.ui-viewer[data-phone] .ui-hud-corner .hud-brand { max-width: calc(100cqw - 16px); }
.ui-viewer[data-phone] .hall-rail-btn { width: 36px; height: 36px; }
.ui-viewer[data-phone] .hall-rail { gap: 4px; }
`

let users = 0
let node: HTMLStyleElement | null = null

export function holdHallHudStyle(): () => void {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "hall-hud"
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
