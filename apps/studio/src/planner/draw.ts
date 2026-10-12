/**
 * The map painter (Canvas 2D). A plan's shapes are built once into `Path2D`s in metres, grouped by
 * colour, so a redraw is a few dozen fills and strokes under one world transform however big the town
 * is; text, the frame, the compass and the scale bar are drawn after, in screen pixels, so they stay
 * crisp at any zoom. The sun stands upper left: shadows fall down and right.
 */
import type { Vec2 } from "@guildhall/world"
import { cornersOf, toWorld as frameToWorld, type MapData, mix, type Tones } from "./derive.ts"
import { overlayLabels, poiGlyph } from "./glyphs.ts"
import type { Layer } from "./query.ts"
import { cropTones, type Theme } from "./theme.ts"
import { niceLength, type View } from "./view.ts"

/** Shadow offset per metre of height (down and right). */
const SUN: Vec2 = [0.22, 0.3]
/** Toward the sun, for lit roof sides. */
const TO_SUN: Vec2 = [-0.6, -0.8]

export interface DrawOpts {
  theme: Theme
  layers: ReadonlySet<Layer>
  dpr: number
  /** A comparison thumbnail: no text, frame, compass or POIs. */
  thumb?: boolean
  /** Screen space the panels cover, so the compass and scale bar stay clear of them. */
  insets?: { left: number; right: number; top: number; bottom: number }
}

type Group = Map<string, Path2D>

interface Built {
  sheet: Path2D
  water: Path2D
  coast: Path2D
  landClip: Path2D
  blobs: { c: Vec2; r: number; dry: boolean }[]
  ripples: Path2D
  roads: Path2D
  streets: { path: Path2D; width: number }[]
  lanes: Path2D
  trails: Path2D
  plaza: Path2D
  yards: Group
  hedgeLines: Path2D
  lotLines: Path2D
  gardens: Path2D
  fields: { poly: Path2D; stripes: Path2D; tones: [string, string] }[]
  overlays: Group
  houseShadows: Path2D
  roofs: Group
  roofLines: Path2D
  ridges: Group
  chimneys: Path2D
  doors: Path2D
  stalls: Group
  rectShadows: Path2D
  buildings: Group
  piers: Path2D
  pierPlanks: Path2D
  boats: Path2D
  cargo: Path2D
  keep: { body: Path2D; turrets: { c: Vec2; r: number }[]; shadow: Path2D } | null
  natureShadows: Path2D
  natureLow: Group
  canopyRims: Group
  canopies: Group
  highlights: Group
  edges: Record<"town" | "castle" | "farm", { walls: Path2D; hedges: Path2D; fences: Path2D; width: number }>
  towers: Record<"town" | "castle", { c: Vec2; r: number }[]>
  gates: [Vec2, Vec2][]
  walk: Path2D
  nodes: { at: Vec2; kind: string }[]
}

const cache = new WeakMap<MapData, Map<Theme, Built>>()

function poly(path: Path2D, ring: readonly Vec2[], close = true): void {
  const first = ring[0]
  if (!first) return
  path.moveTo(first[0], first[1])
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i] as Vec2
    path.lineTo(p[0], p[1])
  }
  if (close) path.closePath()
}

function circle(path: Path2D, c: Vec2, r: number): void {
  path.moveTo(c[0] + r, c[1])
  path.arc(c[0], c[1], r, 0, Math.PI * 2)
}

const into = (group: Group, key: string): Path2D => {
  let p = group.get(key)
  if (!p) {
    p = new Path2D()
    group.set(key, p)
  }
  return p
}

/** A tiny integer hash for deterministic decoration. */
function hash2(x: number, y: number): number {
  let h =
    Math.imul(Math.floor(x) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.floor(y) ^ 0xc2b2ae35, 0x27d4eb2f)
  h ^= h >>> 15
  return (h >>> 0) / 4294967295
}

/** The convex hull of a footprint and its shadow-shifted copy: the shadow a block casts. */
function castShadow(path: Path2D, corners: readonly Vec2[], h: number): void {
  const off: Vec2 = [SUN[0] * h, SUN[1] * h]
  const pts = [...corners, ...corners.map((p) => [p[0] + off[0], p[1] + off[1]] as Vec2)]
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Vec2[] = []
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] as Vec2, lower[lower.length - 1] as Vec2, p) <= 0
    )
      lower.pop()
    lower.push(p)
  }
  const upper: Vec2[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i] as Vec2
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] as Vec2, upper[upper.length - 1] as Vec2, p) <= 0
    )
      upper.pop()
    upper.push(p)
  }
  poly(path, [...lower.slice(0, -1), ...upper.slice(0, -1)])
}

/** Whether a coast segment lies along the sheet's edge (where the lake was cut by the bounds). */
function onSheetEdge(a: Vec2, b: Vec2, box: MapData["box"]): boolean {
  const near = (v: number, w: number) => Math.abs(v - w) < 0.6
  return (
    (near(a[0], box[0]) && near(b[0], box[0])) ||
    (near(a[0], box[2]) && near(b[0], box[2])) ||
    (near(a[1], box[1]) && near(b[1], box[1])) ||
    (near(a[1], box[3]) && near(b[1], box[3]))
  )
}

