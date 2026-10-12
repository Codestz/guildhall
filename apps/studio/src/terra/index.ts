/**
 * Terrain lab (`/lab/terra`): the island's land and water before anything is planned on it
 * (decisions.md "Target island + terrain-first pipeline"). One island large, or eight seeds side by
 * side; sliders for every knob of `terraIsland`; rivers drawn as lines over the hillshaded map.
 * Everything is in the query, so a link opens exactly what is on screen.
 */
import {
  paintTerra,
  TERRA_DEFAULTS,
  type Terra,
  type TerraParcels,
  type TerraPlan,
  type TerraSpecFull,
  terraIsland,
  terraParcels,
  terraPlan,
} from "@guildhall/world"
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
  /** Step 2 on top: anchors and roads (on unless `plan=0`). */
  plan: boolean
}

export function parse(q: URLSearchParams): View {
  const num = (k: string, d: number) => {
    const v = Number(q.get(k))
    return q.has(k) && Number.isFinite(v) ? v : d
  }
  const spec = { seed: num("seed", 1), ...TERRA_DEFAULTS } as TerraSpecFull
  for (const k of KNOBS) spec[k.key] = num(k.key, TERRA_DEFAULTS[k.key])
  return { spec, grid: q.get("grid") === "1", flow: q.get("flow") === "1", plan: q.get("plan") !== "0" }
}

export function params(v: View): URLSearchParams {
  const q = new URLSearchParams({ seed: String(v.spec.seed) })
  for (const k of KNOBS) if (v.spec[k.key] !== TERRA_DEFAULTS[k.key]) q.set(k.key, String(v.spec[k.key]))
  if (v.grid) q.set("grid", "1")
  if (v.flow) q.set("flow", "1")
  if (!v.plan) q.set("plan", "0")
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
  plan?: TerraPlan,
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
  if (plan) {
    const parcels = terraParcels(t, plan)
    drawParcels(g, t, parcels, x, y, size)
    drawClaims(g, t, plan, x, y, size)
    drawTrails(g, parcels, to)
    drawPlan(g, plan, to, k)
    drawPois(g, parcels, to)
    lastParcels = parcels
  }
}

/** The parcels of the last single-island draw, for the stats line. */
let lastParcels: TerraParcels | null = null

/** Parcel colours by use (the legend under the panel uses the same). */
const USE_COLOUR: Record<string, string> = {
  garden: "#a8d47a",
  orchard: "#8fc35a",
  field: "#e6c76a",
  pasture: "#bcdc8e",
  meadow: "#cfe59a",
  wood: "#3f8f45",
  pine: "#2f6f43",
  vineyard: "#a98bc4",
  "terrace-field": "#d9b85e",
  quarry: "#bdb4a6",
  reeds: "#86bf98",
  dune: "#efe0ae",
}

const rgbOf = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

/** Every parcel filled with its use's colour, a darker hedge line where two parcels meet, rows on fields. */
function drawParcels(
  g: CanvasRenderingContext2D,
  t: Terra,
  pc: TerraParcels,
  x: number,
  y: number,
  size: number,
): void {
  const byId = new Map(pc.parcels.map((p) => [p.id + 1, p]))
  const px = new Uint8ClampedArray(t.w * t.h * 4)
  for (let i = 0; i < t.w * t.h; i++) {
    const id = pc.cell[i]!
    const p = id ? byId.get(id) : undefined
    if (!p) continue
    let [r, gg, b] = rgbOf(USE_COLOUR[p.use] ?? "#ffffff")
    const xx = i % t.w
    const yy = (i - xx) / t.w
    const edge = (xx > 0 && pc.cell[i - 1] !== id) || pc.cell[i - t.w] !== id
    let k = edge ? 0.62 : 1
    // rows on crops and vines, dots on orchards
    if (
      (p.use === "field" || p.use === "terrace-field" || p.use === "vineyard") &&
      (xx + yy * ((p.id % 3) - 1)) % 3 === 0
    )
      k *= 0.88
    if (p.use === "orchard" && xx % 3 === 0 && yy % 3 === 0) k *= 0.7
    // shade with the hillside, so the terraces still read
    const slopeK = 1 - Math.min(0.25, t.slope[i]! * 0.4)
    k *= slopeK
    r *= k
    gg *= k
    b *= k
    px[i * 4] = r
    px[i * 4 + 1] = gg
    px[i * 4 + 2] = b
    px[i * 4 + 3] = 215
  }
  const tmp = new OffscreenCanvas(t.w, t.h)
  tmp.getContext("2d")!.putImageData(new ImageData(px, t.w, t.h), 0, 0)
  g.imageSmoothingEnabled = false
  g.drawImage(tmp, x, y, size, size)
  g.imageSmoothingEnabled = true
}

