import { PATCH_HALF, type Patch } from "../../world/archipelago.ts"
import type { FarIsland } from "../../world/archipelagoSource.ts"
import type { World } from "../../world/world.ts"
import type { Hole } from "../nature/shore.ts"
import { outreachOf, type ShoreTile, shoreTilesOf } from "../nature/shoreTiles.ts"

/**
 * Where an island's water is drawn (nature/Water.tsx), which is what keeps islands from sharing sea:
 * the home island's own bake (or its shore tiles, for a big generator-v2 island); a far island's one
 * patch of ±PATCH_HALF, or, for a big one, the same tiles at a far island's coarser bake.
 */

/** A far island's shore tile is baked at this many texels across, half the home island's (nature/shore.ts SHORE.size). */
const FAR_SIZE = 512

const farTiles = new WeakMap<World, readonly ShoreTile[]>()

/** A big island's shore tiles drawn as a far island's (none for an island the one patch holds). */
export function farTilesOf(world: World): readonly ShoreTile[] {
  if (outreachOf(world) === 1) return []
  let tiles = farTiles.get(world)
  if (!tiles) {
    tiles = shoreTilesOf(world).map((tile) => ({ ...tile, size: FAR_SIZE }))
    farTiles.set(world, tiles)
  }
  return tiles
}

/** The squares of water an island is drawn in, from its keep (`far`: as a far island, else as the home one). */
export function patchesOf(world: World, far: boolean): readonly Patch[] {
  if (far && outreachOf(world) === 1) return [{ at: [0, 0], half: PATCH_HALF }]
  return (far ? farTilesOf(world) : shoreTilesOf(world)).map(({ at, half }) => ({ at, half }))
}

/** The holes a far island leaves in the open sea: its squares of water, moved to where it lies. */
export function holesOf(island: FarIsland): Hole[] {
  return patchesOf(island.world, true).map(({ at, half }) => ({
    at: [island.at[0] + at[0], island.at[1] + at[1]],
    half,
  }))
}
