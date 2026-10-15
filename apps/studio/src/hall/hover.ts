/**
 * Hovering a place on desktop (living work's second half): a small tip in the HUD's own look (the badge
 * bar's `.hud-tip`) beside the pointer, naming the place under it (its folder, what it is) and, while
 * the work touches it, what is happening there now and who does it (hall/living.ts `about`).
 *
 * The place is picked by hex maths, not by meshes: the pointer's ray is marched over the ground's height
 * field to where it meets the ground (world hex/pick.ts `pickGround`), and the tile there is looked up in
 * the island's hex → place lookup (job.ts `MapStage.tiles`). A pick is made at most once a frame, only
 * while the pointer moves (and four times a second while the tip shows, as the camera may glide).
 *
 * Mouse only: a touch or a pen never shows it (there a tap on a plate opens the place, as before), and a
 * page on a device with no hover does not mount it. It never shows while the camera is dragged (a button
 * held), nor over the HUD, a plate or a hero's chip, and a wheel's zoom hides it until the pointer moves.
 */
import type { Stage } from "@guildhall/render"
import type { PlaceLiving } from "@guildhall/sim"
import { HEX_TILE_SIZE, hexGrid, pickGround } from "@guildhall/world"
import type { HudParts } from "../hexworld/index.ts"

/** How long the pointer rests on a place before its tip shows, ms. */
export const HOVER_DWELL_MS = 160
/** How often a shown tip is read again (the work moves on, the camera glides), ms. */
export const HOVER_READ_MS = 250

export interface HoverTip {
  /** The place's name (its folder's own name, or its path). */
  title: string
  /** The mono line: its path and what it is ("packages/world · village"). */
  detail: string
  /** What is happening there now, a line each (none at rest). */
  lines: { text: string; tone: "read" | "edit" | "fail" }[]
}

/** The names of a list, as the HUD says them: "A", "A and B", "A, B and 2 more". */
export function namesOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/** The tip's activity lines for a place's living state; `nameOf` names a session. Pure. */
export function activityLines(
  about: PlaceLiving | null,
  nameOf: (id: string) => string | undefined,
): HoverTip["lines"] {
  if (!about) return []
  const named = (ids: readonly string[]) => ids.map((id) => nameOf(id) ?? "a hero")
  const out: HoverTip["lines"] = []
  if (about.blight > 0 && about.failing.length) {
    const whoOf = (f: PlaceLiving["failing"][number]) =>
      (f.who ? nameOf(f.who) : undefined) ?? f.name ?? "a hero"
    const red = about.failing.filter((f) => f.cause === "test").map(whoOf)
    const fell = about.failing.filter((f) => f.cause !== "test").map(whoOf)
    const parts = [
      ...(red.length ? [`${namesOf(red)}'s tests are red`] : []),
      ...(fell.length ? [`${namesOf(fell)} fell here`] : []),
    ]
    out.push({ text: `Failing: ${parts.join("; ")}`, tone: "fail" })
  } else if (about.blight > 0) out.push({ text: "Healing: the fix has landed", tone: "fail" })
  if (about.edit > 0 && about.editors.length)
    out.push({ text: `Edited by ${namesOf(named(about.editors))}`, tone: "edit" })
  if (about.read > 0 && about.readers.length)
    out.push({ text: `Read by ${namesOf(named(about.readers))}`, tone: "read" })
  return out
}

/** Whether this device hovers: a fine pointer that can rest over a thing (no phone, no tablet). */
export const canHover = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches

/** The tip's own lines on the HUD's look (`.hud-tip`, ui hud/style.ts): placed, not hovered into view. */
const STYLE = `
.hud-tip.hall-hover { position: absolute; top: 0; left: 0; z-index: 3; max-width: 320px; transition: opacity 0.15s; }
.hud-tip.hall-hover[data-shown] { opacity: 1; transform: none; }
.hud-tip.hall-hover small { font: var(--t-xs)/1.35 var(--mono); color: var(--faint); }
.hud-tip.hall-hover i { font-style: normal; }
.hud-tip.hall-hover i[data-tone="read"] { color: var(--brass-hi); }
.hud-tip.hall-hover i[data-tone="edit"] { color: var(--paper); }
.hud-tip.hall-hover i[data-tone="fail"] { color: var(--fail); }
@media (prefers-reduced-motion: reduce) { .hud-tip.hall-hover { transition: none; } }
`

