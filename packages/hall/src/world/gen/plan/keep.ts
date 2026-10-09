import { type Cell, cellToWorld } from "../../lands.ts"
import { key, neighbours, unkey } from "../hex.ts"

/**
 * The keep's block at the origin, as on the hand-drawn map (lands.ts' K block: Room, the stations
 * and the hall's aisles are placed there), its gate opening south down a short avenue onto the
 * harbour: the hub, two hexes south, its quay running on south into a bay nothing may fill. The
 * block and the ring of land round it are reserved before anything grows.
 */

export const HUB: Cell = [0, 6]
export const QUAY: Cell = [0, 8]
/** The gate's apron, and the avenue's one hex between it and the hub (lands.ts' [0, 2] and OUT). */
export const GATE: Cell = [0, 2]
export const AVENUE: Cell = [0, 4]
/** The keep's block: lands.ts' K hexes, and the V lots either side of its gate. */
export const KEEP: ReadonlyMap<string, "K" | "V"> = new Map([
  ...(
    [
      [-2, -2],
      [0, -2],
      [2, -2],
      [-1, -1],
      [1, -1],
      [-2, 0],
      [0, 0],
      [2, 0],
      [-1, 1],
      [1, 1],
      [-2, 2],
      [2, 2],
    ] as const
  ).map(([q, line]) => [`${q},${line}`, "K"] as const),
  ["-1,3", "V"],
  ["1,3", "V"],
])
/** Half-angle of the bay kept open south of the hub: the quay always faces open sea. */
export const BAY = (35 * Math.PI) / 180

export const [HUB_X, HUB_Z] = cellToWorld(HUB)
/** Whether a hex lies in a bay opening south of the hub at `half` radians either side. */
export const bayOf =
  (half: number) =>
  (cell: Cell): boolean => {
    if (cell[0] === HUB[0] && cell[1] === HUB[1]) return false
    const [x, z] = cellToWorld(cell)
    return z - HUB_Z > 0 && Math.abs(x - HUB_X) <= (z - HUB_Z) * Math.tan(half)
  }
export const inBay = bayOf(BAY)

/**
 * How an island's land is bounded while it is planned: the bay its quay looks out over (never
 * land), and, for generator v2, the one landmass every district grows inside (plan/mass.ts).
 * Without a mass the districts grow freely round the hub (v1's ring).
 */
export interface Form {
  bay: (cell: Cell) => boolean
  mass?: ReadonlySet<string>
}
/** v1's form: the wide bay, no mass. */
export const RING: Form = { bay: inBay }

/** The keep's block, its gate and avenue, and the ring of land round them: the harbour's, kept level and clear. */
export const RESERVED: ReadonlySet<string> = (() => {
  const out = new Set<string>([...KEEP.keys(), key(GATE), key(AVENUE)])
  for (const id of KEEP.keys()) for (const next of neighbours(unkey(id))) if (!inBay(next)) out.add(key(next))
  out.delete(key(HUB))
  return out
})()

/** World radius of a round patch of n hexes (a hex is 86.6 square units). */
export const patch = (n: number): number => 5.25 * Math.sqrt(n)
