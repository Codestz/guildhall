/**
 * Hex map (`/lab/hexmap`): step 1 of the hex world seen from above (decisions.md "Clean restart on hex"):
 * every tile drawn as a hexagon in its ground's colour, lighter the higher it stands, with a dark rim
 * where it drops to a lower neighbour (so the steps read), rivers as lines from tile to tile. One
 * island large, or eight seeds, or one seed growing; every knob in the Viewer's Inspector and the query.
 */

import { type KnobSection, type KnobValues, roman, type Stat } from "@guildhall/ui"
import {
  HEX_ISLAND_DEFAULTS,
  type HexIsland,
  type HexIslandSpec,
  type HexZones,
  hexCentre,
  hexIsland,
  hexZones,
  kindOf,
  useOf as tileUse,
} from "@guildhall/world"
import type { Screen } from "../screens.ts"
import { href } from "../shell/router.ts"
import { mountViewer } from "../shell/viewer.ts"

/** The map's own lettering: the studio's mono, as the read-outs beside it. */
const MAP_FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace'

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
    C.forEach(([dx, dy], k) => {
      if (k) g.lineTo(px + dx, py + dy)
      else g.moveTo(px + dx, py + dy)
    })
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

/** The map's zoom while drawing, so labels and icons keep their size on screen. */
let zoomNow = 1

