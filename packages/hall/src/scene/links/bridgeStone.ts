import { jitter, type Shapes, type Swatch, type V3 } from "./shapes.ts"

/**
 * The bridges' stone: swatches of the land pack's palette (scene/links/shapes.ts) — the greys the
 * hexagon pack's walls and towers are painted in — and the dressed-stone faces built from them: a wall in
 * courses, each a little lighter or darker block by block, so the eye reads masonry and not a slab.
 */

/** The land palette's greys: a warm stone, a cooler one, a pale one for caps, a dark one for the shade. */
export const STONE: Swatch = { col: 6, row: 1, t: 0.4 }
export const COOL: Swatch = { col: 2, row: 0, t: 0.55 }
export const PALE: Swatch = { col: 2, row: 0, t: 0.2 }
export const SHADE: Swatch = { col: 3, row: 0, t: 0.8 }
/** The deck's flagstones: light grey, between the caps' pale and the cool course. */
export const FLAG: Swatch = { col: 2, row: 0, t: 0.32 }

/** A swatch moved down (or, negative, up) its gradient. */
export const tone = (swatch: Swatch, by: number): Swatch => ({ ...swatch, t: swatch.t + by })

/** Height of one course of stone, world units. */
export const COURSE = 0.55

/**
 * A wall face in courses: from `top(s)` down to `bottom(s)` between distances `s0` and `s1` along the
 * axis, built from `at(s, y)` (a point of the face), facing `out`. Courses hang from the top, so on
 * a ramp they climb with the deck; a course alternates warm and cool stone, each block a touch
 * lighter or darker than its neighbours (`block` numbers the block along the axis).
 */
export function courses(
  shapes: Shapes,
  at: (s: number, y: number) => V3,
  [s0, s1]: readonly [number, number],
  top: (s: number) => number,
  bottom: (s: number) => number,
  out: V3,
  block: number,
  shade = 1,
): void {
  const reach = Math.max(top(s0) - bottom(s0), top(s1) - bottom(s1))
  for (let k = 0; k * COURSE < reach; k++) {
    const hi = (s: number): number => Math.max(bottom(s), top(s) - k * COURSE)
    const lo = (s: number): number => Math.max(bottom(s), top(s) - (k + 1) * COURSE)
    if (hi(s0) - lo(s0) < 1e-3 && hi(s1) - lo(s1) < 1e-3) continue
    const base = k % 2 === 0 ? STONE : COOL
    shapes.quad(
      at(s0, hi(s0)),
      at(s1, hi(s1)),
      at(s1, lo(s1)),
      at(s0, lo(s0)),
      out,
      tone(base, (jitter(block, k) - 0.5) * 0.3),
      shade,
    )
  }
}
