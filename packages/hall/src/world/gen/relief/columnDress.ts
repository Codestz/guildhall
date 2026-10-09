import { cellToWorld, type LandPlacement } from "../../lands.ts"
import { key, neighbours, rng } from "../hex.ts"
import { BODY, COLUMN_STEP } from "./columns.ts"
import type { Crown } from "./crowns.ts"
import type { Massif } from "./field.ts"

/**
 * What stands on the hex-native mountains' columns (relief style e), all of the hex pack's own and
 * set the way the hand map sets its hills: forest on the low columns, wooded hills on the middle
 * ones, bare rock above, and boulders on the edges a column drops away from. Nothing grows in a
 * river's hex or under a crown. Pure and seeded.
 */

/** A column is "low" below this share of its massif's body height, "high" above the second. */
const LOW = 0.22
const WOODED = 0.4
const HIGH = 0.58
/** A column drops away at an edge when its neighbour is this far lower (two tiles). */
const CLIFF = 2 * COLUMN_STEP
/** Boulders sit this far from the centre, towards the drop. */
const EDGE = 3.6
const ROCKS = ["rock_single_A", "rock_single_B", "rock_single_C", "rock_single_D", "rock_single_E"] as const
const FOREST = ["trees_A_large", "trees_B_large", "trees_A_medium", "trees_B_medium"] as const
const HILLS = ["hills_A_trees", "hills_B_trees", "hills_C_trees"] as const
const GREEN = [
  "mountain_A_grass_trees",
  "mountain_B_grass_trees",
  "mountain_C_grass_trees",
  "mountain_A_grass",
] as const
const ROCK = ["mountain_A", "mountain_B", "mountain_C"] as const
const SINGLES = ["tree_single_A", "tree_single_B"] as const

export function columnDressing(
  massifs: readonly Massif[],
  tops: ReadonlyMap<string, number>,
  crowns: readonly Crown[],
  seed: number,
  river: ReadonlySet<string> = new Set(),
): LandPlacement[] {
  const random = rng(seed ^ 0x3c0de)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T
  const out: LandPlacement[] = []
  for (const massif of massifs)
    for (const cell of massif.cells) {
      const id = key(cell)
      const top = tops.get(id) as number
      const [cx, cz] = cellToWorld(cell)
      const rolls = [random(), random(), random(), random()] as const
      const spin = random() * Math.PI * 2
      const covered = crowns.some(
        ({ placement, reach }) => Math.hypot(placement.x - cx, placement.z - cz) < 0.8 * reach,
      )
      if (river.has(id) || covered) continue
      const put = (piece: LandPlacement["piece"], dx = 0, dz = 0, scale?: number): void => {
        out.push({
          piece,
          x: Math.round((cx + dx) * 100) / 100,
          z: Math.round((cz + dz) * 100) / 100,
          y: top,
          rot: spin + dx,
          ...(scale ? { scale } : {}),
        })
      }
      const share = top / (BODY * massif.height)
      if (share < LOW) {
        if (rolls[0] < 0.6) put(pick(FOREST))
        else {
          put(pick(SINGLES), -2.2, 1.4)
          put(pick(SINGLES), 2.4, -1.2)
        }
      } else if (share < WOODED) {
        if (rolls[0] < 0.55) put(pick(HILLS))
        else put(pick(["trees_A_small", "trees_B_small"] as const), 1.2, 0.6)
      } else if (share < HIGH) put(pick(GREEN), 0, 0, 0.95 + 0.25 * rolls[3])
      else if (rolls[0] < 0.75) put(pick(ROCK), 0, 0, 1 + 0.3 * rolls[3])
      else put(pick(ROCKS), 1.6 * rolls[1] - 0.8, 1.6 * rolls[2] - 0.8, 1.8 + 1.4 * rolls[3])
      // Boulders on a drop's edge: towards the lowest neighbour, when it falls away far enough.
      const low = neighbours(cell)
        .map((n) => ({ n, top: tops.get(key(n)) ?? 0 }))
        .reduce((lowest, next) => (next.top < lowest.top ? next : lowest))
      if (top - low.top >= CLIFF && rolls[1] < 0.5) {
        const [nx, nz] = cellToWorld(low.n)
        const length = Math.hypot(nx - cx, nz - cz)
        put(pick(ROCKS), ((nx - cx) / length) * EDGE, ((nz - cz) / length) * EDGE, 1.1 + 0.9 * rolls[2])
      }
    }
  return out
}
