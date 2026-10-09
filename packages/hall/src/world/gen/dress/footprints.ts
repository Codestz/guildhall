import { HEX_SCALE, type LandPlacement, PIECES } from "../../lands.ts"

/**
 * What a building takes up on the ground, so the town can keep its lots off the civic centre, the
 * wall and the venues (dress.ts): each building or wall piece's bounding box (lands.ts PIECES) at its
 * placement, as four corners.
 */

export type Footprint = readonly [number, number][]

type Bounds = { min: readonly number[]; max: readonly number[] }

/** Pieces that stand on the ground rather than take room from it. */
const UNDERFOOT = /^building_(dirt|grain|scaffolding|bridge)/
const BUILT = /^(building_|wall_)/

/** The footprints of the buildings and wall pieces among `placements`. */
export function footprintsOf(placements: readonly LandPlacement[]): Footprint[] {
  const out: Footprint[] = []
  for (const piece of placements) {
    const bounds = (PIECES as Record<string, Bounds>)[piece.piece]
    if (!bounds || !BUILT.test(piece.piece) || UNDERFOOT.test(piece.piece)) continue
    const scale = HEX_SCALE * (piece.scale ?? 1)
    const rot = piece.rot ?? 0
    const [c, s] = [Math.cos(rot), Math.sin(rot)]
    const [x0 = 0, , z0 = 0] = bounds.min
    const [x1 = 0, , z1 = 0] = bounds.max
    out.push(
      (
        [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ] as const
      ).map(([lx, lz]): [number, number] => [
        piece.x + (lx * c + lz * s) * scale,
        piece.z + (-lx * s + lz * c) * scale,
      ]),
    )
  }
  return out
}

/** The extent of a footprint along an axis. */
function span(shape: Footprint, ax: number, az: number): [number, number] {
  const along = shape.map(([x, z]) => x * ax + z * az)
  return [Math.min(...along), Math.max(...along)]
}

/**
 * Whether two footprints come within `gap` of each other: the boxes, grown by it, overlap along
 * every side's axis (never says "clear" when they are not; at a corner it may say "close" a touch early).
 */
export function crowds(a: Footprint, b: Footprint, gap: number): boolean {
  for (const shape of [a, b])
    for (const n of [0, 1]) {
      const [p, q] = [shape[n] as [number, number], shape[n + 1] as [number, number]]
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
      const [ax, az] = [(q[1] - p[1]) / length, -(q[0] - p[0]) / length]
      const [a0, a1] = span(a, ax, az)
      const [b0, b1] = span(b, ax, az)
      if (a0 - b1 >= gap || b0 - a1 >= gap) return false
    }
  return true
}
