/**
 * The party tabs, the "Show HUD · H" pill and the fast-forward chip (Chips.tsx): V1's hall.css `.parties`,
 * `.show-hud` and `.ffwd` on the `.gh` tokens. Part of the HUD sheet.
 */
export const CHIPS_CSS = /* css */ `
/* ── party tabs ── */
.hud-parties { width: 304px; max-width: 100%; padding: 4px; }
.hud-party-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.hud-party-row {
  position: relative;
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 10px 5px 9px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  text-align: left;
  color: var(--paper);
  cursor: pointer;
  transition: background 0.15s;
}
.hud-party-row:hover { background: var(--raise-2); }
.hud-party-row[aria-pressed="true"] { background: var(--brass-wash); box-shadow: inset 0 0 0 1px var(--brass-line); }
.hud-party-row[aria-pressed="true"]:not(.hud-party-all)::before { content: ""; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; border-radius: 0 2px 2px 0; background: var(--banner); }
.hud-party-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--display); font-size: 14px; letter-spacing: 0.04em; }
.hud-party-all .hud-party-name { color: var(--muted); }
.hud-party-all[aria-pressed="true"] .hud-party-name { color: var(--paper); }
.hud-party-state { flex: none; font-size: var(--t-sm); color: var(--muted); }
.hud-party-row[data-leaving="true"] :is(.hud-party-name, .hud-party-state) { color: var(--faint); font-style: italic; }
.hud-party-plea { display: grid; place-items: center; color: var(--warn); }
.hud-pennants { display: inline-flex; flex: none; }
.hud-pennants .hud-pennant + .hud-pennant { margin-left: -8px; }
.hud-parties[data-compact="true"] { width: auto; padding: 3px; }
.hud-parties[data-compact="true"] .hud-party-list { flex-direction: row; overflow-x: auto; scrollbar-width: none; }
.hud-parties[data-compact="true"] .hud-party-row { flex: none; width: auto; min-width: 40px; min-height: 40px; justify-content: center; gap: 6px; padding: 4px 8px; }
.hud-parties[data-compact="true"] .hud-party-name { flex: none; font-size: 13px; }
.hud-parties[data-compact="true"] .hud-party-row:not(.hud-party-all) .hud-party-name { display: none; }
.hud-parties[data-compact="true"] .hud-party-all .hud-pennants { display: none; }
.hud-parties[data-compact="true"] .hud-party-row[aria-pressed="true"]:not(.hud-party-all)::before { top: auto; left: 8px; right: 8px; bottom: 0; width: auto; height: 3px; border-radius: 2px 2px 0 0; }

/* ── Show HUD · H ── */
.hud-show {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 12px;
  border: 1px solid var(--hair);
  border-radius: var(--r);
  background: var(--ink);
  box-shadow: var(--shadow);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.hud-show:hover { color: var(--paper); border-color: var(--brass-line); }
.hud-show-dot { width: 9px; height: 9px; margin: 0 3px 0 1px; transform: rotate(45deg); background: var(--warn); box-shadow: 0 0 0 2px var(--ink-solid); }

/* ── fast-forward: top centre, a quiet ink pill in muted brass ── */
.hud-ffwd {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px 0 10px;
  border-radius: 999px;
  background: rgba(14, 10, 7, 0.72);
  box-shadow: 0 0 0 1px var(--brass-line);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--brass-hi);
  font: 12.5px/1 var(--mono);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.5s ease;
}
.hud-ffwd[data-on="true"] { opacity: 1; }
.hud-ffwd-rate { min-width: 3.2ch; }
/* ── Settings: V1's link row and the Director's controls group ── */
.hud-set-link {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 6px 4px 6px 10px;
  text-align: left;
  border: 1px solid var(--brass-line);
  border-radius: var(--r-sm);
  background: var(--raise);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.hud-set-link > .hud-glyph { color: var(--brass-hi); }
.hud-set-link .ui-toggle-text { flex: 1; }
.hud-set-link > .hud-glyph:last-child { color: var(--muted); transform: rotate(-90deg); }
.hud-set-link:hover, .hud-set-link:active { background: var(--raise-2); border-color: var(--brass); }
.hud-set-section.hud-set-director { gap: 0; margin: 6px -8px 8px; padding: 14px 12px 2px; border: 1px solid var(--brass-line); border-radius: var(--r); background: linear-gradient(180deg, var(--brass-wash), transparent 96px), var(--raise); }
.hud-set-section + .hud-set-section.hud-set-director, .hud-set-section.hud-set-director + .hud-set-section { border-top: 0; }
.hud-director-head { display: flex; flex-direction: column; gap: 6px; padding-bottom: 4px; }
.hud-director-head h3 { margin: 0; font: 400 13px/1.2 var(--display); letter-spacing: 0.12em; color: var(--brass-hi); }
.hud-set-sub { display: grid; gap: 10px; padding: 12px 0 14px; }
.hud-set-sub:first-of-type { border-top: 1px solid var(--hair); }
.hud-set-sub + .hud-set-sub { border-top: 1px solid var(--hair); }
.hud-set-sub h4 { display: flex; align-items: baseline; margin: 0; font: 400 11.5px/1.2 var(--display); letter-spacing: 0.16em; color: var(--brass); }
.hud-set-sub h4 .meta { margin-left: auto; font: var(--t-sm) var(--body); letter-spacing: 0; color: var(--faint); font-style: italic; }

@media (prefers-reduced-motion: reduce) {
  .hud-ffwd { transition: none; }
}
`
