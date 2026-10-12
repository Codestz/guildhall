/**
 * `tag apply`: checks the vision agent's answers against the vocabulary, merges them into the cache
 * (thumb hash → answer) and writes the cache into every shard. Only `autoTags` and placeholder
 * compose meta are touched: rule tags and rule or manual compose meta are never overwritten.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type CatalogEntry, PALETTE } from "@guildhall/assets"
import { readShard, shardIds, writeIndex, writeShard } from "../catalog.ts"
import { type BatchManifest, loadTagCache, thumbHash } from "./emit.ts"
import { batchDir, cacheFile, type TagAnswer, type TagCache, type Vocab, vocabTags } from "./vocab.ts"

/** What the agent writes per piece (tools/import/tags/PROMPT.md). */
interface RawAnswer {
  id?: unknown
  tags?: unknown
  front?: unknown
  door?: unknown
}
interface OutFile {
  by?: unknown
  items?: unknown
}

export interface ApplySummary {
  answers: number
  /** Entries whose autoTags or compose meta changed. */
  updated: number
  warnings: string[]
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const batchNumber = (f: string): number => Number.parseInt(f, 10)

/** Every `<n>.out.json` waiting in the batch folder, in batch order. */
export function pendingOutFiles(library: string): string[] {
  const dir = batchDir(library)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^\d+\.out\.json$/.test(f))
    .sort((a, b) => batchNumber(a) - batchNumber(b))
    .map((f) => join(dir, f))
}

/** The answers in one out file, keyed by thumb hash; anything outside the vocabulary is dropped with a warning. */
export function readAnswers(file: string, vocab: Vocab, warnings: string[]): TagCache {
  const manifestFile = file.replace(/\.out\.json$/, ".json")
  if (!existsSync(manifestFile)) throw new Error(`tag apply: ${file} has no batch manifest ${manifestFile}`)
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as BatchManifest
  const out = JSON.parse(readFileSync(file, "utf8")) as OutFile
  if (typeof out.by !== "string" || out.by === "")
    throw new Error(`tag apply: ${file}: "by" must name the model`)
  if (!Array.isArray(out.items)) throw new Error(`tag apply: ${file}: "items" must be an array`)

  const known = vocabTags(vocab)
  const fronts = new Set<string>(vocab.front)
  const items = new Map(manifest.items.map((i) => [i.id, i]))
  const answers: TagCache = {}
  for (const raw of out.items as RawAnswer[]) {
    const item = typeof raw.id === "string" ? items.get(raw.id) : undefined
    if (!item) {
      warnings.push(`${file}: ${String(raw.id)} is not in batch ${manifest.batch}; skipped`)
      continue
    }
    const tags = new Set<string>()
    for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
      if (typeof t === "string" && known.has(t)) tags.add(t)
      else warnings.push(`${item.id}: dropped tag ${JSON.stringify(t)} (not in the vocabulary)`)
    }
    let front = "none" as TagAnswer["front"]
    if (typeof raw.front === "string" && fronts.has(raw.front)) front = raw.front as TagAnswer["front"]
    else
      warnings.push(`${item.id}: front ${JSON.stringify(raw.front)} is not one of ${vocab.front.join(" ")}`)
    answers[item.thumbHash] = { tags: [...tags].sort(byText), front, door: raw.door === true, by: out.by }
  }
  return answers
}

export function saveTagCache(library: string, cache: TagCache): void {
  mkdirSync(join(library, "tags"), { recursive: true })
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => byText(a, b)))
  writeFileSync(cacheFile(library), `${JSON.stringify(sorted, null, 2)}\n`)
}

/**
 * The entry with its cached answer written in: autoTags always, front only over placeholder (or an
 * earlier vision answer). Returns the entry unchanged when its thumbnail has no answer.
 */
export function withAnswer(
  entry: CatalogEntry,
  hash: string | null,
  cache: TagCache,
  vocab: Vocab,
): CatalogEntry {
  const answer = hash ? cache[hash] : undefined
  if (!hash || !answer) return entry
  const tags = answer.door ? [...answer.tags, vocab.doorTag] : [...answer.tags]
  const out: CatalogEntry = {
    ...entry,
    autoTags: { tags: [...new Set(tags)].sort(byText), by: answer.by, thumb: hash },
  }
  const open = entry.compose.source === "placeholder" || entry.compose.source === "vision"
  if (open && answer.front !== "none")
    out.compose = { ...entry.compose, front: answer.front, source: "vision" }
  return out
}

/** Applies `files` (every pending out file when empty), then deletes each applied batch. */
export function applyAnswers(o: { library: string; vocab: Vocab; files?: readonly string[] }): ApplySummary {
  const files = o.files && o.files.length > 0 ? [...o.files] : pendingOutFiles(o.library)
  const warnings: string[] = []
  const cache = loadTagCache(o.library)
  let answers = 0
  for (const file of files) {
    const read = readAnswers(file, o.vocab, warnings)
    answers += Object.keys(read).length
    Object.assign(cache, read)
  }
  saveTagCache(o.library, cache)

  let updated = 0
  for (const pack of shardIds(o.library)) {
    const entries = readShard(o.library, pack)
    const next = entries.map((e) => withAnswer(e, thumbHash(o.library, e.files.thumb), cache, o.vocab))
    const changed = next.filter((e, i) => JSON.stringify(e) !== JSON.stringify(entries[i])).length
    if (changed === 0) continue
    updated += changed
    writeShard(o.library, pack, next)
  }
  if (updated > 0) writeIndex(o.library, PALETTE, {})

  for (const file of files) {
    rmSync(file)
    rmSync(file.replace(/\.out\.json$/, ".json"), { force: true })
  }
  return { answers, updated, warnings }
}