function build(map: MapData, theme: Theme): Built {
  const plan = map.plan
  const box = map.box
  const sheet = new Path2D()
  sheet.rect(box[0], box[1], box[2] - box[0], box[3] - box[1])

  const water = new Path2D()
  const coast = new Path2D()
  const landClip = new Path2D()
  landClip.rect(box[0], box[1], box[2] - box[0], box[3] - box[1])
  for (const ring of plan.water) {
    poly(water, ring)
    poly(landClip, ring)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Vec2
      const b = ring[(i + 1) % ring.length] as Vec2
      if (onSheetEdge(a, b, box)) continue
      coast.moveTo(a[0], a[1])
      coast.lineTo(b[0], b[1])
    }
  }

  // Big soft patches of drier and lusher grass, and ripple marks on open water.
  const blobs: Built["blobs"] = []
  const span = Math.max(box[2] - box[0], box[3] - box[1])
  const seed = plan.spec.seed
  for (let i = 0; i < 26; i++) {
    const u = hash2(seed * 31 + i, 7)
    const v = hash2(seed * 17 + i, 13)
    blobs.push({
      c: [box[0] + u * (box[2] - box[0]), box[1] + v * (box[3] - box[1])],
      r: span * (0.06 + 0.1 * hash2(i, seed)),
      dry: hash2(seed, i * 3) > 0.55,
    })
  }
  const ripples = new Path2D()
  for (let i = 0; i < 220; i++) {
    const p: Vec2 = [
      box[0] + hash2(seed + i, 101) * (box[2] - box[0]),
      box[1] + hash2(seed + i, 103) * (box[3] - box[1]),
    ]
    if (!plan.water.some((ring) => inside(ring, p))) continue
    const l = 2.5 + 3 * hash2(i, seed + 5)
    ripples.moveTo(p[0] - l, p[1])
    ripples.quadraticCurveTo(p[0], p[1] - l * 0.35, p[0] + l, p[1])
  }

  const roads = new Path2D()
  const lanes = new Path2D()
  const byWidth = new Map<number, Path2D>()
  for (const e of plan.streets.edges) {
    if (e.cls === "road") poly(roads, e.points, false)
    else {
      const p = byWidth.get(e.width) ?? new Path2D()
      byWidth.set(e.width, p)
      poly(p, e.points, false)
    }
    if (e.cls === "lane") poly(lanes, e.points, false)
  }
  const streets = [...byWidth.entries()].sort((a, b) => b[0] - a[0]).map(([width, path]) => ({ width, path }))
  const trails = new Path2D()
  for (const t of map.trails) poly(trails, t, false)
  const plaza = new Path2D()
  for (const p of plan.plazas) poly(plaza, p)

  const yards: Group = new Map()
  const hedgeLines = new Path2D()
  for (const b of plan.blocks) {
    const key =
      b.use === "lots" ? theme.yard[b.district] : b.use === "harbour" ? theme.yard.harbour : theme.yard[b.use]
    poly(into(yards, key), b.poly)
    if (b.use === "lots" || b.use === "green") poly(hedgeLines, b.poly)
  }

  const lotLines = new Path2D()
  const gardens = new Path2D()
  for (const l of plan.lots) {
    const c = cornersOf(l.origin, l.rot, l.w, l.depth)
    poly(lotLines, c)
    if (l.status === "garden") poly(gardens, c)
  }

  const fields = plan.fields.map((f) => {
    const p = new Path2D()
    poly(p, f.poly)
    const stripes = new Path2D()
    const xs = f.poly.map((q) => q[0])
    const zs = f.poly.map((q) => q[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const reach = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 1
    const dir: Vec2 = [Math.cos(f.rows), Math.sin(f.rows)]
    const across: Vec2 = [-dir[1], dir[0]]
    for (let k = -reach; k <= reach; k += 1.4) {
      const o: Vec2 = [cx + across[0] * k, cz + across[1] * k]
      stripes.moveTo(o[0] - dir[0] * reach, o[1] - dir[1] * reach)
      stripes.lineTo(o[0] + dir[0] * reach, o[1] + dir[1] * reach)
    }
    return { poly: p, stripes, tones: cropTones(f.crop, theme) }
  })

  const overlays: Group = new Map()
  for (const o of map.overlays) {
    const tone = o.kind === "quay" ? theme.timber[1] : o.kind === "sand" ? theme.water.sand : theme.road.fill
    poly(into(overlays, tone), o.poly)
  }

  // Houses: a gabled roof reads as two halves, the one facing the sun lighter, split by the ridge.
  const houseShadows = new Path2D()
  const roofs: Group = new Map()
  const ridges: Group = new Map()
  const roofLines = new Path2D()
  const chimneys = new Path2D()
  const doors = new Path2D()
  for (const h of map.houses) {
    const tones: Tones = theme.roofInk ?? h.roof
    const corners = cornersOf(h.c, h.rot, h.w, h.d)
    castShadow(houseShadows, corners, h.h)
    poly(roofLines, corners)
    const L = (p: Vec2) => frameToWorld(h.c, h.rot, p)
    const hw = h.w / 2
    const hd = h.d / 2
    if (h.ridge === "x" || h.ridge === "z") {
      const alongX = h.ridge === "x"
      // The two slopes, each with its outward normal in the house frame.
      const halves: [Vec2[], Vec2][] = alongX
        ? [
            [
              [
                [-hw, -hd],
                [hw, -hd],
                [hw, 0],
                [-hw, 0],
              ],
              [0, -1],
            ],
            [
              [
                [-hw, 0],
                [hw, 0],
                [hw, hd],
                [-hw, hd],
              ],
              [0, 1],
            ],
          ]
        : [
            [
              [
                [-hw, -hd],
                [0, -hd],
                [0, hd],
                [-hw, hd],
              ],
              [-1, 0],
            ],
            [
              [
                [0, -hd],
                [hw, -hd],
                [hw, hd],
                [0, hd],
              ],
              [1, 0],
            ],
          ]
      for (const [quad, n] of halves) {
        const wn = frameToWorld([0, 0], h.rot, n)
        const lit = wn[0] * TO_SUN[0] + wn[1] * TO_SUN[1] > 0
        poly(into(roofs, lit ? tones[2] : tones[0]), quad.map(L))
      }
      const ridge = into(ridges, mix(tones[2], "#fff7e6", 0.35))
      const a = L(alongX ? [-hw, 0] : [0, -hd])
      const b = L(alongX ? [hw, 0] : [0, hd])
      ridge.moveTo(a[0], a[1])
      ridge.lineTo(b[0], b[1])
    } else if (h.ridge === "point") {
      const tip = L([0, 0])
      const cs = corners
      for (let i = 0; i < 4; i++) {
        const a = cs[i] as Vec2
        const b = cs[(i + 1) % 4] as Vec2
        const mid: Vec2 = [(a[0] + b[0]) / 2 - tip[0], (a[1] + b[1]) / 2 - tip[1]]
        const lit = mid[0] * TO_SUN[0] + mid[1] * TO_SUN[1] > 0
        poly(into(roofs, lit ? tones[2] : tones[0]), [tip, a, b])
      }
    } else poly(into(roofs, tones[1]), corners)
    if (h.chimney) {
      const c = L(h.chimney)
      poly(chimneys, cornersOf(c, h.rot, 0.9, 0.9))
    }
    if (h.door) {
      const a = L([h.door[0], hd])
      const b = L([h.door[0], hd + 0.9])
      doors.moveTo(a[0], a[1])
      doors.lineTo(b[0], b[1])
    }
  }

  const stalls: Group = new Map()
  const buildings: Group = new Map()
  const rectShadows = new Path2D()
  const piers = new Path2D()
  const pierPlanks = new Path2D()
  const boats = new Path2D()
  const cargo = new Path2D()
  let keep: Built["keep"] = null
  for (const r of map.rects) {
    const corners = cornersOf(r.c, r.rot, r.w, r.d)
    if (r.kind === "pier") {
      poly(piers, corners)
      for (let k = -r.d / 2 + 0.6; k < r.d / 2; k += 0.6) {
        const a = frameToWorld(r.c, r.rot, [-r.w / 2, k])
        const b = frameToWorld(r.c, r.rot, [r.w / 2, k])
        pierPlanks.moveTo(a[0], a[1])
        pierPlanks.lineTo(b[0], b[1])
      }
      continue
    }
    if (r.kind === "boat") {
      // A hull: pointed at the bow (+z), round at the stern.
      const L = (p: Vec2) => frameToWorld(r.c, r.rot, p)
      const w = r.w / 2
      const d = r.d / 2
      const bow = L([0, d])
      const p1 = L([w, d * 0.2])
      const p2 = L([w * 0.8, -d])
      const p3 = L([-w * 0.8, -d])
      const p4 = L([-w, d * 0.2])
      boats.moveTo(bow[0], bow[1])
      boats.quadraticCurveTo(L([w, d * 0.75])[0], L([w, d * 0.75])[1], p1[0], p1[1])
      boats.lineTo(p2[0], p2[1])
      boats.lineTo(p3[0], p3[1])
      boats.lineTo(p4[0], p4[1])
      boats.quadraticCurveTo(L([-w, d * 0.75])[0], L([-w, d * 0.75])[1], bow[0], bow[1])
      boats.closePath()
      continue
    }
    if (r.kind === "cargo") {
      poly(cargo, corners)
      continue
    }
    if (r.kind === "keep") {
      const body = new Path2D()
      poly(body, corners)
      const shadow = new Path2D()
      castShadow(shadow, corners, r.h)
      const tr = Math.min(r.w, r.d) * 0.17
      keep = { body, shadow, turrets: [...corners, r.c].map((c, i) => ({ c, r: i === 4 ? tr * 1.5 : tr })) }
      continue
    }
    castShadow(rectShadows, corners, r.h)
    if (r.kind === "stall") poly(into(stalls, theme.roofInk ? theme.roofInk[2] : r.tone), corners)
    else poly(into(buildings, theme.roofInk ? theme.roofInk[1] : r.tone), corners)
  }

  // Nature: low things (crops, flowers, animals, hay, rocks) flat; bushes and trees as canopies.
  const natureShadows = new Path2D()
  const natureLow: Group = new Map()
  const canopyRims: Group = new Map()
  const canopies: Group = new Map()
  const highlights: Group = new Map()
  for (const n of map.nature) {
    const tones: Tones =
      theme.treeInk && (n.kind === "tree" || n.kind === "bush" || n.kind === "orchard")
        ? theme.treeInk
        : n.tone
    if (n.kind === "crop" || n.kind === "flower" || n.kind === "animal") {
      circle(
        into(natureLow, n.kind === "crop" ? tones[0] : tones[1]),
        n.c,
        Math.min(n.r, n.kind === "animal" ? 0.8 : 0.45),
      )
      continue
    }
    if (n.kind === "rock" || n.kind === "hay") {
      circle(natureShadows, [n.c[0] + SUN[0] * n.h, n.c[1] + SUN[1] * n.h], n.r * 0.9)
      circle(into(natureLow, tones[1]), n.c, n.r * 0.8)
      circle(into(highlights, tones[2]), [n.c[0] - n.r * 0.2, n.c[1] - n.r * 0.25], n.r * 0.4)
      continue
    }
    const r = n.r
    circle(natureShadows, [n.c[0] + SUN[0] * n.h * 0.6, n.c[1] + SUN[1] * n.h * 0.6], r * 0.92)
    circle(into(canopyRims, tones[0]), n.c, r)
    circle(into(canopies, tones[1]), [n.c[0] - r * 0.06, n.c[1] - r * 0.08], r * 0.84)
    circle(into(highlights, tones[2]), [n.c[0] - r * 0.28, n.c[1] - r * 0.32], r * 0.42)
    if (n.kind === "orchard")
      circle(into(natureLow, n.tone[2]), [n.c[0] + r * 0.25, n.c[1] + r * 0.1], r * 0.18)
  }

  const edges: Built["edges"] = {
    town: { walls: new Path2D(), hedges: new Path2D(), fences: new Path2D(), width: 1.4 },
    castle: { walls: new Path2D(), hedges: new Path2D(), fences: new Path2D(), width: 1.4 },
    farm: { walls: new Path2D(), hedges: new Path2D(), fences: new Path2D(), width: 1.4 },
  }
  const towers: Built["towers"] = { town: [], castle: [] }
  const gates: [Vec2, Vec2][] = []
  for (const e of map.edges) {
    const role = e.castle ? "castle" : e.farm ? "farm" : "town"
    const set = edges[role]
    const target = e.kind === "wall" ? set.walls : e.kind === "hedge" ? set.hedges : set.fences
    if (e.kind === "wall") set.width = e.width
    for (const run of e.runs) poly(target, run, false)
    if (role !== "farm") towers[role].push(...e.towers)
    if (e.kind === "wall") gates.push(...e.gates)
  }

  const walk = new Path2D()
  for (const e of plan.streets.edges) poly(walk, e.points, false)
  for (const t of map.trails) poly(walk, t, false)

  return {
    sheet,
    water,
    coast,
    landClip,
    blobs,
    ripples,
    roads,
    streets,
    lanes,
    trails,
    plaza,
    yards,
    hedgeLines,
    lotLines,
    gardens,
    fields,
    overlays,
    houseShadows,
    roofs,
    roofLines,
    ridges,
    chimneys,
    doors,
    stalls,
    rectShadows,
    buildings,
    piers,
    pierPlanks,
    boats,
    cargo,
    keep,
    natureShadows,
    natureLow,
    canopyRims,
    canopies,
    highlights,
    edges,
    towers,
    gates,
    walk,
    nodes: plan.streets.nodes.map((n) => ({ at: n.at, kind: n.kind })),
  }
}

function inside(ring: readonly Vec2[], p: Vec2): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Vec2
    const b = ring[j] as Vec2
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      hit = !hit
  }
  return hit
}

