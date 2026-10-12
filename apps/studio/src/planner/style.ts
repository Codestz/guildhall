/** The town planner's panels, on the studio's `.gh` tokens (browser/style.ts: V1's HUD look). */
const CSS = /* css */ `
.gh-planner { position: absolute; inset: 0; overflow: hidden; background: #120e0a; }
.gh-planner canvas.map { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
.gh-planner canvas.map:focus-visible { outline: 2px solid var(--brass-hi); outline-offset: -4px; }
.gh-planner :focus-visible { outline: 2px solid var(--brass-hi); outline-offset: 2px; }

.gh-pl-controls, .gh-pl-stats {
  position: absolute;
  top: 12px;
  display: flex;
  flex-direction: column;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.gh-pl-controls { left: 12px; width: 288px; }
.gh-pl-stats { right: 12px; width: 258px; max-height: calc(100% - 150px); }
.gh-pl-sec { padding: 11px 14px 12px; }
.gh-pl-sec + .gh-pl-sec { border-top: 1px solid var(--hair); }
.gh-pl-sec > .gh-eyebrow { margin-bottom: 8px; display: flex; justify-content: space-between; align-items: baseline; }
.gh-pl-sec > .gh-eyebrow .hint { color: var(--faint); letter-spacing: 0.04em; text-transform: none; font-size: 10.5px; }

.gh-pl-title { margin: 6px 0 0; font: 400 21px/1.1 var(--display); letter-spacing: 0.05em; color: var(--paper); }
.gh-pl-title span { color: var(--brass); }
.gh-pl-sub { margin: 6px 0 0; font: 12px/1.4 var(--mono); color: var(--faint); font-variant-numeric: tabular-nums; }
.gh-pl-sub b { color: var(--muted); font-weight: 500; }

.gh-pl-row { display: flex; align-items: center; gap: 6px; }
.gh-pl-row + .gh-pl-row { margin-top: 8px; }
.gh-pl-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 30px; min-width: 30px; padding: 0 10px;
  border: 1px solid var(--hair-2); border-radius: var(--r-sm);
  background: var(--raise); color: var(--muted);
  font: 500 12.5px/1 var(--body); cursor: pointer;
}
.gh-pl-btn:hover { border-color: var(--brass-line); color: var(--paper); background: var(--raise-2); }
.gh-pl-btn[aria-pressed="true"] { background: var(--brass-wash); border-color: var(--brass-line); color: var(--brass-hi); }
.gh-pl-btn.primary { border-color: var(--brass-line); color: var(--paper); }
.gh-pl-btn.grow { flex: 1; }
.gh-pl-btn svg { flex: none; }
.gh-pl-seed {
  flex: 1; min-width: 0; height: 30px; padding: 0 8px; text-align: center;
  border: 1px solid var(--hair-2); border-radius: var(--r-sm); background: rgba(0, 0, 0, 0.3);
  font: 500 15px/1 var(--mono) !important; color: var(--paper); font-variant-numeric: tabular-nums;
}
.gh-pl-seed:focus { border-color: var(--brass-line); outline: none; }
.gh-pl-seed::-webkit-inner-spin-button { display: none; }

.gh-pl-seg { display: flex; padding: 2px; gap: 2px; border: 1px solid var(--hair-2); border-radius: var(--r-sm); background: rgba(0, 0, 0, 0.28); }
.gh-pl-seg button {
  flex: 1; min-width: 0; height: 26px; padding: 0 4px; border: 0; border-radius: 3px;
  background: transparent; color: var(--muted); font: 500 12px/1 var(--body); cursor: pointer; white-space: nowrap;
}
.gh-pl-seg button:hover { color: var(--paper); background: var(--raise-2); }
.gh-pl-seg button[aria-checked="true"] { background: var(--brass-wash); color: var(--brass-hi); box-shadow: inset 0 0 0 1px var(--brass-line); }

.gh-pl-field { display: grid; grid-template-columns: 62px minmax(0, 1fr); align-items: center; gap: 8px; }
.gh-pl-field + .gh-pl-field { margin-top: 8px; }
.gh-pl-field > span { font: 500 10.5px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.gh-pl-select {
  height: 30px; padding: 0 8px; border: 1px solid var(--hair-2); border-radius: var(--r-sm);
  background: #1c1610; color: var(--paper); font: 13px/1 var(--body);
}

.gh-pl-layers { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.gh-pl-layer {
  display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 8px;
  border: 1px solid transparent; border-radius: var(--r-sm); background: transparent;
  color: var(--muted); font: 13px/1 var(--body); text-align: left; cursor: pointer;
}
.gh-pl-layer:hover { background: var(--raise-2); color: var(--paper); }
.gh-pl-layer .box {
  flex: none; width: 13px; height: 13px; border-radius: 3px; border: 1px solid var(--hair-2);
  display: grid; place-content: center; background: rgba(0, 0, 0, 0.3);
}
.gh-pl-layer[aria-pressed="true"] { color: var(--paper); }
.gh-pl-layer[aria-pressed="true"] .box { background: var(--brass); border-color: var(--brass); }
.gh-pl-layer[aria-pressed="true"] .box::after { content: ""; width: 7px; height: 4px; border: solid #1b150f; border-width: 0 0 2px 2px; transform: translate(0, -1px) rotate(-45deg); }
.gh-pl-layer .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gh-pl-layer .count { font: 10.5px/1 var(--mono); color: var(--faint); font-variant-numeric: tabular-nums; }
.gh-pl-layer[data-empty="true"] .label { color: var(--faint); font-style: italic; }
.gh-pl-layer[data-empty="true"] .count { opacity: 0.8; }

.gh-pl-stat { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 2.5px 0; font-size: 13px; color: var(--muted); }
.gh-pl-stat .v { font: 500 12.5px/1.2 var(--mono); color: var(--paper); font-variant-numeric: tabular-nums; text-align: right; }
.gh-pl-stat .v small { color: var(--faint); font-weight: 400; }
.gh-pl-meter { position: relative; height: 8px; margin: 6px 0 4px; border-radius: 4px; background: rgba(0, 0, 0, 0.35); box-shadow: inset 0 0 0 1px var(--hair); }
.gh-pl-meter .fill { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: linear-gradient(90deg, #a0742e, var(--brass)); }
.gh-pl-meter[data-ok="true"] .fill { background: linear-gradient(90deg, #4f8a3a, #8fdc7a); }
.gh-pl-meter .mark { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--paper); border-radius: 1px; }
.gh-pl-note { margin: 2px 0 0; font: 11.5px/1.35 var(--body); color: var(--faint); }
.gh-pl-note.warn { color: var(--warn); }

.gh-pl-time { display: grid; grid-template-columns: 78px minmax(0, 1fr) 52px; align-items: center; gap: 8px; padding: 2px 0; font-size: 12.5px; color: var(--muted); }
.gh-pl-time .bar { height: 6px; border-radius: 3px; background: rgba(0, 0, 0, 0.35); overflow: hidden; }
.gh-pl-time .bar i { display: block; height: 100%; background: var(--brass); opacity: 0.85; border-radius: 3px; }
.gh-pl-time .v { font: 11.5px/1 var(--mono); color: var(--paper); text-align: right; font-variant-numeric: tabular-nums; }
.gh-pl-hover { min-height: 34px; font: 12px/1.4 var(--mono); color: var(--muted); }

.gh-pl-strip {
  position: absolute; bottom: 12px; left: 312px; right: 282px;
  display: flex; align-items: stretch; gap: 8px; padding: 8px 10px;
  overflow-x: auto;
}
.gh-pl-strip .head { flex: none; display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 0 6px 0 2px; }
.gh-pl-strip .head .gh-eyebrow { white-space: nowrap; }
.gh-pl-strip .head p { margin: 0; font: 11.5px/1.3 var(--body); color: var(--faint); max-width: 96px; }
.gh-pl-thumb {
  flex: 1 1 0; min-width: 96px; max-width: 168px; padding: 0; border: 1px solid var(--hair-2); border-radius: var(--r-sm);
  background: #120e0a; cursor: pointer; overflow: hidden; display: flex; flex-direction: column;
  transition: border-color 0.12s, transform 0.12s;
}
.gh-pl-thumb:hover { border-color: var(--brass); transform: translateY(-2px); }
.gh-pl-thumb canvas { display: block; width: 100%; aspect-ratio: 4 / 3; }
.gh-pl-thumb .cap { display: flex; justify-content: space-between; padding: 4px 7px; font: 500 11px/1 var(--mono); color: var(--muted); border-top: 1px solid var(--hair); }
.gh-pl-thumb .cap b { color: var(--paper); font-weight: 500; }
.gh-pl-thumb .wait { display: grid; place-content: center; aspect-ratio: 4 / 3; color: var(--faint); font: 11px var(--mono); }

.gh-pl-busy { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); padding: 6px 12px; font: 12px var(--mono); color: var(--muted); pointer-events: none; }
.gh-pl-error { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); padding: 8px 14px; color: var(--fail); font: 13px var(--body); }

@media (max-width: 1100px) {
  .gh-pl-stats { display: none; }
  .gh-pl-strip { right: 12px; }
}
@media (max-width: 760px) {
  .gh-pl-controls { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 46%; }
  .gh-pl-strip { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .gh-pl-thumb { transition: none; }
  .gh-pl-thumb:hover { transform: none; }
}
`

let users = 0
let node: HTMLStyleElement | null = null

/** Adds the planner stylesheet while the planner is mounted. */
export function holdPlannerStyle(): { release(): void } {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "planner"
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
