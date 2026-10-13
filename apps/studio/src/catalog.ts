/** The asset library as the studio reads it: `/library/catalog/index.json` plus one shard per pack. */
import { type Catalog, type CatalogEntry, type CatalogIndex, createCatalog, inStyle } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { LIBRARY_ROOT } from "./env.ts"

const logger = log("studio:catalog")

/** Where the library is served: vite's `/library/` (vite.config.ts), or the CDN a showcase build names. */
export const LIBRARY = LIBRARY_ROOT

type Fetch = (url: string) => Promise<Pick<Response, "ok" | "status" | "json">>

/**
 * Whether the Studio shows every imported pack (`?packs=all`) or only the house style's (the default:
 * decisions.md "Clean restart on hex").
 */
const allPacks = (): boolean =>
  typeof location !== "undefined" && new URLSearchParams(location.search).get("packs") === "all"

/**
 * The library's catalog, or null when there is no library yet (no index, or an index listing no
 * pieces). A shard that fails to load is logged and left out, so one broken pack does not hide the rest.
 * Only the house style's packs are read unless `all` (default: the page's `?packs=all`).
 */
export async function loadCatalog(
  fetcher: Fetch = fetch,
  base = LIBRARY,
  all = allPacks(),
): Promise<Catalog | null> {
  // The page's own library is read once: the island, the studio's screens and a move between them share it.
  if (fetcher !== fetch || base !== LIBRARY) return readCatalog(fetcher, base, all)
  const held = shared.get(all)
  if (held) return held
  const read = readCatalog(fetcher, base, all)
  shared.set(all, read)
  // a library that is not there yet, or a failed read, is asked for again next time
  void read.then(
    (c) => c ?? shared.delete(all),
    () => shared.delete(all),
  )
  return read
}

const shared = new Map<boolean, Promise<Catalog | null>>()

async function readCatalog(fetcher: Fetch, base: string, all: boolean): Promise<Catalog | null> {
  const response = await fetcher(`${base}/catalog/index.json`).catch(() => null)
  if (!response?.ok) {
    logger.info("no library", { status: response?.status ?? "unreachable" })
    return null
  }
  const full = (await response.json()) as CatalogIndex
  const index: CatalogIndex = all ? full : { ...full, packs: full.packs.filter((p) => inStyle(p.id)) }
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
