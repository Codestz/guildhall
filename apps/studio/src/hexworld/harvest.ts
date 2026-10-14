/**
 * The autumn harvest on the island (render props/harvest.ts, placed by world harvest.ts in the build
 * worker): hay, pumpkins, crates and sacks on the farms, drawn in one extra draw while it is autumn and in
 * none the rest of the year. How much shows follows the season's autumn weight (`harvestShow`), so the
 * heaps grow in as autumn begins and are gone by winter.
 *
 * `window.guildhall.ext.harvest`: `stats()` (pieces, heaps, shown, draws), `heaps()` (where they stand).
 */
import type { Catalog } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { createHarvest, type Harvest, harvestShow, type SeasonWeights, type Stage } from "@guildhall/render"
import type { HarvestPiece } from "@guildhall/world"
import { libraryUrl } from "../catalog.ts"
import { type PackedHarvest, unpackHarvest } from "./job.ts"

const logger = log("hexworld:harvest")

export interface HarvestMount {
  stats(): ReturnType<Harvest["stats"]>
  /** Where each heap stands (its first piece), world metres (shots). */
  heaps(): { x: number; y: number; z: number; piece: string }[]
  dispose(): void
}

/** Mounts the harvest once its pieces arrive; null if there are none, or the screen went first. */
export async function mountHarvest(parts: {
  stage: Stage
  catalog: Catalog
  packed: Promise<PackedHarvest>
  weights: () => SeasonWeights
  gone: () => boolean
}): Promise<HarvestMount | null> {
  const piles: HarvestPiece[] = unpackHarvest(await parts.packed)
  if (parts.gone()) return null
  const made = await createHarvest(parts.stage, piles, { catalog: parts.catalog, url: libraryUrl })
  if (!made) return null
  if (parts.gone()) {
    made.dispose()
    return null
  }
  const off = parts.stage.onFrame(() => made.show(harvestShow(parts.weights().autumn)))
  logger.info("harvest", made.stats())
  const firsts = new Map<string, HarvestPiece>()
  for (const p of piles) if (!firsts.has(`${p.tile}:${p.heap}`)) firsts.set(`${p.tile}:${p.heap}`, p)
  return {
    stats: made.stats,
    heaps: () => [...firsts.values()].map((p) => ({ x: p.x, y: p.y, z: p.z, piece: p.piece })),
    dispose() {
      off()
      made.dispose()
    },
  }
}
