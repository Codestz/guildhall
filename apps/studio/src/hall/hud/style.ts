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

/* the brand under the site's crest: compact, the name its own fold (its width: the left column, below) */
.hud-about .hall-about-quiet { font: 12px/1.45 var(--mono); color: var(--faint); }
.hud-about .hall-about-links { display: flex; flex-wrap: wrap; gap: 4px 16px; }

/* a place's plate lit while the history tells its founding (hexworld/places.ts flash) */
/* founded: it comes up out of nothing as its caption does (a fade, a small rise in scale from its foot:
   the origin 0 0 is the anchor once the plate's own translate(-50%, -100%) has moved it), then glows */
.ui-plate[data-flash] { transform-origin: 0 0; animation: hall-plate-flash var(--flash-ms, 3200ms) ease-out both; }
@keyframes hall-plate-flash {
  0% { opacity: 0; scale: 0.8; border-color: var(--brass-hi); box-shadow: 0 0 0 1px var(--brass-hi), 0 0 26px -2px rgba(240, 206, 120, 0.85); }
  10% { opacity: 1; scale: 1.05; }
  18% { scale: 1; border-color: var(--brass-hi); box-shadow: 0 0 0 1px var(--brass-hi), 0 0 26px -2px rgba(240, 206, 120, 0.85); }
  45% { border-color: var(--brass); box-shadow: 0 0 0 1px var(--brass-line), 0 0 18px -4px rgba(220, 182, 98, 0.6); }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-plate[data-flash] { animation: none; border-color: var(--brass); }
}

/* places: a list folded under the brand */
.gh .hall-places { min-height: 0; flex: 0 1 auto; }
.hall-place-list { list-style: none; margin: 0; padding: 4px; display: grid; gap: 1px; }
/* a row is two lines always (the label over its path, the count over its kind), the share a 2 px track
   along its foot: rows keep one height whether or not a path shows */
