/**
 * Touch size (decisions.md "Phone GUI"): under `root` (a phone's viewer, or any coarse pointer) `--hit` is
 * 44 px and what fixes its own size follows it: the icon buttons, the play button, the speed chip, the
 * timeline's hairline (a transparent 44 px tap pad behind it) and the range thumbs (their ring drawn at
 * the old size inside a 44 px thumb, so the line itself keeps its look).
 */
const touch = (root: string) => /* css */ `
${root} { --hit: 44px; --thumb: radial-gradient(circle closest-side, var(--brass-hi) 0 5px, var(--ink-solid) 5px 8px, var(--brass) 8px 9px, transparent 9.5px); }
${root} .ui-icon-btn[data-plaque] { width: var(--hit); height: var(--hit); }
${root} :is(.hud-play, .ui-play) { width: var(--hit); height: var(--hit); }
${root} .hud-rate { min-width: var(--hit); height: var(--hit); }
${root} .hud-timeline-hint::before { content: ""; position: absolute; left: -10px; right: -10px; top: 50%; height: var(--hit); translate: 0 -50%; }
${root} .ui-range::-webkit-slider-thumb { width: var(--hit); height: var(--hit); margin-top: calc((4px - var(--hit)) / 2); border: 0; background: var(--thumb); box-shadow: none; }
${root} .hud-track { height: var(--hit); }
${root} .hud-track input::-webkit-slider-thumb { width: var(--hit); height: var(--hit); margin-top: 0; border: 0; background: var(--thumb); box-shadow: none; }
${root} :is(.ui-range, .hud-track input):focus-visible::-webkit-slider-thumb { background: radial-gradient(circle closest-side, var(--brass-hi) 0 5px, var(--ink-solid) 5px 8px, var(--brass) 8px 9px, rgba(241, 213, 144, 0.5) 9px 12px, transparent 12.5px); }
`

/**
 * The Viewer's layout: a stage filling the viewer, a label layer over it, and V1's corners round it
 * (title card top-left, tools top-right, transport bottom-left, camera help bottom-right) with the
 * Inspector down the right. Sized by container queries on the viewer itself, so a viewer inset in a
 * panel lays out like a narrow screen.
 */
