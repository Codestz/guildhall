import { CIVIC } from "./civic.ts"
import { HOUSES, SQUARES } from "./houses.ts"
import { LOOKOUTS } from "./lookout.ts"
import { TOWN2 } from "./town2.ts"
import type { Prefab } from "./types.ts"
import { VENUES } from "./venues.ts"
import { WALLS } from "./walls.ts"

export { doorsOf, fixturesOf, instantiate } from "./place.ts"
export { type PieceInfo, type Stats, statsOf } from "./stats.ts"
export {
  DOOR_DEPTH,
  type Door,
  type Fixture,
  type Part,
  type Prefab,
  type PrefabKind,
  pieceOf,
  type Variation,
} from "./types.ts"
export { KITS, type Resolved, resolve, roll } from "./variants.ts"

/** Every prefab, in the order the lab lays them out. Ids are stable. */
export const PREFABS: readonly Prefab[] = [
  ...HOUSES,
  ...SQUARES,
  ...CIVIC,
  ...VENUES,
  ...WALLS,
  ...LOOKOUTS,
  ...TOWN2,
]

const BY_ID = new Map(PREFABS.map((prefab) => [prefab.id, prefab]))

/** The prefab with this id; throws on a name the catalogue doesn't have (a typo is a bug, not a gap). */
export function prefab(id: string): Prefab {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`no prefab "${id}"`)
  return found
}

/** The houses, by how many each holds (1, 2 or 3). */
export const housesOf = (count: 1 | 2 | 3): readonly Prefab[] =>
  HOUSES.filter((house) => house.houses === count)
