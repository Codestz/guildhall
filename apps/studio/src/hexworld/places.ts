/**
 * The places' names over the island: a plate (ui `plate`) pinned over each repo place's heart, with the
 * unit's name and what it is, drawn in the Viewer's labels layer and moved every frame to follow the
 * camera. Plates keep out of each other's way (`layoutPlates`, pure): the biggest places come first, and
 * a plate that would lie over one already placed is drawn compact, or not at all, so a phone shows the
 * few that fit and a close view shows them all. At the map view only the villages and towns (tier 2 and
 * up) carry plates; zoomed close, every place does (`plateMode`, with a gap between the two distances so
 * a zoom resting near one never flickers), and the hamlets' plates fade in and out rather than pop.
 * Heroes come before hamlets: a plate under tier 3 that would lie over a hero's chip is drawn compact or
 * not at all (`HERO_TIER`). `?labels=0` turns them off. With `onPick` a plate is a button for a pointer: a click or a tap picks
 * its place (a hall opens its dossier).
 */
import type { Stage } from "@guildhall/render"
import { toScreen } from "@guildhall/render"
import { plate } from "@guildhall/ui"

export interface PlaceLabel {
  /** The name on the plate. */
  label: string
  /** The mono line under it ("227 files · village"). */
  detail: string
  /** What it is in plain words ("village"): with it, `files` can rewrite the detail line for another day. */
  kind?: string
  /** The unit it names ("packages/react-dom", "/"): what a history asks whether it was born yet. */
  id?: string
  /** Where it hangs: the heart tile's top, metres. */
  at: [number, number, number]
  /** Its claim to the screen: a bigger place's plate is placed first (files). */
  weight: number
  /** 1 a hamlet, 2 a village, 3 a town or the capital: under 2 it shows only zoomed close. */
  tier: number
}

/** How the detail line reads a zone: its tier and kind in plain words. */
const KIND_WORDS: Record<string, string> = {
  town: "capital",
  market: "town",
  farm: "village",
  hamlet: "hamlet",
  harbour: "harbour",
  camp: "camp",
  monastery: "monastery",
  mine: "mine",
  fishing: "fishing village",
  lumber: "lumber camp",
  castle: "castle",
}
export const kindWord = (kind: string): string => KIND_WORDS[kind] ?? kind

/** A plate hangs this far over the heart tile's top, metres. */
const UP = 2.2
/** Plates further than this from the camera are not drawn (metres): the far side of a big island at the map view. */
const FAR = 420
/** How long a plate takes to fade in or out as the zoom crosses between the map view and close, ms. */
const FADE_MS = 280
/** Plates of places under this tier make way for a hero's chip (a town's or the capital's stays). */
export const HERO_TIER = 3
/** The gap kept between plates, CSS px. */
const GAP = 4

/** left, top, right, bottom, CSS px. */
export type Rect = [number, number, number, number]

/**
 * The camera distances (the rig's, metres) between the map view and a close one: closer than `in` it is
 * close, further than `out` it is the map again; between the two it stays what it was. The hall opens at
 * 70 m over its capital, inside the gap: it starts as the map view (villages and towns named).
 */
export const PLATE_ZOOM = { in: 55, out: 80 } as const
/** The lowest tier whose plate the map view shows. */
export const MAP_TIER = 2

export type PlateMode = "map" | "close"

/** Map view or close, from the camera's distance and what it was (hysteresis). Pure. */
export function plateMode(was: PlateMode, distance: number, zoom = PLATE_ZOOM): PlateMode {
  if (distance < zoom.in) return "close"
  if (distance > zoom.out) return "map"
  return was
}

/** Whether a place of `tier` carries its plate in `mode`. */
export const plateOn = (tier: number, mode: PlateMode): boolean => mode === "close" || tier >= MAP_TIER

export type PlateSize = "full" | "sm"
export interface PlateBox {
  /** Width and height at each size, CSS px. */
  full: [number, number]
  sm: [number, number]
}
export interface PlateLaid {
  /** The plate's anchor on screen (its bottom centre), or null when it is not drawn. */
  at: [number, number] | null
  size: PlateSize
}

/**
 * Where the plates go this frame: in `order` (indices, first placed first), each at its anchor, full
 * size if that lies clear of every plate placed so far, else compact, else not drawn. With `view` (the
 * layer's width and height) a plate whose heart is on screen slides in from the edge rather than be cut. Pure.
 */
