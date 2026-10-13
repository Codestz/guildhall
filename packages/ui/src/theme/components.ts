/**
 * The component sheet: V1's pieces (hall.css plaque, panel head, seg, switch, track, play, kbd, chapter
 * chip, loader; demos.css buttons) as `ui-*` classes on the `.gh` tokens. The `ui-` prefix keeps clear of
 * the screens' own `gh-*` sheets. Every interactive piece has hover, pressed, disabled and a visible
 * focus ring; hit targets are at least 28 px (32 px for icon buttons).
 */
export const COMPONENTS_CSS = /* css */ `
.gh :focus-visible { outline: 2px solid var(--brass-hi); outline-offset: 2px; }
.ui-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ── plaque ─────────────────────────────────────────────────────── */
.ui-panel {
  position: relative;
  background: var(--ink);
  border: 1px solid var(--hair);
  border-radius: var(--r);
  box-shadow: var(--shadow);
  backdrop-filter: blur(14px) saturate(1.15);
  -webkit-backdrop-filter: blur(14px) saturate(1.15);
  min-height: 0;
}
.ui-panel[data-solid] { background: rgba(20, 15, 11, 0.95); }
/* brass corner brackets: V1's one ornament */
.ui-panel::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  pointer-events: none;
  --c: var(--brass-line);
  background:
    linear-gradient(var(--c), var(--c)) top left / 12px 1px no-repeat,
    linear-gradient(var(--c), var(--c)) top left / 1px 12px no-repeat,
    linear-gradient(var(--c), var(--c)) top right / 12px 1px no-repeat,
    linear-gradient(var(--c), var(--c)) top right / 1px 12px no-repeat,
    linear-gradient(var(--c), var(--c)) bottom left / 12px 1px no-repeat,
    linear-gradient(var(--c), var(--c)) bottom left / 1px 12px no-repeat,
    linear-gradient(var(--c), var(--c)) bottom right / 12px 1px no-repeat,
    linear-gradient(var(--c), var(--c)) bottom right / 1px 12px no-repeat;
}

/* ── headings ───────────────────────────────────────────────────── */
.ui-eyebrow {
  margin: 0;
  font: 400 var(--t-sm)/1.2 var(--display);
  letter-spacing: 0.14em;
  color: var(--brass);
}
.ui-title {
  margin: 0;
  font: 400 var(--t-xl)/1.15 var(--display);
  letter-spacing: 0.07em;
  color: var(--brass-hi);
}
.ui-sub { margin: 0; font-size: var(--t-md); line-height: 1.35; color: var(--muted); }
.ui-section-head {
  display: flex;
  align-items: baseline;
  gap: var(--s2);
  margin: 0;
  font: 400 var(--t-sm)/1.2 var(--display);
  letter-spacing: 0.16em;
  color: var(--brass);
}
.ui-section-head .meta { margin-left: auto; font: var(--t-sm) var(--body); letter-spacing: 0; color: var(--faint); }
.ui-hint { margin: 0; font-size: var(--t-sm); line-height: 1.4; color: var(--faint); }

/* ── buttons ────────────────────────────────────────────────────── */
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s2);
  min-height: 34px;
  padding: 0 14px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: var(--raise);
  color: var(--paper);
  font: 500 var(--t-md)/1 var(--body);
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ui-btn:hover:not(:disabled) { background: var(--raise-2); border-color: var(--brass-line); }
.ui-btn:active:not(:disabled) { transform: translateY(1px); }
.ui-btn:disabled { opacity: 0.45; cursor: default; }
.ui-btn[data-variant="primary"] { border-color: var(--brass); background: var(--brass); color: var(--on-brass); font-weight: 700; }
.ui-btn[data-variant="primary"]:hover:not(:disabled) { background: var(--brass-hi); border-color: var(--brass-hi); }
.ui-btn[data-variant="outline"] { border-color: var(--brass); background: var(--brass-wash); color: var(--brass-hi); }
.ui-btn[data-variant="outline"]:hover:not(:disabled) { background: rgba(220, 182, 98, 0.26); color: var(--paper); }
.ui-btn[data-variant="ghost"] { border-color: transparent; background: transparent; color: var(--muted); }
.ui-btn[data-variant="ghost"]:hover:not(:disabled) { color: var(--paper); background: var(--raise-2); border-color: transparent; }
.ui-btn[data-size="sm"] { min-height: 28px; padding: 0 10px; font-size: var(--t-sm); }
.ui-btn svg { flex: none; }

.ui-icon-btn {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--hit);
  height: var(--hit);
  padding: 0;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.ui-icon-btn:hover:not(:disabled) { background: var(--raise-2); color: var(--paper); }
.ui-icon-btn[aria-pressed="true"], .ui-icon-btn[aria-expanded="true"] { color: var(--brass-hi); background: rgba(38, 29, 19, 0.92); border-color: var(--brass-line); }
.ui-icon-btn:disabled { opacity: 0.4; cursor: default; }
/* a plaque of its own: V1's corner tools */
.ui-icon-btn[data-plaque] { width: 40px; height: 40px; background: var(--ink); border-color: var(--hair); box-shadow: var(--shadow); backdrop-filter: blur(14px); }
.ui-icon-btn[data-plaque]:hover:not(:disabled) { color: var(--brass-hi); border-color: var(--brass-line); }

/* ── chips ──────────────────────────────────────────────────────── */
.ui-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  min-height: 24px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--hair-2);
  background: var(--ink);
  color: var(--paper);
  font: var(--t-sm)/1.4 var(--body);
  white-space: nowrap;
}
.ui-chip .numeral { min-width: 1.6ch; font-family: var(--display); letter-spacing: 0.08em; color: var(--brass); }
.ui-chip .label { font-family: var(--display); letter-spacing: 0.04em; color: var(--brass-hi); }
.ui-chip[data-kind="tag"] { font: var(--t-xs)/1.5 var(--mono); padding: 1px 8px; min-height: 0; }
.ui-chip[data-tone="ok"] { color: var(--ok); border-color: rgba(166, 221, 143, 0.4); background: rgba(166, 221, 143, 0.08); }
.ui-chip[data-tone="warn"] { color: var(--warn); border-color: rgba(255, 196, 81, 0.45); background: rgba(255, 196, 81, 0.08); }
.ui-chip[data-tone="fail"] { color: var(--fail); border-color: rgba(255, 139, 123, 0.45); background: rgba(255, 139, 123, 0.08); }
.ui-chip[data-tone="info"] { color: var(--info); border-color: rgba(143, 208, 230, 0.4); background: rgba(143, 208, 230, 0.07); }
.ui-chip[data-tone="brass"] { color: var(--brass-hi); border-color: var(--brass-line); background: var(--brass-wash); }

.ui-kbd {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--hair-2);
  border-bottom-width: 2px;
  background: var(--ink-deep);
  font: 500 11px/1 var(--mono);
  color: var(--paper);
}

/* ── fields ─────────────────────────────────────────────────────── */
.ui-field { display: grid; gap: 6px; min-width: 0; }
.ui-field-head { display: flex; align-items: baseline; gap: var(--s2); min-width: 0; }
.ui-field-label { flex: 1; min-width: 0; font-size: var(--t-md); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-field-value { font: 500 var(--t-sm)/1 var(--mono); color: var(--paper); font-variant-numeric: tabular-nums; }
.ui-field-value[data-changed] { color: var(--brass-hi); }

/* V1's track: a 4 px rail, brass fill to the value, a brass-hi thumb in an ink ring */
.ui-range {
  --p: 0.5;
  width: 100%;
  height: 22px;
  margin: 0;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.ui-range:focus-visible { outline: none; }
.ui-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--brass) calc(var(--p) * 100%), rgba(243, 233, 212, 0.16) 0);
}
.ui-range::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(243, 233, 212, 0.16); }
.ui-range::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--brass); }
.ui-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border-radius: 50%;
  background: var(--brass-hi);
  border: 3px solid var(--ink-solid);
  box-shadow: 0 0 0 1px var(--brass);
}
.ui-range::-moz-range-thumb { width: 10px; height: 10px; border-radius: 50%; background: var(--brass-hi); border: 3px solid var(--ink-solid); box-shadow: 0 0 0 1px var(--brass); }
.ui-range:hover::-webkit-slider-thumb { box-shadow: 0 0 0 1px var(--brass-hi); }
.ui-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 1px var(--brass), 0 0 0 5px rgba(241, 213, 144, 0.5); }
.ui-range:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 1px var(--brass), 0 0 0 5px rgba(241, 213, 144, 0.5); }
.ui-range:disabled { opacity: 0.45; cursor: default; }

/* switch row: the whole row is the button */
.ui-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s3);
  min-height: 34px;
  padding: 2px 0;
  border: 0;
  background: none;
  text-align: left;
  border-radius: var(--r-sm);
  cursor: pointer;
}
.ui-toggle-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.ui-toggle-text b { font-size: var(--t-md); font-weight: 500; color: var(--paper); }
.ui-toggle-text span { font-size: var(--t-sm); color: var(--faint); }
.ui-switch { flex: none; position: relative; width: 36px; height: 20px; border-radius: 10px; background: var(--ink-deep); border: 1px solid var(--hair-2); transition: background 0.2s, border-color 0.2s; }
.ui-switch i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--faint); transition: transform 0.2s, background 0.2s; }
.ui-toggle:hover .ui-switch { border-color: var(--muted); }
.ui-toggle[aria-checked="true"] .ui-switch { background: var(--brass-wash); border-color: var(--brass-line); }
.ui-toggle[aria-checked="true"] .ui-switch i { transform: translateX(16px); background: var(--brass-hi); }

.ui-select { position: relative; display: block; }
.ui-select select {
  width: 100%;
  height: 32px;
  padding: 0 30px 0 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: var(--ink-deep);
  color: var(--paper);
  font: var(--t-md)/1 var(--body);
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.ui-select select:hover { border-color: var(--brass-line); }
.ui-select select option { background: var(--ink-solid); color: var(--paper); }
.ui-select svg { position: absolute; right: 10px; top: 50%; translate: 0 -50%; color: var(--faint); pointer-events: none; }

/* grouped controls: a fieldset with its legend as the label */
.ui-fieldset { display: flow-root; margin: 0; padding: 0; border: 0; min-width: 0; }
.ui-fieldset > legend { float: left; padding: 0; line-height: 28px; }
.ui-fieldset > legend + .ui-seg { clear: both; }
.ui-fieldset.ui-field > legend { line-height: 1.4; margin-bottom: 6px; }
.ui-fieldset > .ui-stepper { float: right; }

/* V1's segmented control */
.ui-seg { display: flex; padding: 2px; gap: 2px; border-radius: var(--r-sm); background: var(--ink-deep); border: 1px solid var(--hair); }
.ui-seg button {
  flex: 1;
  min-height: 28px;
  min-width: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 4px;
  background: none;
  font-size: var(--t-md);
  color: var(--muted);
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ui-seg button:hover { color: var(--paper); background: var(--raise); }
.ui-seg button[aria-pressed="true"] { color: var(--on-brass); background: var(--brass); font-weight: 700; }

.ui-stepper { display: inline-flex; align-items: center; border-radius: var(--r-sm); background: var(--ink-deep); border: 1px solid var(--hair); }
.ui-stepper button { width: 30px; height: 28px; border: 0; background: none; color: var(--muted); cursor: pointer; border-radius: 4px; }
.ui-stepper button:hover:not(:disabled) { color: var(--paper); background: var(--raise-2); }
.ui-stepper button:disabled { opacity: 0.4; cursor: default; }
.ui-stepper output { min-width: 5ch; text-align: center; font: 500 var(--t-md)/1 var(--mono); color: var(--paper); font-variant-numeric: tabular-nums; }

/* ── read-outs ──────────────────────────────────────────────────── */
.ui-stats { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 14px; margin: 0; }
/* labels in small caps of the body face: the display face's "1" reads as a roman I */
.ui-stats dt { min-width: 0; font: 500 var(--t-md)/1.3 var(--body); font-variant: all-small-caps; letter-spacing: 0.08em; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-stats dd { margin: 0; text-align: right; font: 500 var(--t-sm)/1.35 var(--mono); color: var(--paper); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-stats dd small { margin-left: 3px; font-weight: 400; color: var(--faint); }
.ui-stats dd[data-tone="warn"] { color: var(--warn); }
.ui-stats dd[data-tone="fail"] { color: var(--fail); }
.ui-stats dd[data-tone="ok"] { color: var(--ok); }
.ui-stats dd[data-tone="brass"] { color: var(--brass-hi); }
/* headline numbers: big mono over a small-caps label (the home page's stat strip) */
.ui-figures { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; }
.ui-figures div { display: flex; flex-direction: column-reverse; min-width: 0; }
.ui-figures dt { font: 500 var(--t-sm)/1.2 var(--body); font-variant: all-small-caps; letter-spacing: 0.1em; color: var(--faint); white-space: nowrap; }
.ui-figures dd { margin: 0; font: 500 var(--t-lg)/1.25 var(--mono); color: var(--paper); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-figures dd small { margin-left: 2px; font-size: var(--t-xs); color: var(--faint); }

.ui-legend { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
.ui-legend li { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 20px; font-size: var(--t-md); color: var(--muted); }
.ui-legend li i { width: 12px; height: 12px; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4) inset, 0 0 0 1px var(--hair); }
.ui-legend li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-legend li b { font: 500 var(--t-sm) var(--mono); color: var(--paper); font-variant-numeric: tabular-nums; }
.ui-legend li small { margin-left: 4px; font: var(--t-xs) var(--mono); color: var(--faint); }

/* ── card / toast ───────────────────────────────────────────────── */
.ui-card {
  display: flex;
  align-items: center;
  gap: var(--s3);
  max-width: min(460px, calc(100vw - 32px));
  padding: 8px 8px 8px 14px;
  border-radius: var(--r);
  background: rgba(20, 15, 11, 0.95);
  border: 1px solid var(--brass-line);
  box-shadow: var(--shadow);
  font-size: var(--t-md);
  color: var(--paper);
  animation: ui-rise 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.ui-card .text { flex: 1; min-width: 0; }
.ui-card .text b { color: var(--brass-hi); font-weight: 500; }
.ui-card .text small { display: block; font: var(--t-xs) var(--mono); color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes ui-rise { from { opacity: 0; transform: translateY(8px); } }

/* ── in-world label (a plate pinned to a point in the scene) ────── */
/* small caps of the body face, not the display face: names carry digits ("sword-1handed") */
.ui-plate {
  position: absolute;
  z-index: 1;
  max-width: var(--plate-w, 260px);
  padding: 3px 9px 4px;
  border-radius: var(--r-sm);
  background: rgba(20, 15, 11, 0.84);
  border: 1px solid var(--hair);
  box-shadow: 0 6px 16px -8px rgba(0, 0, 0, 0.8);
  color: var(--paper);
  font: var(--t-sm)/1.3 var(--body);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
.ui-plate b { font: 500 var(--t-lg)/1.15 var(--body); font-variant: all-small-caps; letter-spacing: 0.06em; color: var(--brass-hi); }
.ui-plate[data-size="sm"] { padding: 2px 6px 3px; }
.ui-plate[data-size="sm"] b { font-size: var(--t-md); letter-spacing: 0.03em; }
/* tighter still: the name alone */
.ui-plate[data-size="xs"] { padding: 1px 6px 2px; }
.ui-plate[data-size="xs"] b { font-size: var(--t-sm); letter-spacing: 0.03em; }
.ui-plate[data-size="xs"] small { display: none; }
/* a heading too tight for its box: bare text, full width, shadowed to read over the scene */
.ui-plate[data-size="sm"][data-kind="head"] { max-width: none; overflow: visible; padding: 0; border: 0; background: none; box-shadow: none; text-shadow: 0 1px 2px #000, 0 0 6px rgba(0, 0, 0, 0.8); }
.ui-plate small { display: block; font: var(--t-xs)/1.35 var(--mono); color: var(--muted); }
.ui-plate[data-tone="ok"] { border-color: rgba(166, 221, 143, 0.35); }
.ui-plate[data-tone="ok"] small { color: var(--ok); }
.ui-plate[data-tone="warn"] { border-color: rgba(255, 196, 81, 0.45); }
.ui-plate[data-tone="warn"] small { color: var(--warn); }
.ui-plate[data-tone="fail"] { border-color: rgba(255, 139, 123, 0.5); }
.ui-plate[data-tone="fail"] small { color: var(--fail); }
.ui-plate[data-kind="head"] { padding: 4px 12px 5px; border-color: var(--brass-line); }

/* ── loader (V1's boot card, as a veil over a stage) ────────────── */
.ui-loader {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(ellipse 70% 60% at 50% 40%, rgba(220, 182, 98, 0.1), transparent 70%),
    radial-gradient(ellipse at 50% 45%, #241b13 0%, var(--ink-solid) 55%, #0c0907 100%);
  transition: opacity 0.45s ease-in-out, visibility 0s linear 0.45s;
}
.ui-loader[data-state="out"] { opacity: 0; visibility: hidden; pointer-events: none; }
.ui-loader-inner { display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 520px; text-align: center; }
.ui-crest { display: grid; place-items: center; width: 56px; height: 56px; color: var(--brass-hi); border: 1px solid var(--brass-line); border-radius: 50%; background: radial-gradient(circle at 50% 35%, rgba(220, 182, 98, 0.18), transparent 70%); box-shadow: 0 0 40px -8px rgba(220, 182, 98, 0.35); animation: ui-breathe 2.4s ease-in-out infinite; }
.ui-loader-name { margin: 0; font: 400 clamp(26px, 4vw, 40px)/1.05 var(--display); letter-spacing: 0.07em; color: var(--brass-hi); overflow-wrap: anywhere; }
.ui-loader-rule { width: 120px; height: 1px; background: linear-gradient(90deg, transparent, var(--brass), transparent); opacity: 0.6; }
.ui-loader-bar { display: block; width: 168px; height: 2px; border-radius: 2px; background: var(--hair-2); overflow: hidden; }
.ui-loader-bar i { display: block; height: 100%; background: var(--brass); transform-origin: left center; transition: transform 0.3s ease-out; }
.ui-loader-steps { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 16px; margin: 0; padding: 0; list-style: none; font: 400 var(--t-sm)/1.2 var(--display); letter-spacing: 0.14em; color: var(--faint); }
.ui-loader-steps li { display: flex; align-items: center; gap: 7px; }
.ui-loader-steps li::before { content: ""; width: 5px; height: 5px; border-radius: 50%; border: 1px solid currentColor; }
.ui-loader-steps li[data-step="done"] { color: var(--muted); }
.ui-loader-steps li[data-step="done"]::before { background: currentColor; }
.ui-loader-steps li[data-step="now"] { color: var(--brass-hi); }
.ui-loader-steps li[data-step="now"]::before { background: var(--brass); border-color: var(--brass); }
.ui-loader-error { margin: 0; color: var(--fail); font-size: var(--t-md); }
@keyframes ui-breathe { 50% { box-shadow: 0 0 56px -4px rgba(220, 182, 98, 0.5); } }

@media (prefers-reduced-motion: reduce) {
  .ui-crest { animation: none; }
  .ui-card { animation: none; }
  .ui-loader { transition-duration: 0.15s; }
}
`
