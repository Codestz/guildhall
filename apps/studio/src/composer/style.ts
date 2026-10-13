/**
 * The tile composer's layout and the shared form controls (the NPC builder uses them too), on top of
 * the studio panels' look (browser/style.ts, which owns the tokens and faces). Injected while mounted.
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
  font: 13px/1.4 var(--body);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.gh-seg button:hover { color: var(--paper); background: var(--raise-2); }
/* V1's segmented control: the pressed one in brass (@guildhall/ui .ui-seg) */
.gh-seg button[aria-pressed="true"] { background: var(--brass); color: var(--on-brass); font-weight: 700; }
.gh-seg button:focus-visible { outline: 2px solid var(--brass-hi); outline-offset: 1px; }

.gh-step { display: inline-flex; align-items: center; border-radius: var(--r-sm); border: 1px solid var(--hair-2); background: rgba(0, 0, 0, 0.26); }
.gh-step button { width: 26px; height: 26px; border: 0; background: transparent; color: var(--brass); cursor: pointer; font: 500 14px var(--mono) !important; }
.gh-step button:hover:not(:disabled) { color: var(--brass-hi); background: var(--raise-2); }
.gh-step button:disabled { color: var(--faint); opacity: 0.4; cursor: default; }
.gh-step span { min-width: 30px; padding: 0 4px; text-align: center; font: 500 13px var(--mono); color: var(--paper); }
.gh-step span small { color: var(--faint); font-weight: 400; }

/* selects, ranges, chips and toggles: the studio's shared controls (browser/style.ts) */

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

/* ── tile composer ─────────────────────────────────────────────── */
.gh-tiles { grid-template-columns: 248px minmax(0, 1fr) 320px; }
.gh-tiles :focus-visible { outline: 2px solid var(--brass-hi); outline-offset: 1px; }
.gh-tiles .gh-col-body { padding: 4px 8px 10px; }
.gh-tiles .gh-group { padding: 8px 0 2px; }
.gh-tiles .gh-group + .gh-group { border-top: 1px solid var(--hair); }
.gh-tiles .gh-group > .gh-eyebrow { padding: 2px 6px 5px; }
.gh-tiles .gh-group > .gh-eyebrow .num { color: var(--faint); margin-left: 4px; letter-spacing: 0; }
.gh-tiles .gh-list li { min-height: 28px; }
.gh-tiles .gh-list .pick { min-height: 26px; }
.gh-row { display: flex; gap: 6px; flex-wrap: wrap; }
.gh-row .gh-tool { text-decoration: none; }
.gh-title {
  min-width: 0;
  width: min(30ch, 45%);
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  font: 400 17px/1.1 var(--display) !important;
  letter-spacing: 0.04em;
  color: var(--paper);
}
.gh-title:hover { border-color: var(--hair-2); }
.gh-title:focus { border-color: var(--brass-line); background: rgba(0, 0, 0, 0.3); outline: none; }
.gh-bar .of { font-size: 11px; color: var(--faint); }
.gh-bar-2 { flex-wrap: wrap; gap: 6px 14px; min-height: 40px; padding: 6px 12px; }
.gh-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--faint); }
.gh-inline .gh-seg button { flex: 0 0 auto; }
.gh-sep { width: 1px; height: 20px; background: var(--hair-2); }
.gh-try[aria-pressed="true"] { box-shadow: 0 0 0 1px var(--brass) inset; }
.gh-stage-host { position: absolute; inset: 0; }
.gh-legend {
  width: max-content;
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 10px;
  padding: 5px 10px;
  border-radius: var(--r-sm);
  background: rgba(20, 15, 11, 0.78);
  border: 1px solid var(--hair);
  font: 11px var(--mono);
  color: var(--muted);
  pointer-events: none;
}
.gh-legend span { display: inline-flex; align-items: center; white-space: nowrap; }
.gh-legend i { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 50%; vertical-align: -1px; }
.gh-legend i.ring { background: transparent; border: 2px solid #ff6e5a; }
.gh-warnings { margin: 0 0 4px; padding: 0 0 0 16px; color: var(--warn); font: 12px/1.45 var(--mono); }
.gh-readout[data-tone="warn"] { border-color: rgba(255, 196, 81, 0.4); }
.gh-tabs { display: flex; border-bottom: 1px solid var(--hair); padding: 6px 6px 0; gap: 2px; }
.gh-tabs button {
  flex: 1;
  padding: 8px 6px 7px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--muted);
  font: 500 11px/1 var(--mono) !important;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}
.gh-tabs button:hover { color: var(--paper); }
.gh-tabs button[aria-selected="true"] { color: var(--brass-hi); border-bottom-color: var(--brass); }
.gh-tabs .num { color: var(--faint); margin-left: 3px; letter-spacing: 0; }
.gh-layer { padding-top: 8px !important; }
.gh-add { margin-bottom: 8px; }
.gh-tiles .gh-col-foot { max-height: 62%; }
.gh-tiles .gh-inspect .gh-field { grid-template-columns: 48px minmax(0, 1fr); }
.dot { display: inline-block; flex: none; width: 9px; height: 9px; margin-right: 4px; border-radius: 50%; }
.gh-inspect { display: grid; gap: 8px; }
.gh-inspect .gh-sec-head { margin-bottom: 0; }
.gh-nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 8px; }
.gh-hours { display: grid; gap: 4px; }
.gh-num { display: flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 6px; border-radius: var(--r-sm); border: 1px solid var(--hair-2); background: rgba(0, 0, 0, 0.26); }
.gh-num:focus-within { border-color: var(--brass-line); }
.gh-num-label { flex: none; width: 3.6em; font: 11px var(--mono); color: var(--faint); }
.gh-num input { flex: 1; min-width: 0; padding: 4px 0; border: 0; background: transparent; outline: none; font: 12.5px var(--mono) !important; color: var(--paper); text-align: right; }
.gh-num-unit { flex: none; font: 11px var(--mono); color: var(--faint); }
.gh-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); }
.gh-check input { accent-color: var(--brass); }
.gh-toggle.danger:hover { border-color: rgba(255, 139, 123, 0.5); color: var(--fail); }
.gh-toggle .dot { margin-right: 5px; }
.gh-adder { display: grid; gap: 8px; }
.gh-adder .gh-hits { padding: 0; max-height: 300px; }
.gh-tiles .gh-hit { min-height: 44px; }
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
