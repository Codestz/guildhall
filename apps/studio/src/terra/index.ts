/**
 * Terrain lab (`/lab/terra`): the island's land and water before anything is planned on it
 * (decisions.md "Target island + terrain-first pipeline"). One island large, or eight seeds side by
 * side; sliders for every knob of `terraIsland`; rivers drawn as lines over the hillshaded map.
 * Everything is in the query, so a link opens exactly what is on screen.
 */
import { paintTerra, TERRA_DEFAULTS, type Terra, type TerraSpecFull, terraIsland } from "@guildhall/world"
import type { Screen } from "../screens.ts"
import { href, replaceQuery } from "../shell/router.ts"

const PANEL_STYLE = [
  "position:absolute",
  "left:12px",
  "top:12px",
  "padding:10px 12px",
  "border-radius:4px",
  "background:rgba(21,17,13,0.82)",
  "color:#f3e9d4",
  "font:12px/1.5 ui-monospace,Menlo,monospace",
  "display:grid",
  "gap:6px",
  "width:270px",
  "z-index:2",
].join(";")

export type Knob = Exclude<keyof TerraSpecFull, "seed" | "cell">
export const KNOBS: { key: Knob; label: string; min: number; max: number; step: number }[] = [
  { key: "size", label: "size (m)", min: 220, max: 520, step: 10 },
  { key: "coast", label: "coast shape", min: 0, max: 1.6, step: 0.05 },
  { key: "cliffs", label: "cliffs", min: 0, max: 1, step: 0.05 },
  { key: "hills", label: "hills", min: 0, max: 1.6, step: 0.05 },
  { key: "rain", label: "rivers", min: 0.3, max: 3, step: 0.05 },
  { key: "step", label: "terrace step (m)", min: 1.2, max: 4, step: 0.2 },
  { key: "levels", label: "terraces (0 auto)", min: 0, max: 8, step: 1 },
]

export interface View {
  spec: TerraSpecFull
  grid: boolean
  flow: boolean
}

export function parse(q: URLSearchParams): View {
  const num = (k: string, d: number) => {
    const v = Number(q.get(k))
    return q.has(k) && Number.isFinite(v) ? v : d
  }
  const spec = { seed: num("seed", 1), ...TERRA_DEFAULTS } as TerraSpecFull
  for (const k of KNOBS) spec[k.key] = num(k.key, TERRA_DEFAULTS[k.key])
  return { spec, grid: q.get("grid") === "1", flow: q.get("flow") === "1" }
}

export function params(v: View): URLSearchParams {
  const q = new URLSearchParams({ seed: String(v.spec.seed) })
  for (const k of KNOBS) if (v.spec[k.key] !== TERRA_DEFAULTS[k.key]) q.set(k.key, String(v.spec[k.key]))
  if (v.grid) q.set("grid", "1")
  if (v.flow) q.set("flow", "1")
  return q
}

/** Paints `t` into a `size`-pixel square at (x, y) of `g`, rivers as lines on top. */
function draw(
  g: CanvasRenderingContext2D,
  t: Terra,
  x: number,
  y: number,
  size: number,
  flow: boolean,
): void {
  const img = new ImageData(paintTerra(t, { flow }) as Uint8ClampedArray<ArrayBuffer>, t.w, t.h)
  const tmp = new OffscreenCanvas(t.w, t.h)
  tmp.getContext("2d")!.putImageData(img, 0, 0)
  g.imageSmoothingEnabled = true
  g.drawImage(tmp, x, y, size, size)
  const k = size / (t.w * t.cell)
  const to = (p: [number, number]): [number, number] => [
    x + (p[0] - t.origin[0]) * k,
    y + (p[1] - t.origin[1]) * k,
  ]
  g.lineCap = "round"
  g.lineJoin = "round"
  for (const r of t.rivers) {
    for (let i = 1; i < r.line.length; i++) {
      const [ax, ay] = to(r.line[i - 1]!)
      const [bx, by] = to(r.line[i]!)
      g.strokeStyle = "#4f97d6"
      g.lineWidth = Math.max(1.2, r.width[i]! * k)
      g.beginPath()
      g.moveTo(ax, ay)
      g.lineTo(bx, by)
      g.stroke()
    }
  }
  for (const f of t.falls) {
    const [fx, fy] = to(f)
    g.fillStyle = "#ffffff"
    g.beginPath()
    g.arc(fx, fy, Math.max(2, 2.5 * k), 0, Math.PI * 2)
    g.fill()
  }
}

