/**
 * Hex map (`/lab/hexmap`): step 1 of the hex world seen from above (decisions.md "Clean restart on hex"):
 * every tile drawn as a hexagon in its ground's colour, lighter the higher it stands, with a dark rim
 * where it drops to a lower neighbour (so the steps read), rivers as lines from tile to tile. One
 * island large, or eight seeds; sliders for every knob; everything in the query.
 */
import {
  HEX_ISLAND_DEFAULTS,
  type HexIsland,
  type HexIslandSpec,
  type HexZones,
  hexCentre,
  hexIsland,
  hexZones,
  kindOf,
  useOf,
} from "@guildhall/world"
import type { Screen } from "../screens.ts"
import { replaceQuery } from "../shell/router.ts"

const PANEL = [
  "position:absolute",
  "left:12px",
  "top:12px",
  "padding:10px 12px",
  "border-radius:4px",
  "background:rgba(21,17,13,0.85)",
  "color:#f3e9d4",
  "font:12px/1.5 ui-monospace,Menlo,monospace",
  "display:grid",
  "gap:6px",
  "width:260px",
  "z-index:2",
].join(";")

type Knob = Exclude<keyof HexIslandSpec, "seed">
const KNOBS: { key: Knob; label: string; min: number; max: number; step: number }[] = [
  { key: "files", label: "repo files", min: 0, max: 30000, step: 100 },
  { key: "coast", label: "coast shape", min: 0, max: 2, step: 0.05 },
  { key: "hills", label: "hill levels", min: 0, max: 9, step: 1 },
  { key: "rain", label: "rivers", min: 0.3, max: 3, step: 0.05 },
  { key: "forest", label: "forest", min: 0, max: 0.7, step: 0.01 },
]

/** Rings shown: the biggest island fits, so every size is drawn at one scale and growth reads. */
const FIT = 40

/** Ground colours (top-down map; the 3D tiles come later from prefabs). */
const COLOUR: Record<string, [number, number, number]> = {
  sea: [52, 120, 170],
  shallows: [96, 176, 200],
  sand: [232, 210, 150],
  grass: [138, 190, 84],
  meadow: [170, 200, 92],
  forest: [62, 128, 64],
  hill: [150, 168, 92],
  rock: [150, 140, 128],
  cliff: [132, 112, 92],
  lake: [80, 156, 214],
  river: [80, 156, 214],
}

interface View {
  spec: Required<Omit<HexIslandSpec, "seed">> & { seed: number }
  grid: boolean
  growth: boolean
  /** Step 2 on top: zones, buildings, roads (on unless `zones=0`). */
  zones: boolean
}

function parse(q: URLSearchParams): View {
  const num = (k: string, d: number) => {
    const v = Number(q.get(k))
    return q.has(k) && Number.isFinite(v) ? v : d
  }
  const spec = { ...HEX_ISLAND_DEFAULTS, seed: num("seed", 1) }
  for (const k of KNOBS) spec[k.key] = num(k.key, HEX_ISLAND_DEFAULTS[k.key])
  return { spec, grid: q.get("grid") === "1", growth: q.get("growth") === "1", zones: q.get("zones") !== "0" }
}

function params(v: View): URLSearchParams {
  const q = new URLSearchParams({ seed: String(v.spec.seed) })
  for (const k of KNOBS) if (v.spec[k.key] !== HEX_ISLAND_DEFAULTS[k.key]) q.set(k.key, String(v.spec[k.key]))
  if (v.grid) q.set("grid", "1")
  if (v.growth) q.set("growth", "1")
  if (!v.zones) q.set("zones", "0")
  return q
}

