import { type Biome, biomeOf, dominant, type Language, languageOf } from "./biomes.ts"
import { hash } from "./hex.ts"

/**
 * A repo's file tree, summed up into what the island is made from: one folder per top-level
 * directory (the root's own files are the harbour's), each with its files, bytes, depth and
 * languages. A workspace container (packages/, apps/, crates/…) holding two or more packages is
 * split instead: each package its own village, the biggest MAX_PACKAGES − 1 kept and the rest
 * pooled when there are more, so a monorepo reads as a town of villages. Entries are GitHub's
 * git/trees?recursive=1 shape (or `git ls-tree -r -t -l`).
 */

export interface RepoEntry {
  path: string
  /** blob = file, tree = directory, commit = a submodule. */
  type: "blob" | "tree" | "commit"
  /** Bytes, blobs only. */
  size?: number
}

export interface Folder {
  /** The top-level directory's name; "/" for the root's own files; "packages/react" for a package. */
  name: string
  biome: Biome
  files: number
  bytes: number
  /** Mean depth of its files from the repo root (README is 0, a/b/c.ts is 2). */
  depth: number
  language: Language
  /** The workspace container a package village belongs to ("packages"); absent for a top-level folder. */
  group?: string
  /** The smallest folders (or a workspace's smallest packages) pooled into one. */
  pooled?: true
}

export interface RepoShape {
  /** Hash of the whole tree, order-independent: the island's seed. */
  hash: number
  root: Folder
  /**
   * Biggest first (bytes, then name), at most MAX_DISTRICTS; the rest pooled into one "wilds". A
   * split workspace takes its place in that order as its packages, biggest first, side by side.
   */
  folders: Folder[]
}

/** Districts round the harbour, at most: past this the smallest folders pool into the wilds. */
export const MAX_DISTRICTS = 12
/** Villages a workspace splits into, at most: past this its smallest packages pool into one. */
export const MAX_PACKAGES = 9
/** Top-level folders that hold a workspace's packages, one per child folder. */
const WORKSPACES = new Set(["packages", "apps", "crates", "libs", "services", "modules"])

interface Tally {
  files: number
  bytes: number
  depths: number
  languages: Map<string, { language: Language; bytes: number }>
}

export function summarize(tree: readonly RepoEntry[]): RepoShape {
  const entries = [...tree].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const tallies = new Map<string, Tally>()
  const tally = (name: string, into = tallies): Tally => {
    let known = into.get(name)
    if (!known) {
      known = empty()
      into.set(name, known)
    }
    return known
  }
  /** Each workspace's packages by name; "" holds the files loose in the container itself. */
  const packages = new Map<string, Map<string, Tally>>()
  const lines: string[] = []
  for (const entry of entries) {
    lines.push(`${entry.type} ${entry.path} ${entry.size ?? 0}`)
    const parts = entry.path.split("/")
    const top = parts.length > 1 ? (parts[0] ?? "/") : "/"
    if (entry.type === "tree") {
      if (parts.length === 1) tally(entry.path)
      continue
    }
    const bytes = entry.size ?? 0
    const language = languageOf(entry.path)
    add(
      tally(entry.type === "commit" && parts.length === 1 ? entry.path : top),
      bytes,
      parts.length - 1,
      language,
    )
    if (WORKSPACES.has(top.toLowerCase()) && parts.length > 1) {
      const loose = parts.length === 2 && entry.type === "blob"
      const own = packages.get(top) ?? new Map<string, Tally>()
      packages.set(top, own)
      // A package's depth counts from its container, as a top-level folder's does from the root.
      add(tally(loose ? "" : (parts[1] ?? ""), own), bytes, parts.length - 2, language)
    }
  }

  const folder = (name: string, from: Tally, biome = name === "/" ? "harbour" : biomeOf(name)): Folder => ({
    name,
    biome,
    files: from.files,
    bytes: from.bytes,
    depth: from.files ? round(from.depths / from.files) : 0,
    language: dominant(from.languages),
  })
  const root = folder("/", tallies.get("/") ?? empty())
  const all = [...tallies]
    .filter(([name]) => name !== "/")
    .map(([name, from]) => ({ name, from }))
    .sort((a, b) => b.from.bytes - a.from.bytes || (a.name < b.name ? -1 : 1))
  const kept = all.length > MAX_DISTRICTS ? all.slice(0, MAX_DISTRICTS - 1) : all
  const folders = kept.flatMap(
    ({ name, from }) => villagesOf(name, packages.get(name)) ?? [folder(name, from)],
  )
  const rest = all.slice(kept.length)
  if (rest.length > 0)
    folders.push({
      ...folder(`+${rest.length} more`, pool(rest.map(({ from }) => from)), "wilds"),
      pooled: true,
    })
  return { hash: hash(lines.join("\n")), root, folders }

  /** A workspace's packages as villages, biggest first, the smallest pooled; none under two packages. */
  function villagesOf(group: string, own: Map<string, Tally> | undefined): Folder[] | undefined {
    const loose = own?.get("")
    const all = [...(own ?? [])]
      .filter(([name]) => name !== "")
      .map(([name, from]) => ({ name, from }))
      .sort((a, b) => b.from.bytes - a.from.bytes || (a.name < b.name ? -1 : 1))
    if (all.length < 2) return undefined
    const kept = all.length > MAX_PACKAGES ? all.slice(0, MAX_PACKAGES - 1) : all
    const rest = all.slice(kept.length).map(({ from }) => from)
    // Files loose in the container itself go with the pool, or with the biggest package.
    if (loose && rest.length === 0 && kept[0]) kept[0].from = pool([kept[0].from, loose])
    const out = kept.map(({ name, from }) => ({ ...folder(`${group}/${name}`, from, "village"), group }))
    if (rest.length > 0)
      out.push({
        ...folder(`${group}/+${rest.length} ${group}`, pool(loose ? [...rest, loose] : rest), "village"),
        group,
        pooled: true,
      })
    return out
  }
}

const empty = (): Tally => ({ files: 0, bytes: 0, depths: 0, languages: new Map() })

function add(into: Tally, bytes: number, depth: number, language: Language): void {
  into.files++
  into.bytes += bytes
  into.depths += depth
  const known = into.languages.get(language.name) ?? { language, bytes: 0 }
  known.bytes += bytes
  into.languages.set(language.name, known)
}

/** Several tallies summed into one. */
function pool(from: readonly Tally[]): Tally {
  const pooled = empty()
  for (const one of from) {
    pooled.files += one.files
    pooled.bytes += one.bytes
    pooled.depths += one.depths
    for (const [id, entry] of one.languages) {
      const known = pooled.languages.get(id) ?? { language: entry.language, bytes: 0 }
      known.bytes += entry.bytes
      pooled.languages.set(id, known)
    }
  }
  return pooled
}

const round = (value: number): number => Math.round(value * 100) / 100
