/**
 * The studio's base sheet: `@guildhall/ui`'s tokens (V1's HUD, v1:packages/hall/src/hall.css) and the
 * controls every tool screen shares (tool buttons, pill toggles, selects, ranges, chips), then the piece
 * browser's layout. The top bar holds it, so it is on every screen; a screen's own sheet adds layout,
 * never a second copy of a control.
 */
import { FACES, FONTS_URL as FONTS, TOKENS_CSS } from "@guildhall/ui"

/** The shared controls on V1's look: words in the body face, numbers and ids in mono, brass when on. */
const CONTROLS = /* css */ `
.gh-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: var(--raise);
  color: var(--paper);
  font: 500 13px/1 var(--body);
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.gh-tool:hover:not(:disabled) { background: var(--raise-2); border-color: var(--brass-line); }
.gh-tool[aria-pressed="true"] { border-color: var(--brass-line); background: var(--brass-wash); color: var(--brass-hi); }
.gh-tool:disabled { opacity: 0.4; cursor: default; }
.gh-tool:focus-visible, .gh-toggle:focus-visible, .gh-select:focus-visible { outline: 2px solid var(--brass-hi); outline-offset: 2px; }

.gh-chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
fieldset.gh-seg, fieldset.gh-chips { margin: 0; min-width: 0; }
fieldset.gh-chips { padding: 0; border: 0; }
.gh-toggle {
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--hair-2);
  background: transparent;
  color: var(--muted);
  font: 13px/1 var(--body);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.gh-toggle:hover { color: var(--paper); border-color: var(--brass-line); }
.gh-toggle[aria-pressed="true"] { border-color: var(--brass-line); background: var(--brass-wash); color: var(--brass-hi); }

.gh-select {
  width: 100%;
  height: 30px;
  padding: 0 28px 0 9px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: var(--ink-deep) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%23ab9e85' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E") no-repeat right 9px center;
  color: var(--paper);
  font: 13.5px/1 var(--body);
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.gh-select:hover { border-color: var(--brass-line); }
.gh-select option { background: var(--ink-solid); color: var(--paper); }
.gh-select.mini { width: auto; height: 24px; padding: 0 22px 0 6px; font-size: 12px; background-position: right 6px center; }
.gh-bar .gh-select { width: auto; }

.gh-range { display: flex; align-items: center; gap: 8px; }
.gh-range input { flex: 1; }
.gh-range span { width: 38px; text-align: right; font: 12px var(--mono); color: var(--paper); }

/* every studio range on V1's track: a thin rail, a brass-hi thumb in an ink ring, a glow on focus */
.gh input[type="range"]:not(.ui-range) { height: 20px; margin: 0; background: transparent; appearance: none; -webkit-appearance: none; cursor: pointer; }
.gh input[type="range"]:not(.ui-range):focus-visible { outline: none; }
.gh input[type="range"]:not(.ui-range)::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: rgba(243, 233, 212, 0.18); }
.gh input[type="range"]:not(.ui-range)::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(243, 233, 212, 0.18); }
.gh input[type="range"]:not(.ui-range)::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--brass); }
.gh input[type="range"]:not(.ui-range)::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%; background: var(--brass-hi); border: 3px solid var(--ink-solid); box-shadow: 0 0 0 1px var(--brass); }
.gh input[type="range"]:not(.ui-range)::-moz-range-thumb { width: 8px; height: 8px; border-radius: 50%; background: var(--brass-hi); border: 3px solid var(--ink-solid); box-shadow: 0 0 0 1px var(--brass); }
.gh input[type="range"]:not(.ui-range):focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 1px var(--brass), 0 0 0 5px rgba(241, 213, 144, 0.5); }
`

