import { type Biome, biomeOf, dominant, type Language, languageOf } from "./biomes.ts"
import { hash } from "./hex.ts"

/**
 * A repo's file tree, summed up into what the island is made from: one folder per top-level
 * directory (the root's own files are the harbour's), each with its files, bytes, depth and
 * languages. Entries are GitHub's git/trees?recursive=1 shape (or `git ls-tree -r -t -l`).
 */

export interface RepoEntry {
  path: string
  /** blob = file, tree = directory, commit = a submodule. */
  type: "blob" | "tree" | "commit"
  /** Bytes, blobs only. */
  size?: number
}

export interface Folder {
  /** The top-level directory's name; "/" for the root's own files. */
  name: string
  biome: Biome
  files: number
  bytes: number
  /** Mean depth of its files from the repo root (README is 0, a/b/c.ts is 2). */
  depth: number
  language: Language
}

export interface RepoShape {
  /** Hash of the whole tree, order-independent: the island's seed. */
  hash: number
  root: Folder
  /** Biggest first (bytes, then name), at most MAX_DISTRICTS; the rest pooled into one "wilds". */
  folders: Folder[]
}

/** Districts round the harbour, at most: past this the smallest folders pool into the wilds. */
export const MAX_DISTRICTS = 12

interface Tally {
  files: number
  bytes: number
  depths: number
  languages: Map<string, { language: Language; bytes: number }>
}

export function summarize(tree: readonly RepoEntry[]): RepoShape {
  const entries = [...tree].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const tallies = new Map<string, Tally>()
  const tally = (name: string): Tally => {
    let known = tallies.get(name)
    if (!known) {
      known = { files: 0, bytes: 0, depths: 0, languages: new Map() }
      tallies.set(name, known)
    }
    return known
  }
  const lines: string[] = []
  for (const entry of entries) {
    lines.push(`${entry.type} ${entry.path} ${entry.size ?? 0}`)
    const parts = entry.path.split("/")
    const top = parts.length > 1 ? (parts[0] ?? "/") : "/"
    if (entry.type === "tree") {
      if (parts.length === 1) tally(entry.path)
      continue
    }
    const into = tally(entry.type === "commit" && parts.length === 1 ? entry.path : top)
    const bytes = entry.size ?? 0
    into.files++
    into.bytes += bytes
    into.depths += parts.length - 1
    const language = languageOf(entry.path)
    const known = into.languages.get(language.name) ?? { language, bytes: 0 }
    known.bytes += bytes
    into.languages.set(language.name, known)
  }

  const folder = (name: string, from: Tally, biome = name === "/" ? "harbour" : biomeOf(name)): Folder => ({
    name,
    biome,
    files: from.files,
    bytes: from.bytes,
    depth: from.files ? round(from.depths / from.files) : 0,
    language: dominant(from.languages),
  })
  const root = folder("/", tallies.get("/") ?? { files: 0, bytes: 0, depths: 0, languages: new Map() })
  const all = [...tallies]
    .filter(([name]) => name !== "/")
    .map(([name, from]) => ({ name, from }))
    .sort((a, b) => b.from.bytes - a.from.bytes || (a.name < b.name ? -1 : 1))
  const kept = all.length > MAX_DISTRICTS ? all.slice(0, MAX_DISTRICTS - 1) : all
  const folders = kept.map(({ name, from }) => folder(name, from))
  const rest = all.slice(kept.length)
  if (rest.length > 0) {
    const pooled: Tally = { files: 0, bytes: 0, depths: 0, languages: new Map() }
    for (const { from } of rest) {
      pooled.files += from.files
      pooled.bytes += from.bytes
      pooled.depths += from.depths
      for (const [id, entry] of from.languages) {
        const known = pooled.languages.get(id) ?? { language: entry.language, bytes: 0 }
        known.bytes += entry.bytes
        pooled.languages.set(id, known)
      }
    }
    folders.push(folder(`+${rest.length} more`, pooled, "wilds"))
  }
  return { hash: hash(lines.join("\n")), root, folders }
}

const round = (value: number): number => Math.round(value * 100) / 100
