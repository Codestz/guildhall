import type { Cell } from "../../lands.ts"
import { key } from "../hex.ts"
import type { IslandPlan } from "../plan.ts"
import { reliefOf } from "../relief/index.ts"
import { riversOf } from "../rivers/index.ts"

/**
 * The hexes the mountains and rivers will cover, known while the island is still being dressed
 * (generator v2): world.ts grows the relief and the rivers after the dresser is done, taking
 * whatever stands on the hexes they cover, so a venue is placed knowing where they will be.
 * It is the same relief and the same rivers on a throwaway copy, in the default art direction
 * (`?relief=` sculpts the heights, and may move a river a hex; world.ts still drops a venue whose
 * building ends up under one).
 */
export interface Cover {
  /** Every hex a massif holds, by key. */
  massifs: ReadonlySet<string>
  /** Every hex a river runs through, by key. */
  rivers: ReadonlySet<string>
}

export function coverOf(plan: IslandPlan, levels: ReadonlyMap<string, number>): Cover {
  const level = (cell: Cell): number => levels.get(key(cell)) ?? 0
  const relief = reliefOf({ plan, level })
  if (relief.massifs.length === 0) return { massifs: new Set(), rivers: new Set() }
  return { massifs: relief.keys, rivers: riversOf(plan, relief, level)?.hexes ?? new Set() }
}
