/**
 * The authored tile prefabs (`data/tiles/<id>.json`, the tile composer's files) put in place for the
 * world: every screen that builds hex tiles awaits `loadTiles()` first, so the island is built from the
 * data, not world's code fallback. A file that fails the validator is logged and left out.
 */
import { log } from "@guildhall/core"
import { installTilePrefabs, parseTilePrefabs, type TilePrefab } from "@guildhall/world"
import * as data from "./data.ts"

const logger = log("studio:tiles")

/** Reads every tile file, installs the valid ones, and returns them (empty: none saved, the fallback stands). */
export async function loadTiles(): Promise<TilePrefab[]> {
  const ids = await data.list("tiles").catch((): string[] => [])
  const files = Object.fromEntries(
    await Promise.all(ids.map(async (id) => [id, await data.load("tiles", id).catch(() => null)] as const)),
  )
  const { prefabs, problems } = parseTilePrefabs(files)
  if (problems.length) logger.warn("tile files left out", { problems: problems.slice(0, 8) })
  if (prefabs.length) installTilePrefabs(prefabs)
  logger.info("tiles", { files: ids.length, installed: prefabs.length })
  return prefabs
}