/** Draws island `h` centred at (cx, cy), fitted to `size` pixels across. */
function draw(
  g: CanvasRenderingContext2D,
  h: HexIsland,
  cx: number,
  cy: number,
  size: number,
  fit: number,
  zones?: HexZones,
): void {
  const { grid } = h
  const s = size / (Math.sqrt(3) * (2 * fit + 1))
  const corner = (k: number): [number, number] => {
    const a = (Math.PI / 180) * (60 * k - 30)
    return [Math.cos(a) * s, Math.sin(a) * s]
  }
  const C = [0, 1, 2, 3, 4, 5].map(corner)
  let top = 1
  for (let i = 0; i < grid.size; i++) top = Math.max(top, h.level[i]!)
  for (let i = 0; i < grid.size; i++) {
    const [x, y] = hexCentre({ q: grid.q[i]!, r: grid.r[i]! })
    const px = cx + x * s
    const py = cy + y * s
    const kind = kindOf(h, i)
    const L = Math.max(0, h.level[i]!)
    const lift = kind === "sea" || kind === "shallows" ? 1 : 0.86 + 0.24 * (L / top)
    const [r0, g0, b0] = COLOUR[kind] ?? [255, 0, 255]
    g.fillStyle = `rgb(${r0 * lift},${g0 * lift},${b0 * lift})`
    g.beginPath()
    C.forEach(([dx, dy], k) => (k ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)))
    g.closePath()
    g.fill()
    // a dark rim on each edge that drops to a lower neighbour: the steps read from above
    if (h.level[i]! >= 0) {
      const nb = grid.neighbours(i)
      // DIRS order: E, NE, NW, W, SW, SE; the edge toward direction d runs between corners d and d+1 (+5 offset)
      const EDGE = [0, 5, 4, 3, 2, 1]
      for (let d = 0; d < 6; d++) {
        const j = nb[d]!
        if (j < 0) continue
        const drop = h.level[i]! - Math.max(-1, h.level[j]!)
        if (drop <= 0) continue
        const e = EDGE[d]!
        const [ax, ay] = C[e]!
        const [bx, by] = C[(e + 1) % 6]!
        g.strokeStyle = `rgba(40,28,16,${Math.min(0.75, 0.25 + 0.18 * drop)})`
        g.lineWidth = Math.max(1, s * 0.22)
        g.beginPath()
        g.moveTo(px + ax, py + ay)
        g.lineTo(px + bx, py + by)
        g.stroke()
      }
    }
  }
  // rivers: tile centre to tile centre, wider downstream
  g.lineCap = "round"
  g.lineJoin = "round"
  for (const rv of h.rivers) {
    g.strokeStyle = "rgb(70,146,212)"
    for (let k = 1; k < rv.tiles.length; k++) {
      const a = hexCentre({ q: grid.q[rv.tiles[k - 1]!]!, r: grid.r[rv.tiles[k - 1]!]! })
      const b = hexCentre({ q: grid.q[rv.tiles[k]!]!, r: grid.r[rv.tiles[k]!]! })
      g.lineWidth = Math.max(1.2, s * (0.35 + 0.5 * (k / rv.tiles.length)))
      g.beginPath()
      g.moveTo(cx + a[0] * s, cy + a[1] * s)
      g.lineTo(cx + b[0] * s, cy + b[1] * s)
      g.stroke()
    }
  }
  if (zones) drawZones(g, h, zones, cx, cy, s, C)
}

/** Zone colours (a tint over the place's tiles, its name at the heart). */
const ZONE_COLOUR: Record<string, string> = {
  town: "#d8463a",
  harbour: "#7a4fd6",
  castle: "#5a5a6a",
  farm: "#d9a520",
  fishing: "#2aa39a",
  mine: "#8a6a4a",
  lumber: "#3f7a3a",
}

/**
 * The zones over the land: each place's tiles tinted with its colour; a building tile as a small roofed
 * block, the square paved, yards left as tinted ground; roads as a dirt band tile to tile, bridges plank
 * brown; fields striped; docks planked out on the shallows.
 */