export const terraLab: Screen = {
  id: "terra",
  title: "Terrain",
  mount(host, ctx) {
    host.style.background = "#266699"
    const canvas = document.createElement("canvas")
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block"
    host.append(canvas)
    const panel = document.createElement("div")
    panel.style.cssText = PANEL_STYLE
    host.append(panel)

    const view = parse(ctx.query)
    const stats = document.createElement("div")
    stats.style.cssText = "opacity:.85;white-space:pre"

    const render = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const W = host.clientWidth
      const H = host.clientHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      const g = canvas.getContext("2d")!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = "#266699"
      g.fillRect(0, 0, W, H)
      const left = 290
      const aw = W - left - 12
      if (view.grid) {
        const cols = 4
        const size = Math.min(aw / cols, (H - 24) / 2)
        const lines: string[] = []
        for (let k = 0; k < 8; k++) {
          const t = terraIsland({ ...view.spec, seed: view.spec.seed + k, cell: 4 })
          const x = left + (k % cols) * size
          const y = 12 + Math.floor(k / cols) * size
          draw(g, t, x, y, size, view.flow)
          g.fillStyle = "#f3e9d4"
          g.font = "12px ui-monospace,Menlo,monospace"
          g.fillText(`seed ${view.spec.seed + k}`, x + 8, y + 18)
          lines.push(`${view.spec.seed + k}: ${t.rivers.length} rivers, ${t.stats.lakes} lakes`)
        }
        stats.textContent = lines.join("\n")
      } else {
        const t = terraIsland(view.spec)
        const size = Math.min(aw, H - 24)
        draw(g, t, left + (aw - size) / 2, 12 + (H - 24 - size) / 2, size, view.flow)
        const s = t.stats
        stats.textContent = [
          `land      ${(s.landM2 / 1e4).toFixed(1)} ha`,
          `cliffs    ${Math.round(s.cliffShare * 100)}% of coast`,
          `rivers    ${t.rivers.length} (${s.riverM} m)`,
          `lakes     ${s.lakes}`,
          `falls     ${t.falls.length}`,
          `generated ${s.ms} ms`,
        ].join("\n")
      }
      replaceQuery(params(view))
    }

    // controls
    const title = document.createElement("div")
    title.innerHTML = "<b>Terrain + water</b> · step 1"
    panel.append(title)
    const seedRow = document.createElement("div")
    seedRow.style.cssText = "display:flex;gap:6px;align-items:center"
    const btn = (label: string, on: () => void): HTMLButtonElement => {
      const b = document.createElement("button")
      b.textContent = label
      b.style.cssText =
        "background:#3b3127;color:#f3e9d4;border:1px solid #6b5a46;border-radius:3px;padding:2px 8px;font:inherit;cursor:pointer"
      b.onclick = () => {
        on()
        render()
      }
      return b
    }
    const seedLabel = document.createElement("span")
    const syncSeed = () => {
      seedLabel.textContent = `seed ${view.spec.seed}`
    }
    syncSeed()
    seedRow.append(
      btn("◀", () => {
        view.spec.seed = Math.max(1, view.spec.seed - (view.grid ? 8 : 1))
        syncSeed()
      }),
      seedLabel,
      btn("▶", () => {
        view.spec.seed += view.grid ? 8 : 1
        syncSeed()
      }),
    )
    panel.append(seedRow)
    for (const k of KNOBS) {
      const row = document.createElement("label")
      row.style.cssText = "display:grid;grid-template-columns:110px 1fr 40px;gap:6px;align-items:center"
      const name = document.createElement("span")
      name.textContent = k.label
      const input = document.createElement("input")
      input.type = "range"
      input.min = String(k.min)
      input.max = String(k.max)
      input.step = String(k.step)
      input.value = String(view.spec[k.key])
      const val = document.createElement("span")
      val.textContent = String(view.spec[k.key])
      input.oninput = () => {
        view.spec[k.key] = Number(input.value)
        val.textContent = input.value
      }
      input.onchange = () => render()
      row.append(name, input, val)
      panel.append(row)
    }
    const toggles = document.createElement("div")
    toggles.style.cssText = "display:flex;gap:6px;flex-wrap:wrap"
    const gridBtn = btn(view.grid ? "one island" : "8 seeds", () => {
      view.grid = !view.grid
      gridBtn.textContent = view.grid ? "one island" : "8 seeds"
    })
    const flowBtn = btn(view.flow ? "hide flow" : "show flow", () => {
      view.flow = !view.flow
      flowBtn.textContent = view.flow ? "hide flow" : "show flow"
    })
    const go3d = document.createElement("a")
    go3d.textContent = "view in 3D ▶"
    go3d.style.cssText = "color:#e8c27a;align-self:center;margin-left:4px"
    const sync3d = () => {
      go3d.href = href("terra3d", params(view))
    }
    sync3d()
    panel.addEventListener("click", sync3d)
    panel.addEventListener("change", sync3d)
    toggles.append(gridBtn, flowBtn, go3d)
    panel.append(toggles, stats)

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "]") {
        view.spec.seed += 1
        syncSeed()
        render()
      } else if (e.key === "[") {
        view.spec.seed = Math.max(1, view.spec.seed - 1)
        syncSeed()
        render()
      }
    }
    window.addEventListener("keydown", onKey)
    const ro = new ResizeObserver(() => render())
    ro.observe(host)
    render()
    return () => {
      ro.disconnect()
      window.removeEventListener("keydown", onKey)
      host.replaceChildren()
    }
  },
}