export function layoutPlates(
  anchors: readonly ([number, number] | null)[],
  boxes: readonly PlateBox[],
  order: readonly number[],
  /** Screen rects the plates keep clear of (left, top, right, bottom): the site's crest. */
  keepOut: readonly Rect[] = [],
  view?: readonly [number, number],
  /** Rects only the plates `yields(k)` keep clear of: the heroes' chips, over a hamlet's plate. */
  soft?: { rects: readonly Rect[]; yields(k: number): boolean },
): PlateLaid[] {
  const out: PlateLaid[] = anchors.map(() => ({ at: null, size: "full" }))
  const taken: Rect[] = keepOut.map((r) => [...r] as Rect)
  const clear = (x: number, y: number, w: number, h: number, k: number) => {
    const l = x - w / 2 - GAP
    const r = x + w / 2 + GAP
    const t = y - h - GAP
    for (const [L, T, R, B] of taken) if (l < R && r > L && t < B && y > T) return false
    if (soft?.yields(k))
      for (const [L, T, R, B] of soft.rects) if (l < R && r > L && t < B && y > T) return false
    return true
  }
  /** The anchor `a` moved just enough for a `w` × `h` plate to lie inside the view. */
  const inside = (a: readonly [number, number], w: number, h: number): [number, number] => {
    if (!view) return [a[0], a[1]]
    const x = Math.min(Math.max(a[0], w / 2 + GAP), view[0] - w / 2 - GAP)
    const y = Math.min(Math.max(a[1], h + GAP), view[1] - GAP)
    return [Math.round(x), Math.round(y)]
  }
  for (const k of order) {
    const a = anchors[k]
    const box = boxes[k]
    if (!a || !box) continue
    if (view && (a[0] < 0 || a[0] > view[0] || a[1] < 0 || a[1] > view[1])) continue
    const full = inside(a, ...box.full)
    const sm = inside(a, ...box.sm)
    const size: PlateSize | null = clear(full[0], full[1], ...box.full, k)
      ? "full"
      : clear(sm[0], sm[1], ...box.sm, k)
        ? "sm"
        : null
    if (!size) continue
    const [w, h] = box[size]
    const at = size === "full" ? full : sm
    taken.push([at[0] - w / 2, at[1] - h, at[0] + w / 2, at[1]])
    out[k] = { at, size }
  }
  return out
}

export interface PlaceLabels {
  /**
   * Leaves out the plates whose heart stands where `at(x, z)` says (a history replay: a place not yet
   * there); they fade like a hamlet's at the map view. Null shows them all again.
   */
  hide(at: ((x: number, z: number, id: string | undefined) => boolean) | null): void
  /**
   * The file count each plate's line reads, by unit (a history at its day): a place `files` has no count
   * for, or with no `kind`, keeps its own line. Null puts back today's lines.
   */
  files(count: ((id: string | undefined) => number | undefined) | null): void
  /** Shows or hides every plate (the HUD's "Name plates"). */
  show(on: boolean): void
  shown(): boolean
  /** Marks one place's plate as the one open (by index), or none. */
  select(index: number | null): void
  dispose(): void
}

/** A plate's box at each size, measured once (one layout) before it is moved anywhere. */
function measure(el: HTMLElement): PlateBox {
  const full: [number, number] = [el.offsetWidth, el.offsetHeight]
  el.dataset.size = "sm"
  const sm: [number, number] = [el.offsetWidth, el.offsetHeight]
  delete el.dataset.size
  return { full, sm }
}

