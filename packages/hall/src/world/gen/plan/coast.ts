import { key, unkey } from "../hex.ts"
import { inBay, RESERVED } from "./keep.ts"
import { drawable, majority, type Owners, spanOf, wet } from "./land.ts"

/**
 * Smooths the shore until every land hex meets the sea along one run of at most four sides (what
 * the pack's coast tiles can draw): sea hexes mostly ringed by land fill in, land hexes the tiles
 * can't draw are given back to the sea. Roads and the keep's reserve stay. Returns the rings from
 * the hub that hold the land after.
 */
export function smoothCoast(owner: Owners, road: ReadonlySet<string>): number {
  const erode = (): boolean => {
    let changed = false
    for (const id of [...owner.keys()]) {
      if (road.has(id) || RESERVED.has(id)) continue
      if (!drawable(wet(owner, unkey(id)))) {
        owner.delete(id)
        changed = true
      }
    }
    return changed
  }
  for (let pass = 0; pass < 20; pass++) {
    let changed = false
    for (const cell of spanOf(owner).cells) {
      const id = key(cell)
      if (owner.has(id) || inBay(cell)) continue
      const { count, district } = majority(owner, cell)
      if (count >= 4 && drawable(wet(owner, cell))) {
        owner.set(id, district)
        changed = true
      }
    }
    if (erode()) changed = true
    if (!changed) break
  }
  while (erode());
  return spanOf(owner).radius
}
