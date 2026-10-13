/**
 * The camera's controls for every world screen, in the Viewer's bottom-right corner: a Free camera
 * pill (also `F`) and a Controls pill that unfolds what the mouse and keys do in the mode the rig is in,
 * with free flight's speed. Drawn on `@guildhall/ui`'s classes (`ui-pill`, `ui-keys`, `ui-kbd`), which the
 * Viewer holding the chip has on the page.
 */
import type { Rig } from "@guildhall/render"
import { holdUiStyle } from "@guildhall/ui"

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
        cap.className = "ui-kbd"
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

/** The legend alone. */
export function createCamKeys(rig: Rig): CamKeys {
  const style = holdUiStyle()
  const list = document.createElement("ul")
  list.className = "ui-keys"
  list.setAttribute("aria-label", "Camera controls")
  const draw = () => legend(list, rig)
  draw()
  const unsubscribe = rig.subscribe(draw)
  return {
    el: list,
    dispose() {
      unsubscribe()
      list.remove()
      style.release()
    },
  }
}

let ids = 0

const pill = (label: string): HTMLButtonElement => {
  const b = document.createElement("button")
  b.type = "button"
  b.className = "ui-pill"
  b.textContent = label
  return b
}

/** The corner chip: the legend (folded until asked for) over a Free camera pill and a Controls pill. */
export function createCamChip(host: HTMLElement, rig: Rig): CamKeys {
  const keys = createCamKeys(rig)
  const chip = document.createElement("div")
  chip.className = "gh ui-help gh-camchip"
  chip.setAttribute("role", "group")
  chip.setAttribute("aria-label", "Camera")

  const body = document.createElement("div")
  body.className = "ui-panel ui-help-body"
  body.id = `gh-camkeys-${++ids}`
  body.hidden = true
  body.append(keys.el)

  const free = pill("Free camera")
  free.setAttribute("aria-keyshortcuts", "F")
  free.title = "Free camera (F)"
  const led = document.createElement("span")
  led.className = "led"
  led.setAttribute("aria-hidden", "true")
  free.prepend(led)
  free.onclick = () => rig.setMode(rig.mode() === "free" ? "orbit" : "free")

  const help = pill("Controls")
  help.setAttribute("aria-expanded", "false")
  help.setAttribute("aria-controls", body.id)
  help.insertAdjacentHTML(
    "afterbegin",
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="1.8" y="4" width="12.4" height="8" rx="1.5"/><path d="M4.5 6.6h.01M7 6.6h.01M9.5 6.6h.01M12 6.6h.01M5.5 9.4h5"/></svg>',
  )
  help.onclick = () => {
    body.hidden = !body.hidden
    help.setAttribute("aria-expanded", String(!body.hidden))
  }

  const row = document.createElement("div")
  row.className = "ui-help-row"
  row.append(free, help)

  let was = false
  const sync = () => {
    const on = rig.mode() === "free"
    free.setAttribute("aria-pressed", String(on))
    // free flight has keys worth showing: unfold the legend as it starts (once; folding it stays folded)
    if (on && !was && body.hidden) help.click()
    was = on
  }
  sync()
  const unsubscribe = rig.subscribe(sync)
  chip.append(body, row)
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