function built(map: MapData, theme: Theme): Built {
  let byTheme = cache.get(map)
  if (!byTheme) {
    byTheme = new Map()
    cache.set(map, byTheme)
  }
  let b = byTheme.get(theme)
  if (!b) {
    b = build(map, theme)
    byTheme.set(theme, b)
  }
  return b
}

/** Seeded value noise in two colours on a tile, for grass and paper grain. */
const tiles = new Map<string, HTMLCanvasElement>()
function noiseTile(
  key: string,
  size: number,
  a: string,
  b: string,
  base: string,
  cell: number,
): HTMLCanvasElement {
  const id = `${key}|${size}|${a}|${b}|${base}|${cell}`
  const hit = tiles.get(id)
  if (hit) return hit
  const c = document.createElement("canvas")
  c.width = size
  c.height = size
  const g = c.getContext("2d") as CanvasRenderingContext2D
  g.fillStyle = base
  g.fillRect(0, 0, size, size)
  const n = size / cell
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = hash2(x * 7 + key.length, y * 13)
      if (v < 0.36) continue
      g.globalAlpha = 0.18 + 0.4 * (v - 0.36)
      g.fillStyle = hash2(x, y + 99) > 0.5 ? a : b
      const r = cell * (0.35 + 0.5 * hash2(x + 3, y))
      g.beginPath()
      g.arc(x * cell + cell / 2, y * cell + cell / 2, r, 0, Math.PI * 2)
      g.fill()
    }
  g.globalAlpha = 1
  tiles.set(id, c)
  return c
}

