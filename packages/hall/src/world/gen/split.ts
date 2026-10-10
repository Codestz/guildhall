import { type Coupling, couplingOf, type Manifests, pairKey, weightOf } from "./coupling.ts"
import type { RepoEntry } from "./repo.ts"

/**
 * A repo as an archipelago (`?repo=owner/name&split`): its tree cut into one subtree per island. Pure.
 *
 *   workspaces  every package of a workspace container (packages/, apps/, crates/… two or more) is an island;
 *               what is outside them (the root's files, tooling, fixtures) is one more
 *   folders     no workspaces, but a big repo (BIG_REPO_FILES): each top-level folder is an island
 *   (neither)   undefined: the repo stays the single island it has always been
 *
 * A package under ISLET_FILES files is an islet. At most MAX_ISLANDS islands (the core and the biggest
 * packages) and MAX_ISLETS islets are kept; the rest pool into one "+N more". The core, the island at
 * the centre, is the package named for the repo, else the one the others lean on most, else the biggest.
 */

export const ISLET_FILES = 20
export const BIG_REPO_FILES = 1500
export const MAX_ISLANDS = 14
export const MAX_ISLETS = 8
/** Folders that hold a workspace's packages, one per child folder (world/gen/repo.ts' list). */
const CONTAINERS = new Set(["packages", "apps", "crates", "libs", "services", "modules"])

export interface Slice {
  /** Its folder in the repo ("packages/react-dom"); "." the root's own share; "+" the pooled rest. */
  id: string
  /** What it is called: the package's name (its folder's), "root" for the root's share. */
  label: string
  kind: "island" | "islet"
  /** The workspace container it sits in ("packages"). */
  group?: string
  files: number
  bytes: number
  /** Its tree, re-rooted at its folder (the pooled rest and the root's share keep the repo's paths). */
  entries: RepoEntry[]
  pooled?: true
}

export interface RepoSplit {
  mode: "workspaces" | "folders"
  /** The core first, then islands, then islets, each biggest first. */
  slices: Slice[]
  coupling: Coupling
}

interface Raw {
  id: string
  label: string
  group?: string
  entries: RepoEntry[]
}

const sum = (entries: readonly RepoEntry[], pick: (e: RepoEntry) => number): number =>
  entries.reduce((total, e) => total + (e.type === "blob" ? pick(e) : 0), 0)
const underDir = (path: string, dir: string): boolean => path.startsWith(`${dir}/`)

/** The package folders of every workspace container with two or more (shallowest containers win). */
function packageDirs(entries: readonly RepoEntry[]): Map<string, string> {
  const found = new Map<string, Set<string>>()
  for (const entry of entries) {
    const parts = entry.path.split("/")
    if (entry.type !== "blob") continue
    const top = CONTAINERS.has((parts[0] ?? "").toLowerCase())
    if (top && parts.length >= 3) add(found, parts[0] as string, parts[1] as string)
    else if (!top && parts.length >= 4 && CONTAINERS.has((parts[1] ?? "").toLowerCase()))
      add(found, `${parts[0]}/${parts[1]}`, parts[2] as string)
  }
  const dirs = new Map<string, string>()
  for (const [container, names] of found)
    if (names.size >= 2) for (const name of names) dirs.set(`${container}/${name}`, container)
  return dirs
}

function add(found: Map<string, Set<string>>, container: string, name: string): void {
  const names = found.get(container) ?? new Set<string>()
  names.add(name)
  found.set(container, names)
}

/** Entries of `dir`, re-rooted at it. */
const within = (entries: readonly RepoEntry[], dir: string): RepoEntry[] =>
  entries.filter((e) => underDir(e.path, dir)).map((e) => ({ ...e, path: e.path.slice(dir.length + 1) }))

/** What is left outside `dirs`, without the folders that hold nothing more (an emptied container). */
function remainder(entries: readonly RepoEntry[], dirs: readonly string[]): RepoEntry[] {
  const kept = entries.filter((e) => !dirs.some((dir) => e.path === dir || underDir(e.path, dir)))
  const filled = new Set<string>()
  for (const e of kept)
    if (e.type !== "tree") {
      const parts = e.path.split("/")
      for (let n = 1; n < parts.length; n++) filled.add(parts.slice(0, n).join("/"))
    }
  return kept.filter((e) => e.type !== "tree" || filled.has(e.path))
}

