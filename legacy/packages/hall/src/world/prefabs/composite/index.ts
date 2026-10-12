import type { KitColour } from "../../gen/biomes.ts"
import { PREFABS } from "../index.ts"
import { CASTLES } from "./castle.ts"
import { CATHEDRALS } from "./cathedral.ts"
import { flatten, type Lookup } from "./flatten.ts"
import { FORGES } from "./forge.ts"
import { HARBOURS } from "./harbour.ts"
import { ISLETS } from "./islets.ts"
import { PLAZAS } from "./plaza.ts"
import { SPIRES } from "./spire.ts"
import type { Composed, Composite } from "./types.ts"

export type { Composed, Composite, Group, Node, Size, Tree, Variant } from "./types.ts"

/** Every composite landmark, in the order the lab lays them out. Ids are stable. */
export const COMPOSITES: readonly Composite[] = [
  ...CASTLES,
  ...CATHEDRALS,
  ...FORGES,
  ...HARBOURS,
  ...SPIRES,
  ...PLAZAS,
  ...ISLETS,
]

const BY_ID = new Map<string, Composite>(COMPOSITES.map((item) => [item.id, item]))

/** The composite with this id; throws on a name the catalogue doesn't have. */
export function composite(id: string): Composite {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`no composite "${id}"`)
  return found
}

const lookup: Lookup = (id) => BY_ID.get(id) ?? PREFABS.find((item) => item.id === id)

/**
 * The composite as `seed` makes it (0 the plain one), a plain prefab with the landmark's extras:
 * `instantiate` puts it into the world, `doorsOf` and `statsOf` read it, as for any prefab.
 */
export const composed = (item: Composite | string, seed = 0, kit: KitColour = "blue"): Composed =>
  flatten(typeof item === "string" ? composite(item) : item, seed, kit, lookup)