/** Diagonal ink hatching, for the parchment look's town blocks. */
function hatchTile(ink: string): HTMLCanvasElement {
  const id = `hatch|${ink}`
  const hit = tiles.get(id)
  if (hit) return hit
  const c = document.createElement("canvas")
  c.width = 16
  c.height = 16
  const g = c.getContext("2d") as CanvasRenderingContext2D
  g.strokeStyle = ink
  g.lineWidth = 1.4
  g.beginPath()
  for (const o of [-16, 0, 16]) {
    g.moveTo(o, 16)
    g.lineTo(o + 16, 0)
  }
  g.stroke()
  tiles.set(id, c)
  return c
}

/** Fills the current path with a world-anchored pattern of `tile`, `metres` per tile pixel. */
function patternFill(
  ctx: CanvasRenderingContext2D,
  tile: HTMLCanvasElement,
  metres: number,
  path: Path2D,
): void {
  const pattern = ctx.createPattern(tile, "repeat")
  if (!pattern) return
  pattern.setTransform(new DOMMatrix().scale(metres))
  ctx.fillStyle = pattern
  ctx.fill(path)
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  style: string,
  width: number,
  dash: number[] = [],
): void {
  ctx.strokeStyle = style
  ctx.lineWidth = width
  ctx.setLineDash(dash)
  ctx.stroke(path)
  ctx.setLineDash([])
}

