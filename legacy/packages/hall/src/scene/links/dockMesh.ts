import type { BufferGeometry } from "three"
import { PIER, type Quay } from "../../world/linkStub.ts"
import { SEA_Y } from "../Ships.tsx"
import { jitter, Shapes, type V3 } from "./shapes.ts"

/**
 * A ferry's dock as timber: a pier straight out from the coast, a wider landing stage at its end,
 * piles into the seabed, bollards on the side the boat lies at, a few crates and a lantern post.
 * Every dock of an archipelago is merged into one geometry (one draw call); the lanterns' flames
 * are halos (LinksLayer).
 */

const PLANK = 0x9a7650
const PILE = 0x5d4630
const ROPE = 0xcdb98f
const IRON = 0x3c3a3e
const CRATE = 0xb48a55
/** How far above the coast's ground the deck lies. */
const RISE = 0.35
/** A pier does not climb a cliff: on high ground it starts at the foot. */
const MAX_GROUND = 0.5
/** Pier and landing widths, and the landing's length along the pier. */
const WIDTH = 2.6
const STAGE_WIDTH = 5.2
const STAGE_LENGTH = 4
/** The deck starts this far inland of the coast point. */
const INLAND = 3
/** Lantern post height above the deck. */
export const LAMP_HEIGHT = 3.6

/** Where the flame of a dock's lantern burns, from the quay's frame. */
export function dockLampOf(quay: Quay): V3 {
  const { land, facing, height } = quay
  const ux = Math.sin(facing)
  const uz = Math.cos(facing)
  const s = PIER - 0.8
  const side = -(STAGE_WIDTH / 2 - 0.5) * quay.berthSide
  const y = Math.min(height, MAX_GROUND) + RISE + LAMP_HEIGHT + 0.25
  return [land[0] + ux * s + uz * side, y, land[1] + uz * s - ux * side]
}

export function addDock(shapes: Shapes, quay: Quay, index: number): void {
  const { land, facing, height } = quay
  const ux = Math.sin(facing)
  const uz = Math.cos(facing)
  const deck = Math.min(height, MAX_GROUND) + RISE
  /** A point `s` out along the pier and `side` towards the boat's berth (negative: away from it). */
  const at = (s: number, side: number, y: number): V3 => [
    land[0] + ux * s + uz * side * quay.berthSide,
    y,
    land[1] + uz * s - ux * side * quay.berthSide,
  ]
  const box = (s: number, side: number, y: number, half: V3, colour: number, shade = 1): void =>
    shapes.box(at(s, side, y), half, facing, colour, shade)

  // Deck boards, across the pier, then the wider landing stage at its end.
  const stageFrom = PIER - STAGE_LENGTH
  const boards = Math.round((PIER + INLAND) / 1.1)
  for (let i = 0; i < boards; i++) {
    const s = -INLAND + ((PIER + INLAND) * (i + 0.5)) / boards
    const wide = s >= stageFrom ? STAGE_WIDTH : WIDTH
    box(
      s,
      0,
      deck - 0.12,
      [wide / 2, 0.12, (PIER + INLAND) / boards / 2 - 0.04],
      PLANK,
      0.88 + 0.24 * jitter(i, index),
    )
  }
  // Piles: along both edges of the pier, and the stage's corners, down into the seabed.
  const pile = (s: number, side: number, thick = 0.28): void => {
    const bottom = SEA_Y - 2.4
    const top = deck + 0.4
    box(s, side, (top + bottom) / 2, [thick, (top - bottom) / 2, thick], PILE, 0.9)
  }
  for (let s = 0.5; s <= PIER - 0.4; s += 3.8)
    for (const side of [-1, 1]) pile(s, (side * WIDTH) / 2 - side * 0.1)
  for (const side of [-1, 1]) pile(PIER - 0.4, (side * STAGE_WIDTH) / 2 - side * 0.3, 0.3)
  // Bollards on the boat's side (the right), with a coil of rope on the first.
  for (const s of [PIER - 6.5, PIER - 2.4]) {
    box(s, WIDTH / 2 - 0.2, deck + 0.28, [0.26, 0.28, 0.26], IRON)
    box(s, WIDTH / 2 - 0.2, deck + 0.52, [0.36, 0.07, 0.36], ROPE)
  }
  // A fender log along the boat's side of the stage.
  box(PIER - STAGE_LENGTH / 2, STAGE_WIDTH / 2 + 0.1, deck - 0.1, [0.16, 0.16, STAGE_LENGTH / 2], PILE, 1.1)
  // The lantern post on the stage's left corner: pole, arm, a little house for the flame.
  const lampSide = -(STAGE_WIDTH / 2 - 0.5)
  box(PIER - 0.8, lampSide, deck + LAMP_HEIGHT / 2, [0.14, LAMP_HEIGHT / 2, 0.14], PILE, 0.8)
  box(PIER - 0.8, lampSide, deck + LAMP_HEIGHT + 0.05, [0.3, 0.06, 0.3], IRON)
  box(PIER - 0.8, lampSide, deck + LAMP_HEIGHT + 0.25, [0.2, 0.2, 0.2], 0xffd9a0, 1.4)
  // Crates by the shore end.
  box(1.6, -WIDTH / 2 + 0.55, deck + 0.4, [0.5, 0.4, 0.5], CRATE, 1.0)
  box(2.5, -WIDTH / 2 + 0.5, deck + 0.3, [0.4, 0.3, 0.4], CRATE, 0.85)
}

/** Every ferry dock of an archipelago in one geometry (null when there are none). */
export function dockGeometry(quays: readonly Quay[]): BufferGeometry | null {
  if (quays.length === 0) return null
  const shapes = new Shapes()
  for (const [i, quay] of quays.entries()) addDock(shapes, quay, i)
  return shapes.geometry()
}