/** Footpaths to the places worth a walk: dashed. */
function drawTrails(
  g: CanvasRenderingContext2D,
  pc: TerraParcels,
  to: (p: [number, number]) => [number, number],
): void {
  g.setLineDash([4, 3])
  g.strokeStyle = "#6b4a2a"
  g.lineWidth = 1.8
  for (const tr of pc.trails) {
    g.beginPath()
    tr.line.forEach((p, i) => {
      const [x, y] = to(p as [number, number])
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    })
    g.stroke()
  }
  g.setLineDash([])
}

const POI_GLYPH: Record<string, string> = {
  lookout: "⚑",
  quarry: "⛏",
  shrine: "✧",
  lighthouse: "☼",
  farmstead: "⌂",
}

function drawPois(
  g: CanvasRenderingContext2D,
  pc: TerraParcels,
  to: (p: [number, number]) => [number, number],
): void {
  g.font = "bold 13px ui-monospace,Menlo,monospace"
  g.textAlign = "center"
  for (const p of pc.pois) {
    const [x, y] = to(p.at as [number, number])
    const glyph = POI_GLYPH[p.kind] ?? "•"
    g.lineWidth = 3
    g.strokeStyle = "rgba(20,16,12,0.85)"
    g.strokeText(glyph, x, y + 5)
    g.fillStyle = "#fff"
    g.fillText(glyph, x, y + 5)
    if (p.kind !== "farmstead") {
      g.font = "bold 10px ui-monospace,Menlo,monospace"
      g.strokeText(p.kind, x, y + 18)
      g.fillText(p.kind, x, y + 18)
      g.font = "bold 13px ui-monospace,Menlo,monospace"
    }
  }
  g.textAlign = "start"
}

/** What each anchor grows into, as a tint of its colour with a darker rim. */
function drawClaims(
  g: CanvasRenderingContext2D,
  t: Terra,
  plan: TerraPlan,
  x: number,
  y: number,
  size: number,
): void {
  const rgb = plan.anchors.map((a) => {
    const hex = ANCHOR_COLOUR[a.kind] ?? "#ffffff"
    return [1, 3, 5].map((o) => Number.parseInt(hex.slice(o, o + 2), 16))
  })
  const px = new Uint8ClampedArray(t.w * t.h * 4)
  for (let i = 0; i < t.w * t.h; i++) {
    const c = plan.claim[i]!
    if (!c) continue
    const col = rgb[c - 1]!
    const xx = i % t.w
    const rim =
      (xx > 0 && plan.claim[i - 1] !== c) ||
      (xx < t.w - 1 && plan.claim[i + 1] !== c) ||
      plan.claim[i - t.w] !== c ||
      plan.claim[i + t.w] !== c
    px[i * 4] = col[0]!
    px[i * 4 + 1] = col[1]!
    px[i * 4 + 2] = col[2]!
    px[i * 4 + 3] = rim ? 235 : 150
  }
  const tmp = new OffscreenCanvas(t.w, t.h)
  tmp.getContext("2d")!.putImageData(new ImageData(px, t.w, t.h), 0, 0)
  g.imageSmoothingEnabled = false
  g.drawImage(tmp, x, y, size, size)
  g.imageSmoothingEnabled = true
}

/** What an anchor becomes, in a few words, for its label. */
const ANCHOR_ROLE: Record<string, string> = {
  town: "the town: market, guildhall, ~60 buildings",
  harbour: "harbour quarter: quay, piers, warehouses",
  crossing: "river village: bridge, mill, inn",
  outpost: "hill outpost: watchtower, keep",
  fishing: "fishing hamlet: huts, jetties",
  farm: "farm hamlet: farmsteads, fields",
}