function fillGroup(ctx: CanvasRenderingContext2D, group: Group): void {
  for (const [colour, path] of group) {
    ctx.fillStyle = colour
    ctx.fill(path)
  }
}

/** Draws the map; returns the milliseconds it took. */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  view: View,
  width: number,
  height: number,
  opts: DrawOpts,
): number {
  const t0 = performance.now()
  const { theme, layers, dpr } = opts
  const on = (l: Layer) => layers.has(l)
  const b = built(map, theme)
  const px = 1 / view.scale
  const box = map.box

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.fillStyle = theme.table
  ctx.fillRect(0, 0, width, height)

  // The sheet lies on the table with a soft shadow under it.
  const sx0 = (box[0] - view.cx) * view.scale + width / 2
  const sz0 = (box[1] - view.cz) * view.scale + height / 2
  const sw = (box[2] - box[0]) * view.scale
  const sh = (box[3] - box[1]) * view.scale
  if (!opts.thumb) {
    ctx.save()
    ctx.shadowColor = theme.sheetShadow
    ctx.shadowBlur = 28
    ctx.shadowOffsetY = 8
    ctx.fillStyle = theme.frame.band
    ctx.fillRect(sx0 - 14, sz0 - 14, sw + 28, sh + 28)
    ctx.restore()
  }

  // World space from here.
  ctx.setTransform(
    dpr * view.scale,
    0,
    0,
    dpr * view.scale,
    dpr * (width / 2 - view.cx * view.scale),
    dpr * (height / 2 - view.cz * view.scale),
  )
  ctx.save()
  ctx.clip(b.sheet)

  // Land: base, broad patches, then fine grain.
  ctx.fillStyle = theme.land.base
  ctx.fill(b.sheet)
  for (const blob of b.blobs) {
    const g = ctx.createRadialGradient(blob.c[0], blob.c[1], 0, blob.c[0], blob.c[1], blob.r)
    const tone = blob.dry ? theme.land.dry : theme.land.lush
    g.addColorStop(0, `${tone}88`)
    g.addColorStop(1, `${tone}00`)
    ctx.fillStyle = g
    ctx.fillRect(blob.c[0] - blob.r, blob.c[1] - blob.r, blob.r * 2, blob.r * 2)
  }
  if (!opts.thumb) {
    ctx.globalAlpha = 0.55
    patternFill(
      ctx,
      noiseTile("grass", 128, theme.land.light, theme.land.dark, theme.land.base, 4),
      0.5,
      b.sheet,
    )
    ctx.globalAlpha = 0.35
    patternFill(
      ctx,
      noiseTile("grass2", 128, theme.land.light, theme.land.dark, theme.land.base, 8),
      2.3,
      b.sheet,
    )
    ctx.globalAlpha = 1
  }

  // Water: deep in the middle, shallow toward the shore, foam at the edge, sand on the land side.
  if (map.plan.water.length > 0) {
    ctx.fillStyle = theme.water.deep
    ctx.fill(b.water)
    ctx.save()
    ctx.clip(b.water)
    const bands: [number, string, number][] = [
      [60, theme.water.mid, 0.35],
      [34, theme.water.mid, 0.45],
      [18, theme.water.shallow, 0.5],
      [9, theme.water.shallow, 0.65],
      [4, theme.water.shallow, 0.8],
    ]
    for (const [w, c, a] of bands) {
      ctx.globalAlpha = a
      strokePath(ctx, b.coast, c, w)
    }
    ctx.globalAlpha = 1
    if (!opts.thumb) {
      strokePath(ctx, b.ripples, theme.water.ripple, Math.max(0.35, px * 1.2))
      if (theme.look === "parchment")
        for (const w of [3, 7, 12]) strokePath(ctx, b.coast, theme.water.ripple, w + px * 2.2)
    }
    strokePath(ctx, b.coast, theme.water.foam, 1.6)
    ctx.globalAlpha = 0.55
    strokePath(ctx, b.coast, theme.water.foam, 5.5, [2.2, 3.4])
    ctx.globalAlpha = 1
    ctx.restore()
    ctx.save()
    ctx.clip(b.landClip, "evenodd")
    strokePath(ctx, b.coast, theme.water.sand, 6)
    strokePath(ctx, b.coast, mix(theme.water.sand, theme.land.base, 0.5), 9, [])
    strokePath(ctx, b.coast, theme.water.sand, 5)
    ctx.restore()
    if (theme.look === "parchment") strokePath(ctx, b.coast, theme.water.ink, px * 1.6)
  }

  if (on("harbour")) fillGroup(ctx, b.overlays)

  if (on("streets")) {
    // Edges first (all of them), then fills, so junctions join without seams.
    strokePath(ctx, b.roads, theme.road.edge, 4 + 1.2)
    strokePath(ctx, b.trails, theme.road.edge, 1.8 + 0.6)
    for (const s of b.streets) strokePath(ctx, s.path, theme.street.edge, s.width + 1 + 0.9)
    strokePath(ctx, b.roads, theme.road.fill, 4)
    strokePath(ctx, b.trails, theme.road.fill, 1.8)
    for (const s of b.streets) strokePath(ctx, s.path, theme.street.fill, s.width + 1)
    ctx.fillStyle = theme.street.edge
    ctx.fill(b.plaza)
    ctx.save()
    ctx.clip(b.plaza)
    ctx.fillStyle = theme.plaza.fill
    ctx.fill(b.plaza)
    strokePath(ctx, b.plaza, theme.plaza.fill, 1.4)
    ctx.restore()
    if (!opts.thumb && view.scale > 1.6) {
      ctx.globalAlpha = 0.5
      const speck = noiseTile(
        "cobble",
        64,
        theme.street.speck[0],
        theme.street.speck[1],
        theme.street.fill,
        4,
      )
      ctx.save()
      ctx.clip(b.plaza)
      patternFill(ctx, speck, 0.18, b.sheet)
      ctx.restore()
      ctx.globalAlpha = 1
    }
  }

  if (on("blocks")) {
    fillGroup(ctx, b.yards)
    if (theme.hatch && !opts.thumb) {
      const tile = hatchTile(theme.hatch)
      for (const p of b.yards.values()) patternFill(ctx, tile, 0.12, p)
    }
    strokePath(ctx, b.hedgeLines, theme.hedge.base, 1.3)
    if (!opts.thumb && view.scale > 1) strokePath(ctx, b.hedgeLines, theme.hedge.light, 0.55, [0.2, 1.1])
  }

  if (on("lots")) {
    ctx.fillStyle = theme.lots.garden
    ctx.fill(b.gardens)
    strokePath(ctx, b.lotLines, theme.lots.line, Math.max(0.12, px * 0.9))
  }

  if (on("farms")) {
    for (const f of b.fields) {
      ctx.fillStyle = f.tones[0]
      ctx.fill(f.poly)
      ctx.save()
      ctx.clip(f.poly)
      strokePath(ctx, f.stripes, f.tones[1], 0.55)
      ctx.restore()
      strokePath(ctx, f.poly, theme.field.edge, px * 0.8)
    }
    const f = b.edges.farm
    strokePath(ctx, f.hedges, theme.hedge.base, 1.2)
    strokePath(ctx, f.fences, theme.fence, Math.max(0.22, px * 1.1))
    if (view.scale > 2.2) strokePath(ctx, f.fences, theme.fence, 0.55, [0.01, 2.3])
  }

  // Cast shadows, all before anything that stands, so none falls on a roof.
  ctx.fillStyle = theme.shadow
  if (on("houses")) {
    ctx.fill(b.houseShadows)
    ctx.fill(b.rectShadows)
  }
  if (on("castle") && b.keep) ctx.fill(b.keep.shadow)
  if (on("nature")) ctx.fill(b.natureShadows)

  if (on("harbour")) {
    ctx.fillStyle = theme.timber[1]
    ctx.fill(b.piers)
    strokePath(ctx, b.pierPlanks, theme.timber[0], 0.12)
    strokePath(ctx, b.piers, theme.timber[0], px * 1)
    ctx.fillStyle = theme.timber[2]
    ctx.fill(b.boats)
    strokePath(ctx, b.boats, theme.timber[0], Math.max(0.15, px))
    ctx.fillStyle = theme.timber[0]
    ctx.fill(b.cargo)
  }

  const walls = (set: Built["edges"]["town"], showTowers: { c: Vec2; r: number }[], kitBlue: boolean) => {
    strokePath(ctx, set.hedges, theme.hedge.base, 1.5)
    if (view.scale > 1) strokePath(ctx, set.hedges, theme.hedge.light, 0.7, [0.2, 1.2])
    strokePath(ctx, set.fences, theme.fence, Math.max(0.3, px * 1.4))
    if (view.scale > 1.6) strokePath(ctx, set.fences, theme.fence, 0.6, [0.01, 2.3])
    strokePath(ctx, set.walls, theme.wall.edge, set.width + 0.7)
    strokePath(ctx, set.walls, theme.wall.fill, set.width)
    strokePath(ctx, set.walls, theme.wall.top, set.width * 0.34)
    if (view.scale > 1.2) strokePath(ctx, set.walls, theme.wall.crenel, set.width * 0.34, [0.7, 0.9])
    for (const t of showTowers) {
      ctx.beginPath()
      ctx.arc(t.c[0] + SUN[0] * 4, t.c[1] + SUN[1] * 4, t.r, 0, Math.PI * 2)
      ctx.fillStyle = theme.shadow
      ctx.fill()
    }
    for (const t of showTowers) {
      ctx.beginPath()
      ctx.arc(t.c[0], t.c[1], t.r + 0.35, 0, Math.PI * 2)
      ctx.fillStyle = theme.wall.edge
      ctx.fill()
      ctx.beginPath()
      ctx.arc(t.c[0], t.c[1], t.r, 0, Math.PI * 2)
      ctx.fillStyle = theme.wall.fill
      ctx.fill()
      if (kitBlue && theme.look === "colour") {
        // A conical roof: dark half away from the sun, light half toward it.
        const [dk, , lt] = theme.keep.roof
        ctx.beginPath()
        ctx.arc(t.c[0], t.c[1], t.r * 0.82, 0, Math.PI * 2)
        ctx.fillStyle = dk
        ctx.fill()
        ctx.beginPath()
        ctx.arc(t.c[0], t.c[1], t.r * 0.82, Math.PI * 0.8, Math.PI * 1.8)
        ctx.fillStyle = lt
        ctx.fill()
        ctx.beginPath()
        ctx.arc(t.c[0], t.c[1], t.r * 0.14, 0, Math.PI * 2)
        ctx.fillStyle = "#f1d590"
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.arc(t.c[0], t.c[1], t.r * 0.62, 0, Math.PI * 2)
        ctx.fillStyle = theme.wall.towerTop
        ctx.fill()
        ctx.lineWidth = Math.max(0.15, px)
        ctx.strokeStyle = theme.wall.crenel
        ctx.stroke()
      }
    }
  }
  const blueTowers = map.plan.spec.tier === "city" || map.plan.spec.tier === "capital"
  if (on("walls")) {
    walls(b.edges.town, b.towers.town, blueTowers)
    // Gates: a dark threshold across the gap and a jamb at each side.
    for (const [a, c] of b.gates) {
      const d: Vec2 = [c[0] - a[0], c[1] - a[1]]
      const l = Math.hypot(d[0], d[1]) || 1
      const n: Vec2 = [(-d[1] / l) * 1.6, (d[0] / l) * 1.6]
      ctx.beginPath()
      ctx.moveTo(a[0] + n[0], a[1] + n[1])
      ctx.lineTo(c[0] + n[0], c[1] + n[1])
      ctx.moveTo(a[0] - n[0], a[1] - n[1])
      ctx.lineTo(c[0] - n[0], c[1] - n[1])
      ctx.strokeStyle = theme.wall.edge
      ctx.lineWidth = 0.5
      ctx.stroke()
    }
  }
  if (on("castle")) {
    walls(b.edges.castle, b.towers.castle, true)
    if (b.keep) {
      ctx.fillStyle = theme.wall.edge
      ctx.fill(b.keep.body)
      ctx.fillStyle = theme.keep.stone
      ctx.fill(b.keep.body)
      strokePath(ctx, b.keep.body, theme.wall.edge, 0.6)
      for (const t of b.keep.turrets) {
        ctx.beginPath()
        ctx.arc(t.c[0], t.c[1], t.r, 0, Math.PI * 2)
        ctx.fillStyle = theme.keep.roof[0]
        ctx.fill()
        ctx.beginPath()
        ctx.arc(t.c[0], t.c[1], t.r, Math.PI * 0.8, Math.PI * 1.8)
        ctx.fillStyle = theme.keep.roof[2]
        ctx.fill()
        ctx.beginPath()
        ctx.arc(t.c[0], t.c[1], t.r, 0, Math.PI * 2)
        ctx.strokeStyle = theme.wall.edge
        ctx.lineWidth = 0.35
        ctx.stroke()
      }
    }
  }

  if (on("houses")) {
    fillGroup(ctx, b.buildings)
    fillGroup(ctx, b.roofs)
    fillGroup(ctx, b.stalls)
    strokePath(ctx, b.roofLines, theme.outline, Math.max(0.16, px * 0.9))
    if (view.scale > 1.1) {
      for (const [colour, path] of b.ridges) strokePath(ctx, path, colour, 0.35)
      ctx.fillStyle = "#5b3427"
      ctx.fill(b.chimneys)
      strokePath(ctx, b.doors, theme.timber[0], 0.9)
    }
  }

  if (on("nature")) {
    fillGroup(ctx, b.natureLow)
    fillGroup(ctx, b.canopyRims)
    fillGroup(ctx, b.canopies)
    if (!opts.thumb) fillGroup(ctx, b.highlights)
  }

  if (on("walk")) {
    strokePath(ctx, b.walk, theme.walk.line, px * 1.6, [px * 5, px * 3])
    ctx.fillStyle = theme.walk.node
    for (const n of b.nodes) {
      ctx.beginPath()
      const r = (n.kind === "junction" ? 2.2 : 3.4) * px
      ctx.arc(n.at[0], n.at[1], r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()

  // Screen space: vignette, frame, POIs, labels, compass, scale.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const vg = ctx.createRadialGradient(
    sx0 + sw / 2,
    sz0 + sh / 2,
    Math.min(sw, sh) * 0.35,
    sx0 + sw / 2,
    sz0 + sh / 2,
    Math.max(sw, sh) * 0.75,
  )
  vg.addColorStop(0, "rgba(0,0,0,0)")
  vg.addColorStop(1, theme.vignette)
  ctx.fillStyle = vg
  ctx.fillRect(sx0, sz0, sw, sh)

  if (!opts.thumb) {
    frame(ctx, theme, map.box, view, width, height, sx0, sz0, sw, sh)
    const toScreen = (p: Vec2): Vec2 => [
      (p[0] - view.cx) * view.scale + width / 2,
      (p[1] - view.cz) * view.scale + height / 2,
    ]
    // Farm stations are many and small: they show once the fields are big enough to tell apart.
    if (on("pois"))
      for (const p of map.pois)
        if (p.kind !== "field" || view.scale >= 2.4) poiGlyph(ctx, theme, toScreen(p.at), p.kind)
    if (on("labels")) overlayLabels(ctx, theme, map.labels, toScreen, view.scale)
    const ins = opts.insets ?? { left: 0, right: 0, top: 0, bottom: 0 }
    compass(ctx, theme, width - ins.right - 62, ins.top + 66)
    scaleBar(ctx, theme, view.scale, ins.left + 24, height - ins.bottom - 30)
  }
  ctx.restore()
  return performance.now() - t0
}

/** The sheet's neatline: a band with alternating 10 m ticks, like an old survey's graduated border. */
function frame(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  box: MapData["box"],
  view: View,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const band = 7
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.frame.line
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1)
  ctx.strokeRect(x - band - 0.5, y - band - 0.5, w + 2 * band + 1, h + 2 * band + 1)
  const step = view.scale * 10 < 6 ? 50 : 10
  const ticks = (from: number, to: number, put: (a: number, b: number, dark: boolean) => void) => {
    let i = 0
    for (let m = from; m < to; m += step, i++) put(m, Math.min(to, m + step), i % 2 === 0)
  }
  const sx = (m: number) => (m - view.cx) * view.scale + width / 2
  const sz = (m: number) => (m - view.cz) * view.scale + height / 2
  ticks(box[0], box[2], (a, b, dark) => {
    ctx.fillStyle = dark ? theme.frame.tickA : theme.frame.tickB
    ctx.fillRect(sx(a), y - band + 1.5, sx(b) - sx(a), band - 3)
    ctx.fillRect(sx(a), y + h + 1.5, sx(b) - sx(a), band - 3)
  })
  ticks(box[1], box[3], (a, b, dark) => {
    ctx.fillStyle = dark ? theme.frame.tickA : theme.frame.tickB
    ctx.fillRect(x - band + 1.5, sz(a), band - 3, sz(b) - sz(a))
    ctx.fillRect(x + w + 1.5, sz(a), band - 3, sz(b) - sz(a))
  })
}

/** An eight-point compass rose, north up. */
function compass(ctx: CanvasRenderingContext2D, theme: Theme, x: number, y: number): void {
  const R = 30
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.arc(0, 0, R + 6, 0, Math.PI * 2)
  ctx.fillStyle = "rgba(244, 234, 210, 0.82)"
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.frame.line
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, R - 4, 0, Math.PI * 2)
  ctx.lineWidth = 0.75
  ctx.stroke()
  const point = (angle: number, len: number, wide: number, dark: string, light: string) => {
    const dx = Math.sin(angle)
    const dy = -Math.cos(angle)
    const nx = -dy
    const ny = dx
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(dx * len, dy * len)
    ctx.lineTo(nx * wide, ny * wide)
    ctx.closePath()
    ctx.fillStyle = dark
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(dx * len, dy * len)
    ctx.lineTo(-nx * wide, -ny * wide)
    ctx.closePath()
    ctx.fillStyle = light
    ctx.fill()
  }
  for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, R * 0.62, 4, "#8a6a2c", "#e8d6a8")
  for (let i = 0; i < 4; i++)
    point((i * Math.PI) / 2, R, 6, i === 0 ? "#9b2a1f" : theme.frame.line, i === 0 ? "#d9584a" : "#f4ead2")
  ctx.beginPath()
  ctx.arc(0, 0, 2.6, 0, Math.PI * 2)
  ctx.fillStyle = "#dcb662"
  ctx.fill()
  ctx.font = '400 13px "Marcellus SC", Georgia, serif'
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = theme.frame.line
  ctx.fillText("N", 0, -R - 9)
  ctx.restore()
}

/** A scale bar in metres: four alternating segments and their numbers. */
function scaleBar(ctx: CanvasRenderingContext2D, theme: Theme, scale: number, x: number, y: number): void {
  const metres = niceLength(scale, 150)
  const w = metres * scale
  ctx.save()
  ctx.fillStyle = "rgba(244, 234, 210, 0.86)"
  ctx.fillRect(x - 10, y - 24, w + 46, 36)
  ctx.strokeStyle = theme.frame.line
  ctx.lineWidth = 1
  ctx.strokeRect(x - 10.5, y - 24.5, w + 47, 37)
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? theme.frame.line : "#f4ead2"
    ctx.fillRect(x + (i * w) / 4, y, w / 4, 5)
  }
  ctx.strokeRect(x + 0.5, y + 0.5, w, 5)
  ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace'
  ctx.fillStyle = theme.frame.line
  ctx.textAlign = "center"
  ctx.fillText("0", x, y - 5)
  ctx.fillText(String(metres / 2), x + w / 2, y - 5)
  ctx.textAlign = "left"
  ctx.fillText(`${metres} m`, x + w - 4, y - 5)
  ctx.restore()
}
