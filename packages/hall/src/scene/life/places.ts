import { island } from "../../world/lands.ts"
import { sitesOf } from "../../world/siteMap.ts"
import type { World } from "../../world/world.ts"

/**
 * Where each site's traces pile up (world units, yaw turns the pile). Chosen by eye off the walking
 * graph, beside the work: logs by the lumber mill, stones by the quarry's wheelbarrow, the catch on
 * a rack on the river bank, books by the wizard tower's door.
 */
export interface Pile {
  x: number
  z: number
  yaw: number
}

export const PILES = {
  logs: { x: -48.3, z: 23.6, yaw: 0.5 },
  stones: { x: 30.5, z: -41.2, yaw: 0 },
  fish: { x: -22.6, z: 40.5, yaw: -Math.PI / 2 + 0.2 },
  books: { x: -35.6, z: -40.4, yaw: -0.4 },
} as const satisfies Record<string, Pile>

/** How far from a repo island's proving grounds its targets count as theirs. */
const RANGE = 12

/**
 * The proving grounds' targets (from the map): arrows land in them. On a repo's island (`world`),
 * the targets round the district the proving grounds took (world/siteMap.ts).
 */
export function targets(world?: World): { x: number; z: number; rot: number; scale: number }[] {
  const at = world && world.kind !== "hand" ? sitesOf(world).proving.at : undefined
  return (world?.island ?? island()).decor
    .filter((piece) => piece.piece === "target")
    .filter((piece) => !at || Math.hypot(piece.x - at[0], piece.z - at[1]) < RANGE)
    .map((piece) => ({ x: piece.x, z: piece.z, rot: piece.rot ?? 0, scale: piece.scale ?? 1 }))
}

/** The target board's centre and front, in the piece's own units (measured from the model). */
export const TARGET_FACE = { y: 0.19, z: 0.03, radius: 0.085 }