/** How far from the pointer the tip sits, CSS px (below and to the right, as a cursor's tip). */
const OFFSET = [14, 18] as const

/**
 * The ray from a camera through a point of its screen (`ndcX`, `ndcY` in −1 … 1), from the inverse of its
 * projection and its world matrix (column-major, as three keeps them): its origin into `o`, its way
 * (unnormalised) into `d`. Pure; allocates nothing.
 */
export function rayThrough(
  ndcX: number,
  ndcY: number,
  projectionInverse: ArrayLike<number>,
  world: ArrayLike<number>,
  o: [number, number, number],
  d: [number, number, number],
): void {
  const p = projectionInverse
  const m = world
  // a point half way into the frustum, in view space
  const z = 0.5
  const w = (p[3] as number) * ndcX + (p[7] as number) * ndcY + (p[11] as number) * z + (p[15] as number)
  const vx =
    ((p[0] as number) * ndcX + (p[4] as number) * ndcY + (p[8] as number) * z + (p[12] as number)) / w
  const vy =
    ((p[1] as number) * ndcX + (p[5] as number) * ndcY + (p[9] as number) * z + (p[13] as number)) / w
  const vz =
    ((p[2] as number) * ndcX + (p[6] as number) * ndcY + (p[10] as number) * z + (p[14] as number)) / w
  o[0] = m[12] as number
  o[1] = m[13] as number
  o[2] = m[14] as number
  d[0] = (m[0] as number) * vx + (m[4] as number) * vy + (m[8] as number) * vz
  d[1] = (m[1] as number) * vx + (m[5] as number) * vy + (m[9] as number) * vz
  d[2] = (m[2] as number) * vx + (m[6] as number) * vy + (m[10] as number) * vz
}

/** The zone under a point of a stage's box (CSS px), or null: no ground there, or no place on it. */
export type ZoneAt = (x: number, y: number) => number | null

/**
 * The hex pick for a stage (see the top of this file): the pointer's ray from the camera, marched over
 * `groundAt` (world hex/pick.ts), the tile it lands on looked up in `tiles`. Made once; a pick allocates
 * nothing.
 */
export function zonePicker(parts: {
  host: HTMLElement
  stage: Pick<Stage, "camera">
  tiles: NonNullable<HudParts["tiles"]>
  groundAt: (x: number, z: number) => number
}): ZoneAt {
  const { host, tiles } = parts
  const grid = hexGrid(tiles.radius)
  // the band the ground's heights fill: sampled once at the tile centres (the ray is marched inside it)
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 0; i < grid.size; i++) {
    const x = Math.sqrt(3) * ((grid.q[i] as number) + (grid.r[i] as number) / 2) * HEX_TILE_SIZE
    const z = 1.5 * (grid.r[i] as number) * HEX_TILE_SIZE
    const y = parts.groundAt(x, z)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const opts = { tile: HEX_TILE_SIZE, minY: minY - 0.5, maxY: maxY + 1.5, far: 1e4 }
  const o: [number, number, number] = [0, 0, 0]
  const d: [number, number, number] = [0, 0, 0]
  return (x, y) => {
    const box = host.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return null
    const camera = parts.stage.camera
    rayThrough(
      (x / box.width) * 2 - 1,
      -(y / box.height) * 2 + 1,
      camera.projectionMatrixInverse.elements,
      camera.matrixWorld.elements,
      o,
      d,
    )
    opts.far = camera.far
    const hit = pickGround(o, d, parts.groundAt, opts)
    if (!hit) return null
    const i = grid.index(hit.q, hit.r)
    if (i < 0) return null
    const zone = (tiles.zoneOf[i] ?? 0) - 1
    return zone >= 0 ? zone : null
  }
}

/**
 * Mounts the tip on the stage's `host` (the element its canvas is in), laid in `layer` (the labels
 * layer: over the canvas, under the HUD). `describe(zone)` names a zone's place (null: no place there).
 * Returns its unmount.
 */
