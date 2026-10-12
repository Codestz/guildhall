/**
 * The composer's own layout and controls, on top of the studio panels' look (browser/style.ts, which
 * owns the tokens and faces). Injected while the composer is mounted.
 */

const CSS = /* css */ `
.gh-composer {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 288px;
  gap: 12px;
  padding: 12px;
  background:
    radial-gradient(1200px 700px at 30% -10%, rgba(220, 182, 98, 0.07), transparent 60%),
    linear-gradient(#1b1611, #100c09);
  overflow: hidden;
}
.gh-composer.empty { display: block; }
.gh-col { display: flex; flex-direction: column; overflow: hidden; }
.gh-col-head { padding: 12px 12px 10px; border-bottom: 1px solid var(--hair); display: grid; gap: 7px; }
.gh-col-head .gh-brand { margin: 0 0 3px; }
.gh-col-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 12px; }
.gh-col-foot { flex: none; max-height: 45%; overflow-y: auto; padding: 8px 12px 12px; border-top: 1px solid var(--hair); }
.gh-composer .gh-sec-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
.gh-composer .gh-sec-head .gh-eyebrow { margin: 0; }
.gh-aside { font: 10.5px var(--mono); color: var(--faint); }
.gh-composer .pad { padding: 12px; }

.gh-field { display: grid; grid-template-columns: 62px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 28px; }
.gh-field + .gh-field { margin-top: 4px; }
.gh-field-label { font-size: 12.5px; color: var(--faint); }
.gh-field-body { min-width: 0; }

.gh-seg { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px; border-radius: var(--r-sm); background: rgba(0, 0, 0, 0.26); border: 1px solid var(--hair); }
.gh-seg button {
  flex: 1 0 auto;
  padding: 3px 7px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font: 11.5px/1.4 var(--mono) !important;
  cursor: pointer;
}
.gh-seg button:hover { color: var(--paper); background: var(--raise-2); }
.gh-seg button[aria-pressed="true"] { background: var(--brass-wash); color: var(--brass-hi); box-shadow: 0 0 0 1px var(--brass-line) inset; }

.gh-step { display: inline-flex; align-items: center; border-radius: var(--r-sm); border: 1px solid var(--hair-2); background: rgba(0, 0, 0, 0.26); }
.gh-step button { width: 26px; height: 26px; border: 0; background: transparent; color: var(--brass); cursor: pointer; font: 500 14px var(--mono) !important; }
.gh-step button:hover:not(:disabled) { color: var(--brass-hi); background: var(--raise-2); }
.gh-step button:disabled { color: var(--faint); opacity: 0.4; cursor: default; }
.gh-step span { min-width: 30px; padding: 0 4px; text-align: center; font: 500 13px var(--mono); color: var(--paper); }
.gh-step span small { color: var(--faint); font-weight: 400; }

.gh-select {
  width: 100%;
  padding: 5px 7px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: rgba(0, 0, 0, 0.32);
  color: var(--paper);
  font: 12px/1.3 var(--mono);
  outline: none;
}
.gh-select:focus { border-color: var(--brass-line); }
.gh-select.mini { width: auto; padding: 1px 4px; font-size: 11px; }
.gh-bar .gh-select { width: auto; }

.gh-storey { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 8px; align-items: start; margin-top: 7px; }
.gh-storey-n { margin-top: 4px; font: 600 12px var(--mono); color: var(--brass); text-align: center; }
.gh-storey-body { display: grid; gap: 3px; }

.gh-range { display: flex; align-items: center; gap: 8px; }
.gh-range input { flex: 1; accent-color: var(--brass); }
.gh-range span { width: 38px; text-align: right; font: 12px var(--mono); color: var(--paper); }

.gh-chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.gh-toggle {
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--hair-2);
  background: transparent;
  color: var(--muted);
  font: 11.5px/1.5 var(--mono) !important;
  cursor: pointer;
}
.gh-toggle:hover { color: var(--paper); }
.gh-toggle[aria-pressed="true"] { border-color: var(--brass-line); background: var(--brass-wash); color: var(--brass-hi); }
.gh-ramp { display: grid; gap: 4px; margin-bottom: 7px; }
.gh-ramp .from { font-size: 11.5px; color: var(--paper); }
.gh-ramp .from::after { content: " →"; color: var(--brass); }

.gh-hint-line { margin: 0 0 6px; font-size: 12px; color: var(--faint); }
.gh-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.gh-list li { display: flex; align-items: center; gap: 8px; padding: 2px 4px 2px 6px; border-radius: 4px; font-size: 12.5px; color: var(--muted); }
.gh-list li .num { font-size: 11px; color: var(--faint); flex: none; }
.gh-list li .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gh-list li:hover { background: var(--raise-2); }
.gh-list li[data-selected="true"] { background: var(--brass-wash); color: var(--brass-hi); }
.gh-list .pick { flex: 1; min-width: 0; display: flex; gap: 8px; align-items: center; padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer; color: inherit; }
.gh-x { flex: none; width: 20px; height: 20px; border: 0; border-radius: 4px; background: transparent; color: var(--faint); cursor: pointer; }
.gh-x:hover { color: var(--fail); background: rgba(255, 139, 123, 0.1); }
.gh-gizmo { display: grid; gap: 6px; margin-top: 10px; }

.gh-hits { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 92px; gap: 6px; align-content: start; }
.gh-hit {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair);
  background: var(--raise);
  cursor: pointer;
  overflow: hidden;
  text-align: left;
}
.gh-hit:hover { border-color: var(--brass-line); background: var(--raise-2); }
.gh-hit img, .gh-hit i { flex: 1; min-height: 0; width: 100%; object-fit: contain; padding: 4px; }
.gh-hit .name { padding: 2px 5px 3px; font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-top: 1px solid var(--hair); }
.gh-hit .h { position: absolute; top: 3px; right: 4px; font-size: 9.5px; color: var(--faint); }

.gh-composer .gh-main { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.gh-bar-gap { flex: 1; }
.gh-composer .gh-tool { font-size: 12px !important; padding: 4px 10px; }
.gh-save { border-color: var(--brass-line) !important; color: var(--brass-hi) !important; }
.gh-save:disabled { opacity: 0.4; cursor: default; }
.gh-view { position: relative; flex: 1; min-height: 0; overflow: hidden; border-radius: 0 0 var(--r) var(--r); }
.gh-readout {
  position: absolute;
  left: 10px;
  bottom: 10px;
  max-width: min(560px, calc(100% - 20px));
  padding: 8px 12px 7px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: rgba(20, 15, 11, 0.84);
  backdrop-filter: blur(4px);
}
.gh-readout[data-tone="fail"] { border-color: rgba(255, 139, 123, 0.45); }
.gh-readout .gh-kv { grid-template-columns: repeat(5, auto); gap: 2px 18px; }
.gh-problems { margin: 0 0 4px; padding: 0 0 0 16px; color: var(--fail); font: 12px/1.45 var(--mono); }
.gh-status { margin: 5px 0 0; font: 11px var(--mono); color: var(--faint); }
.gh-status[data-tone="ok"] { color: #a6dd8f; }
.gh-status[data-tone="warn"] { color: var(--warn); }
.gh-status[data-tone="fail"] { color: var(--fail); }
`

let users = 0
let node: HTMLStyleElement | null = null

/** Adds the composer's stylesheet while at least one composer holds it. */
export function holdComposerStyle(): { release(): void } {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "composer"
    node.textContent = CSS
    document.head.append(node)
  }
  let released = false
  return {
    release() {
      if (released) return
      released = true
      if (--users > 0) return
      node?.remove()
      node = null
    },
  }
}
