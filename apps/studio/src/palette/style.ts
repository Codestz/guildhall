/** The palette screen's own layout, on top of the studio panel look (`browser/style.ts`'s `.gh` tokens). */
const CSS = /* css */ `
.gh-pal {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 404px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  background:
    radial-gradient(1200px 700px at 30% -10%, rgba(220, 182, 98, 0.07), transparent 60%),
    linear-gradient(#1b1611, #100c09);
  overflow: hidden;
}
.gh-pal-side { display: flex; flex-direction: column; overflow: hidden; }
.gh-pal-head { padding: 12px 14px 10px; border-bottom: 1px solid var(--hair); }
.gh-pal-head h1 { margin: 3px 0 4px; font: 400 19px/1.1 var(--display); letter-spacing: 0.06em; }
.gh-pal-head p { margin: 0; color: var(--muted); font-size: 12.5px; }
.gh-pal-head .num { color: var(--brass-hi); }
.gh-pal-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
.gh-pal-chip {
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--hair-2);
  background: var(--raise);
  color: var(--muted);
  font: 11.5px/1.6 var(--mono);
  cursor: pointer;
}
.gh-pal-chip:hover { border-color: var(--brass-line); color: var(--paper); }
.gh-pal-chip[aria-pressed="true"] { background: var(--brass-wash); border-color: var(--brass-line); color: var(--brass-hi); }
.gh-pal-btn {
  margin-left: auto;
  padding: 3px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--brass-line);
  background: var(--brass-wash);
  color: var(--brass-hi);
  font: 500 11.5px/1.6 var(--mono);
  cursor: pointer;
}
.gh-pal-btn:hover { background: rgba(220, 182, 98, 0.26); }
.gh-pal-list { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 10px 12px; }
.gh-pal-group { margin: 10px 4px 4px; }
.gh-pal-ramp {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(3, 76px);
  align-items: center;
  gap: 5px;
  padding: 3px 4px;
  border-radius: var(--r-sm);
}
.gh-pal-ramp:hover { background: var(--raise); }
.gh-pal-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.gh-pal-name small { display: block; white-space: normal; color: var(--faint); font: 10.5px/1.3 var(--mono); }
.gh-pal-name small[data-swap] { color: var(--warn); }
.gh-pal-sw {
  position: relative;
  display: grid;
  grid-template-rows: 22px auto;
  gap: 2px;
  padding: 3px;
  border-radius: 5px;
  border: 1px solid var(--hair);
  background: rgba(0, 0, 0, 0.18);
  cursor: pointer;
  text-align: left;
}
.gh-pal-sw:hover { border-color: var(--brass-line); }
.gh-pal-sw[aria-pressed="true"] { border-color: var(--brass-hi); box-shadow: 0 0 0 1px var(--brass-hi) inset; }
.gh-pal-sw i { display: block; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35) inset; }
.gh-pal-sw span { font: 10.5px/1.2 var(--mono); color: var(--muted); }
.gh-pal-sw[data-edited="true"]::after {
  content: "";
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brass-hi);
  box-shadow: 0 0 0 1px var(--ink-solid);
}
.gh-pal-view { position: relative; min-width: 0; border-radius: var(--r); overflow: hidden; border: 1px solid var(--brass-line); }
.gh-pal-stage { position: absolute; inset: 0; }
.gh-pal-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.gh-pal-label {
  position: absolute;
  left: 0;
  top: 0;
  padding: 1px 7px;
  border-radius: 4px;
  background: rgba(21, 17, 13, 0.72);
  color: var(--paper);
  font: 10.5px/1.5 var(--mono);
  white-space: nowrap;
}
.gh-pal-picker { position: absolute; top: 12px; left: 12px; width: 270px; padding: 11px 13px 12px; }
.gh-pal-picker h2 { margin: 3px 0 9px; font: 400 16px/1.1 var(--display); letter-spacing: 0.05em; }
.gh-pal-picker h2 small { margin-left: 6px; color: var(--faint); font: 11px var(--mono); letter-spacing: 0; }
.gh-pal-pick { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 8px; align-items: stretch; }
.gh-pal-pick input[type="color"] {
  width: 56px;
  height: 56px;
  padding: 0;
  border: 1px solid var(--hair-2);
  border-radius: var(--r-sm);
  background: none;
  cursor: pointer;
}
.gh-pal-pick input[type="text"] {
  width: 100%;
  padding: 5px 8px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: rgba(0, 0, 0, 0.3);
  font: 500 14px var(--mono);
}
.gh-pal-pick input[aria-invalid="true"] { border-color: var(--fail); }
.gh-pal-pick p { margin: 5px 0 0; color: var(--faint); font: 10.5px/1.4 var(--mono); }
.gh-pal-pick button { margin-top: 6px; }
.gh-pal-export {
  position: absolute;
  inset: 40px 12% auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: calc(100% - 80px);
  padding: 12px 14px;
}
.gh-pal-export[hidden], .gh-pal-picker[hidden] { display: none; }
.gh-pal-export header { display: flex; align-items: center; gap: 8px; }
.gh-pal-export h2 { margin: 0; font: 400 16px/1.1 var(--display); letter-spacing: 0.05em; }
.gh-pal-export p { margin: 0; color: var(--muted); font-size: 12.5px; }
.gh-pal-export textarea {
  flex: 1;
  min-height: 300px;
  resize: none;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--hair-2);
  background: rgba(0, 0, 0, 0.35);
  color: var(--paper);
  font: 11.5px/1.45 var(--mono);
}
`

/** Adds the stylesheet; returns its removal. */
export function addPaletteStyle(): () => void {
  const style = document.createElement("style")
  style.dataset.gh = "palette"
  style.textContent = CSS
  document.head.append(style)
  return () => style.remove()
}
