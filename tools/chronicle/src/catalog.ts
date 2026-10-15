import { CATALOG_VERSION, type Catalog, type CatalogEntry } from "@guildhall/sim/catalog"
import { type Chronicle, isoOf } from "./format.ts"

/**
 * The chronicles catalog written: index.json, the list of every repo with a deep chronicle, as the
 * chronicles repo serves it (`index <dir>`). The site reads it with packages/sim/src/repo/catalog.ts
 * (`loadCatalog`, `parseCatalog`); the shapes are that file's.
 */

/** A description is cut to this many characters (a card's line or two). */
const DESCRIPTION_MAX = 200

/** A chronicle's line in the catalog. */
export function catalogEntry(c: Chronicle): CatalogEntry {
  const description = c.repo.description?.trim()
  return {
    repo: c.repo.name,
    ...(description ? { description: clip(description) } : {}),
    ...(c.repo.stars !== undefined ? { stars: c.repo.stars } : {}),
    languages: c.repo.languages.slice(0, 3).map(([name]) => name),
    years: [yearOf(c.start), yearOf(c.end)],
    files: c.repo.files,
    bytes: c.repo.bytes,
    built: c.generatedAt.slice(0, 10),
  }
}

/** The catalog of these chronicles: one entry a repo (the newest build wins), most stars first. */
export function buildCatalog(chronicles: readonly Chronicle[], updated: string): Catalog {
  const byRepo = new Map<string, Chronicle>()
  for (const c of chronicles) {
    const key = c.repo.name.toLowerCase()
    const kept = byRepo.get(key)
    if (!kept || kept.generatedAt < c.generatedAt) byRepo.set(key, c)
  }
  const repos = [...byRepo.values()].map(catalogEntry).sort(byStars)
  return { v: CATALOG_VERSION, updated: updated.slice(0, 10), repos }
}

function byStars(a: CatalogEntry, b: CatalogEntry): number {
  return (b.stars ?? 0) - (a.stars ?? 0) || a.repo.localeCompare(b.repo)
}

function yearOf(day: number): number {
  return Number(isoOf(day).slice(0, 4))
}

function clip(text: string): string {
  return text.length <= DESCRIPTION_MAX ? text : `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`
}
