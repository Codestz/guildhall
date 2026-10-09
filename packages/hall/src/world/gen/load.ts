import { bundledChronicle } from "../chronicle/bundled.ts"
import { CHRONICLES_CDN } from "../chronicle/catalog.ts"
import { type Chronicle, decodeChronicle, encodeChronicle } from "../chronicle/format.ts"
import { quickChronicle } from "../chronicle/quick.ts"
import { fetchPublicTree, GitHubError, parseRepo } from "./fetch.ts"
import type { RepoEntry } from "./repo.ts"

/**
 * A repo's tree for `?repo=`: a bundled fixture when there is one (`sample` is this repo), else the
 * live, unauthenticated GitHub API (60 calls an hour per IP: two per repo), kept for the tab's
 * session so a reload doesn't spend them again.
 */

export interface Tree {
  /** "owner/name". */
  repo: string
  source: "fixture" | "github"
  branch?: string
  truncated?: boolean
  entries: RepoEntry[]
}

interface Fixture {
  repo: string
  branch?: string
  truncated?: boolean
  entries: RepoEntry[]
}

/**
 * The bundled fixtures, each its own lazy chunk (react's is ~1 MB): owner__name.json. Called, not
 * read at import, so the module loads outside Vite (bun test) too.
 */
const fixtures = (): Record<string, () => Promise<Fixture>> =>
  import.meta.glob<Fixture>("../../../test/fixtures/repos/*.json", { import: "default" })

const SAMPLE = "guildhall"
const CACHE = "guildhall.repo:"
const CHRONICLE_CACHE = "guildhall.chronicle:"

/** Why a tree couldn't be had, for a HUD that answers each differently (hud/RepoDoor.tsx). */
export type RepoFailure = "invalid" | "missing" | "rate" | "network" | "github"

/** treeFor's rejection: the friendly reason as its message, plus what kind of failure it was. */
export class RepoLoadError extends Error {
  override name = "RepoLoadError"
  constructor(
    message: string,
    readonly kind: RepoFailure,
    /** When GitHub's rate limit resets (`rate` only, when GitHub said). */
    readonly resetAt?: Date,
  ) {
    super(message)
  }
}

/** The tree for `wanted` ("sample", "owner/name" or a GitHub URL). Rejects with a RepoLoadError. */
export async function treeFor(wanted: string): Promise<Tree> {
  let repo: string | undefined
  try {
    repo = wanted === "sample" ? undefined : parseRepo(wanted)
  } catch (error) {
    throw new RepoLoadError((error as Error).message, "invalid")
  }
  const name = repo ? repo.replace("/", "__").toLowerCase() : SAMPLE
  const bundled = Object.entries(fixtures()).find(([path]) => path.toLowerCase().endsWith(`/${name}.json`))
  if (bundled) {
    const fixture = await bundled[1]()
    return { ...fixture, source: "fixture" }
  }
  if (!repo) throw new Error("the sample island's tree is missing from this build")
  const kept = remembered(repo)
  if (kept) return kept
  try {
    const tree = await fetchPublicTree(repo)
    const out: Tree = { ...tree, source: "github" }
    remember(out)
    return out
  } catch (error) {
    throw failureOf(error, repo)
  }
}

/** A failed fetch of `repo`'s tree as a RepoLoadError: the reason in words, its kind, the reset time. */
export function failureOf(error: unknown, repo: string): RepoLoadError {
  return new RepoLoadError(reasonOf(error, repo), kindOf(error), resetOf(error))
}

function kindOf(error: unknown): RepoFailure {
  if (!(error instanceof GitHubError)) return "network"
  if (error.status === 404) return "missing"
  if (error.status === 403 || error.status === 429) return "rate"
  return "github"
}

/** The reset time fetchPublicTree writes into its rate-limit message ("resets at <ISO>"). */
function resetOf(error: unknown): Date | undefined {
  if (!(error instanceof GitHubError)) return undefined
  const iso = /resets at ([0-9T:.-]+Z)/.exec(error.message)?.[1]
  const when = iso ? new Date(iso) : undefined
  return when && Number.isFinite(when.getTime()) ? when : undefined
}

/** What went wrong, in words for the HUD. */
export function reasonOf(error: unknown, repo: string): string {
  if (error instanceof GitHubError) {
    if (error.status === 404) return `GitHub has no public repo called ${repo}`
    if (error.status === 403 || error.status === 429) return error.message
    return `GitHub couldn't list ${repo} (${error.status})`
  }
  return `couldn't reach GitHub for ${repo}`
}

/**
 * The history of `wanted`'s island (world/chronicle/format.ts), the deepest to be had: its deep
 * chronicle from the chronicles repo's CDN (world/chronicle/catalog.ts; the freshest, refreshed
 * weekly), else the one the hall ships, else one quick-built live from GitHub (~20 of the hour's 60
 * unauthenticated calls, so it is asked for on demand, not with every tree), kept for the tab's
 * session. Undefined when none can be had: the island is then tree-only, as before. Never rejects.
 */
export async function chronicleFor(
  wanted: string,
  tree?: Tree,
  fetcher: typeof fetch = fetch,
): Promise<Chronicle | undefined> {
  // Bundled first (no network, and the showcase stays deterministic), then the chronicles repo's CDN
  // for repos the hall doesn't ship, then a quick build.
  const deep =
    (await bundledChronicle(wanted, fetcher)) ?? (await bundledChronicle(wanted, fetcher, CHRONICLES_CDN))
  if (deep) return deep
  let repo: string
  try {
    repo = parseRepo(tree?.repo ?? wanted)
  } catch {
    return undefined
  }
  const key = `${CHRONICLE_CACHE}${repo.toLowerCase()}`
  try {
    const kept = sessionStorage.getItem(key)
    if (kept) return decodeChronicle(kept)
  } catch {
    // Blocked, or an old format: build it again.
  }
  try {
    const built = await quickChronicle(repo, {
      fetcher,
      ...(tree && !tree.truncated ? { tree: { entries: tree.entries } } : {}),
    })
    try {
      sessionStorage.setItem(key, encodeChronicle(built))
    } catch {
      // Full or blocked: the next ask builds it again.
    }
    return built
  } catch {
    return undefined
  }
}

function remembered(repo: string): Tree | undefined {
  try {
    const text = sessionStorage.getItem(CACHE + repo.toLowerCase())
    return text ? (JSON.parse(text) as Tree) : undefined
  } catch {
    return undefined
  }
}

function remember(tree: Tree): void {
  try {
    sessionStorage.setItem(CACHE + tree.repo.toLowerCase(), JSON.stringify(tree))
  } catch {
    // Full or blocked: the next reload asks GitHub again.
  }
}