.hall-place-row {
  position: relative; width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 18px 15px;
  align-content: center; column-gap: 10px; align-items: center; min-height: 52px; padding: 4px 8px 6px;
  border: 1px solid transparent; border-radius: var(--r-sm); background: none; color: var(--paper); text-align: left; cursor: pointer; overflow: hidden;
}
.hall-place-row:hover { background: var(--raise-2); }
.hall-place-row[aria-current="true"] { border-color: var(--brass-line); background: var(--brass-wash); }
.hall-place-name, .hall-place-meta { display: contents; }
.hall-place-name b { grid-column: 1; grid-row: 1; font: 500 var(--t-md)/1.2 var(--body); font-variant: all-small-caps; letter-spacing: 0.06em; color: var(--brass-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hall-place-name small { grid-column: 1; grid-row: 2; font-size: 11px; line-height: 15px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hall-place-meta .num { grid-column: 2; grid-row: 1; justify-self: end; font-size: 12px; color: var(--paper); }
.hall-place-meta small { grid-column: 2; grid-row: 2; justify-self: end; font-size: 11px; line-height: 15px; color: var(--muted); }
.hall-place-row::before { content: ""; position: absolute; left: 8px; right: 8px; bottom: 0; height: 2px; border-radius: 1px; background: rgba(243, 233, 212, 0.08); }
.hall-place-bar { position: absolute; left: 8px; bottom: 0; height: 2px; max-width: calc(100% - 16px); border-radius: 1px; background: var(--brass); opacity: 0.3; }
.hall-place-row[aria-current="true"] .hall-place-bar { opacity: 0.6; }

/* the timeline bar (hall/timeline.tsx) in the HUD's bottom-centre slot, between the Chronicle chip and
   the act chip. A hairline until hovered, focused or tapped (only the line takes the pointer then: the
   world under the folded bar stays the world's); pinned open in Detailed */
.gh.site-root .ui-hud-bottom .hall-timeline, .gh .ui-hud-bottom .hall-timeline {
  position: static; translate: none; left: auto; right: auto; margin: 0;
  width: min(680px, calc(100cqw - 2 * var(--gut) - 2 * 250px));
}
.gh .ui-hud-bottom .hall-timeline[data-pinned="false"] { pointer-events: none; }
.gh .ui-hud-bottom .hall-timeline[data-pinned="false"] .hud-timeline-hint { pointer-events: auto; }
.gh.site-root .ui-viewer[data-phone] .ui-hud-bottom .hall-timeline, .gh .ui-viewer[data-phone] .ui-hud-bottom .hall-timeline { width: 100%; }
/* a sheet that is up without a panel opened (Detailed's Chronicle) keeps the bar clear of it too */
.ui-viewer:not([data-phone]) .ui-hud-sheet:not(:empty) ~ .ui-hud-bottom { translate: calc(-50% - 190px) 0; }
/* a phone: the timeline is the bottom edge, a hairline across it (a tap opens the bar); the row over it
   steps up while the bar is open */
.ui-viewer[data-phone] .hud-timeline-hint { left: 0; width: 100%; margin-left: 0; }

/* ── the HUD's own slots (hall/hud/mount.tsx): top centre, the captions, the act chip ── */
.hall-float { position: absolute; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.hall-float > * { pointer-events: auto; }
.hall-float:empty { display: none; }
.hall-top { top: var(--gut); left: 50%; translate: -50% 0; align-items: center; width: min(420px, calc(100% - 2 * var(--gut) - 2 * 330px)); }
.hall-top .hud-pleas { width: 100%; }
.hall-top .hud-ffwd { align-self: center; }
/* captions: V1's pill over the hairline, lower centre; up over the bar while it is open */
.hall-caps {
  bottom: calc(var(--gut) + 30px); left: 50%; translate: -50% 0; align-items: center;
  width: min(640px, calc(100% - 2 * var(--gut) - 2 * 250px)); pointer-events: none;
  transition: bottom 0.2s ease;
}
.hall-caps > * { pointer-events: none; }
/* the strip spans the slot: its width never follows the line it holds (the line is fitted to the strip,
   and a strip that shrank to it would refit it every frame) */
.hall-caps .st-captions { width: 100%; }
.ui-viewer:has(.ui-hud-bottom .hud-timeline:is(:hover, :focus-within, [data-open="true"])) .hall-caps { bottom: calc(var(--gut) + 74px); }
/* the history's tape is always open: the captions ride over it, one row or two (--tape-h, timeline.tsx) */
.ui-viewer:not([data-phone], [data-hud-mode="hidden"]):has(.ui-hud-bottom .hall-timeline[data-scale="history"]) .hall-caps { bottom: calc(var(--gut) + var(--tape-h, 60px) + 14px); }
.ui-viewer[data-hud-mode="hidden"] .hall-caps { bottom: var(--gut); }
.ui-viewer:not([data-phone]) .ui-hud-sheet:not(:empty) ~ .hall-caps { translate: calc(-50% - 190px) 0; }
/* the act chip bottom right (V1), its title centred, its list up over it */
.hall-acts { right: var(--gut); bottom: var(--gut); align-items: flex-end; }
.ui-viewer:not([data-phone]) .ui-hud-sheet:not(:empty) ~ .hall-acts { right: calc(var(--gut) + min(380px, 100% - 2 * var(--gut)) + 12px); }
.gh .hall-chapter .st-chapter-btn { min-width: 156px; justify-content: center; text-align: center; }
.gh .hall-chapter[data-compact="true"] .st-chapter-btn { min-width: 0; }
/* the current act's thin brass bracket stays when the list takes focus by pointer; the ring is the keyboard's */
.gh .hall-chapter .st-chapter-list button:focus:not(:focus-visible) { outline: none; }
/* ── a phone's foot (decisions.md "Phone GUI"), bottom up: the timeline's hairline, then one row with the
   face bar (+N) at the left and the act chip at the right, then the captions (three rows at most). Each
   steps up over what is under it: --foot-bar, the timeline (a hairline, or the open bar); --foot-row, the
   row (none when it is empty). The sheet up hides them all ── */
.ui-viewer[data-phone] { --foot-bar: 18px; --foot-row: 0px; --foot: calc(var(--gut) + env(safe-area-inset-bottom)); }
.ui-viewer[data-phone]:has(.ui-hud-bottom .hud-timeline:is([data-pinned="true"], [data-open="true"], :focus-within)) { --foot-bar: calc(var(--tape-h, 56px) + 10px); }
.ui-viewer[data-phone]:has(.hall-acts:not(:empty)) { --foot-row: 58px; }
.ui-viewer[data-phone] .hall-acts {
  left: var(--gut); right: var(--gut); bottom: calc(var(--foot) + var(--foot-bar)); flex-direction: row; align-items: flex-end; gap: 8px;
  pointer-events: none; transition: bottom 0.2s ease;
}
.ui-viewer[data-phone] .hall-acts > .hud-badges { flex: 0 1 auto; min-width: 0; }
.ui-viewer[data-phone] .hall-acts > :is(.hall-chapter, .hud-ffwd) { margin-left: auto; }
.ui-viewer[data-phone] .hall-acts > .hud-ffwd + .hall-chapter { margin-left: 0; }
.ui-viewer[data-phone] .hall-acts .hud-badge { width: 44px; height: 44px; }
.ui-viewer[data-phone] .hall-acts .hud-badges { padding: 3px; border-radius: 12px; }
.ui-viewer[data-phone] .hall-acts .hud-badges-expand { height: 44px; }
/* a phone's touch target: the roster's expander a full 44 × 44 wherever the face bar is */
.gh .ui-viewer[data-phone] .hud-badges-expand { width: auto; min-width: 44px; height: 44px; }
.ui-viewer[data-phone] .hall-acts .hud-tip { display: none; }
.gh .ui-viewer[data-phone] .hall-acts .st-chapter-btn { width: 52px; height: 52px; padding: 0; align-items: center; justify-content: center; line-height: 1; border-radius: 12px; font-size: 15px; }
.ui-viewer[data-phone] .hall-caps { bottom: calc(var(--foot) + var(--foot-bar) + var(--foot-row) + 4px); width: calc(100% - 2 * var(--gut)); }
.ui-viewer[data-phone][data-hud-mode="hidden"] .hall-caps { bottom: var(--foot); }
.ui-viewer[data-phone] .ui-hud-feed { display: none; }
.ui-viewer[data-phone][data-hud-open] .ui-hud-sheet:not(:empty) ~ :is(.hall-acts, .hall-caps, .hall-top) { display: none; }
.ui-viewer[data-phone] .hall-caps .st-caption { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.ui-viewer[data-phone] .hall-caps .st-caption-row { display: inline; white-space: normal; }
.ui-viewer[data-phone] .hall-caps .st-caption-row + .st-caption-row::before { content: " "; }
.ui-viewer[data-phone] .hall-caps .st-caption[data-kind="chapter"] { display: grid; }
/* the welcome bar at the foot (site, wide screens; a phone's is a button in the top row): the captions
   ride above it like the bar */
.site-root[data-welcome] .ui-viewer:not([data-phone]) .hall-caps { bottom: calc(var(--gut) + var(--welcome-h, 0px) + 40px); }

/* a screen too narrow for a card between the left column and the rail: a plea's card under the face bar */
@container viewer (min-width: 601px) and (max-width: 1100px) {
  .hall-top { top: calc(var(--hud-top, var(--gut)) + 44px + 8px + 48px + 8px); left: var(--gut); translate: none; width: var(--hud-col); align-items: flex-start; }
}
/* ── a short screen (a phone on its side): the desktop's layout, compact heights; one toast at most ── */
@container viewer (max-height: 460px) {
  .hud-toast-list .hud-toast:nth-last-child(n + 2) { display: none; }
  .ui-viewer:has(.ui-hud-corner > :is(.hall-roster, .hall-places, .hud-brand-more)) .ui-hud-feed .hud-toast-list { display: none; }
  .ui-hud-corner { max-height: calc(100% - var(--hud-top, var(--gut)) - var(--gut) - 52px); }
  .gh .hall-rail-btn { width: 38px; height: 38px; }
  .ui-hud-sheet { top: calc(var(--gut) + 50px); }
  .gh .hall-feed, .gh .ui-hud-sheet .hud-panel { max-height: 100%; }
  .hall-caps { bottom: calc(var(--gut) + 22px); }
}

/* the folded feed is its chip alone (its box is what the plates keep out of) */
.ui-hud-feed .hud-toasts { width: auto; }

/* the feed's open form keeps to the screen */
.gh .hall-feed { max-height: min(460px, 100%); }
.gh .hall-feed .hud-chron-text b { color: var(--brass-hi); }
/* one truncation rule for its rows (two lines, then an ellipsis), and a soft fade where the list runs on
   under the panel's foot rather than a row cut in half; room under the last row to scroll it clear */
.gh .hall-feed .hud-chron-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; white-space: normal; }
.gh .hall-feed .hud-panel-body {
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 32px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 32px), transparent);
}
.gh .hall-feed .hud-chron-list { padding-bottom: 28px; }

/* panels over the world: V1's plaque ink (0.86) over a blur, the sheet's long reads V1's settings ink
   (0.95): at 0.74 a noon meadow showed through and the faint and muted type fell under AA; a soft shadow
   under the small type */
.gh .ui-hud-region .ui-panel, .gh .hall-float .ui-panel {
  background: var(--ink);
  backdrop-filter: blur(14px) saturate(1.15); -webkit-backdrop-filter: blur(14px) saturate(1.15);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}
.gh .ui-hud-sheet .ui-panel { background: rgba(20, 15, 11, 0.95); }

/* ── the top row (user 10-13): the site's crest pill (its own compact width), then the repo chip of its
   own width (--crest-w: the crest and the gap after it, hall/hud/HallHud.tsx); under them, left-aligned,
   the Guild's face bar of its own width, and the panels at the column's width; 8 px between them ── */
.ui-viewer { --hud-col: 300px; --hud-r: 10px; }
.ui-viewer[data-phone] { --hud-col: min(340px, calc(100cqw - 2 * var(--gut))); }
.gh .ui-hud-corner { gap: 8px; }
.gh .ui-hud-corner > .hud-repo-chip { margin-left: var(--crest-w, 0px); max-width: calc(100cqw - 2 * var(--gut) - var(--crest-w, 0px) - var(--rail-w, 0px)); }
.gh .ui-hud-corner > :is(.hud-brand, .hud-parties, .hall-roster, .hall-places, .hud-pleas) {
  width: var(--hud-col); max-width: 100%; border-radius: var(--hud-r); border: 1px solid var(--hair);
}
.gh .ui-hud-corner > .hud-badges { width: auto; max-width: 100%; border-radius: var(--hud-r); }
.gh .ui-hud-corner .hud-badge { width: 40px; height: 40px; }
.gh .ui-hud-corner .hud-badges-expand { height: 40px; }

/* the Brand, denser: smaller type, tighter padding, the about's links on one row */
.gh .ui-hud-corner .hud-brand { padding: 8px 12px 9px; gap: 7px; }
.gh .ui-hud-corner .hud-brand-name { font-size: 18px; }
.gh .ui-hud-corner .hud-brand .ui-figures { padding-top: 7px; gap: 4px 14px; }
.gh .ui-hud-corner .hud-brand .ui-figures dd { font-size: 14px; }
.gh .ui-hud-corner .hud-brand .ui-figures dt { font-size: 11px; }
.gh .ui-hud-corner .hud-about { gap: 6px; padding-top: 7px; font-size: 12.5px; line-height: 1.45; }
.gh .hud-about .hall-about-links { flex-wrap: nowrap; gap: 12px; white-space: nowrap; }
.gh .hud-about .hall-about-links .site-link { min-height: 26px; font-size: 12.5px; padding: 0; }

/* the sheet: the panel fills it, scrolling inside */
.hall-sheet { display: flex; flex-direction: column; min-height: 0; max-height: 100%; outline: none; }
.hall-sheet > * { min-height: 0; max-height: 100%; }
.ui-viewer:not([data-phone]) .hall-sheet { align-items: flex-end; }
.ui-viewer[data-phone] .hall-sheet > * { width: 100%; max-width: none; border-radius: 14px 14px 0 0; }
.ui-viewer[data-phone] .hall-sheet .hud-panel { max-height: min(64cqh, 620px); }

/* the session (?feed=): the Guild under the brand like the Places, the pleas pinned between, a hero's
   dossier in the sheet, a plea's dot on the Guild's icon */
.gh .hall-roster { min-height: 0; flex: 0 1 auto; }
.gh .hall-rail-btn { position: relative; }
.gh .hall-rail-btn .hud-tab-dot { position: absolute; top: 5px; right: 5px; }
.hall-hero-sheet { display: flex; flex-direction: column; gap: 6px; min-height: 0; max-height: 100%; }
.hall-hero-sheet > .hud-dossier { min-height: 0; }
.gh .hall-back { align-self: flex-start; padding: 4px 2px; }
.ui-viewer[data-phone] .hall-sheet .hud-dossier, .ui-viewer[data-phone] .hall-sheet .hud-roster { max-height: min(64cqh, 620px); }

.hall-keys { margin: 0; display: grid; gap: 6px; }
.hall-keys div { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: var(--t-sm); color: var(--muted); }
.hall-keys dd { margin: 0; text-align: right; }

/* ── a phone's top row: crest · repo chip · ☰ (the rail is the menu's one button), and the one menu: a
   bottom sheet with its tabs over the tab's panel (the panel's own head and frame give way to the tabs) ── */
.ui-viewer[data-phone] { --rail-w: 52px; }
.ui-viewer[data-phone] .ui-hud-rail { top: var(--gut); }
.gh .ui-viewer[data-phone] .hall-menu-btn { width: 44px; height: 44px; border-radius: 999px; }
.gh .hall-menu-btn .hud-tab-dot { top: 7px; right: 7px; }
.gh .ui-hud-sheet .hall-menu { background: rgba(20, 15, 11, 0.95); }
.ui-viewer[data-phone] .hud-repo-source { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.ui-viewer[data-phone] .hud-repo-chip { padding: 0 14px; }
.hall-menu { display: flex; flex-direction: column; min-height: 0; max-height: min(70cqh, 640px); padding: 0; overflow: hidden; background: rgba(20, 15, 11, 0.94); }
.hall-tabs { flex: none; display: flex; align-items: stretch; gap: 2px; padding: 4px 4px 0; border-bottom: 1px solid var(--hair); }
.hall-tab {
  position: relative; flex: 1 1 0; min-width: 0; min-height: 46px; padding: 0 6px; border: 0; border-bottom: 2px solid transparent; background: none;
  color: var(--muted); font: 400 14px/1 var(--display); letter-spacing: 0.08em; cursor: pointer; white-space: nowrap;
}
.hall-tab:hover { color: var(--paper); }
.hall-tab[aria-selected="true"] { color: var(--brass-hi); border-bottom-color: var(--brass); }
.hall-tab:focus-visible { outline: none; box-shadow: inset var(--ring); }
.hall-tab .hud-tab-dot { position: absolute; top: 9px; right: 6px; }
.gh .hall-tabs-close { flex: none; align-self: center; width: 44px; height: 44px; border: 0; background: none; }
.hall-menu-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.hall-menu-body > * { flex: 1 1 auto; min-height: 0; max-height: none !important; }
.gh .hall-menu-body .ui-panel { width: 100%; max-width: none; border: 0; border-radius: 0; background: none; box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
.hall-menu-body > .hud-panel > .hud-panel-head, .hall-menu-body > .hud-settings > .hud-settings-head { display: none; }
.hall-menu-body > .hud-panel > .hud-panel-body { border-top: 0; }
/* the captions and the act chip slide up over the bar: still, when motion is not wanted */
@media (prefers-reduced-motion: reduce) {
  .hall-caps, .ui-viewer[data-phone] .hall-acts { transition: none; }
}

/* ── the history told (hall/historyEvents.ts): while it plays, or rests short of today, the tape stays
   open (V1's growth tape) and takes the bottom row's middle, clear of the Chronicle chip; the captions
   ride over it; the toasts keep left of it and wrap; a short screen leaves the moments to the captions ── */
.ui-viewer:not([data-phone]):has(.hall-timeline[data-telling="true"]) {
  --tell-w: min(720px, calc(100cqw - 2 * var(--gut) - 2 * 212px));
}
.ui-viewer:not([data-phone]):has(.hall-timeline[data-telling="true"]) .ui-hud-bottom { max-width: var(--tell-w); }
.gh .ui-viewer:not([data-phone]) .ui-hud-bottom .hall-timeline[data-telling="true"] { width: var(--tell-w); }
.ui-viewer:not([data-phone]):has(.hall-timeline[data-telling="true"]) .hall-caps { width: min(640px, var(--tell-w)); }
.ui-viewer:not([data-phone]):has(.hall-timeline[data-telling="true"]) .ui-hud-feed .hud-toasts {
  max-width: max(180px, calc((100cqw - var(--tell-w)) / 2 - var(--gut) - 10px));
}
.ui-viewer:not([data-phone]):has(.hall-timeline[data-telling="true"]) .ui-hud-feed .hud-toast-text {
  white-space: normal; line-height: 1.3; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
}
@container viewer (max-width: 1180px) {
  .gh .hall-timeline[data-telling="true"] .hud-ticks { display: none; }
}
@container viewer (max-height: 460px) {
  .ui-viewer:has(.hall-timeline[data-telling="true"]) .ui-hud-feed .hud-toast-list { display: none; }
  .ui-viewer:not([data-phone]):has(.hall-timeline[data-telling="true"]) { --tell-w: min(720px, calc(100cqw - 2 * var(--gut) - 2 * 196px)); }
  .ui-viewer:not([data-phone], [data-hud-mode="hidden"]):has(.ui-hud-bottom .hall-timeline[data-scale="history"]) .hall-caps { bottom: calc(var(--gut) + var(--tape-h, 60px) + 8px); }
}
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