const CSS = /* css */ `
${TOKENS_CSS}
${CONTROLS}

.gh-panel {
  background: var(--ink);
  border: 1px solid var(--brass-line);
  border-radius: var(--r);
  box-shadow: var(--shadow);
  backdrop-filter: blur(6px);
  min-height: 0;
}
.gh-eyebrow {
  margin: 0;
  color: var(--brass);
  font: 500 10.5px/1.2 var(--mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

/* ── browser layout ─────────────────────────────────────────────── */
.gh-browser {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 228px minmax(0, 1fr) 480px;
  gap: 12px;
  padding: 12px;
  background:
    radial-gradient(1200px 700px at 30% -10%, rgba(220, 182, 98, 0.07), transparent 60%),
    linear-gradient(#1b1611, #100c09);
  overflow: hidden;
}

/* ── rail ───────────────────────────────────────────────────────── */
.gh-rail { display: flex; flex-direction: column; overflow: hidden; }
.gh-rail-head { padding: 12px 12px 10px; border-bottom: 1px solid var(--hair); }
.gh-brand { margin: 0 0 10px; font: 400 17px/1 var(--display); letter-spacing: 0.08em; color: var(--paper); }
.gh-brand span { color: var(--brass); }
.gh-search {
  width: 100%;
  padding: 7px 9px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: rgba(0, 0, 0, 0.28);
  outline: none;
  font: 13px/1.2 var(--mono) !important;
}
.gh-search:focus { border-color: var(--brass-line); background: rgba(0, 0, 0, 0.4); }
.gh-search::placeholder { color: var(--faint); }
.gh-rail-body { overflow-y: auto; padding: 4px 6px 10px; }
.gh-group { padding: 8px 0 2px; }
.gh-group + .gh-group { border-top: 1px solid var(--hair); }
.gh-group > .gh-eyebrow { padding: 2px 6px 5px; }
.gh-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
}
.gh-opt:hover { background: var(--raise-2); color: var(--paper); }
.gh-opt[aria-pressed="true"] { background: var(--brass-wash); color: var(--brass-hi); }
.gh-opt[data-empty="true"] { opacity: 0.38; }
.gh-opt .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gh-opt .count { font: 11.5px var(--mono); color: var(--faint); font-variant-numeric: tabular-nums; }
.gh-opt[aria-pressed="true"] .count { color: var(--brass); }
.gh-opt .dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }

/* ── grid ───────────────────────────────────────────────────────── */
.gh-main { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.gh-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--hair);
  flex-wrap: wrap;
}
.gh-bar .total { font: 500 13px var(--mono); color: var(--paper); }
.gh-bar .of { font: 12px var(--mono); color: var(--faint); margin-right: 4px; }
.gh-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--brass-line);
  background: var(--brass-wash);
  color: var(--brass-hi);
  font: 11.5px/1.5 var(--mono);
  cursor: pointer;
}
.gh-chip::after { content: "×"; color: var(--brass); }
.gh-scroll { position: relative; flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 12px; }
.gh-tile {
  position: absolute;
  display: flex;
  flex-direction: column;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair);
  background: var(--raise);
  cursor: pointer;
  overflow: hidden;
  padding: 0;
  text-align: left;
}
.gh-tile:hover { border-color: var(--hair-2); background: var(--raise-2); }
.gh-tile[aria-pressed="true"] { border-color: var(--brass); box-shadow: 0 0 0 1px var(--brass) inset; }
.gh-thumb {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 40%, rgba(255, 238, 205, 0.08), transparent 70%);
}
.gh-thumb img { position: absolute; inset: 6px; width: calc(100% - 12px); height: calc(100% - 12px); object-fit: contain; }
.gh-ph { display: grid; place-items: center; gap: 2px; text-align: center; }
.gh-ph .cat { font: 500 9.5px var(--mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); }
.gh-ph .h { font: 500 18px var(--mono); color: var(--muted); }
.gh-ph .h small { font-size: 11px; color: var(--faint); margin-left: 2px; }
.gh-strip { position: absolute; left: 8px; right: 8px; bottom: 6px; display: flex; height: 4px; border-radius: 2px; overflow: hidden; }
.gh-strip i { flex: 1; }
.gh-flagmark { position: absolute; top: 6px; right: 6px; display: flex; gap: 3px; }
.gh-flagmark i { width: 7px; height: 7px; border-radius: 50%; }
.gh-cap { padding: 5px 8px 6px; border-top: 1px solid var(--hair); }
.gh-cap .name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; color: var(--paper); }
.gh-cap .meta { display: flex; gap: 6px; font: 10.5px var(--mono); color: var(--faint); white-space: nowrap; }
.gh-cap .meta .pack { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.gh-cap .meta .h { flex: none; color: var(--muted); }

.gh-empty { display: grid; place-content: center; gap: 8px; height: 100%; text-align: center; color: var(--muted); }
.gh-empty h2 { margin: 0; font: 400 22px var(--display); letter-spacing: 0.06em; color: var(--paper); }
.gh-empty p { margin: 0; }
.gh-empty code { font: 13px var(--mono); color: var(--brass-hi); background: rgba(0, 0, 0, 0.3); padding: 2px 6px; border-radius: 4px; }

/* ── inspector ──────────────────────────────────────────────────── */
.gh-inspector { display: flex; flex-direction: column; overflow: hidden; }
.gh-ins-head { padding: 11px 14px 10px; border-bottom: 1px solid var(--hair); }
.gh-ins-head h2 { margin: 2px 0 2px; font: 400 19px/1.15 var(--display); letter-spacing: 0.05em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gh-ins-head .id { font: 11.5px var(--mono); color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gh-stage { position: relative; flex: none; height: 340px; margin: 10px 10px 0; border-radius: var(--r-sm); overflow: hidden; border: 1px solid var(--hair-2); }
.gh-stage-host { position: absolute; inset: 0; }
.gh-tools { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; }
.gh-tools .gh-tool { background: rgba(20, 15, 11, 0.82); border-color: var(--hair-2); }
.gh-tools .gh-tool[aria-pressed="true"] { background: rgba(48, 36, 18, 0.9); border-color: var(--brass-line); }
.gh-hint {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 3px 8px;
  border-radius: var(--r-sm);
  background: rgba(20, 15, 11, 0.78);
  color: var(--muted);
  font: 12px/1.4 var(--body);
}
.gh-stats { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 14px 12px; }
.gh-sec { padding: 9px 0 8px; }
.gh-sec + .gh-sec { border-top: 1px solid var(--hair); }
.gh-sec > .gh-eyebrow { margin-bottom: 6px; }
.gh-kv { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 14px; }
.gh-kv div { min-width: 0; }
.gh-kv dt { font-size: 11.5px; color: var(--faint); }
.gh-kv dd { margin: 0; font: 500 13px var(--mono); color: var(--paper); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gh-kv dd small { color: var(--faint); font-weight: 400; margin-left: 2px; }
.gh-kv dd.ph { color: var(--warn); }
.gh-swatches { display: flex; flex-wrap: wrap; gap: 4px; }
.gh-sw { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 3px; border-radius: 4px; background: var(--raise); border: 1px solid var(--hair); font: 11px var(--mono); color: var(--muted); }
.gh-sw i { width: 14px; height: 14px; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35) inset; }
.gh-flags { display: flex; flex-wrap: wrap; gap: 4px; }
.gh-flag { padding: 1px 7px; border-radius: 999px; font: 11px/1.6 var(--mono); border: 1px solid; }
.gh-flag[data-tone="scale"] { color: var(--warn); border-color: rgba(255, 196, 81, 0.4); background: rgba(255, 196, 81, 0.08); }
.gh-flag[data-tone="piece"] { color: var(--fail); border-color: rgba(255, 139, 123, 0.4); background: rgba(255, 139, 123, 0.08); }
.gh-flag[data-tone="ok"] { color: #a6dd8f; border-color: rgba(166, 221, 143, 0.35); background: rgba(166, 221, 143, 0.07); }
.gh-lead { margin: 0 0 10px; color: var(--muted); }
.gh-lead .num { color: var(--brass-hi); }
.gh-kv dt small { color: var(--faint); opacity: 0.8; margin-left: 2px; }

/* ── animation ──────────────────────────────────────────────────── */
.gh-anim {
  position: absolute;
  left: 6px;
  top: 6px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--brass-line);
  background: rgba(20, 15, 11, 0.78);
  color: var(--brass-hi);
  font: 10px/1.6 var(--mono);
}
.gh-transport { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.gh-now { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 12.5px var(--mono); color: var(--brass-hi); }
.gh-time { font-size: 11px; color: var(--faint); white-space: nowrap; }
.gh-slider { display: grid; grid-template-columns: 44px minmax(0, 1fr) 48px; align-items: center; gap: 8px; font-size: 11.5px; color: var(--faint); }
.gh-slider input { width: 100%; }
.gh-slider .num { text-align: right; font-size: 11.5px; color: var(--paper); }
.gh-player .gh-search { margin-top: 6px; }
.gh-clips { max-height: 230px; overflow-y: auto; margin-top: 4px; }
.gh-clips .gh-group { padding: 6px 0 2px; }
.gh-clips .gh-group > .gh-eyebrow { padding: 2px 6px 4px; }
.gh-clips .gh-group > .gh-eyebrow .num { color: var(--faint); margin-left: 4px; }

/* ── scale scene legend ─────────────────────────────────────────── */
.gh-legend { position: absolute; top: 12px; left: 12px; width: 320px; padding: 11px 13px 10px; pointer-events: none; }
.gh-legend h1 { margin: 2px 0 8px; font: 400 18px/1.1 var(--display); letter-spacing: 0.06em; }
.gh-legend ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; }
.gh-legend li { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: 6px; font-size: 12.5px; color: var(--muted); }
.gh-legend li > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gh-legend li small { color: var(--faint); font: 10.5px var(--mono); margin-left: 4px; }
.gh-legend li .n { font: 11px var(--mono); color: var(--faint); }
.gh-legend li .v { font: 500 12px var(--mono); color: var(--paper); }
.gh-legend li[data-missing="true"] { color: var(--faint); font-style: italic; }
.gh-legend .key { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--hair); font: 11px var(--mono); color: var(--faint); }
.gh-legend .key i { width: 18px; height: 8px; background: rgba(217, 130, 43, 0.55); border-radius: 2px; }
`

let users = 0
let nodes: HTMLElement[] = []
let loaded: Promise<void> = Promise.resolve()

/**
 * Adds the stylesheet and fonts while at least one screen holds them. `ready` settles once the fonts
 * have loaded, or after `ms` (offline, the fallback faces are used).
 */
export function holdStudioStyle(ms = 3000): { ready: Promise<void>; release(): void } {
  if (users++ === 0) {
    const style = document.createElement("style")
    style.dataset.gh = "studio"
    style.textContent = CSS
    const fonts = document.createElement("link")
    fonts.rel = "stylesheet"
    fonts.href = FONTS
    const sheet = new Promise<void>((done) => {
      fonts.onload = () => done()
      fonts.onerror = () => done()
    })
    document.head.append(fonts, style)
    nodes = [fonts, style]
    const faces = sheet.then(() => Promise.all(FACES.map((face) => document.fonts.load(face))))
    loaded = Promise.race([faces.then(() => undefined), new Promise<void>((done) => setTimeout(done, ms))])
  }
  let released = false
  return {
    ready: loaded.catch(() => undefined),
    release() {
      if (released) return
      released = true
      if (--users > 0) return
      for (const node of nodes) node.remove()
      nodes = []
    },
  }
}