function drawZones(
  g: CanvasRenderingContext2D,
  h: HexIsland,
  z: HexZones,
  cx: number,
  cy: number,
  s: number,
  C: [number, number][],
): void {
  const { grid } = h
  const hexPath = (px: number, py: number, k = 1) => {
    g.beginPath()
    C.forEach(([dx, dy], i) => (i ? g.lineTo(px + dx * k, py + dy * k) : g.moveTo(px + dx * k, py + dy * k)))
    g.closePath()
  }
  const centre = (i: number): [number, number] => {
    const [x, y] = hexCentre({ q: grid.q[i]!, r: grid.r[i]! })
    return [cx + x * s, cy + y * s]
  }
  for (let i = 0; i < grid.size; i++) {
    const u = useOf(z, i)
    const zi = z.zoneOf[i]!
    const [px, py] = centre(i)
    if (zi) {
      g.fillStyle = `${ZONE_COLOUR[z.zones[zi - 1]!.kind] ?? "#fff"}55`
      hexPath(px, py)
      g.fill()
    }
    if (u === "field") {
      g.fillStyle = "#e3c25a"
      hexPath(px, py, 0.92)
      g.fill()
      g.strokeStyle = "#b8963c"
      g.lineWidth = Math.max(0.6, s * 0.12)
      for (let k = -2; k <= 2; k++) {
        g.beginPath()
        g.moveTo(px - s * 0.7, py + k * s * 0.3)
        g.lineTo(px + s * 0.7, py + k * s * 0.3)
        g.stroke()
      }
    } else if (u === "square") {
      g.fillStyle = "#cfc4ae"
      hexPath(px, py, 0.95)
      g.fill()
    } else if (u === "dock") {
      g.fillStyle = "#8a6038"
      hexPath(px, py, 0.55)
      g.fill()
    }
  }
  // roads: a band from tile centre to tile centre
  g.lineCap = "round"
  g.lineJoin = "round"
  const band = (a: number, b: number, colour: string, w: number) => {
    const [ax, ay] = centre(a)
    const [bx, by] = centre(b)
    g.strokeStyle = colour
    g.lineWidth = w
    g.beginPath()
    g.moveTo(ax, ay)
    g.lineTo(bx, by)
    g.stroke()
  }
  // each road and street along its own tile path (never every adjacent pair: that draws triangles)
  for (const pass of [0, 1])
    for (const r of z.roads)
      for (let k = 1; k < r.tiles.length; k++) {
        const a = r.tiles[k - 1]!
        const b = r.tiles[k]!
        const bridge = useOf(z, a) === "bridge" || useOf(z, b) === "bridge"
        if (pass === 0) band(a, b, "#7a5a36", Math.max(2, s * 0.62))
        else band(a, b, bridge ? "#a0703c" : "#e2c68f", Math.max(1.2, s * 0.4))
      }
  // buildings: a small roofed block per tile; the castle a keep
  for (let i = 0; i < grid.size; i++) {
    const u = useOf(z, i)
    if (u !== "building" && u !== "landmark") continue
    const [px, py] = centre(i)
    const zi = z.zoneOf[i]!
    const colour = ZONE_COLOUR[z.zones[zi - 1]?.kind ?? "town"] ?? "#d8463a"
    const w = s * (u === "landmark" ? 1.3 : 1.05)
    g.fillStyle = "#f3e9d4"
    g.fillRect(px - w / 2, py - w / 2, w, w)
    g.fillStyle = colour
    g.beginPath()
    g.moveTo(px - w / 2 - s * 0.08, py - w / 2 + s * 0.05)
    g.lineTo(px, py - w / 2 - s * 0.45)
    g.lineTo(px + w / 2 + s * 0.08, py - w / 2 + s * 0.05)
    g.closePath()
    g.fill()
    g.strokeStyle = "rgba(30,20,10,0.6)"
    g.lineWidth = 0.8
    g.strokeRect(px - w / 2, py - w / 2, w, w)
  }
  // names at the hearts
  g.font = "bold 12px ui-monospace,Menlo,monospace"
  g.textAlign = "center"
  for (const zone of z.zones) {
    const [px, py] = centre(zone.tile)
    const label = `${zone.kind} · ${zone.buildings}`
    g.lineWidth = 3
    g.strokeStyle = "rgba(20,16,12,0.85)"
    g.strokeText(label, px, py - s * 1.6)
    g.fillStyle = "#fff"
    g.fillText(label, px, py - s * 1.6)
  }
  g.textAlign = "start"
}

