/** The asset library as the studio reads it: `/library/catalog/index.json` plus one shard per pack. */
import { type Catalog, type CatalogEntry, type CatalogIndex, createCatalog } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { BASE } from "./env.ts"

const logger = log("studio:catalog")

/** Where vite serves the library (vite.config.ts). */
export const LIBRARY = `${BASE}library`

type Fetch = (url: string) => Promise<Pick<Response, "ok" | "status" | "json">>

/**
 * The library's catalog, or null when there is no library yet (no index, or an index listing no
 * pieces). A shard that fails to load is logged and left out, so one broken pack does not hide the rest.
 */
export async function loadCatalog(fetcher: Fetch = fetch, base = LIBRARY): Promise<Catalog | null> {
  const response = await fetcher(`${base}/catalog/index.json`).catch(() => null)
  if (!response?.ok) {
    logger.info("no library", { status: response?.status ?? "unreachable" })
    return null
  }
  const index = (await response.json()) as CatalogIndex
  const shards = await Promise.all(
    index.packs.map(async ({ id }): Promise<CatalogEntry[]> => {
      try {
        const shard = await fetcher(`${base}/catalog/${encodeURIComponent(id)}.json`)
        if (!shard.ok) throw new Error(`HTTP ${shard.status}`)
        return (await shard.json()) as CatalogEntry[]
      } catch (error) {
        logger.warn("shard failed", { pack: id, error: String(error) })
        return []
      }
    }),
  )
  const catalog = createCatalog(index, shards)
  logger.info("loaded", { packs: index.packs.length, entries: catalog.all().length })
  return catalog.all().length > 0 ? catalog : null
}

/** The url a library-relative path (`files.glb`, `files.thumb`) is served at. */
export function libraryUrl(path: string, base = LIBRARY): string {
  return `${base}/${path.split("/").map(encodeURIComponent).join("/")}`
}
