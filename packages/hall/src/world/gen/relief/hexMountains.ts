import type { LandPlacement } from "../../lands.ts"
import { unkey } from "../hex.ts"
import { columnDressing } from "./columnDress.ts"
import { columnTiles } from "./columns.ts"
import type { Relief } from "./index.ts"

/**
 * The hex-native mountains (relief style e) as the island's own placements: the columns' tiles and
 * the summit crowns (`ground`, drawn in the snow-line material so the peaks whiten and the cut
 * shows through), and what stands on them (`decor`). The batches draw them with the rest of the land.
 */
export interface HexMountains {
  tiles: LandPlacement[]
  decor: LandPlacement[]
  /** The tiles and the mountain pieces (crowns and the hills' cones): the placements that are the range, not dressing. */
  ground: ReadonlySet<LandPlacement>
}

/** The relief's mountains as placements, or undefined for a style that draws a mesh instead. */
export function hexMountains(
  relief: Relief,
  seed: number,
  river: ReadonlySet<string> = new Set(),
): HexMountains | undefined {
  if (!relief.hex) return undefined
  const { columns, crowns } = relief.hex
  const tiles = [...columns].flatMap(([id, top]) => columnTiles(unkey(id), top))
  const crowned = crowns.map(({ placement }) => placement)
  const dressing = columnDressing(relief.massifs, columns, crowns, seed, river)
  return {
    tiles,
    decor: [...crowned, ...dressing],
    ground: new Set([...tiles, ...crowned, ...dressing.filter(({ piece }) => piece.startsWith("mountain_"))]),
  }
}
