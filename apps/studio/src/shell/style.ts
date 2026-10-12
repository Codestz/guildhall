/**
 * The top bar and quick switcher, on the studio's `.gh` tokens (browser/style.ts: V1's HUD look). The
 * bar is BAR_PX tall and sits above every screen; the shell offsets the screen host by the same amount.
 */

/** The bar's height in CSS pixels: the screen host starts below it. */
export const BAR_PX = 40

const CSS = /* css */ `
.gh-top {
  position: fixed;
  z-index: 50;
  top: 0;
  left: 0;
  right: 0;
  height: ${BAR_PX}px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 10px 0 12px;
  background: linear-gradient(#1d1712, #15110d);
  border-bottom: 1px solid var(--brass-line);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.45), 0 8px 18px -12px rgba(0, 0, 0, 0.8);
  user-select: none;
}
.gh-top :focus-visible, .gh-switch :focus-visible {
  outline: 2px solid var(--brass-hi);
  outline-offset: 2px;
}
.gh-top a { color: inherit; text-decoration: none; }

.gh-mark {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 30px;
  padding: 0 8px 0 4px;
  border-radius: var(--r-sm);
}
.gh-mark:hover { background: var(--raise); }
.gh-mark svg { flex: none; }
.gh-mark b { font: 400 16px/1 var(--display); letter-spacing: 0.09em; color: var(--paper); }
.gh-mark b span { color: var(--brass); }

.gh-crumb {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding-left: 14px;
  border-left: 1px solid var(--hair-2);
  white-space: nowrap;
}
.gh-crumb .group { font: 500 10.5px/1 var(--mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--brass); }
.gh-crumb .sep { color: var(--faint); font: 12px/1 var(--mono); }
.gh-crumb .name { font: 400 15px/1 var(--display); letter-spacing: 0.07em; color: var(--paper); overflow: hidden; text-overflow: ellipsis; }

.gh-top .spacer { flex: 1; }

.gh-jump {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 268px;
  height: 28px;
  padding: 0 6px 0 10px;
  border: 1px solid var(--hair-2);
  border-radius: var(--r-sm);
  background: rgba(0, 0, 0, 0.3);
  color: var(--muted);
  font: 13px/1 var(--body);
  cursor: pointer;
  text-align: left;
}
.gh-jump:hover { border-color: var(--brass-line); color: var(--paper); }
.gh-jump .label { flex: 1; }
.gh-jump svg { flex: none; color: var(--faint); }
.gh-kbd {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  padding: 0 5px;
  border: 1px solid var(--hair-2);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--raise);
  color: var(--muted);
  font: 500 10.5px/1 var(--mono);
}

.gh-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 8px 0 9px;
  border: 1px solid var(--hair-2);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  font: 500 11.5px/1 var(--mono);
  letter-spacing: 0.06em;
  cursor: pointer;
}
.gh-toggle:hover { border-color: var(--brass-line); color: var(--paper); }
.gh-toggle .led { width: 7px; height: 7px; border-radius: 50%; background: var(--hair-2); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.4); }
.gh-toggle[aria-pressed="true"] { background: var(--brass-wash); border-color: var(--brass-line); color: var(--brass-hi); }
.gh-toggle[aria-pressed="true"] .led { background: #8fdc7a; box-shadow: 0 0 6px rgba(143, 220, 122, 0.7); }

/* The showcase build's marker: nothing saves here. */
.gh-showcase {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border: 1px solid var(--brass-line);
  border-radius: 999px;
  background: var(--brass-wash);
  color: var(--brass-hi);
  font: 500 10.5px/1 var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
}

/* ── quick switcher ─────────────────────────────────────────────── */
.gh-switch-back {
  position: fixed;
  z-index: 60;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: max(64px, 13vh);
  background: rgba(8, 6, 4, 0.55);
  backdrop-filter: blur(3px);
}
.gh-switch {
  width: min(600px, calc(100vw - 32px));
  max-height: min(560px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(21, 17, 13, 0.97);
  border: 1px solid var(--brass-line);
  border-radius: 9px;
  box-shadow: 0 1px 0 rgba(255, 240, 210, 0.06) inset, 0 30px 70px -20px rgba(0, 0, 0, 0.9);
}
.gh-switch-head { display: flex; align-items: center; gap: 10px; padding: 0 14px; border-bottom: 1px solid var(--hair); }
.gh-switch-head svg { flex: none; color: var(--brass); }
.gh-switch-head input {
  flex: 1;
  height: 50px;
  border: 0;
  background: transparent;
  outline: none;
  font: 17px/1 var(--body);
  color: var(--paper);
}
.gh-switch-head input::placeholder { color: var(--faint); }
/* The input is the dialog's one focus: the caret and the brass rule under it show it, not a box. */
.gh-switch-head input:focus-visible { outline: none; }
.gh-switch-head:focus-within { border-bottom-color: var(--brass-line); }
.gh-switch-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; }
.gh-switch-list .head { padding: 10px 10px 5px; }
.gh-switch-opt {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px 16px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.gh-switch-opt .name { font: 500 15px/1.2 var(--body); color: var(--paper); }
.gh-switch-opt .purpose { grid-column: 1; font: 13px/1.3 var(--body); color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gh-switch-opt .where { grid-row: 1 / span 2; grid-column: 2; font: 500 10.5px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--faint); }
.gh-switch-opt[aria-selected="true"] { background: var(--brass-wash); box-shadow: inset 2px 0 0 var(--brass); }
.gh-switch-opt[aria-selected="true"] .name { color: var(--brass-hi); }
.gh-switch-opt[aria-selected="true"] .purpose { color: var(--muted); }
.gh-switch-empty { padding: 22px 12px; color: var(--faint); font: 14px/1.4 var(--body); text-align: center; }
.gh-switch-foot {
  display: flex;
  gap: 16px;
  padding: 9px 14px;
  border-top: 1px solid var(--hair);
  color: var(--faint);
  font: 11px/1 var(--mono);
}
.gh-switch-foot span { display: inline-flex; align-items: center; gap: 6px; }

@media (max-width: 900px) {
  .gh-jump { width: auto; }
  .gh-jump .label, .gh-crumb .group, .gh-crumb .sep { display: none; }
}
@media (max-width: 560px) {
  .gh-mark b { display: none; }
}
`

let node: HTMLStyleElement | null = null

/** Adds the shell's stylesheet once; the shell lives as long as the page. */
export function addShellStyle(): void {
  if (node) return
  node = document.createElement("style")
  node.dataset.gh = "shell"
  node.textContent = CSS
  document.head.append(node)
}
