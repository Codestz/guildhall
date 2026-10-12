/** The grip editor's layout, on top of the studio panel look (`browser/style.ts`'s `.gh` tokens). */
const CSS = /* css */ `
.gh-grip {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 372px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  background:
    radial-gradient(1200px 700px at 30% -10%, rgba(220, 182, 98, 0.07), transparent 60%),
    linear-gradient(#1b1611, #100c09);
  overflow: hidden;
}
.gh-grip-side { display: flex; flex-direction: column; overflow: hidden; }
.gh-grip-head { padding: 12px 14px 10px; border-bottom: 1px solid var(--hair); }
.gh-grip-head h1 { margin: 3px 0 2px; font: 400 19px/1.1 var(--display); letter-spacing: 0.06em; }
.gh-grip-head p:last-child { margin: 0; color: var(--faint); font: 11px/1.4 var(--mono); }
.gh-grip-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 8px; }
.gh-grip-sec { padding: 9px 2px 8px; border-bottom: 1px solid var(--hair); }
.gh-grip-sec > .gh-eyebrow { margin-bottom: 6px; }
.gh-grip-sec > .gh-eyebrow:not(:first-child) { margin-top: 8px; }
.gh-grip-bar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.gh-grip-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
.gh-grip-label { min-width: 54px; color: var(--muted); font: 11.5px/1.4 var(--mono); }
.gh-grip-bar .gh-grip-label { min-width: 0; margin: 0 2px 0 6px; }
.gh-grip-bar .gh-grip-label:first-child { margin-left: 0; }
.gh-grip-chip {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--hair-2);
  background: var(--raise);
  color: var(--muted);
  font: 11.5px/1.6 var(--mono);
  cursor: pointer;
}
.gh-grip-chip:hover:not(:disabled) { border-color: var(--brass-line); color: var(--paper); }
.gh-grip-chip[aria-pressed="true"] { background: var(--brass-wash); border-color: var(--brass-line); color: var(--brass-hi); }
.gh-grip-chip:disabled { opacity: 0.35; cursor: default; }
.gh-grip-vec { display: block; margin: 4px 0 2px; color: var(--faint); font-size: 11px; }
.gh-grip .gh-grip-num {
  width: 64px;
  padding: 2px 6px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: rgba(0, 0, 0, 0.25);
  font: 12px/1.5 var(--mono);
}
.gh-grip select {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: #241d16;
  color: var(--paper);
  font: 12px/1.5 var(--mono);
}
.gh-grip-range { flex: 1; accent-color: var(--brass); }
.gh-grip-row .num { min-width: 38px; text-align: right; color: var(--brass-hi); font-size: 12px; }
.gh-grip-check { display: inline-flex; align-items: center; gap: 5px; margin-right: 6px; color: var(--muted); font-size: 13px; }
.gh-grip-check input { accent-color: var(--brass); }
.gh-grip .gh-grip-search {
  flex: 1;
  min-width: 0;
  padding: 3px 8px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: rgba(0, 0, 0, 0.25);
  font-size: 13px;
}
.gh-grip-results { max-height: 168px; overflow-y: auto; margin-top: 6px; }
.gh-grip-result {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 2px 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.gh-grip-result small { color: var(--faint); font: 10.5px/1.9 var(--mono); white-space: nowrap; }
.gh-grip-result:hover { background: var(--raise); }
.gh-grip-result[aria-pressed="true"] { background: var(--brass-wash); color: var(--brass-hi); }
.gh-grip-foot { padding: 9px 14px 12px; border-top: 1px solid var(--hair); }
.gh-grip-problems { margin: 0 0 8px; padding: 6px 8px 6px 22px; border-radius: var(--r-sm); background: rgba(255, 139, 123, 0.1); color: var(--fail); font: 11.5px/1.5 var(--mono); }
.gh-grip-save {
  width: 100%;
  padding: 5px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--brass-line);
  background: var(--brass-wash);
  color: var(--brass-hi);
  font: 500 12px/1.6 var(--mono);
  cursor: pointer;
}
.gh-grip-save:hover:not(:disabled) { background: rgba(220, 182, 98, 0.26); }
.gh-grip-save:disabled { opacity: 0.5; cursor: default; }
.gh-grip-status { margin: 6px 0 0; color: var(--paper); font: 12px/1.4 var(--mono); }
.gh-grip-status:empty { display: none; }
.gh-grip-hint { margin: 6px 0 0; color: var(--faint); font-size: 12.5px; }
.gh-grip-hint code { color: var(--brass-hi); font: 11.5px var(--mono); }

.gh-grip-view { position: relative; min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 12px; }
.gh-grip-main { position: relative; min-height: 0; border-radius: var(--r); overflow: hidden; border: 1px solid var(--hair); }
.gh-grip-bench {
  z-index: 1;
  position: absolute;
  top: 12px;
  right: 12px;
  width: 300px;
  height: 300px;
  overflow: hidden;
}
.gh-grip-bench > .gh-eyebrow { position: absolute; z-index: 1; top: 8px; left: 10px; pointer-events: none; }
.gh-grip-bench-host { position: absolute; inset: 0; }
.gh-grip-legend { position: absolute; z-index: 1; bottom: 8px; left: 10px; display: flex; gap: 10px; font: 10.5px/1 var(--mono); color: var(--muted); pointer-events: none; }
.gh-grip-legend i { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border-radius: 2px; vertical-align: -1px; }
.gh-grip-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.gh-grip-tile { position: relative; height: 214px; overflow: hidden; }
.gh-grip-tile img { display: block; height: 100%; margin: 0 auto; }
.gh-grip-tile .gh-eyebrow { position: absolute; top: 8px; left: 10px; }
`

export function addGripStyle(): () => void {
  const style = document.createElement("style")
  style.dataset.gh = "grip"
  style.textContent = CSS
  document.head.append(style)
  return () => style.remove()
}
