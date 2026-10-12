/**
 * The studio panels' look, carried over from V1's HUD (legacy/packages/hall/src/hall.css): warm ink
 * plaques with brass hairlines, JetBrains Mono for every number. Injected while a screen that uses it
 * is mounted.
 */

/** V1's faces: Marcellus SC for titles, Alegreya Sans for text, JetBrains Mono for numbers. */
const FONTS =
  "https://fonts.googleapis.com/css2?family=Marcellus+SC&family=Alegreya+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;500;600&display=swap"

const CSS = /* css */ `
.gh {
  --ink: rgba(20, 15, 11, 0.86);
  --ink-solid: #15110d;
  --raise: rgba(255, 238, 205, 0.05);
  --raise-2: rgba(255, 238, 205, 0.09);
  --hair: rgba(243, 233, 212, 0.1);
  --hair-2: rgba(243, 233, 212, 0.16);
  --paper: #f3e9d4;
  --muted: #cdbfa3;
  --faint: #ab9e85;
  --brass: #dcb662;
  --brass-hi: #f1d590;
  --brass-line: rgba(220, 182, 98, 0.34);
  --brass-wash: rgba(220, 182, 98, 0.16);
  --warn: #ffc451;
  --fail: #ff8b7b;
  --display: "Marcellus SC", "Cormorant SC", Georgia, serif;
  --body: "Alegreya Sans", "Gill Sans", "Trebuchet MS", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --r: 7px;
  --r-sm: 5px;
  --shadow: 0 1px 0 rgba(255, 240, 210, 0.06) inset, 0 18px 40px -18px rgba(0, 0, 0, 0.7),
    0 2px 8px rgba(0, 0, 0, 0.28);
  font: 14px/1.4 var(--body);
  color: var(--paper);
  -webkit-font-smoothing: antialiased;
}
.gh *, .gh *::before, .gh *::after { box-sizing: border-box; }
.gh button, .gh input { font: inherit; color: inherit; }
.gh ::-webkit-scrollbar { width: 8px; height: 8px; }
.gh ::-webkit-scrollbar-thumb { background: var(--hair-2); border-radius: 4px; }
.gh ::-webkit-scrollbar-track { background: transparent; }
.gh .num { font-family: var(--mono); font-variant-numeric: tabular-nums; }

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
.gh-tool {
  padding: 3px 9px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: rgba(20, 15, 11, 0.8);
  color: var(--muted);
  font: 11px/1.5 var(--mono) !important;
  cursor: pointer;
}
.gh-tool:hover { color: var(--paper); }
.gh-tool[aria-pressed="true"] { border-color: var(--brass-line); color: var(--brass-hi); background: rgba(48, 36, 18, 0.88); }
.gh-hint {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 3px 8px;
  border-radius: var(--r-sm);
  background: rgba(20, 15, 11, 0.72);
  color: var(--muted);
  font: 11px var(--mono);
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

/** Faces the panels use, loaded before a screen reports ready so shots never catch the fallback. */
const FACES = ['400 17px "Marcellus SC"', '400 14px "Alegreya Sans"', '500 13px "JetBrains Mono"']

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