export const VIEWER_CSS = /* css */ `
.ui-viewer {
  --gut: 12px;
  --insp-w: 320px;
  --tools-h: 40px;
  position: absolute;
  inset: 0;
  overflow: hidden;
  container: viewer / size;
}
.ui-viewer-stage, .ui-viewer-labels { position: absolute; inset: 0; }
.ui-viewer-stage { z-index: 0; }
.ui-viewer-labels { z-index: 1; pointer-events: none; overflow: hidden; }
.ui-viewer-chrome { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
.ui-viewer[data-chrome="off"] .ui-viewer-chrome { display: none; }
.ui-viewer-chrome > * { pointer-events: auto; }
.ui-corner { position: absolute; display: flex; flex-direction: column; gap: 8px; max-width: calc(100% - 2 * var(--gut)); }
.ui-corner:empty { display: none; }
.ui-corner[data-at="tl"] { top: var(--gut); left: var(--gut); align-items: flex-start; }
.ui-corner[data-at="tr"] { top: var(--gut); right: var(--gut); flex-direction: row; align-items: center; }
.ui-corner[data-at="bl"] { bottom: var(--gut); left: var(--gut); align-items: flex-start; }
.ui-corner[data-at="br"] { bottom: var(--gut); right: var(--gut); align-items: flex-end; transition: right 0.2s ease; }
.ui-viewer[data-inspector="open"] .ui-corner[data-at="br"] { right: calc(var(--insp-w) + 2 * var(--gut)); }
.ui-corner[data-at="bc"] { bottom: calc(var(--gut) + 56px); left: 50%; translate: -50% 0; align-items: center; }

/* ── title card ─────────────────────────────────────────────────── */
.ui-titlecard { width: max-content; min-width: 220px; max-width: 360px; padding: 11px 14px 12px; display: grid; gap: 7px; }
.ui-titlecard .ui-sub { max-width: 52ch; }
.ui-titlecard .ui-figures { padding-top: 8px; border-top: 1px solid var(--hair); }
.ui-titlecard .actions { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 2px; }
.ui-titlecard .status { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--t-sm); color: var(--muted); }
.ui-titlecard .status i { width: 6px; height: 6px; border-radius: 50%; background: var(--brass); animation: ui-pulse 1.4s ease-in-out infinite; }
@keyframes ui-pulse { 50% { opacity: 0.35; } }

/* ── tools (top right) ──────────────────────────────────────────── */
.ui-tools { display: flex; gap: 6px; align-items: center; }
.ui-perf {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--ink);
  border: 1px solid var(--hair);
  font: 500 var(--t-sm)/1 var(--mono);
  color: var(--paper);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  backdrop-filter: blur(14px);
}
.ui-perf-wrap { position: relative; display: inline-flex; }
.ui-perf { cursor: pointer; appearance: none; }
.ui-perf:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
.ui-perf-detail { position: absolute; top: calc(100% + 6px); right: 0; min-width: 168px; padding: 8px 12px 9px; display: grid; gap: 6px; font: 500 var(--t-sm)/1.45 var(--mono); font-variant-numeric: tabular-nums; color: var(--paper); }
.ui-perf-detail dl { margin: 0; display: grid; grid-template-columns: 1fr auto; column-gap: 14px; }
.ui-perf-detail dl + dl { padding-top: 6px; border-top: 1px solid var(--hair); }
.ui-perf-detail dt { color: var(--faint); font-weight: 400; }
.ui-perf-detail dd { margin: 0; text-align: right; }
.ui-perf-detail .head { color: var(--brass); font-weight: 500; }
.ui-perf-detail .none { margin: 0; color: var(--faint); }
.ui-perf small { color: var(--faint); font-weight: 400; }
.ui-perf .led { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 6px rgba(166, 221, 143, 0.6); }
.ui-perf[data-tone="warn"] .led { background: var(--warn); box-shadow: 0 0 6px rgba(255, 196, 81, 0.6); }
.ui-perf[data-tone="fail"] .led { background: var(--fail); box-shadow: 0 0 6px rgba(255, 139, 123, 0.6); }

/* ── transport (bottom left) ────────────────────────────────────── */
.ui-transport { display: flex; align-items: center; gap: 12px; width: min(380px, calc(100cqw - 2 * var(--gut))); height: 56px; padding: 0 16px 0 10px; }
.ui-play {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  color: var(--on-brass);
  background: var(--brass);
  box-shadow: 0 0 0 3px rgba(20, 15, 11, 0.9), 0 0 0 4px var(--brass-line);
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.ui-play:hover { background: var(--brass-hi); }
.ui-play:active { transform: scale(0.94); }
.ui-play:focus-visible { outline-offset: 4px; border-radius: 50%; }
.ui-transport .time { flex: none; min-width: 56px; display: grid; line-height: 1.1; }
.ui-transport .time small { font: 400 var(--t-xs)/1.2 var(--display); letter-spacing: 0.12em; color: var(--faint); white-space: nowrap; }
.ui-transport .time b { font: 500 var(--t-lg)/1.2 var(--mono); color: var(--paper); font-variant-numeric: tabular-nums; }
.ui-transport .ui-range { flex: 1; min-width: 60px; }

/* ── help (bottom right) ────────────────────────────────────────── */
.ui-help { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.ui-help-body { padding: 10px 12px 11px; max-width: min(400px, calc(100cqw - 2 * var(--gut))); }
.ui-help-row { display: flex; align-items: center; gap: 6px; }
.ui-keys { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0; padding: 0; list-style: none; font: var(--t-sm)/1.2 var(--body); color: var(--faint); }
.ui-keys li { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.ui-keys .ui-kbd { height: 18px; min-width: 18px; font-size: 10px; padding: 0 4px; }
.ui-keys b { font-weight: 500; color: var(--muted); }
.ui-keys .num { color: var(--brass-hi); }
.ui-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 11px 0 9px;
  border-radius: 999px;
  border: 1px solid var(--hair);
  background: var(--ink);
  color: var(--muted);
  font: 500 var(--t-sm)/1 var(--body);
  backdrop-filter: blur(14px);
  cursor: pointer;
  white-space: nowrap;
}
.ui-pill:hover { color: var(--paper); border-color: var(--brass-line); }
.ui-pill[aria-pressed="true"], .ui-pill[aria-expanded="true"] { color: var(--brass-hi); border-color: var(--brass-line); background: rgba(38, 29, 19, 0.92); }
.ui-pill .led { width: 7px; height: 7px; border-radius: 50%; background: var(--hair-2); }
.ui-pill[aria-pressed="true"] .led { background: var(--brass-hi); box-shadow: 0 0 6px rgba(241, 213, 144, 0.7); }

/* ── inspector (right) ──────────────────────────────────────────── */
.ui-inspector {
  position: absolute;
  z-index: 4;
  top: calc(var(--gut) + var(--tools-h) + 8px);
  right: var(--gut);
  bottom: var(--gut);
  width: var(--insp-w);
  display: flex;
  flex-direction: column;
  background: rgba(20, 15, 11, 0.93);
  animation: ui-slide 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.ui-inspector[hidden] { display: none; }
@keyframes ui-slide { from { opacity: 0; transform: translateX(10px); } }
.ui-inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 8px 9px 16px; border-bottom: 1px solid var(--hair); }
.ui-inspector-head h2 { margin: 0; font: 400 var(--t-xl)/1 var(--display); letter-spacing: 0.08em; color: var(--brass-hi); }
.ui-inspector-body { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 16px 16px; scrollbar-width: thin; scrollbar-color: var(--hair-2) transparent; }
.ui-group { border-bottom: 1px solid var(--hair); }
.ui-group:last-child { border-bottom: 0; }
.ui-group > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  list-style: none;
  cursor: pointer;
  border-radius: var(--r-sm);
}
.ui-group > summary::-webkit-details-marker { display: none; }
.ui-group > summary svg { flex: none; color: var(--faint); transition: transform 0.2s; }
.ui-group:not([open]) > summary svg { transform: rotate(-90deg); }
.ui-group > summary:hover .ui-section-head { color: var(--brass-hi); }
.ui-group > summary .ui-section-head { flex: 1; }
.ui-group-body { display: grid; gap: 12px; padding: 2px 0 14px; }
.ui-inspector-foot { display: grid; gap: 8px; padding: 10px 16px 12px; border-top: 1px solid var(--hair); background: rgba(12, 9, 7, 0.5); }
.ui-inspector-foot p { margin: 0; font-size: var(--t-sm); color: var(--muted); }
.ui-inspector-foot p b { color: var(--brass-hi); font-weight: 500; }
.ui-inspector-foot .row { display: flex; gap: 8px; }
.ui-inspector-foot .row .ui-btn { flex: 1; }

/* toasts sit bottom centre */
.ui-toasts { display: flex; flex-direction: column; align-items: center; gap: 6px; }

/* ── HUD regions (hud.ts): empty and inert until a screen uses them ─ */
.ui-viewer-hud { position: absolute; inset: 0; z-index: 2; pointer-events: none; display: none; }
.ui-viewer[data-hud="on"] .ui-viewer-hud { display: block; animation: ui-hud-in 0.4s ease-out both; }
.ui-viewer[data-hud-veil] .ui-viewer-hud, .ui-viewer[data-chrome="off"] .ui-viewer-hud { display: none; }
@keyframes ui-hud-in { from { opacity: 0; } }
.ui-hud-region { position: absolute; display: flex; flex-direction: column; gap: 8px; max-width: calc(100% - 2 * var(--gut)); }
.ui-hud-region > * { pointer-events: auto; }
.ui-hud-region:empty { display: none; }
.ui-hud-corner { top: var(--hud-top, var(--gut)); left: var(--gut); align-items: flex-start; max-height: calc(100% - var(--hud-top, var(--gut)) - var(--gut) - 64px); }
.ui-hud-rail { top: var(--gut); right: var(--gut); flex-direction: row; align-items: center; gap: 6px; }
.ui-hud-feed { bottom: var(--gut); left: var(--gut); align-items: flex-start; max-height: calc(100% - var(--hud-top, var(--gut)) - 160px); }
.ui-hud-bottom { bottom: var(--gut); left: 50%; translate: -50% 0; align-items: center; max-width: min(720px, calc(100% - 2 * var(--gut) - 2 * 260px)); }
.ui-hud-sheet {
  top: calc(var(--gut) + 52px);
  right: var(--gut);
  bottom: var(--gut);
  width: min(380px, calc(100% - 2 * var(--gut)));
  align-items: stretch;
}
.ui-hud-sheet > * { max-height: 100%; min-height: 0; }
/* hidden: only the rail's way back stays */
.ui-viewer[data-hud-mode="hidden"] .ui-hud-region:not(.ui-hud-rail) { display: none; }
/* the focus H hands back to the viewer when its control hides: no ring round the whole scene */
.ui-viewer[tabindex="-1"]:focus { outline: none; }
/* with the sheet open the bottom bar keeps clear of it */
.ui-viewer[data-hud-open] .ui-hud-sheet:not(:empty) ~ .ui-hud-bottom { translate: calc(-50% - 190px) 0; }

/* a phone: the rail stays top-right, the feed is a chip, the one open panel is a bottom sheet */
.ui-viewer[data-phone] { --gut: 8px; }
${touch(".ui-viewer[data-phone]")}
@media (pointer: coarse) { ${touch(".gh.ui-viewer")} }
.ui-viewer[data-phone] .ui-hud-bottom { left: var(--gut); right: var(--gut); translate: none; max-width: none; bottom: calc(var(--gut) + env(safe-area-inset-bottom)); }
.ui-viewer[data-phone] .ui-hud-sheet {
  top: auto;
  left: 0;
  right: 0;
  bottom: 0;
  width: auto;
  max-width: none;
  max-height: min(64%, 620px);
  padding-bottom: env(safe-area-inset-bottom);
}
.ui-viewer[data-phone] .ui-hud-sheet > * { border-radius: 14px 14px 0 0; border-bottom: 0; width: 100%; }
.ui-viewer[data-phone][data-hud-open] .ui-hud-sheet:not(:empty) ~ .ui-hud-bottom,
.ui-viewer[data-phone][data-hud-open] .ui-hud-feed { display: none; }
@media (prefers-reduced-motion: reduce) { .ui-viewer[data-hud="on"] .ui-viewer-hud { animation: none; } }

/* ── narrow (a phone, or a viewer inset in a panel) ─────────────── */
@container viewer (max-width: 760px) {
  .ui-viewer { --gut: 8px; }
  .ui-titlecard { min-width: 0; max-width: calc(100cqw - 2 * var(--gut) - 120px); padding: 8px 11px 9px; gap: 4px; }
  .ui-titlecard .ui-title { font-size: var(--t-lg); }
  .ui-titlecard .ui-sub, .ui-titlecard .ui-figures, .ui-titlecard .ui-eyebrow { display: none; }
  .ui-perf { display: none; }
  .ui-inspector {
    top: auto;
    left: var(--gut);
    width: auto;
    max-height: min(62cqh, 560px);
  }
  .ui-viewer[data-inspector="open"] .ui-corner[data-at="br"], .ui-viewer[data-inspector="open"] .ui-corner[data-at="bl"] { display: none; }
  .ui-corner[data-at="br"] { right: var(--gut); }
  /* the transport takes the whole bottom edge; the camera pills stand above it */
  .ui-corner[data-at="bl"] { right: var(--gut); }
  .ui-viewer:has(.ui-transport) .ui-corner[data-at="br"] { bottom: calc(var(--gut) + 56px); }
  .ui-transport { width: 100%; height: 48px; gap: 10px; padding: 0 12px 0 8px; }
}
@container viewer (max-height: 460px) {
  .ui-titlecard .ui-figures, .ui-titlecard .ui-sub { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-inspector { animation: none; }
  .ui-titlecard .status i { animation: none; }
}
`
