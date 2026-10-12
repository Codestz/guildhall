/** The catalog in memory: pure and synchronous over parsed JSON. Fetching the files is the app's job. */
import type { CatalogEntry, CatalogIndex, Category, Kind, PieceFlag, RigEntry, ScaleFlag } from "./catalog.ts"
import type { AttachRole } from "./compose.ts"

/** Every field narrows the result; an empty query returns everything. */
export interface CatalogQuery {
  /** Words that must all appear (case-insensitive) in the id, name, category or a tag. */
  text?: string
  pack?: string
  category?: Category
  /** All must be present, in `tags` or `autoTags.tags`. */
  tags?: readonly string[]
  /** All must be raised, as piece flags or scale flags. */
  flags?: readonly (PieceFlag | ScaleFlag)[]
  attach?: AttachRole
  kind?: Kind
  /** Per-axis bounds on `size` (w, h, d), metres, inclusive. */
  minSize?: readonly [w: number, h: number, d: number]
  maxSize?: readonly [w: number, h: number, d: number]
}

/** Entry counts per value, for the browser's facet chips. */
export interface Facets {
  pack: Record<string, number>
  category: Record<string, number>
  tag: Record<string, number>
  flag: Record<string, number>
}

export interface Catalog {
  index: CatalogIndex
  /** Sorted by id. */
  all(): readonly CatalogEntry[]
  get(id: string): CatalogEntry | undefined
  query(q: CatalogQuery): CatalogEntry[]
  /** Counts over `entries` (default: the whole catalog). */
  facets(entries?: readonly CatalogEntry[]): Facets
  rig(id: string): RigEntry | undefined
}

const tagsOf = (e: CatalogEntry): string[] => (e.autoTags ? [...e.tags, ...e.autoTags.tags] : e.tags)
const flagsOf = (e: CatalogEntry): string[] => [...e.flags, ...e.scale.flags]

function matches(e: CatalogEntry, q: CatalogQuery, words: readonly string[]): boolean {
  if (q.pack !== undefined && e.pack !== q.pack) return false
  if (q.category !== undefined && e.category !== q.category) return false
  if (q.attach !== undefined && e.compose.attach !== q.attach) return false
  if (q.kind !== undefined && e.kind !== q.kind) return false
  if (q.tags && !q.tags.every((t) => tagsOf(e).includes(t))) return false
  if (q.flags && !q.flags.every((f) => flagsOf(e).includes(f))) return false
  const { minSize: lo, maxSize: hi } = q
  if (lo && e.size.some((v, i) => v < (lo[i] as number))) return false
  if (hi && e.size.some((v, i) => v > (hi[i] as number))) return false
  if (words.length > 0) {
    const haystack = [e.id, e.name, e.category, ...tagsOf(e)].join(" ").toLowerCase()
    if (!words.every((w) => haystack.includes(w))) return false
  }
  return true
}

function count(into: Record<string, number>, key: string): void {
  into[key] = (into[key] ?? 0) + 1
}

/** Builds the catalog from the index and its shards. Throws on an id that appears twice. */
export function createCatalog(index: CatalogIndex, shards: readonly (readonly CatalogEntry[])[]): Catalog {
  const entries = shards.flat().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const byId = new Map<string, CatalogEntry>()
  for (const e of entries) {
    if (byId.has(e.id)) throw new Error(`catalog: duplicate id "${e.id}"`)
    byId.set(e.id, e)
  }
  const rigs = new Map(index.rigs.map((r) => [r.id, r]))

  return {
    index,
    all: () => entries,
    get: (id) => byId.get(id),
    rig: (id) => rigs.get(id),
    query(q) {
      const words = (q.text ?? "").toLowerCase().split(/\s+/).filter(Boolean)
      return entries.filter((e) => matches(e, q, words))
    },
    facets(list = entries) {
      const out: Facets = { pack: {}, category: {}, tag: {}, flag: {} }
      for (const e of list) {
        count(out.pack, e.pack)
        count(out.category, e.category)
        for (const t of new Set(tagsOf(e))) count(out.tag, t)
        for (const f of new Set(flagsOf(e))) count(out.flag, f)
      }
      return out
    },
  }
}
