import { DMath } from "../../dmath.ts"
import type { Home } from "../../homes.ts"
import { cellToWorld } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { DOOR_DEPTH, doorsOf } from "../../prefabs/index.ts"
import { unkey } from "../hex.ts"
import type { IslandPlan } from "../plan.ts"
import { round } from "./sites.ts"
import type { Lot } from "./town.ts"

/**
 * The homes of a gen 2 island: every door of every lot the town stands on (dress/town.ts), after
 * the civic centre, the venues and the wall have cleared theirs. In the lots' key order, so the
 * numbering is the island's own. A prefab's door is a step in front of the facade; the sill lies a
 * pace in, and the window glows beside it.
 */

/** The window sits this far to the door's side, and this high. */
const BESIDE = 1.35
const HIGH = 2.1

export function homesOf(plan: IslandPlan, lots: ReadonlyMap<string, Lot>): Home[] {
  const homes: Home[] = []
  for (const id of [...lots.keys()].sort()) {
    const lot = lots.get(id) as Lot
    if (lot.prefab.kind !== "house") continue
    const hex = plan.land.get(id)
    const district = hex?.district === undefined ? undefined : plan.districts[hex.district]
    if (!district) continue
    const at: Spot = cellToWorld(unkey(id))
    for (const door of doorsOf(lot.prefab, at, lot.rot)) {
      const depth = door.depth ?? DOOR_DEPTH
      const out = [DMath.sin(door.rot), DMath.cos(door.rot)] as const
      const step: Spot = [door.x, door.z]
      const sill: Spot = [round(step[0] - out[0] * depth), round(step[1] - out[1] * depth)]
      homes.push({
        id: `home:${homes.length}`,
        district: district.folder.name,
        door: { step, sill, y: door.y ?? 0, inward: round(door.rot + Math.PI) },
        // To the left of someone facing the door, on the facade.
        window: { x: round(sill[0] - out[1] * BESIDE), y: HIGH, z: round(sill[1] + out[0] * BESIDE) },
      })
    }
  }
  return homes
}
