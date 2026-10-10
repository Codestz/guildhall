import { type Side as CellSide, at as kenney, M, S, shell } from "../town2.ts"
import type { Door, Part } from "../types.ts"
import type { Group, Node } from "./types.ts"

/**
 * The rules a landmark is composed by: leaf helpers for the two kits (the hex pack's pieces at its
 * 5×, the second town kit's at its cell), a curtain wall with a gate and its towers, stepped tiers
 * rising to a focal point, a cloister, rows of things. Each returns plain nodes in the caller's frame.
 */

export { M, S }

const PI = Math.PI

export interface Opts {
  rot?: number
  y?: number
  scale?: number
}

/** A piece of the hex pack (or its civic bundle) at `x, z`, drawn at 5× times `scale`. */
export const hex = (piece: string, x: number, z: number, o: Opts = {}): Part => ({
  piece,
  x,
  z,
  ...(o.rot ? { rot: o.rot } : {}),
  ...(o.y ? { y: o.y } : {}),
  ...(o.scale ? { scale: o.scale } : {}),
})

/** A piece of the second town kit (`t2_` is its name in the bundle, `c_…` the castle kit's), one cell = M units by default. */
export const t2 = (piece: string, x: number, z: number, o: Opts = {}): Part =>
  kenney(piece, x, z, o.rot ?? 0, o.y ?? 0, o.scale ?? S)

/** Rotation that faces a piece's front (+z) toward each side of a rectangle, from outside: back is -z. */
export type Side = CellSide
const FACING: Record<Side, number> = { front: PI, back: 0, left: PI / 2, right: -PI / 2 }

export interface Curtain {
  name: string
  /** Segments of 10 along x (width) and z (depth). */
  w: number
  d: number
  /** The side that has a gate in its middle segment (that side needs an odd count). */
  gate?: Side
  /** Sides left out: a coast, a cliff, a building that is its own wall. */
  open?: readonly Side[]
  /** What stands at each corner (and at the gate's flanks): given the spot. */
  corner: (x: number, z: number) => Node
  /** What stands at each gate flank, when it differs from the corner. */
  flank?: (x: number, z: number) => Node
  /** Where the gate door's step lies, away from the wall (default 3.2 beyond its face). */
  step?: number
}

/**
 * A curtain wall round a `w × d` run of 10-unit segments, centred on the anchor: a straight wall
 * piece each, a gate piece in the middle of one side (with a door out of it and a tower to each
 * side), a tower on every corner. The wall pieces face inward; their towers cover the joints.
 */
export function curtain(c: Curtain): Group {
  const W = c.w * 10
  const D = c.d * 10
  const kids: Node[] = []
  const doors: Door[] = []
  const sides: Side[] = (["back", "front", "left", "right"] as const).filter((s) => !c.open?.includes(s))
  for (const side of sides) {
    const along = side === "front" || side === "back"
    const n = along ? c.w : c.d
    const at = along ? (side === "front" ? D / 2 : -D / 2) : side === "right" ? W / 2 : -W / 2
    for (let i = 0; i < n; i++) {
      const s = (i - (n - 1) / 2) * 10
      const [x, z] = along ? [s, at] : [at, s]
      const gate = c.gate === side && i === (n - 1) / 2
      kids.push(hex(gate ? "wall_straight_gate" : "wall_straight", x, z, { rot: FACING[side] }))
      if (gate) {
        const out = c.step ?? 3.2
        const sign = side === "front" || side === "right" ? 1 : -1
        doors.push(
          along
            ? { x, z: z + sign * out, rot: side === "front" ? 0 : PI, depth: out + 1 }
            : { x: x + sign * out, z, rot: side === "right" ? PI / 2 : -PI / 2, depth: out + 1 },
        )
      }
    }
  }
  const flank = c.flank
  for (const [x, z] of [
    [-W / 2, -D / 2],
    [W / 2, -D / 2],
    [-W / 2, D / 2],
    [W / 2, D / 2],
  ] as const) {
    const touches = (side: Side): boolean => !c.open?.includes(side)
    const corner =
      (z < 0 ? touches("back") : touches("front")) || (x < 0 ? touches("left") : touches("right"))
    if (corner) kids.push(c.corner(x, z))
  }
  if (flank && c.gate) {
    const g = c.gate
    const along = g === "front" || g === "back"
    const at = along ? (g === "front" ? D / 2 : -D / 2) : g === "right" ? W / 2 : -W / 2
    for (const s of [-7, 7]) kids.push(flank(along ? s : at, along ? at : s))
  }
  return { name: c.name, kids, doors }
}

/** What panel stands on a side's `i`th of `n` cells at floor `floor`: a wall, a door, a window, or a gap. */
export type FloorPick = (side: Side, i: number, n: number, floor: number) => string | undefined

/** One level of a stepped building: `w × d` cells, `floors` of walls, topped by the next level or the roof. */
export interface Tier {
  w: number
  d: number
  floors: number
  wall: FloorPick
}

/**
 * Tiers rising to a focal point: each level a box of kit walls narrower than the last, stood on it,
 * so the building steps up as it nears its centre. Returns the pieces and the height reached (in floors).
 */
export function tiers(levels: readonly Tier[], x = 0, z = 0): { parts: Part[]; height: number } {
  const parts: Part[] = []
  let floor = 0
  for (const level of levels) {
    for (let f = 0; f < level.floors; f++)
      for (const part of shell(level.w, level.d, (side, i, n) => level.wall(side, i, n, f), floor + f))
        parts.push({ ...part, x: part.x + x, z: part.z + z })
    floor += level.floors
  }
  return { parts, height: floor }
}

/** `n` of something along a line from `(x, z)` by `(dx, dz)` each. */
export const row = (
  n: number,
  x: number,
  z: number,
  dx: number,
  dz: number,
  make: (x: number, z: number, i: number) => Node,
): Node[] => Array.from({ length: n }, (_, i) => make(x + dx * i, z + dz * i, i))

/**
 * A quadrangle: a `w × d` ring of one-storey wings round a garth, walls and gabled roofs (each wing's
 * ridge along its length), windows on both faces, the garth left open. Cells are the kit's (M units).
 */
export function quad(name: string, w: number, d: number, wall = "wall", window = "wall_window_glass"): Group {
  const pick =
    (out: boolean) =>
    (side: Side, i: number): string | undefined =>
      out && side === "front" && i === Math.floor((w - 1) / 2) ? "wall_door" : i % 2 === 0 ? window : wall
  const kids: Node[] = [...shell(w, d, pick(true)), ...shell(w - 2, d - 2, pick(false))]
  for (let i = 0; i < w; i++)
    for (let j = 0; j < d; j++) {
      if (i > 0 && i < w - 1 && j > 0 && j < d - 1) continue
      const ridgeAlongX = j === 0 || j === d - 1
      kids.push(
        kenney("roof_gable", (i - (w - 1) / 2) * M, (j - (d - 1) / 2) * M, ridgeAlongX ? 0 : PI / 2, M),
      )
    }
  return { name, kids }
}
