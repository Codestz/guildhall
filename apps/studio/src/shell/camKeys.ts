/**
 * The camera's controls, compact, for every world screen: what the mouse and keys do in the mode the
 * rig is in (orbit or free flight), with free flight's speed. The town shows it in its Camera section;
 * the labs show it as a corner chip with a Free camera toggle (`worldCamera`). On the studio's `.gh`
 * tokens, keys as the shell's `gh-kbd`, the toggle as its `gh-toggle`.
 */
import type { Rig } from "@guildhall/render"

const CSS = /* css */ `
.gh-camkeys { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 0; padding: 0; list-style: none; font: 12px/1.2 var(--body); color: var(--faint); }
.gh-camkeys li { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.gh-camkeys .gh-kbd { height: 17px; min-width: 17px; justify-content: center; padding: 0 4px; font-size: 10px; margin-right: 1px; }
.gh-camkeys b { font-weight: 500; color: var(--muted); }
.gh-camkeys .num { color: var(--brass-hi); }
.gh-camchip {
  position: absolute; right: 12px; bottom: 12px; z-index: 2; max-width: min(380px, calc(100% - 24px));
  padding: 9px 11px 10px; display: flex; flex-direction: column; gap: 8px;
}
.gh-camchip .gh-toggle { align-self: flex-start; height: 26px; }
.gh-camchip .gh-toggle:focus-visible { outline: 2px solid var(--brass-hi); outline-offset: 2px; }
`

let users = 0
let sheet: HTMLStyleElement | null = null

function holdStyle(): () => void {
  if (users++ === 0) {
    sheet = document.createElement("style")
    sheet.dataset.gh = "camkeys"
    sheet.textContent = CSS
    document.head.append(sheet)
  }
  let held = true
  return () => {
    if (!held) return
    held = false
    if (--users > 0) return
    sheet?.remove()
    sheet = null
  }
}

/** One legend entry: keys drawn as caps, then what they do (a gesture is a word, not a cap). */
type Entry = { keys?: string[]; gesture?: string; does: string; speed?: boolean }

const ORBIT: Entry[] = [
  { gesture: "Drag", does: "orbit" },
  { gesture: "Right-drag", does: "pan" },
  { gesture: "Wheel", does: "zoom" },
  { keys: ["F"], does: "free camera" },
]
const FREE: Entry[] = [
  { keys: ["W", "A", "S", "D"], does: "move" },
  { keys: ["Q", "E"], does: "down · up" },
  { keys: ["Shift"], does: "fast" },
  { gesture: "Drag", does: "look" },
  { gesture: "Wheel", does: "speed", speed: true },
  { keys: ["Esc"], does: "back" },
]

function legend(list: HTMLUListElement, rig: Rig): void {
  const entries = rig.mode() === "free" ? FREE : ORBIT
  list.replaceChildren(
    ...entries.map((e) => {
      const li = document.createElement("li")
      for (const key of e.keys ?? []) {
        const cap = document.createElement("kbd")
        cap.className = "gh-kbd"
        cap.textContent = key
        li.append(cap)
      }
      if (e.gesture) {
        const g = document.createElement("b")
        g.textContent = e.gesture
        li.append(g)
      }
      li.append(` ${e.does}`)
      if (e.speed) {
        const v = document.createElement("span")
        v.className = "num"
        v.textContent = ` ${Math.round(rig.speed())} m/s`
        li.append(v)
      }
      return li
    }),
  )
}

export interface CamKeys {
  el: HTMLElement
  dispose(): void
}

/** The legend alone (the town's Camera section). */
export function createCamKeys(rig: Rig): CamKeys {
  const release = holdStyle()
  const list = document.createElement("ul")
  list.className = "gh-camkeys"
  list.setAttribute("aria-label", "Camera controls")
  const draw = () => legend(list, rig)
  draw()
  const unsubscribe = rig.subscribe(draw)
  return {
    el: list,
    dispose() {
      unsubscribe()
      list.remove()
      release()
    },
  }
}

/** The labs' corner chip: a Free camera toggle over the legend. */
export function createCamChip(host: HTMLElement, rig: Rig): CamKeys {
  const keys = createCamKeys(rig)
  const chip = document.createElement("div")
  chip.className = "gh gh-panel gh-camchip"
  chip.setAttribute("role", "group")
  chip.setAttribute("aria-label", "Camera")
  const toggle = document.createElement("button")
  toggle.type = "button"
  toggle.className = "gh-toggle"
  toggle.setAttribute("aria-keyshortcuts", "F")
  const led = document.createElement("span")
  led.className = "led"
  led.setAttribute("aria-hidden", "true")
  toggle.append(led, "Free camera")
  toggle.onclick = () => rig.setMode(rig.mode() === "free" ? "orbit" : "free")
  const sync = () => toggle.setAttribute("aria-pressed", String(rig.mode() === "free"))
  sync()
  const unsubscribe = rig.subscribe(sync)
  chip.append(toggle, keys.el)
  host.append(chip)
  return {
    el: chip,
    dispose() {
      unsubscribe()
      keys.dispose()
      chip.remove()
    },
  }
}
