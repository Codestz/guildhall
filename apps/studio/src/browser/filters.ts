/** The browser's filter state: read from and written to the deep link, applied to the catalog. */
import {
  CATEGORIES,
  type Catalog,
  type CatalogEntry,
  type Category,
  PIECE_FLAGS,
  type PieceFlag,
  SCALE_FLAGS,
  type ScaleFlag,
} from "@guildhall/assets"

export type Flag = PieceFlag | ScaleFlag

/** Every flag the rail offers, scale flags first (they are what the Look bar judges). */
export const FLAGS: readonly Flag[] = [...SCALE_FLAGS, ...PIECE_FLAGS]

export interface Filters {
  /** Free text over id, name, category and tags. */
  text: string
  pack: string | null
  category: Category | null
  /** All must be raised. */
  flags: Flag[]
  /** Only pieces with any piece or scale flag. */
  misfit: boolean
}

export const NO_FILTERS: Filters = { text: "", pack: null, category: null, flags: [], misfit: false }

const isCategory = (v: string): v is Category => (CATEGORIES as readonly string[]).includes(v)
const isFlag = (v: string): v is Flag => (FLAGS as readonly string[]).includes(v)

/** `?q=…&pack=…&cat=…&flag=a,b&misfit=1`; unknown categories and flags are ignored. */
export function parseFilters(query: URLSearchParams): Filters {
  const cat = query.get("cat")
  return {
    text: query.get("q") ?? "",
    pack: query.get("pack") || null,
    category: cat && isCategory(cat) ? cat : null,
    flags: (query.get("flag") ?? "").split(",").filter(isFlag),
    misfit: query.get("misfit") === "1",
  }
}

/** The deep link for `filters` and `id`, keeping every other parameter of `base` (screen, hud, log). */
export function toSearch(base: URLSearchParams, filters: Filters, id: string | null): string {
  const out = new URLSearchParams(base)
  const set = (key: string, value: string | null) => (value ? out.set(key, value) : out.delete(key))
  set("q", filters.text.trim() || null)
  set("pack", filters.pack)
  set("cat", filters.category)
  set("flag", filters.flags.join(",") || null)
  set("misfit", filters.misfit ? "1" : null)
  set("id", id)
  return `?${out.toString()}`
}

const hasFlag = (e: CatalogEntry) => e.flags.length > 0 || e.scale.flags.length > 0

/** The entries `filters` let through, sorted by id. */
export function applyFilters(catalog: Catalog, filters: Filters): CatalogEntry[] {
  const entries = catalog.query({
    text: filters.text,
    ...(filters.pack ? { pack: filters.pack } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.flags.length > 0 ? { flags: filters.flags } : {}),
  })
  return filters.misfit ? entries.filter(hasFlag) : entries
}

export interface RailCounts {
  pack: Record<string, number>
  category: Record<string, number>
  flag: Record<string, number>
  misfit: number
}

/**
 * The counts beside each rail option. A single-choice facet (pack, category) counts with every other
 * filter applied but its own, so its options read as "what picking this would show"; flags narrow
 * together, so they count over the current result.
 */
export function railCounts(catalog: Catalog, filters: Filters): RailCounts {
  const without = (patch: Partial<Filters>) => applyFilters(catalog, { ...filters, ...patch })
  return {
    pack: catalog.facets(without({ pack: null })).pack,
    category: catalog.facets(without({ category: null })).category,
    flag: catalog.facets(without({})).flag,
    misfit: without({ misfit: false }).filter(hasFlag).length,
  }
}
