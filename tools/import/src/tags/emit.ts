/**
 * `tag emit`: batch manifests for every piece whose thumbnail has no cached answer, so the step is
 * resumable — a piece is listed again only when its thumbnail changed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Category } from "@guildhall/assets"
import { contentHash } from "../cache.ts"
import { readShard, shardIds } from "../catalog.ts"
import { batchDir, cacheFile, type TagCache, type Vocab } from "./vocab.ts"

export const BATCH = 40

export interface BatchItem {
  id: string
  /** Absolute path of the thumbnail, for the agent's Read tool. */
  thumb: string
  /** Content hash of the thumbnail the answer will describe; the cache key. */
  thumbHash: string
  name: string
  category: Category
  size: [w: number, h: number, d: number]
}
export interface BatchManifest {
  batch: number
  vocab: Vocab
  items: BatchItem[]
}

export const batchFile = (library: string, n: number): string => join(batchDir(library), `${n}.json`)
export const outFile = (library: string, n: number): string => join(batchDir(library), `${n}.out.json`)

export function loadTagCache(library: string): TagCache {
  const file = cacheFile(library)
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as TagCache) : {}
}

/** The shards named, all of them for none or "all"; an unknown name throws. */
export function selectTagShards(library: string, names: readonly string[]): string[] {
  const ids = shardIds(library)
  if (names.length === 0 || names.includes("all")) return ids
  const unknown = names.filter((n) => !ids.includes(n))
  if (unknown.length > 0) throw new Error(`tag: no catalog shard for ${unknown.join(", ")}`)
  return ids.filter((id) => names.includes(id))
}

/** The content hash of an entry's thumbnail, or null when it has none on disk. */
export function thumbHash(library: string, thumb: string | null): string | null {
  if (!thumb || !existsSync(join(library, thumb))) return null
  return contentHash(readFileSync(join(library, thumb)))
}

/**
 * Every piece in `packs` with a thumbnail whose hash has no cached answer, in id order. A thumbnail
 * identical to one already listed is left out: its answer reaches both pieces through the cache.
 */
export function untagged(library: string, packs: readonly string[], cache: TagCache): BatchItem[] {
  const items: BatchItem[] = []
  const seen = new Set<string>()
  for (const pack of packs)
    for (const e of readShard(library, pack)) {
      const hash = thumbHash(library, e.files.thumb)
      if (!hash || cache[hash] || seen.has(hash)) continue
      seen.add(hash)
      const thumb = join(library, e.files.thumb as string)
      items.push({ id: e.id, thumb, thumbHash: hash, name: e.name, category: e.category, size: e.size })
    }
  return items
}

/**
 * Replaces the pending manifests with fresh ones numbered from 1; returns their numbers. Throws when
 * an answer is waiting, so `tag apply` runs before work is listed again.
 */
export function emitBatches(o: {
  library: string
  names: readonly string[]
  vocab: Vocab
  batch?: number
}): number[] {
  const dir = batchDir(o.library)
  const files = existsSync(dir) ? readdirSync(dir) : []
  const waiting = files.filter((f) => f.endsWith(".out.json"))
  if (waiting.length > 0)
    throw new Error(`tag emit: ${waiting.join(", ")} not applied yet; run \`tag apply\``)
  for (const f of files) if (f.endsWith(".json")) rmSync(join(dir, f))

  const items = untagged(o.library, selectTagShards(o.library, o.names), loadTagCache(o.library))
  const size = o.batch ?? BATCH
  const numbers: number[] = []
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < items.length; i += size) {
    const n = numbers.length + 1
    const manifest: BatchManifest = { batch: n, vocab: o.vocab, items: items.slice(i, i + size) }
    writeFileSync(batchFile(o.library, n), `${JSON.stringify(manifest, null, 2)}\n`)
    numbers.push(n)
  }
  return numbers
}
