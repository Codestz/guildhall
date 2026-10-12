import { chronicleFile } from "./bundled.ts"
import { type Chronicle, isoOf } from "./format.ts"

/**
 * The chronicles catalog: index.json, the list of every repo with a deep chronicle (docs/adr/
 * 0019-chronicles-backend.md). Two copies exist: the hall's own (public/chronicles/index.json, what
 * `bun scripts/chronicle.ts bundle` writes for the chronicles it ships) and the chronicles repo's,
 * served by jsDelivr, which grows as people ask for islands (a GitHub issue, built by an Action).
 * The Harbour (/harbour) lists it; the repo door asks it whether an island is deep or quick.
 */

/** The public repo that builds and stores deep chronicles. */
export const CHRONICLES_REPO = "Codestz/guildhall-chronicles"
/** Where the hall reads them: jsDelivr's mirror of that repo's main branch. The one place to point elsewhere. */
export const CHRONICLES_CDN = `https://cdn.jsdelivr.net/gh/${CHRONICLES_REPO}@main/`

export const CATALOG_VERSION = 1
/** A description is cut to this many characters (a card's line or two). */
const DESCRIPTION_MAX = 200

export interface CatalogEntry {
  /** "owner/name", as GitHub spells it now. */
  repo: string
  description?: string
  stars?: number
  /** Biggest first, at most three. */
  languages: string[]
  /** First and last year of its history. */
  years: [number, number]
  /** Today's size. */
  files: number
  bytes: number
  /** "YYYY-MM-DD" the chronicle was built. */
  built: string
}

export interface Catalog {
  v: typeof CATALOG_VERSION
  /** "YYYY-MM-DD" it was written. */
  updated: string
  /** Most stars first. */
  repos: CatalogEntry[]
}

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

/**
 * A catalog from JSON (it comes off a CDN: trusted for nothing). Undefined when it isn't one; an
 * entry that is malformed is dropped, the rest kept.
 */
export function parseCatalog(value: unknown): Catalog | undefined {
  const c = value as Partial<Catalog> | null
  if (!c || typeof c !== "object" || c.v !== CATALOG_VERSION || !Array.isArray(c.repos)) return undefined
  const repos = c.repos.flatMap((entry) => {
    const ok = entryOf(entry)
    return ok ? [ok] : []
  })
  return { v: CATALOG_VERSION, updated: typeof c.updated === "string" ? c.updated : "", repos }
}

/** Where a catalog was read from. */
export type CatalogSource = "cdn" | "bundled"

/**
 * The catalog: the chronicles repo's (CDN) when it answers, else the hall's own. Undefined when
 * neither does. Never rejects.
 */
export async function loadCatalog(
  fetcher: typeof fetch = fetch,
  base: string = import.meta.env?.BASE_URL ?? "/",
): Promise<{ catalog: Catalog; source: CatalogSource } | undefined> {
  const cdn = await fetchCatalog(`${CHRONICLES_CDN}index.json`, fetcher)
  if (cdn) return { catalog: cdn, source: "cdn" }
  const bundled = await fetchCatalog(`${base}chronicles/index.json`, fetcher)
  return bundled ? { catalog: bundled, source: "bundled" } : undefined
}

/** Whether `repo` ("owner/name", or an alias bundled.ts knows) has a deep chronicle in the catalog. */
export function inCatalog(catalog: Catalog, repo: string): boolean {
  const file = chronicleFile(repo)
  return catalog.repos.some((entry) => chronicleFile(entry.repo) === file)
}

async function fetchCatalog(url: string, fetcher: typeof fetch): Promise<Catalog | undefined> {
  try {
    const response = await fetcher(url)
    if (!response.ok) return undefined
    return parseCatalog(await response.json())
  } catch {
    return undefined
  }
}

const REPO = /^[\w.-]+\/[\w.-]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const count = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0

function entryOf(value: unknown): CatalogEntry | undefined {
  const e = value as Partial<CatalogEntry> | null
  if (!e || typeof e !== "object") return undefined
  if (typeof e.repo !== "string" || !REPO.test(e.repo)) return undefined
  if (!count(e.files) || !count(e.bytes) || typeof e.built !== "string" || !DATE.test(e.built))
    return undefined
  const years = Array.isArray(e.years) && e.years.length === 2 && e.years.every(count) ? e.years : undefined
  if (!years) return undefined
  const languages = Array.isArray(e.languages)
    ? e.languages.filter((name): name is string => typeof name === "string").slice(0, 3)
    : []
  return {
    repo: e.repo,
    ...(typeof e.description === "string" && e.description ? { description: clip(e.description) } : {}),
    ...(count(e.stars) ? { stars: e.stars } : {}),
    languages,
    years: [years[0] as number, years[1] as number],
    files: e.files,
    bytes: e.bytes,
    built: e.built,
  }
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
