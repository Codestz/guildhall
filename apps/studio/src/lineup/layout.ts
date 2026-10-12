import type { CameraPose } from "@guildhall/core"

/** Metres of open ground between two slots. */
export const GAP = 2

export interface Placed {
  /** The slot's left edge, on the 1 m grid. */
  start: number
  /** Whole metres, at least 1. */
  width: number
  /** Where the piece's centre goes. */
  centre: number
}

/** Slots left to right from x = 0: each rounds its piece's width up to whole metres, `gap` between. */
export function layoutSlots(widths: readonly number[], gap = GAP): Placed[] {
  let cursor = 0
  return widths.map((w) => {
    // A hair of float noise (2.0000001 m) must not cost a whole extra metre.
    const width = Math.max(1, Math.ceil(w - 1e-6))
    const placed = { start: cursor, width, centre: cursor + width / 2 }
    cursor += width + gap
    return placed
  })
}

/** What a framing has to fit: a run of slots on x, and the tallest and deepest piece in it. */
export interface Span {
  minX: number
  maxX: number
  height: number
  depth: number
}

export interface View {
  aspect: number
  /** Vertical field of view, degrees. */
  fov: number
  azimuth: number
  elevation: number
}

const RAD = Math.PI / 180
/** The frame is fitted this much smaller than the viewport, for breathing room. */
const MARGIN = 0.9
/** Head room above the tallest piece, so its floating label stays in frame. */
const LABEL_ROOM = 2

/**
 * A camera pose at `view`'s angles, aimed at the centre of `span`'s box (ground to tallest piece
 * plus label room), at the least distance where every corner of that box is inside the frustum.
 */
export function framePose(span: Span, view: View): CameraPose {
  const az = view.azimuth * RAD
  const el = view.elevation * RAD
  const top = span.height + LABEL_ROOM
  const target: [number, number, number] = [(span.minX + span.maxX) / 2, top / 2, 0]
  // The camera's axes: `back` points from the target to the camera.
  const back = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]
  const right = [Math.cos(az), 0, -Math.sin(az)]
  const up = [-Math.sin(el) * Math.sin(az), Math.cos(el), -Math.sin(el) * Math.cos(az)]
  const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * (b[i] as number), 0)
  const tanV = Math.tan((view.fov / 2) * RAD) * MARGIN
  const tanH = Math.tan((view.fov / 2) * RAD) * view.aspect * MARGIN
  let distance = 0
  for (const x of [span.minX, span.maxX])
    for (const y of [0, top])
      for (const z of [-span.depth / 2, span.depth / 2]) {
        const p = [x - target[0], y - target[1], z - target[2]]
        // A corner `toward` the camera sits that much nearer, so it needs that much more distance.
        const toward = dot(p, back)
        distance = Math.max(
          distance,
          toward + Math.abs(dot(p, right)) / tanH,
          toward + Math.abs(dot(p, up)) / tanV,
        )
      }
  return { target, azimuth: view.azimuth, elevation: view.elevation, distance }
}

/** A label anchored at its bottom centre `(x, y)`, `w` by `h` CSS pixels. */
export interface LabelBox {
  x: number
  y: number
  w: number
  h: number
}

/** Pixels kept between two stacked labels. */
const LABEL_GAP = 3

/**
 * Each label's bottom y once overlaps are lifted away: labels are taken in order, and each rises
 * above any earlier one it would cover, so neighbours in a crowded view stack instead of colliding.
 */
export function stackLabels(boxes: readonly LabelBox[]): number[] {
  const placed: LabelBox[] = []
  return boxes.map((box) => {
    let y = box.y
    let moved = true
    while (moved) {
      moved = false
      for (const other of placed) {
        const apart = Math.abs(box.x - other.x) >= (box.w + other.w) / 2 + LABEL_GAP
        const clear = y - box.h >= other.y + LABEL_GAP || y <= other.y - other.h - LABEL_GAP
        if (apart || clear) continue
        y = other.y - other.h - LABEL_GAP
        moved = true
      }
    }
    placed.push({ ...box, y })
    return y
  })
}

/** `?focus=3` or `?focus=3-5` → the inclusive slot range, clamped to `count`; null when absent or bad. */
export function parseFocus(text: string | null, count: number): [number, number] | null {
  const match = /^(\d+)(?:-(\d+))?$/.exec(text?.trim() ?? "")
  if (!match || count === 0) return null
  const from = Math.min(Number(match[1]), count - 1)
  const to = Math.min(Number(match[2] ?? match[1]), count - 1)
  return from <= to ? [from, to] : [to, from]
}