export function mountHover(parts: {
  host: HTMLElement
  layer: HTMLElement
  zoneAt: ZoneAt
  describe: (zone: number) => HoverTip | null
  /** A hero's chip at a point of the layer (its id): the chip names them, the tip keeps out of it. */
  chipAt?: (x: number, y: number) => string | null
}): () => void {
  const { host, layer, zoneAt } = parts
  const style = document.createElement("style")
  style.textContent = STYLE
  document.head.append(style)
  const tip = document.createElement("div")
  tip.className = "hud-tip hall-hover"
  tip.setAttribute("aria-hidden", "true")
  layer.append(tip)

  let pointer: { x: number; y: number } | null = null
  let dragging = false
  let zone: number | null = null
  let since = 0
  let raf = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let painted = ""

  const hide = () => {
    delete tip.dataset.shown
    zone = null
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const paint = () => {
    if (zone === null || !pointer) return
    const about = parts.describe(zone)
    if (!about) {
      hide()
      return
    }
    const key = `${about.title}|${about.detail}|${about.lines.map((l) => l.text).join("|")}`
    if (key !== painted) {
      painted = key
      const title = document.createElement("b")
      title.textContent = about.title
      const detail = document.createElement("small")
      detail.textContent = about.detail
      tip.replaceChildren(title, detail)
      for (const line of about.lines) {
        const el = document.createElement("i")
        el.dataset.tone = line.tone
        el.textContent = line.text
        tip.append(el)
      }
    }
    // beside the pointer, kept inside the stage
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    const box = host.getBoundingClientRect()
    const x = Math.min(pointer.x + OFFSET[0], box.width - w - 8)
    const y = pointer.y + OFFSET[1] + h > box.height - 8 ? pointer.y - h - 10 : pointer.y + OFFSET[1]
    tip.style.translate = `${Math.max(8, x)}px ${Math.max(8, y)}px`
    tip.dataset.shown = ""
  }

  const look = () => {
    raf = 0
    if (!pointer || dragging) return
    const next = parts.chipAt?.(pointer.x, pointer.y) ? null : zoneAt(pointer.x, pointer.y)
    const now = performance.now()
    if (next !== zone) {
      // a new place: shown at once if a tip is up (sliding from place to place), else after the dwell
      const up = tip.dataset.shown !== undefined
      zone = next
      since = now
      if (next === null) {
        hide()
        return
      }
      if (!up) {
        delete tip.dataset.shown
        setTimeout(() => {
          if (zone === next && !dragging && performance.now() - since >= HOVER_DWELL_MS - 1) show()
        }, HOVER_DWELL_MS)
        return
      }
    }
    if (zone !== null && tip.dataset.shown !== undefined) paint()
  }

  const show = () => {
    paint()
    timer ??= setInterval(() => {
      if (!pointer || dragging) return
      // the camera may glide under a resting pointer: the place under it is read again
      const next = zoneAt(pointer.x, pointer.y)
      if (next !== zone) {
        zone = next
        if (next === null) {
          hide()
          return
        }
      }
      paint()
    }, HOVER_READ_MS)
  }

  const move = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") {
      pointer = null
      hide()
      return
    }
    // a button held is the camera's drag; over the HUD, a plate or anything not the canvas: no tip
    dragging = e.buttons !== 0
    if (dragging || !(e.target instanceof HTMLCanvasElement)) {
      pointer = null
      hide()
      return
    }
    const box = host.getBoundingClientRect()
    pointer = { x: e.clientX - box.left, y: e.clientY - box.top }
    if (!raf) raf = requestAnimationFrame(look)
  }
  const down = () => {
    dragging = true
    hide()
  }
  const up = () => {
    dragging = false
  }
  const leave = () => {
    pointer = null
    hide()
  }
  host.addEventListener("pointermove", move, { passive: true })
  host.addEventListener("pointerdown", down, { passive: true })
  addEventListener("pointerup", up, { passive: true })
  host.addEventListener("pointerleave", leave, { passive: true })
  host.addEventListener("wheel", leave, { passive: true })

  // a plate or a chip laid over the canvas (the labels layer) is not the ground: no tip over it
  const over = (e: PointerEvent) => {
    if (e.target !== layer) leave()
  }
  layer.addEventListener("pointerover", over, { passive: true })

  return () => {
    hide()
    if (raf) cancelAnimationFrame(raf)
    host.removeEventListener("pointermove", move)
    host.removeEventListener("pointerdown", down)
    removeEventListener("pointerup", up)
    host.removeEventListener("pointerleave", leave)
    host.removeEventListener("wheel", leave)
    layer.removeEventListener("pointerover", over)
    tip.remove()
    style.remove()
  }
}
