import { COOL, COURSE, STONE, tone } from "./bridgeStone.ts"
import { jitter, type Shapes, type V3 } from "./shapes.ts"

/**
 * A bridge's heads: where the deck meets the beach it is solid stone, not a slab hanging over the
 * sand. The body runs on ABUT past each landing (bridgeMesh.ts), so the deck is flush with the ground
 * and no gap shows under its end; this dresses what that body ends in: an end face in courses of the
 * bridge's own stone down to the seabed, and a wing wall flaring out on each side, so the head reads as a
 * masonry abutment stepping down to the sand.
 */

/** How far the head's body runs on past the landing, inland. */
export const ABUT = 2.6
/** A wing wall flares this far out and back from the head's corner. */
const WING = 2.2

/** The part of a bridge's frame an abutment is drawn in (scene/links/bridgeMesh.ts `Frame`). */
export interface Axis {
  at(s: number, side: number, y: number): V3
  dir(across: number, along: number, up: number): V3
}

/**
 * The head at distance `s` along the axis, inland `way` (-1 at the first landing, +1 at the second):
 * its end face across the body `[left, right]` from `bottom` up to the deck's `top`, with the
 * parapets' ends (`posts`: each one's [inner, outer] across the axis) up to `crest`, and on each
 * side a wing whose top falls from `crest` to `top`.
 */
export function abutment(
  shapes: Shapes,
  f: Axis,
  s: number,
  way: -1 | 1,
  [left, right]: readonly [number, number],
  posts: readonly (readonly [number, number])[],
  bottom: number,
  top: number,
  crest: number,
): void {
  const out = f.dir(0, way, 0)
  const face = (from: number, to: number, up: number): void => {
    for (let k = 0; bottom + k * COURSE < up; k++) {
      const lo = bottom + k * COURSE
      const hi = Math.min(up, lo + COURSE)
      shapes.quad(
        f.at(s, from, lo),
        f.at(s, to, lo),
        f.at(s, to, hi),
        f.at(s, from, hi),
        out,
        tone(k % 2 === 0 ? STONE : COOL, (jitter(k, 13) - 0.5) * 0.3),
        0.95,
      )
    }
  }
  face(left, right, top)
  for (const [inner, outer] of posts) face(Math.min(inner, outer), Math.max(inner, outer), crest)
  for (const side of [-1, 1] as const) {
    const edge = side < 0 ? left : right
    // The wing: the body's side flaring out and back, its top falling to the deck's height, down to the seabed.
    shapes.quad(
      f.at(s, edge, bottom),
      f.at(s + way * WING, edge + side * WING, bottom),
      f.at(s + way * WING, edge + side * WING, top),
      f.at(s, edge, crest),
      f.dir(side, 0, 0),
      tone(STONE, 0.04),
      0.95,
    )
  }
}
