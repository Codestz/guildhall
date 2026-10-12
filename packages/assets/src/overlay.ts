/**
 * Authored data laid over imported catalog entries (ADR 010). Import persists it into the shards and
 * Studio applies it live, through this one function, so both see the same catalog.
 */
import type { CatalogEntry } from "./catalog.ts"
import type { Mount } from "./mount.ts"

/** What `data/` contributes to catalog entries; a parsed `data/mounts.json` is one. */
export interface DataOverlay {
  /** Catalog id → mount. When given, it is the whole truth: entries not listed lose any mount. */
  mounts?: Record<string, Mount>
}

/**
 * Entries with the overlay applied. Pure and idempotent: inputs are not mutated, an entry whose data
 * is unchanged is returned as the same object (so callers can tell which shards changed), and ids the
 * catalog does not have are ignored.
 */
export function applyOverlay(entries: readonly CatalogEntry[], o: DataOverlay): CatalogEntry[] {
  const { mounts } = o
  if (!mounts) return [...entries]
  return entries.map((e) => {
    const mount = Object.hasOwn(mounts, e.id) ? mounts[e.id] : undefined
    if (JSON.stringify(mount) === JSON.stringify(e.compose.mount)) return e
    const { mount: _old, ...compose } = e.compose
    return { ...e, compose: mount ? { ...compose, mount: structuredClone(mount) } : compose }
  })
}
