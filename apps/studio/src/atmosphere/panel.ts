/** The atmosphere lab's panel: a toggle per feature, sliders for hour, coverage and wind, the cameras. */
import type { AtmosphereParams } from "@guildhall/render"
import { CAMS, type Cam } from "./query.ts"

export interface PanelOpts {
  params: AtmosphereParams
  hour: number
  wake: boolean
  onParams(p: Partial<AtmosphereParams>): void
  onHour(hour: number): void
  onWake(on: boolean): void
  onCam(cam: Cam): void
}

const STYLE = [
  "position:absolute",
  "left:12px",
  "bottom:12px",
  "width:240px",
  "padding:10px 12px",
  "border-radius:6px",
  "background:rgba(21,17,13,0.82)",
  "color:#f3e9d4",
  "font:12px/1.6 ui-monospace,Menlo,monospace",
  "display:grid",
  "gap:4px",
].join(";")

const hh = (h: number) =>
  `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`

export function createPanel(host: HTMLElement, opts: PanelOpts): { dispose(): void } {
  const node = document.createElement("div")
  node.style.cssText = STYLE
  node.setAttribute("aria-label", "Atmosphere")

  const toggle = (label: string, on: boolean, change: (on: boolean) => void) => {
    const row = document.createElement("label")
    const box = document.createElement("input")
    box.type = "checkbox"
    box.checked = on
    box.addEventListener("change", () => change(box.checked))
    row.append(box, ` ${label}`)
    node.append(row)
  }
  const slider = (
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    show: (v: number) => string,
    change: (v: number) => void,
  ) => {
    const row = document.createElement("label")
    row.style.cssText = "display:grid;grid-template-columns:1fr auto;align-items:center"
    const text = document.createElement("span")
    const out = document.createElement("span")
    text.textContent = label
    out.textContent = show(value)
    const input = document.createElement("input")
    input.type = "range"
    Object.assign(input, { min: String(min), max: String(max), step: String(step), value: String(value) })
    input.style.gridColumn = "1 / 3"
    input.addEventListener("input", () => {
      const v = Number(input.value)
      out.textContent = show(v)
      change(v)
    })
    row.append(text, out, input)
    node.append(row)
  }

  const p = opts.params
  toggle("clouds", p.clouds, (on) => opts.onParams({ clouds: on }))
  toggle("cloud shadows", p.shadows, (on) => opts.onParams({ shadows: on }))
  toggle("reflections", p.reflections, (on) => opts.onParams({ reflections: on }))
  toggle("boat wake (demo)", opts.wake, opts.onWake)
  slider("hour", 0, 24, 0.05, opts.hour, hh, opts.onHour)
  slider(
    "coverage",
    0,
    1,
    0.01,
    p.coverage,
    (v) => v.toFixed(2),
    (v) => opts.onParams({ coverage: v }),
  )
  slider(
    "wind toward",
    0,
    360,
    1,
    p.windHeading,
    (v) => `${v}°`,
    (v) => opts.onParams({ windHeading: v }),
  )
  slider(
    "wind speed",
    0,
    30,
    0.5,
    p.windSpeed,
    (v) => `${v} m/s`,
    (v) => opts.onParams({ windSpeed: v }),
  )
  const cams = document.createElement("div")
  cams.style.cssText = "display:flex;gap:6px;margin-top:4px"
  for (const cam of CAMS) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = cam
    button.addEventListener("click", () => opts.onCam(cam))
    cams.append(button)
  }
  node.append(cams)
  host.append(node)
  return { dispose: () => node.remove() }
}
