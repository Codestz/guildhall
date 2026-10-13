/**
 * The places' names over the island: a plate (ui `plate`) pinned over each repo place's heart, with the
 * unit's name and what it is, drawn in the Viewer's labels layer and moved every frame to follow the
 * camera. Plates keep out of each other's way (`layoutPlates`, pure): the biggest places come first, and
 * a plate that would lie over one already placed is drawn compact, or not at all, so a phone shows the
 * few that fit and a close view shows them all. `?labels=0` turns them off.
 */
import type { Stage } from "@guildhall/render"
import { toScreen } from "@guildhall/render"
import { plate } from "@guildhall/ui"

export interface PlaceLabel {
  /** The name on the plate. */
  label: string
  /** The mono line under it ("227 files · village"). */
  detail: string
  /** Where it hangs: the heart tile's top, metres. */
  at: [number, number, number]
  /** Its claim to the screen: a bigger place's plate is placed first (files). */
  weight: number
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
/** The gap kept between plates, CSS px. */
const GAP = 4

/** left, top, right, bottom, CSS px. */
export type Rect = [number, number, number, number]
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
 * size if that lies clear of every plate placed so far, else compact, else not drawn. Pure.
 */
export function layoutPlates(
  anchors: readonly ([number, number] | null)[],
  boxes: readonly PlateBox[],
  order: readonly number[],
  /** Screen rects the plates keep clear of (left, top, right, bottom): the site's crest. */
  keepOut: readonly Rect[] = [],
): PlateLaid[] {
  const out: PlateLaid[] = anchors.map(() => ({ at: null, size: "full" }))
  const taken: Rect[] = keepOut.map((r) => [...r] as Rect)
  const clear = (x: number, y: number, w: number, h: number) => {
    const l = x - w / 2 - GAP
    const r = x + w / 2 + GAP
    const t = y - h - GAP
    for (const [L, T, R, B] of taken) if (l < R && r > L && t < B && y > T) return false
    return true
  }
  for (const k of order) {
    const a = anchors[k]
    const box = boxes[k]
    if (!a || !box) continue
    const size: PlateSize | null = clear(a[0], a[1], ...box.full)
      ? "full"
      : clear(a[0], a[1], ...box.sm)
        ? "sm"
        : null
    if (!size) continue
    const [w, h] = box[size]
    taken.push([a[0] - w / 2, a[1] - h, a[0] + w / 2, a[1]])
    out[k] = { at: a, size }
  }
  return out
}

export interface PlaceLabels {
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
): PlaceLabels {
  const els = places.map((p) =>
    plate({ title: p.label, detail: p.detail, width: 220, anchor: "translate(-50%, -100%)" }),
  )
  layer.append(...els)
  const boxes = els.map(measure)
  const order = places.map((_, k) => k).sort((a, b) => places[b]!.weight - places[a]!.weight || a - b)
  const points = places.map((p) => [p.at[0], p.at[1] + UP, p.at[2]] as [number, number, number])
  const anchors: ([number, number] | null)[] = new Array(places.length).fill(null)
  // what each plate was last set to, so the DOM is only written when something moved
  const shown = els.map(() => ({ x: Number.NaN, y: Number.NaN, size: "" as string, on: true }))
  // the crest (and anything else marked `data-keepout`) keeps its corner: its box in the layer's pixels,
  // re-read every half second and on a resize
  let keep: Rect[] = []
  let frame = 0
  const readKeep = () => {
    const at = layer.getBoundingClientRect()
    keep = [...document.querySelectorAll("[data-keepout]")].map((el) => {
      const r = el.getBoundingClientRect()
      return [r.left - at.left - 8, r.top - at.top - 8, r.right - at.left + 8, r.bottom - at.top + 8] as Rect
    })
  }
  readKeep()
  addEventListener("resize", readKeep)
  const off = stage.onFrame(() => {
    if (++frame % 30 === 0) readKeep()
    const cam = stage.camera.position
    for (let k = 0; k < points.length; k++) {
      const p = points[k] as [number, number, number]
      const d = Math.hypot(p[0] - cam.x, p[1] - cam.y, p[2] - cam.z)
      const s = d > FAR ? null : toScreen(stage, p)
      anchors[k] = s ? [Math.round(s[0]), Math.round(s[1])] : null
    }
    const laid = layoutPlates(anchors, boxes, order, keep)
    for (let k = 0; k < els.length; k++) {
      const el = els[k] as HTMLElement
      const was = shown[k]!
      const { at, size } = laid[k]!
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
      }
      if (was.x !== at[0] || was.y !== at[1]) {
        el.style.translate = `${at[0]}px ${at[1]}px`
        was.x = at[0]
        was.y = at[1]
      }
      if (was.size !== size) {
        if (size === "sm") el.dataset.size = "sm"
        else delete el.dataset.size
        was.size = size
      }
    }
  })
  return {
    dispose() {
      off()
      removeEventListener("resize", readKeep)
      for (const el of els) el.remove()
    },
  }
}

/** `?labels=0`: no plates. */
export const labelsOn = (query: URLSearchParams): boolean => query.get("labels") !== "0"
