/**
 * The import cache: `library/.cache/<pack>.json` maps slug → key. A piece whose key is unchanged (same
 * source bytes, same pack config, same palette, same importer) keeps its GLB and catalog entry.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export type PackCache = Record<string, string>

/** 16 hex characters of SHA-256: content hashes for GLBs and cache keys. */
export const contentHash = (...parts: (string | Uint8Array)[]): string => {
  const h = createHash("sha256")
  for (const p of parts) h.update(p).update("\0")
  return h.digest("hex").slice(0, 16)
}

/** JSON with object keys sorted at every level, so equal values serialise to equal bytes. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  )
}

/** A piece's cache key. Any change to the pack's config re-imports the whole pack. */
export function pieceKey(k: {
  source: Uint8Array
  pack: unknown
  palette: string
  importer: string
}): string {
  return contentHash(k.source, stableStringify(k.pack), k.palette, k.importer)
}

export const cacheFile = (library: string, pack: string): string => join(library, ".cache", `${pack}.json`)

export function loadCache(library: string, pack: string): PackCache {
  const file = cacheFile(library, pack)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PackCache
  } catch {
    return {}
  }
}

export function saveCache(library: string, pack: string, cache: PackCache): void {
  const file = cacheFile(library, pack)
  mkdirSync(dirname(file), { recursive: true })
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => (a < b ? -1 : 1)))
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`)
}