/** A tile's content as a little glyph: what its prefab will hold. */
function paintContent(
  g: CanvasRenderingContext2D,
  u: string,
  px: number,
  py: number,
  s: number,
  hexPath: (x: number, y: number, k?: number) => void,
  i: number,
): void {
  const r = (k: number) => {
    const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  const dot = (x: number, y: number, rad: number, c: string) => {
    g.fillStyle = c
    g.beginPath()
    g.arc(px + x * s, py + y * s, Math.max(0.6, rad * s), 0, Math.PI * 2)
    g.fill()
  }
  const tree = (x: number, y: number, rad: number, c = "#2f6a33") => {
    dot(x + 0.05, y + 0.08, rad, "rgba(0,0,0,0.25)")
    dot(x, y, rad, c)
  }
  const house = (x: number, y: number, w: number, roof: string) => {
    const W = w * s
    g.fillStyle = "#f3e9d4"
    g.fillRect(px + x * s - W / 2, py + y * s - W / 2, W, W)
    g.fillStyle = roof
    g.beginPath()
    g.moveTo(px + x * s - W / 2 - 1, py + y * s - W / 2 + 1)
    g.lineTo(px + x * s, py + y * s - W)
    g.lineTo(px + x * s + W / 2 + 1, py + y * s - W / 2 + 1)
    g.closePath()
    g.fill()
  }
  const rows = (c: string, back: string, angle: number) => {
    g.fillStyle = back
    hexPath(px, py, 0.9)
    g.fill()
    g.save()
    hexPath(px, py, 0.9)
    g.clip()
    g.strokeStyle = c
    g.lineWidth = Math.max(0.6, s * 0.14)
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    for (let k = -3; k <= 3; k++) {
      g.beginPath()
      g.moveTo(px - ca * s + -sa * k * s * 0.28, py - sa * s + ca * k * s * 0.28)
      g.lineTo(px + ca * s + -sa * k * s * 0.28, py + sa * s + ca * k * s * 0.28)
      g.stroke()
    }
    g.restore()
  }
  const icon = (glyph: string) => {
    g.font = `${Math.max(9, s * 1.4)}px system-ui`
    g.textAlign = "center"
    g.textBaseline = "middle"
    g.fillText(glyph, px, py)
    g.textAlign = "start"
    g.textBaseline = "alphabetic"
  }
  switch (u) {
    case "field":
      rows("#c9a33c", "#e6c75e", (i % 3) * 1.05)
      break
    case "orchard":
      for (const [x, y] of [
        [-0.4, -0.3],
        [0.3, -0.35],
        [-0.35, 0.35],
        [0.35, 0.3],
        [0, 0],
      ])
        tree(x!, y!, 0.2, "#4f9a3c")
      break
    case "pasture":
      for (let k = 0; k < 3; k++) dot(r(k) - 0.5, r(k + 5) - 0.5, 0.11, "#ffffff")
      break
    case "woods":
      for (let k = 0; k < 5; k++)
        tree(r(k) * 1.2 - 0.6, r(k + 7) * 1.1 - 0.55, 0.3, k % 2 ? "#2b6232" : "#357a38")
      break
    case "grove":
      tree(r(1) * 0.6 - 0.3, r(2) * 0.6 - 0.3, 0.32, "#3f8a3c")
      tree(r(3) * 0.6 - 0.1, r(4) * 0.6 - 0.1, 0.22, "#4e9a40")
      break
    case "meadow":
      for (let k = 0; k < 3; k++) dot(r(k) - 0.5, r(k + 3) - 0.5, 0.06, ["#f2d24a", "#e86ca0", "#ffffff"][k]!)
      break
    case "hillside":
      dot(r(1) * 0.8 - 0.4, r(2) * 0.8 - 0.4, 0.16, "#8b7d68")
      tree(r(3) * 0.8 - 0.4, r(4) * 0.8 - 0.4, 0.2, "#2f5f3a")
      break
    case "crag":
    case "quarry":
      dot(-0.2, 0.1, 0.3, u === "quarry" ? "#d8d0c2" : "#7d7468")
      dot(0.25, -0.15, 0.22, "#958b7c")
      break
    case "reeds":
      for (let k = 0; k < 4; k++) dot(r(k) - 0.5, r(k + 4) - 0.5, 0.07, "#3d7a4a")
      break
    case "beach":
      if (r(1) < 0.3) dot(r(2) - 0.5, r(3) - 0.5, 0.08, "#b89a6a")
      break
    case "farmstead":
      rows("#c9a33c", "#e6c75e", 0.5)
      house(0, 0.05, 0.75, "#b8483e")
      break
    case "windmill":
      house(0, 0.1, 0.6, "#8a6a4a")
      g.fillStyle = "#3a2a1a"
      icon("✣")
      break
    case "lighthouse":
      g.fillStyle = "#fff"
      icon("☼")
      break
    case "watchtower":
      g.fillStyle = "#3a3a46"
      icon("♜")
      break
    case "ruins":
      g.fillStyle = "#6f6a60"
      icon("⌂")
      break
    case "shrine":
      g.fillStyle = "#f3e9d4"
      icon("✧")
      break
    case "campsite":
      g.fillStyle = "#b8483e"
      icon("▲")
      break
    case "sawmill":
      house(0, 0, 0.7, "#6a4a2a")
      break
    case "garden":
      for (const [x, y] of [
        [-0.35, -0.2],
        [0.3, 0.25],
      ]) {
        g.fillStyle = "#6fa84a"
        g.fillRect(px + (x! - 0.22) * s, py + (y! - 0.16) * s, 0.44 * s, 0.32 * s)
      }
      tree(0.25, -0.35, 0.16, "#4e9a40")
      break
    case "market":
      for (const [x, y, c] of [
        [-0.3, -0.15, "#d8463a"],
        [0.3, 0.1, "#3f7fc4"],
        [-0.05, 0.4, "#e8b13a"],
      ] as const) {
        g.fillStyle = c
        g.fillRect(px + (x - 0.18) * s, py + (y - 0.12) * s, 0.36 * s, 0.24 * s)
      }
      break
    case "well":
      dot(0, 0, 0.22, "#7d7468")
      dot(0, 0, 0.12, "#4f97d6")
      break
    case "square":
      g.fillStyle = "#cfc4ae"
      hexPath(px, py, 0.95)
      g.fill()
      break
    case "dock":
      g.fillStyle = "#8a6038"
      hexPath(px, py, 0.55)
      g.fill()
      break
  }
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
    C.forEach(([dx, dy], i) => {
      if (i) g.lineTo(px + dx * k, py + dy * k)
      else g.moveTo(px + dx * k, py + dy * k)
    })
    g.closePath()
  }
  const centre = (i: number): [number, number] => {
    const [x, y] = hexCentre({ q: grid.q[i]!, r: grid.r[i]! })
    return [cx + x * s, cy + y * s]
  }
  for (let i = 0; i < grid.size; i++) {
    const u = tileUse(z, i)
    const zi = z.zoneOf[i]!
    const [px, py] = centre(i)
    if (zi) {
      g.fillStyle = `${ZONE_COLOUR[z.zones[zi - 1]!.kind] ?? "#fff"}55`
      hexPath(px, py)
      g.fill()
    }
    paintContent(g, u, px, py, s, hexPath, i)
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
        const bridge = tileUse(z, a) === "bridge" || tileUse(z, b) === "bridge"
        if (pass === 0) band(a, b, "#7a5a36", Math.max(2, s * 0.62))
        else band(a, b, bridge ? "#a0703c" : "#e2c68f", Math.max(1.2, s * 0.4))
      }
  // buildings: a small roofed block per tile; the castle a keep
  for (let i = 0; i < grid.size; i++) {
    const u = tileUse(z, i)
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
  // names at the hearts, once a hex is big enough on screen to carry one (a phone zooms in to read them)
  if (s * zoomNow < 3.5) {
    g.textAlign = "start"
    return
  }
  g.font = `600 ${12 / zoomNow}px ${MAP_FONT}`
  g.textAlign = "center"
  for (const zone of z.zones) {
    const [px, py] = centre(zone.tile)
    const label = `${zone.kind} · ${zone.buildings}`
    g.lineWidth = 3 / zoomNow
    g.strokeStyle = "rgba(20,16,12,0.85)"
    g.strokeText(label, px, py - s * 1.6)
    g.fillStyle = "#fff"
    g.fillText(label, px, py - s * 1.6)
  }
  g.textAlign = "start"
}

/** The hex map's knobs: the island spec live (a map regenerates in milliseconds), the view, the zones. */
const SECTIONS: KnobSection[] = [
  {
    title: "View",
    knobs: [
      {
        kind: "segment",
        key: "view",
        label: "Show",
        default: "one",
        options: [
          { value: "one", label: "One island" },
          { value: "grid", label: "Eight seeds" },
          { value: "growth", label: "Growth" },
        ],
      },
      { kind: "stepper", key: "seed", label: "Seed", min: 1, default: 1 },
      {
        kind: "toggle",
        key: "zones",
        label: "Zones and roads",
        hint: "Places, buildings, fields",
        default: true,
      },
    ],
  },
  {
    title: "Island",
    knobs: [
      {
        kind: "range",
        key: "files",
        label: "Repo files",
        min: 0,
        max: 30000,
        step: 100,
        default: HEX_ISLAND_DEFAULTS.files,
      },
      {
        kind: "range",
        key: "coast",
        label: "Coast shape",
        min: 0,
        max: 2,
        step: 0.05,
        default: HEX_ISLAND_DEFAULTS.coast,
      },
      {
        kind: "range",
        key: "hills",
        label: "Hill levels",
        min: 0,
        max: 9,
        step: 1,
        default: HEX_ISLAND_DEFAULTS.hills,
      },
      {
        kind: "range",
        key: "rain",
        label: "Rivers",
        min: 0.3,
        max: 3,
        step: 0.05,
        default: HEX_ISLAND_DEFAULTS.rain,
      },
      {
        kind: "range",
        key: "forest",
        label: "Forest",
        min: 0,
        max: 0.7,
        step: 0.01,
        default: HEX_ISLAND_DEFAULTS.forest,
      },
    ],
  },
]

const HELP = [
  { gesture: "Drag", does: "pan" },
  { gesture: "Wheel", does: "zoom" },
  { keys: ["[", "]"], does: "seed" },
]

const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r},${g},${b})`

/** Old links: `?grid=1` and `?growth=1` were two buttons; they are the view knob now. */
function migrate(q: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(q)
  if (!out.has("view")) {
    if (out.get("growth") === "1") out.set("view", "growth")
    else if (out.get("grid") === "1") out.set("view", "grid")
  }
  out.delete("grid")
  out.delete("growth")
  return out
}

function viewOf(values: KnobValues): View {
  const spec = { ...HEX_ISLAND_DEFAULTS, seed: values.seed as number }
  for (const k of KNOB_KEYS) spec[k] = values[k] as number
  return {
    spec,
    grid: values.view === "grid",
    growth: values.view === "growth",
    zones: values.zones as boolean,
  }
}

const KNOB_KEYS = ["files", "coast", "hills", "rain", "forest"] as const

export const hexmap: Screen = {
  id: "hexmap",
  title: "Hex map",
  mount(host, ctx) {
    const query = migrate(ctx.query)
    const viewer = mountViewer(host, { ...ctx, query }, "hexmap", {
      title: "The island from above",
      subtitle:
        "Heights in steps, sand, cliffs, rivers, lakes and forest; places, roads and fields over them.",
      sections: SECTIONS,
      help: HELP,
      inspector: true,
      onKnobs: (values) => {
        view = viewOf(values)
        render()
      },
      actions: [
        {
          label: "Open in 3D",
          primary: true,
          // this island in 3D: the town screen builds the same spec (seed, files and the shape knobs)
          run: () => {
            const q = new URLSearchParams()
            for (const k of KNOB_KEYS)
              if (view.spec[k] !== HEX_ISLAND_DEFAULTS[k]) q.set(k, String(view.spec[k]))
            q.set("files", String(view.spec.files))
            q.set("town", String(view.spec.seed))
            window.location.assign(href("town", q))
          },
        },
      ],
    })
    const canvas = document.createElement("canvas")
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab"
    canvas.setAttribute("role", "img")
    canvas.setAttribute("aria-label", "The hex island seen from above")
    viewer.stage.append(canvas)
    viewer.attachCanvas(canvas)
    let view = viewOf(viewer.values())

    const cam = { x: 0, y: 0, zoom: 1 }
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault()
        const k = Math.exp(-e.deltaY * 0.0015)
        const z = Math.min(12, Math.max(1, cam.zoom * k))
        const f = z / cam.zoom
        cam.x = e.offsetX - (e.offsetX - cam.x) * f
        cam.y = e.offsetY - (e.offsetY - cam.y) * f
        cam.zoom = z
        if (z === 1) {
          cam.x = 0
          cam.y = 0
        }
        render()
      },
      { passive: false },
    )
    let drag: { x: number; y: number } | null = null
    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY }
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = "grabbing"
    })
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return
      cam.x += e.clientX - drag.x
      cam.y += e.clientY - drag.y
      drag = { x: e.clientX, y: e.clientY }
      render()
    })
    canvas.addEventListener("pointerup", () => {
      drag = null
      canvas.style.cursor = "grab"
    })

    let described = ""
    const render = (): void => {
      const key = JSON.stringify(view)
      const describe = key !== described
      described = key
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const W = viewer.stage.clientWidth
      const H = viewer.stage.clientHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      const g = canvas.getContext("2d")
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = "rgb(52,120,170)"
      g.fillRect(0, 0, W, H)
      // the map centres in what the Inspector leaves free
      const left = 8
      const aw = W - left - 8 - viewer.coveredRight()
      const label = (text: string, x: number, y: number) => {
        g.font = `500 12px ${MAP_FONT}`
        g.lineWidth = 3
        g.strokeStyle = "rgba(20,16,12,0.85)"
        g.strokeText(text, x, y)
        g.fillStyle = "#f3e9d4"
        g.fillText(text, x, y)
      }
      if (view.growth) {
        // one seed at growing repo sizes: the land already there never moves
        const sizes = [100, 600, 2000, 6000, 14000, 30000]
        // the sheet starts below the title card
        const top = Math.max(8, viewer.coveredTop("left"))
        const size = Math.min(aw / 3, (H - top - 8) / 2)
        const rows: Stat[] = []
        sizes.forEach((files, k) => {
          const h = hexIsland({ ...view.spec, files })
          const x = left + (k % 3) * size + size / 2
          const y = top + Math.floor(k / 3) * size + size / 2
          draw(g, h, x, y, size, FIT)
          label(`${files.toLocaleString("en-US")} files`, x - size / 2 + 12, y - size / 2 + 22)
          rows.push({ label: `${files.toLocaleString("en-US")} files`, value: h.stats.land, unit: "tiles" })
        })
        if (describe)
          viewer.setInfo({
            title: `Island ${roman(view.spec.seed)} growing`,
            figures: [{ label: "Seed", value: view.spec.seed }],
          })
        if (describe) viewer.setReadout([{ title: "Growth", meta: "same seed, more files", rows }])
      } else if (view.grid) {
        const top = Math.max(8, viewer.coveredTop("left"))
        const size = Math.min(aw / 4, (H - top - 8) / 2)
        const rows: Stat[] = []
        for (let k = 0; k < 8; k++) {
          const seed = view.spec.seed + k
          const h = hexIsland({ ...view.spec, seed })
          const x = left + (k % 4) * size + size / 2
          const y = top + Math.floor(k / 4) * size + size / 2
          draw(g, h, x, y, size, FIT)
          label(`Seed ${seed}`, x - size / 2 + 12, y - size / 2 + 22)
          rows.push({ label: `Seed ${seed}`, value: `${h.stats.rivers} rivers · ${h.stats.lakes} lakes` })
        }
        if (describe)
          viewer.setInfo({
            title: `Seeds ${roman(view.spec.seed)}–${roman(view.spec.seed + 7)}`,
            figures: [{ label: "Repo files", value: view.spec.files }],
          })
        if (describe) viewer.setReadout([{ title: "Seeds", rows }])
      } else {
        const h = hexIsland(view.spec)
        const zones = view.zones ? hexZones(h) : undefined
        const size = Math.min(aw, H - 16) * 1.02
        // zoom about the cursor, drag to pan (wheel / drag on the map)
        zoomNow = cam.zoom
        g.save()
        g.translate(cam.x, cam.y)
        g.scale(cam.zoom, cam.zoom)
        draw(g, h, left + aw / 2, H / 2, size, FIT, zones)
        g.restore()
        if (!describe) return
        const count: Record<string, number> = {}
        for (let i = 0; i < h.grid.size; i++) count[kindOf(h, i)] = (count[kindOf(h, i)] ?? 0) + 1
        viewer.setInfo({
          title: `Island ${roman(view.spec.seed)}`,
          figures: [
            { label: "Land tiles", value: h.stats.land },
            ...(zones
              ? [
                  { label: "Places", value: zones.zones.length },
                  { label: "Buildings", value: zones.stats.buildings },
                ]
              : [{ label: "Rivers", value: h.stats.rivers }]),
          ],
        })
        viewer.setReadout([
          {
            title: "Summary",
            rows: [
              { label: "Repo files", value: view.spec.files },
              { label: "Land tiles", value: h.stats.land },
              { label: "Rivers", value: h.stats.rivers },
              { label: "Lakes", value: h.stats.lakes },
              ...(zones
                ? [
                    { label: "Buildings", value: zones.stats.buildings },
                    { label: "Fields", value: zones.stats.fields },
                    { label: "Road tiles", value: zones.stats.roadTiles },
                    { label: "Bridges", value: zones.stats.bridges },
                  ]
                : []),
              { label: "Generated in", value: h.stats.ms, unit: "ms" },
            ],
          },
          ...(zones
            ? [
                {
                  title: "Places",
                  meta: `${zones.zones.length}`,
                  folded: true,
                  legend: zones.zones.map((q) => ({
                    colour: ZONE_COLOUR[q.kind] ?? "#f3e9d4",
                    label: q.kind,
                    value: q.tiles.length,
                    note: `tiles · ${q.buildings} bldg`,
                  })),
                },
              ]
            : []),
          {
            title: "Ground",
            folded: true,
            legend: Object.entries(count)
              .filter(([k]) => k !== "sea")
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => ({ colour: rgb(COLOUR[k] ?? [255, 0, 255]), label: k, value: n })),
          },
        ])
      }
    }

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return
      if (e.key === "]" || e.key === "[") {
        const step = view.grid ? 8 : 1
        viewer.setValues({ seed: Math.max(1, view.spec.seed + (e.key === "]" ? step : -step)) })
        view = viewOf(viewer.values())
        render()
      }
    }
    window.addEventListener("keydown", onKey)
    const ro = new ResizeObserver(() => render())
    ro.observe(viewer.stage)
    const offLayout = viewer.onLayout(render)
    render()
    return () => {
      ro.disconnect()
      offLayout()
      window.removeEventListener("keydown", onKey)
      viewer.dispose()
    }
  },
}
