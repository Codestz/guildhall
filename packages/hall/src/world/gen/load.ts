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

/** The tree for `wanted` ("sample", "owner/name" or a GitHub URL). Rejects with a friendly reason. */
export async function treeFor(wanted: string): Promise<Tree> {
  const repo = wanted === "sample" ? undefined : parseRepo(wanted)
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
    throw new Error(reasonOf(error, repo))
  }
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
