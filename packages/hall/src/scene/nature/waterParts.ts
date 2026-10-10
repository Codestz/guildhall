import { PATCH_HALF, seaRadiusOf } from "../../world/archipelago.ts"
import type { Archipelago } from "../../world/archipelagoSource.ts"
import type { Spot } from "../../world/layout.ts"
import { reachOf, type World } from "../../world/world.ts"
import { farTilesOf, holesOf, patchHalfOf } from "../archipelago/footprint.ts"
import { type Hole, SHORE, type ShoreLayout } from "./shore.ts"
import { outreachOf, type ShoreTile, shoreTilesOf } from "./shoreTiles.ts"

/**
 * The surfaces a world's water is drawn as (nature/Water.tsx): one for an island the one bake holds,
 * or, for a big one (generator v2), the open sea with a hole per shore tile and a surface over each.
 * A far island of an archipelago is drawn the same way round its own keep (`at`, its offset).
 */

/** A far island's shore patch (world/archipelago.ts): its own bake, coarser than the home island's. */
const PATCH: ShoreLayout = { half: PATCH_HALF, size: 512 }
/** The disc of sea round a home island that fits the one bake (a bigger screen's reach widens it). */
const DISC = 420

/** Where a surface lies: the disc round the home island (its radius), a grid with holes, or a patch over one. */
export type Sea = { disc: number } | { radius: number; holes: readonly Hole[] } | { patch: number; at?: Spot }

/** One water surface: where it lies, the shore it reads (none: open sea), and whether its bake waits its turn. */
export interface Part {
  key: string
  sea: Sea
  layout: ShoreLayout | null
  queued: boolean
}

/** A patch of water over each shore tile, each reading its own bake, baked one a frame. */
const tileParts = (tiles: readonly ShoreTile[]): Part[] =>
  tiles.map((tile) => ({
    key: `tile ${tile.at.join(",")}`,
    sea: { patch: tile.half, at: tile.at },
    layout: tile,
    queued: true,
  }))

export function partsOf(world: World, archipelago: Archipelago | null, view: number, at?: Spot): Part[] {
  // A far island: its one patch, or (a big generator-v2 one) its shore tiles at a far island's coarser bake.
  if (at) {
    if (outreachOf(world) === 1) {
      // A split repo's island has a tight patch (scene/archipelago/footprint.ts), so its straits can be narrow.
      const half = archipelago?.islands.find((island) => island.world === world)?.tight
        ? patchHalfOf(world)
        : PATCH_HALF
      return [
        {
          key: "patch",
          sea: { patch: half },
          layout: half === PATCH_HALF ? PATCH : { ...PATCH, half },
          queued: false,
        },
      ]
    }
    return tileParts(farTilesOf(world))
  }
  const far: Hole[] = archipelago?.islands.flatMap(holesOf) ?? []
  if (outreachOf(world) === 1) {
    const sea: Sea = archipelago
      ? { radius: seaRadiusOf(archipelago.extent), holes: far }
      : { disc: Math.max(DISC, view) }
    return [{ key: "home", sea, layout: SHORE, queued: false }]
  }
  const tiles = shoreTilesOf(world)
  const radius = Math.max(seaRadiusOf(Math.max(archipelago?.extent ?? 0, reachOf(world))), view)
  return [
    { key: "sea", sea: { radius, holes: [...tiles, ...far] }, layout: null, queued: false },
    ...tileParts(tiles),
  ]
}