export function splitRepo(
  entries: readonly RepoEntry[],
  repo: string,
  manifests?: Manifests,
): RepoSplit | undefined {
  const name = repo.split("/")[1] ?? repo
  const dirs = packageDirs(entries)
  let raws: Raw[]
  let mode: RepoSplit["mode"]
  if (dirs.size >= 2) {
    mode = "workspaces"
    const sorted = [...dirs.keys()].sort()
    raws = sorted.map((dir) => ({
      id: dir,
      label: dir.split("/").pop() ?? dir,
      group: dirs.get(dir) as string,
      entries: within(entries, dir),
    }))
    raws.push({ id: ".", label: "root", entries: remainder(entries, sorted) })
  } else if (sum(entries, () => 1) >= BIG_REPO_FILES) {
    mode = "folders"
    const tops = [
      ...new Set(entries.filter((e) => e.path.includes("/")).map((e) => e.path.split("/")[0] as string)),
    ]
    raws = tops.sort().map((dir) => ({ id: dir, label: dir, entries: within(entries, dir) }))
    raws.push({ id: ".", label: "root", entries: remainder(entries, tops) })
  } else return undefined

  const slices: Slice[] = raws
    .map((raw) => ({
      id: raw.id,
      label: raw.label,
      ...(raw.group ? { group: raw.group } : {}),
      kind: "island" as const,
      files: sum(raw.entries, () => 1),
      bytes: sum(raw.entries, (e) => e.size ?? 0),
      entries: raw.entries,
    }))
    .filter((slice) => slice.files > 0)
  if (slices.length < 2) return undefined

  const coupling = couplingOf(slices, manifests)
  const core = coreOf(slices, coupling, name)
  const bound = new Map(coupling)
  return { mode, slices: arrange(slices, core, bound), coupling: bound }
}

/** The package named for the repo; else the one bound to the most others; else the biggest. */
function coreOf(slices: readonly Slice[], coupling: Coupling, name: string): Slice {
  const own = slices.filter((s) => s.id !== ".")
  const named = own.find((s) => s.label.toLowerCase() === name.toLowerCase())
  if (named) return named
  const lean = (s: Slice): number => own.reduce((total, o) => total + weightOf(coupling, s.id, o.id), 0)
  return [...own].sort((a, b) => lean(b) - lean(a) || b.files - a.files || (a.id < b.id ? -1 : 1))[0] as Slice
}

/** Core first; islands then islets, biggest first; the overflow pooled. */
function arrange(slices: readonly Slice[], core: Slice, coupling: Map<string, number>): Slice[] {
  const bigger = (a: Slice, b: Slice): number => b.files - a.files || (a.id < b.id ? -1 : 1)
  const rest = slices.filter((s) => s !== core).sort(bigger)
  const big = rest.filter((s) => s.files >= ISLET_FILES)
  const small = rest.filter((s) => s.files < ISLET_FILES).map((s): Slice => ({ ...s, kind: "islet" }))
  const islands = big.slice(0, MAX_ISLANDS - 1)
  const islets = small.slice(0, MAX_ISLETS)
  const over = [...big.slice(MAX_ISLANDS - 1), ...small.slice(MAX_ISLETS)]
  const out: Slice[] = [{ ...core, kind: "island" }, ...islands, ...islets]
  if (over.length === 0) return out
  // The pooled rest keeps the repo's paths, and is bound to whatever any of its members was.
  const entries = over.flatMap((s) =>
    s.id === "." ? s.entries : s.entries.map((e) => ({ ...e, path: `${s.id}/${e.path}` })),
  )
  const files = over.reduce((total, s) => total + s.files, 0)
  const pooled: Slice = {
    id: "+",
    label: `+${over.length} more`,
    kind: files >= ISLET_FILES ? "island" : "islet",
    files,
    bytes: over.reduce((total, s) => total + s.bytes, 0),
    entries,
    pooled: true,
  }
  for (const other of out) {
    const w = Math.max(...over.map((s) => weightOf(coupling, s.id, other.id)))
    if (w > 0) coupling.set(pairKey("+", other.id), w)
  }
  return [...out, pooled]
}
