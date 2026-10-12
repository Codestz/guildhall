/** The home page's live numbers: read from the library's catalog and the authored data, never stored. */
import type { Catalog } from "@guildhall/assets"
import type { TilePrefab } from "@guildhall/world"
import type { DataKind } from "../data.ts"

export interface StudioStats {
  pieces: number
  /** Packs that brought at least one piece (an animation-only pack counts under rigs). */
  packs: number
  /** Animation clips across every rig. */
  clips: number
  rigs: number
  /** Props with an authored grip in `data/mounts.json`. */
  mounts: number
  /** Tile prefabs: saved under `data/tiles/`, or the ones in force when that cannot be listed. */
  tiles: number
  /** Activity spots (sit, work, stand, talk, sleep) across the tile prefabs the world builds from. */
  spots: number
  /** The palette hash the library was baked with. */
  palette: string | null
}

export const TILE_KINDS: readonly DataKind[] = ["tiles"]

/**
 * The numbers for a catalog (null: no library yet), the authored mounts, a `list` of a data folder and
 * the tile prefabs in force. A data folder that cannot be listed (a static build with no `/data/`)
 * counts as empty.
 */
export async function studioStats(
  catalog: Catalog | null,
  mounts: Record<string, unknown> | undefined,
  list: (kind: DataKind) => Promise<string[]>,
  prefabs: readonly Pick<TilePrefab, "spots">[] = [],
): Promise<StudioStats> {
  const counts = await Promise.all(TILE_KINDS.map((kind) => list(kind).catch(() => [])))
  const rigs = catalog?.index.rigs ?? []
  return {
    pieces: catalog?.all().length ?? 0,
    packs: catalog?.index.packs.filter((p) => p.count > 0).length ?? 0,
    clips: rigs.reduce((n, rig) => n + rig.clips.length, 0),
    rigs: rigs.length,
    mounts: Object.keys(mounts ?? {}).length,
    // the saved files, or the prefabs in force where the folder cannot be listed (the code's own)
    tiles: Math.max(
      counts.reduce((n, ids) => n + ids.length, 0),
      prefabs.length,
    ),
    spots: prefabs.reduce((n, t) => n + (t.spots?.length ?? 0), 0),
    palette: catalog?.index.palette ?? null,
  }
}

/** A count as the page prints it: thousands grouped, the way the pieces browser does. */
export const formatCount = (n: number): string => n.toLocaleString("en-US")
