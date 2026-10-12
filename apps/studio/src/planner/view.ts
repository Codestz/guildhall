/**
 * The map's camera: a centre in metres and a scale in CSS pixels per metre. North (−z) is up. Pure.
 */
import type { Vec2 } from "@guildhall/world"

export interface View {
  /** The world point at the middle of the canvas. */
  cx: number
  cz: number
  /** CSS pixels per metre. */
  scale: number
}

export const MIN_SCALE = 0.25
export const MAX_SCALE = 40

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/** Screen pixels covered on each side (panels over the canvas). */
export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

const NONE: Insets = { left: 0, right: 0, top: 0, bottom: 0 }

/**
 * The view that shows `box` whole in the part of a `w × h` canvas the insets leave free, with `pad`
 * pixels round it. When the free part is too small to be useful, the insets are ignored.
 */
export function fit(
  box: readonly [number, number, number, number],
  w: number,
  h: number,
  pad = 28,
  insets: Insets = NONE,
): View {
  const [x0, z0, x1, z1] = box
  const free = { w: w - insets.left - insets.right, h: h - insets.top - insets.bottom }
  const use = free.w > w * 0.4 && free.h > h * 0.4 ? insets : NONE
  const fw = w - use.left - use.right - 2 * pad
  const fh = h - use.top - use.bottom - 2 * pad
  const scale = clampScale(Math.max(0.01, Math.min(fw / Math.max(1, x1 - x0), fh / Math.max(1, z1 - z0))))
  // Centre the box in the free part: shift the view centre by half the inset imbalance.
  const dx = (use.left - use.right) / 2 / scale
  const dz = (use.top - use.bottom) / 2 / scale
  return { cx: (x0 + x1) / 2 - dx, cz: (z0 + z1) / 2 - dz, scale }
}

export function toScreen(v: View, w: number, h: number, p: Vec2): Vec2 {
  return [(p[0] - v.cx) * v.scale + w / 2, (p[1] - v.cz) * v.scale + h / 2]
}

export function toWorld(v: View, w: number, h: number, s: Vec2): Vec2 {
  return [(s[0] - w / 2) / v.scale + v.cx, (s[1] - h / 2) / v.scale + v.cz]
}

/** Zooms by `factor` keeping the world point under screen point `at` where it is. */
export function zoomAt(v: View, w: number, h: number, at: Vec2, factor: number): View {
  const before = toWorld(v, w, h, at)
  const scale = clampScale(v.scale * factor)
  const next = { ...v, scale }
  const after = toWorld(next, w, h, at)
  return { cx: next.cx + before[0] - after[0], cz: next.cz + before[1] - after[1], scale }
}

/** Moves the view by a screen-pixel drag. */
export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, cx: v.cx - dx / v.scale, cz: v.cz - dy / v.scale }
}

/** A round scale-bar length (metres) that draws about `px` pixels long at this scale. */
export function niceLength(scale: number, px = 120): number {
  const raw = px / scale
  const pow = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw * 0.7) return m * pow
  return 10 * pow
}
