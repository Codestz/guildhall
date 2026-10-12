import type { RepoEntry } from "./repo.ts"

/**
 * A public repo's file tree from the unauthenticated GitHub REST API: two calls (the repo, for its
 * default branch; then git/trees/{branch}?recursive=1). Unauthenticated callers get 60 calls an hour
 * per IP, so callers should cache what they fetch.
 */

export interface RepoTree {
  repo: string
  branch: string
  entries: RepoEntry[]
  /** GitHub cut the listing short (very large repos), or it was capped at MAX_ENTRIES. */
  truncated: boolean
}

/** Entries kept at most: enough for a big monorepo's shape, small enough to plan in a blink. */
export const MAX_ENTRIES = 20_000

export class GitHubError extends Error {
  override name = "GitHubError"
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** "owner/name" from "owner/name", "github.com/owner/name" or a full URL (.git and paths ignored). */
export function parseRepo(input: string): string {
  const text = input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.)?github\.com\//, "")
  const [owner, name] = text.split("/")
  const repo = `${owner ?? ""}/${(name ?? "").replace(/\.git$/, "")}`
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || /(^|\/)\.+(\/|$)/.test(repo))
    throw new Error(`not a GitHub repo: "${input}" (want owner/name)`)
  return repo
}

export async function fetchPublicTree(ownerRepo: string, fetcher: typeof fetch = fetch): Promise<RepoTree> {
  const repo = parseRepo(ownerRepo)
  const get = async (path: string): Promise<unknown> => {
    const response = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
    if (response.ok) return response.json()
    if (
      (response.status === 403 || response.status === 429) &&
      response.headers.get("x-ratelimit-remaining") === "0"
    ) {
      const reset = Number(response.headers.get("x-ratelimit-reset"))
      const when =
        Number.isFinite(reset) && reset > 0 ? ` (resets at ${new Date(reset * 1000).toISOString()})` : ""
      throw new GitHubError(
        `GitHub's rate limit for unauthenticated calls (60 an hour) is used up${when}`,
        response.status,
      )
    }
    if (response.status === 404) throw new GitHubError(`no public repo "${repo}" on GitHub`, 404)
    throw new GitHubError(`GitHub answered ${response.status} for ${repo}${path}`, response.status)
  }

  const meta = (await get("")) as { default_branch?: string }
  const branch = meta.default_branch ?? "main"
  const listing = (await get(`/git/trees/${encodeURIComponent(branch)}?recursive=1`)) as {
    tree?: { path: string; type: string; size?: number }[]
    truncated?: boolean
  }
  const all = (listing.tree ?? []).filter(
    (entry): entry is RepoEntry => entry.type === "blob" || entry.type === "tree" || entry.type === "commit",
  )
  const entries = all
    .slice(0, MAX_ENTRIES)
    .map(({ path, type, size }) => (type === "blob" ? { path, type, size: size ?? 0 } : { path, type }))
  return { repo, branch, entries, truncated: !!listing.truncated || all.length > MAX_ENTRIES }
}
