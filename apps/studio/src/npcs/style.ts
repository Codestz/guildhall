/**
 * The NPC builder's layout, on top of the studio panels' look (browser/style.ts) and the composer's
 * controls (composer/style.ts: fields, segments, chips, steppers, readout). Injected while mounted.
 */

const CSS = /* css */ `
.gh-npc {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr) 300px;
  gap: 12px;
  padding: 12px;
  background:
    radial-gradient(1200px 700px at 30% -10%, rgba(220, 182, 98, 0.07), transparent 60%),
    linear-gradient(#1b1611, #100c09);
  overflow: hidden;
}
.gh-npc.empty { display: block; }
.gh-npc .gh-sec { border-bottom: 1px solid var(--hair); }
.gh-npc .gh-sec:last-child { border-bottom: 0; }
.gh-npc .gh-chips { margin-bottom: 4px; }
.gh-npc .gh-sec-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
.gh-npc .gh-sec-head .gh-eyebrow { margin: 0; }
.gh-npc a { color: var(--brass); }
.gh-npc-id { width: 100%; padding: 5px 7px; border-radius: var(--r-sm); border: 1px solid var(--hair-2); background: rgba(0, 0, 0, 0.32); color: var(--paper); font: 13px var(--mono); outline: none; }
.gh-npc-id:focus { border-color: var(--brass-line); }

.gh-sw-chip {
  width: 22px;
  height: 18px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.4);
  cursor: pointer;
  opacity: 0.45;
}
.gh-sw-chip:hover { opacity: 0.85; }
.gh-sw-chip[aria-pressed="true"] { opacity: 1; box-shadow: 0 0 0 2px var(--brass-hi); }
.gh-sw-chip.keep { outline: 1px dashed var(--paper); outline-offset: -4px; }
.gh-outfit-row { display: grid; grid-template-columns: 86px minmax(0, 1fr) 20px; gap: 6px; align-items: start; margin-bottom: 6px; }
.gh-outfit-row .from { display: flex; align-items: center; gap: 5px; font: 11.5px var(--mono); color: var(--paper); padding-top: 1px; }
.gh-outfit-row .from i { width: 12px; height: 12px; border-radius: 3px; flex: none; }
.gh-outfit-row .gh-chips { gap: 3px; }

.gh-needs { margin: 2px 0 6px; font-size: 12px; color: var(--faint); }
.gh-needs summary { cursor: pointer; }
.gh-needs ul { margin: 4px 0 0; padding: 0; list-style: none; display: grid; gap: 1px; max-height: 150px; overflow-y: auto; }
.gh-needs li { display: flex; justify-content: space-between; gap: 6px; font: 11px var(--mono); }
.gh-needs a { color: var(--brass); text-decoration: none; white-space: nowrap; }
.gh-needs a:hover { color: var(--brass-hi); }

.gh-npc .gh-main { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.gh-npc .gh-view { position: relative; flex: 1; min-height: 0; overflow: hidden; border-radius: 0 0 var(--r) var(--r); }
.gh-npc .gh-range span { width: 44px; }
.gh-time-ctl { display: inline-flex; align-items: center; gap: 6px; font: 12px var(--body); color: var(--faint); }
.gh-time-ctl input[type="range"] { width: 110px; }

.gh-big { display: flex; flex-direction: column; overflow: hidden; }
.gh-big-view { position: relative; flex: 1; min-height: 240px; margin: 0 10px; border-radius: var(--r-sm); overflow: hidden; border: 1px solid var(--hair-2); }
.gh-big .pad { padding: 10px 12px; display: grid; gap: 8px; }
.gh-big .gh-kv { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.gh-look { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; font: 11.5px var(--mono); color: var(--muted); }
.gh-look li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gh-look b { color: var(--faint); font-weight: 400; margin-right: 6px; }
`

let users = 0
let node: HTMLStyleElement | null = null

/** Adds the builder's stylesheet while at least one builder holds it. */
export function holdNpcStyle(): { release(): void } {
  if (users++ === 0) {
    node = document.createElement("style")
    node.dataset.gh = "npc"
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