export const hexmap: Screen = {
  id: "hexmap",
  title: "Hex map",
  mount(host, ctx) {
    const canvas = document.createElement("canvas")
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block"
    host.append(canvas)
    const panel = document.createElement("div")
    panel.style.cssText = PANEL
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
      g.fillStyle = "rgb(52,120,170)"
      g.fillRect(0, 0, W, H)
      const left = 284
      const aw = W - left - 8
      if (view.growth) {
        // one seed at growing repo sizes: the land already there never moves
        const sizes = [100, 600, 2000, 6000, 14000, 30000]
        const size = Math.min(aw / 3, (H - 16) / 2)
        sizes.forEach((files, k) => {
          const h = hexIsland({ ...view.spec, files })
          const x = left + (k % 3) * size + size / 2
          const y = 8 + Math.floor(k / 3) * size + size / 2
          draw(g, h, x, y, size, FIT)
          g.fillStyle = "#f3e9d4"
          g.font = "12px ui-monospace,Menlo,monospace"
          g.fillText(`${files} files · ${h.stats.land} tiles`, x - size / 2 + 8, y - size / 2 + 18)
        })
        stats.textContent = "growth: same seed, more files"
      } else if (view.grid) {
        const size = Math.min(aw / 4, (H - 16) / 2)
        const lines: string[] = []
        for (let k = 0; k < 8; k++) {
          const h = hexIsland({ ...view.spec, seed: view.spec.seed + k })
          const x = left + (k % 4) * size + size / 2
          const y = 8 + Math.floor(k / 4) * size + size / 2
          draw(g, h, x, y, size, FIT)
          g.fillStyle = "#f3e9d4"
          g.font = "12px ui-monospace,Menlo,monospace"
          g.fillText(`seed ${view.spec.seed + k}`, x - size / 2 + 8, y - size / 2 + 18)
          lines.push(`${view.spec.seed + k}: ${h.stats.rivers} rivers · ${h.stats.lakes} lakes`)
        }
        stats.textContent = lines.join("\n")
      } else {
        const h = hexIsland(view.spec)
        const zones = view.zones ? hexZones(h) : undefined
        const size = Math.min(aw, H - 16) * 1.02
        draw(g, h, left + aw / 2, H / 2, size, FIT, zones)
        const count: Record<string, number> = {}
        for (let i = 0; i < h.grid.size; i++) count[kindOf(h, i)] = (count[kindOf(h, i)] ?? 0) + 1
        stats.textContent = [
          `land tiles ${h.stats.land} (${view.spec.files} files)`,
          `rivers ${h.stats.rivers} · lakes ${h.stats.lakes}`,
          ...(zones
            ? [
                `buildings ${zones.stats.buildings} · fields ${zones.stats.fields}`,
                `road tiles ${zones.stats.roadTiles} · bridges ${zones.stats.bridges}`,
                ...zones.zones.map(
                  (q) =>
                    `  ${q.kind.padEnd(8)} ${String(q.tiles.length).padStart(3)} tiles · ${q.buildings} bldg`,
                ),
              ]
            : []),
          ...Object.entries(count)
            .filter(([k]) => k !== "sea")
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k.padEnd(9)} ${n}`),
          `generated ${h.stats.ms} ms`,
        ].join("\n")
      }
      replaceQuery(params(view))
    }

    const title = document.createElement("div")
    title.innerHTML = "<b>Hex world</b> · 1 land + water · 2 zones + roads"
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
    const sync = () => {
      seedLabel.textContent = `seed ${view.spec.seed}`
    }
    sync()
    const row = document.createElement("div")
    row.style.cssText = "display:flex;gap:6px;align-items:center"
    row.append(
      btn("◀", () => {
        view.spec.seed = Math.max(1, view.spec.seed - (view.grid ? 8 : 1))
        sync()
      }),
      seedLabel,
      btn("▶", () => {
        view.spec.seed += view.grid ? 8 : 1
        sync()
      }),
    )
    const gridBtn = btn(view.grid ? "one island" : "8 seeds", () => {
      view.grid = !view.grid
      gridBtn.textContent = view.grid ? "one island" : "8 seeds"
    })
    const growBtn = btn(view.growth ? "hide growth" : "growth", () => {
      view.growth = !view.growth
      growBtn.textContent = view.growth ? "hide growth" : "growth"
    })
    const zoneBtn = btn(view.zones ? "land only" : "zones", () => {
      view.zones = !view.zones
      zoneBtn.textContent = view.zones ? "land only" : "zones"
    })
    row.append(gridBtn, growBtn, zoneBtn)
    row.style.flexWrap = "wrap"
    panel.append(title, row)
    for (const k of KNOBS) {
      const label = document.createElement("label")
      label.style.cssText = "display:grid;grid-template-columns:96px 1fr 38px;gap:6px;align-items:center"
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
        render()
      }
      label.append(name, input, val)
      panel.append(label)
    }
    panel.append(stats)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "]" || e.key === "[") {
        view.spec.seed = Math.max(1, view.spec.seed + (e.key === "]" ? 1 : -1))
        sync()
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
