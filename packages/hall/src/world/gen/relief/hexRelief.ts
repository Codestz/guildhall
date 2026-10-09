import { key, neighbours, unkey } from "../hex.ts"
import { COLUMN_STEP, columnsOf } from "./columns.ts"
import { type Crown, type CrownSite, crownAt, crownSites } from "./crowns.ts"
import type { Massif } from "./field.ts"

/**
 * The hex-native relief's ground (relief style e): every massif hex's flat column top, and the
 * crowns that stand on the highest. A crown's foot is wider than its hex, so the six hexes round it
 * are raised to within one tile of its column (a stepped shoulder, as the kit's own terraces climb).
 */
export interface HexRelief {
  /** Each massif hex's column top, world units, by key: what walkers stand on. */
  columns: ReadonlyMap<string, number>
  crowns: readonly Crown[]
}

export function hexReliefOf(massifs: readonly Massif[], seed: number): HexRelief {
  const columns = columnsOf(massifs)
  const sites: CrownSite[] = []
  for (const site of crownSites(massifs, columns)) {
    const top = columns.get(site.id) as number
    const around = neighbours(unkey(site.id))
    // An earlier crown's shoulder may have raised a neighbour past this ridge top: it is a slope now.
    if (!site.main && around.some((n) => (columns.get(key(n)) ?? 0) > top)) continue
    sites.push(site)
    for (const n of around) {
      const mine = columns.get(key(n))
      if (mine !== undefined && mine < top - COLUMN_STEP) columns.set(key(n), top - COLUMN_STEP)
    }
  }
  return { columns, crowns: sites.map((site) => crownAt(site, columns.get(site.id) as number, seed)) }
}