/** Draws the plates and keeps them pinned to their hearts until disposed. */
export function createPlaceLabels(
  stage: Stage,
  layer: HTMLElement,
  places: readonly PlaceLabel[],
  onPick?: (index: number) => void,
  /** The heroes' chips on screen now (layer px): a plate under tier 3 makes way for a hero. */
  heroes?: () => readonly Rect[],
): PlaceLabels {
  const els = places.map((p, k) => {
    const el = plate({ title: p.label, detail: p.detail, width: 220, anchor: "translate(-50%, -100%)" })
    if (onPick) {
      // a pointer's way in: the keyboard and screen readers have the same places as a list (the HUD's
      // Places), so the plates stay out of the tab order rather than put 40 stops before the HUD
      el.dataset.pick = ""
      el.setAttribute("aria-hidden", "true")
      el.addEventListener("click", () => onPick(k))
    }
    return el
  })
  let on = true
  layer.append(...els)
  const boxes = els.map(measure)
  const order = places.map((_, k) => k).sort((a, b) => places[b]!.weight - places[a]!.weight || a - b)
  const points = places.map((p) => [p.at[0], p.at[1] + UP, p.at[2]] as [number, number, number])
  const anchors: ([number, number] | null)[] = new Array(places.length).fill(null)
  // what each plate was last set to, so the DOM is only written when something moved
  const shown = els.map(() => ({
    x: Number.NaN,
    y: Number.NaN,
    size: "" as string,
    on: true,
    off: false,
    since: 0,
  }))
  const screen: ([number, number] | null)[] = new Array(places.length).fill(null)
  for (const el of els) el.style.transition = `opacity ${FADE_MS}ms ease`
  let mode: PlateMode = plateMode("map", stage.getCamera().distance)
  const hidden = new Uint8Array(places.length)
  /** Whether plate k is wanted now: its tier at this zoom, and its place there at all. */
  const wanted = (k: number) => !hidden[k] && plateOn(places[k]!.tier, mode)
  // the crest (and anything else marked `data-keepout`) keeps its corner: its box in the layer's pixels,
  // re-read every half second and on a resize
  let keep: Rect[] = []
  let view: [number, number] = [0, 0]
  let frame = 0
  const readKeep = () => {
    const at = layer.getBoundingClientRect()
    view = [at.width, at.height]
    keep = [...document.querySelectorAll("[data-keepout]")].map((el) => {
      const r = el.getBoundingClientRect()
      return [r.left - at.left - 8, r.top - at.top - 8, r.right - at.left + 8, r.bottom - at.top + 8] as Rect
    })
  }
  readKeep()
  addEventListener("resize", readKeep)
  const off = stage.onFrame(() => {
    if (!on) return
    if (++frame % 30 === 0) readKeep()
    const cam = stage.camera.position
    mode = plateMode(mode, stage.getCamera().distance)
    const now = performance.now()
    // plates past FAR are left out, or past half again the view's own distance when it stands further back (a whole big island)
    const far = Math.max(FAR, stage.getCamera().distance * 1.5)
    for (let k = 0; k < points.length; k++) {
      const p = points[k] as [number, number, number]
      const d = Math.hypot(p[0] - cam.x, p[1] - cam.y, p[2] - cam.z)
      const s = d > far ? null : toScreen(stage, p)
      screen[k] = s ? [Math.round(s[0]), Math.round(s[1])] : null
      // a plate the zoom leaves out gives up its room at once (it fades out where it stands)
      anchors[k] = wanted(k) ? screen[k]! : null
    }
    const laid = layoutPlates(
      anchors,
      boxes,
      order,
      keep,
      view[0] > 0 ? view : undefined,
      heroes ? { rects: heroes(), yields: (k) => (places[k]?.tier ?? 0) < HERO_TIER } : undefined,
    )
    for (let k = 0; k < els.length; k++) {
      const el = els[k] as HTMLElement
      const was = shown[k]!
      const out = !wanted(k)
      const { size } = laid[k]!
      if (out !== was.off) {
        was.off = out
        was.since = now
        if (out) el.style.opacity = "0"
      }
      // fading out: it follows its heart until it is gone
      const at = out ? (was.on && now - was.since < FADE_MS ? screen[k]! : null) : laid[k]!.at
      if (!at) {
        if (was.on) {
          el.style.display = "none"
          was.on = false
        }
        continue
      }
      if (!was.on) {
        el.style.display = ""
        was.on = true
        // in from nothing: from transparent, so it fades in rather than pops
        el.style.opacity = "0"
        void el.offsetWidth
        el.style.opacity = ""
      } else if (!out && el.style.opacity === "0") el.style.opacity = ""
      if (was.x !== at[0] || was.y !== at[1]) {
        el.style.translate = `${at[0]}px ${at[1]}px`
        was.x = at[0]
        was.y = at[1]
      }
      if (!out && was.size !== size) {
        if (size === "sm") el.dataset.size = "sm"
        else delete el.dataset.size
        was.size = size
      }
    }
  })
  let picked: number | null = null
  const lines = els.map((el) => el.querySelector("small"))
  return {
    files(count) {
      for (let k = 0; k < places.length; k++) {
        const p = places[k]!
        const line = lines[k]
        if (!line) continue
        const n = p.kind ? count?.(p.id) : undefined
        const text = n === undefined ? p.detail : `${n.toLocaleString("en-US")} files · ${p.kind}`
        if (line.textContent === text) continue
        line.textContent = text
        els[k]!.title = `${p.label} · ${text}`
      }
    },
    hide(at) {
      for (let k = 0; k < places.length; k++) {
        const p = places[k]!.at
        hidden[k] = at?.(p[0], p[2], places[k]!.id) ? 1 : 0
      }
    },
    show(next) {
      if (next === on) return
      on = next
      for (const [k, el] of els.entries()) {
        el.style.display = on && shown[k]?.on ? "" : "none"
      }
    },
    shown: () => on,
    select(index) {
      if (picked !== null) delete els[picked]?.dataset.selected
      picked = index
      if (index !== null) {
        const el = els[index]
        if (el) el.dataset.selected = ""
      }
    },
    dispose() {
      off()
      removeEventListener("resize", readKeep)
      for (const el of els) el.remove()
    },
  }
}

/** `?labels=0`: no plates. */
export const labelsOn = (query: URLSearchParams): boolean => query.get("labels") !== "0"
