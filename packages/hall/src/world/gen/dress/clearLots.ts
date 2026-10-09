import { cellToWorld } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { instantiate, prefab } from "../../prefabs/index.ts"
import { unkey } from "../hex.ts"
import { crowds, type Footprint, footprintsOf } from "./footprints.ts"
import type { Lot } from "./town.ts"
import type { Anchor } from "./venues.ts"

/** The room kept between a lot's buildings and the civic centre's, the wall's, a venue's or another lot's. */
export const LOT_GAP = 1

/**
 * Lots the civic centre, a venue or the wall stand on are dropped; so is one whose buildings would
 * touch the `fixed` footprints or a lot kept before it (markets first), unless a cottage in its
 * place fits.
 */
export function clearLots(
  lots: Map<string, Lot>,
  clear: readonly Anchor[],
  wall: readonly Spot[],
  fixed: readonly Footprint[],
): void {
  for (const id of [...lots.keys()]) {
    const [x, z] = cellToWorld(unkey(id))
    const crowded =
      clear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + 4) ||
      wall.some(([wx, wz]) => Math.hypot(wx - x, wz - z) < 7)
    if (crowded) lots.delete(id)
  }
  const market = (lot: Lot): number => (lot.prefab.kind === "market" ? 0 : 1)
  const order = [...lots].sort(([a, one], [b, two]) => market(one) - market(two) || (a < b ? -1 : 1))
  const standing: Footprint[] = [...fixed]
  const room = (id: string, lot: Lot): Footprint[] | undefined => {
    const own = footprintsOf(instantiate(lot.prefab, cellToWorld(unkey(id)), lot.rot, "blue"))
    return own.some((shape) => standing.some((other) => crowds(shape, other, LOT_GAP))) ? undefined : own
  }
  for (const [id, lot] of order) {
    const cottage: Lot = { ...lot, prefab: prefab("house-cottage") }
    const own = room(id, lot)
    const kept = own ?? (lot.prefab.kind === "house" ? room(id, cottage) : undefined)
    if (!kept) lots.delete(id)
    else {
      if (!own) lots.set(id, cottage)
      standing.push(...kept)
    }
  }
}
