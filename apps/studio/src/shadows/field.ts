/** The shadows screen's pure side: where the field's pieces stand and how the scripted camera moves. */
import type { CatalogEntry } from "@guildhall/assets"
import { type CameraPose, roll } from "@guildhall/core"

/** One place in the field: a spot on the ground, a turn (degrees) and which pick stands there. */
export interface Slot {
  x: number
  z: number
  turn: number
  pick: number
}

/** The field is 2 × HALF metres a side; pieces stand on a CELL grid, jittered, clear of the witness. */
export const HALF = 100
const CELL = 9
const CLEAR = 9
/** Categories that cast a shadow worth reading. */
const CASTERS = new Set(["building", "tower", "tree", "rock", "prop", "wall"])
const MAX_PICKS = 48

/** A spread of static library pieces that cast: at least knee high and no wider than a cell. */
export function fieldPicks(entries: readonly CatalogEntry[]): CatalogEntry[] {
  const casters = entries.filter(
    (e) =>
      e.kind === "static" &&
      CASTERS.has(e.category) &&
      e.size[1] >= 0.8 &&
      Math.max(e.size[0], e.size[2]) < 7,
  )
  const stride = Math.max(1, Math.floor(casters.length / MAX_PICKS))
  return casters.filter((_, i) => i % stride === 0).slice(0, MAX_PICKS)
}

/** Every slot of the field for `seed`, with `picks` kinds of piece to choose among. */
export function fieldSlots(seed: number, picks: number): Slot[] {
  const slots: Slot[] = []
  for (let x = -HALF + CELL / 2; x < HALF; x += CELL)
    for (let z = -HALF + CELL / 2; z < HALF; z += CELL) {
      if (Math.abs(x) < CLEAR && Math.abs(z) < CLEAR) continue
      const cell = `${x},${z}`
      slots.push({
        x: x + (roll(seed, `jx:${cell}`) - 0.5) * CELL * 0.4,
        z: z + (roll(seed, `jz:${cell}`) - 0.5) * CELL * 0.4,
        turn: Math.floor(roll(seed, `turn:${cell}`) * 4) * 90,
        pick: Math.floor(roll(seed, `pick:${cell}`) * picks),
      })
    }
  return slots
}

export type Move = "pan" | "orbit" | "zoom"

export function parseMove(text: string | null): Move | null {
  return text === "pan" || text === "orbit" || text === "zoom" ? text : null
}

/**
 * The scripted camera `t` seconds in: a pan sweeps the target ±4 m along x, an orbit turns a full
 * circle a minute, a zoom breathes from 15 m to 150 m and back (exponentially, as the wheel does).
 */
export function movePose(move: Move, base: CameraPose, t: number): CameraPose {
  const wave = Math.sin(t * 0.6)
  if (move === "pan") return { ...base, target: [base.target[0] + 4 * wave, base.target[1], base.target[2]] }
  if (move === "orbit") return { ...base, azimuth: base.azimuth + t * 6 }
  return { ...base, distance: 15 * 10 ** ((wave + 1) / 2) }
}