const ANCHOR_COLOUR: Record<string, string> = {
  town: "#d8463a",
  harbour: "#7a4fd6",
  crossing: "#2f8fd0",
  outpost: "#6a4a2a",
  fishing: "#2aa39a",
  farm: "#d9a520",
}

/** Roads (dirt with a dark edge; the loop track dashed), bridges, and each anchor as a labelled disc. */
function drawPlan(
  g: CanvasRenderingContext2D,
  plan: TerraPlan,
  to: (p: [number, number]) => [number, number],
  k: number,
): void {
  for (const pass of [0, 1])
    for (const r of plan.roads) {
      g.setLineDash(r.kind === "track" && pass === 1 ? [6, 4] : [])
      g.strokeStyle = pass === 0 ? "rgba(70,50,30,0.75)" : "#e3c78f"
      g.lineWidth = Math.max(pass === 0 ? 3.5 : 2, (r.kind === "main" ? 4.5 : 3) * k + (pass === 0 ? 2 : 0))
      g.beginPath()
      r.line.forEach((p, i) => {
        const [x, y] = to(p as [number, number])
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      })
      g.stroke()
    }
  g.setLineDash([])
  for (const r of plan.roads)
    for (const b of r.bridges) {
      const [x, y] = to(b as [number, number])
      g.fillStyle = "#7a5233"
      g.fillRect(x - 5, y - 5, 10, 10)
      g.strokeStyle = "#f3e9d4"
      g.strokeRect(x - 5, y - 5, 10, 10)
    }
  g.font = "bold 11px ui-monospace,Menlo,monospace"
  for (const a of plan.anchors) {
    const [x, y] = to(a.at as [number, number])
    g.fillStyle = ANCHOR_COLOUR[a.kind] ?? "#fff"
    g.strokeStyle = "#fff"
    g.lineWidth = 2
    g.beginPath()
    g.arc(x, y, a.kind === "town" ? 11 : 8, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    const ha = (plan.area[plan.anchors.indexOf(a)] ?? 0) / 1e4
    const label = `${ANCHOR_ROLE[a.kind] ?? a.kind} · ${ha.toFixed(1)} ha${a.level ? ` · terrace ${a.level}` : ""}`
    g.lineWidth = 3
    g.strokeStyle = "rgba(20,16,12,0.85)"
    g.strokeText(label, x + 13, y + 4)
    g.fillStyle = "#fff"
    g.fillText(label, x + 13, y + 4)
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
        const plan = view.plan ? terraPlan(t) : undefined
        const size = Math.min(aw, H - 24)
        draw(g, t, left + (aw - size) / 2, 12 + (H - 24 - size) / 2, size, view.flow, plan)
        const s = t.stats
        stats.textContent = [
          `land      ${(s.landM2 / 1e4).toFixed(1)} ha`,
          `cliffs    ${Math.round(s.cliffShare * 100)}% of coast`,
          `rivers    ${t.rivers.length} (${s.riverM} m)`,
          `lakes     ${s.lakes}`,
          `falls     ${t.falls.length}`,
          `generated ${s.ms} ms`,
          ...(plan
            ? [
                `anchors   ${plan.anchors.length} · roads ${plan.roads.length}`,
                `bridges   ${plan.roads.reduce((n, r) => n + r.bridges.length, 0)} · plan ${plan.ms} ms`,
                `parcels   ${lastParcels?.parcels.length ?? 0} · land used ${Math.round((lastParcels?.covered ?? 0) * 100)}%`,
                `places    ${(lastParcels?.pois ?? [])
                  .filter((p) => p.kind !== "farmstead")
                  .map((p) => p.kind)
                  .join(", ")}`,
                `farms     ${(lastParcels?.pois ?? []).filter((p) => p.kind === "farmstead").length} farmsteads`,
              ]
            : []),
        ].join("\n")
      }
      replaceQuery(params(view))
    }

    // controls
    const title = document.createElement("div")
    title.innerHTML = "<b>Island plan</b> · 1 terrain + water · 2 places + roads · 3 parcels + trails"
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
    const planBtn = btn(view.plan ? "terrain only" : "show plan", () => {
      view.plan = !view.plan
      planBtn.textContent = view.plan ? "terrain only" : "show plan"
    })
    toggles.append(gridBtn, flowBtn, planBtn, go3d)
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
