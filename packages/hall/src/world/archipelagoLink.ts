import { DEFAULT_ARCHIPELAGO, HOME_REPO, MAX_ISLANDS } from "./archipelago.ts"
import { parseRepo } from "./gen/fetch.ts"

/**
 * The archipelago's own link params (guild/deeplink.ts leaves them to this module):
 *
 *   archipelago        the default archipelago (world/archipelago.ts DEFAULT_ARCHIPELAGO)
 *   repos=a/b,c/d      these repos instead (at most MAX_ISLANDS; GitHub URLs are fine)
 *   island=name        start there: "home", "map", or an island's repo ("mcpx" or "Codestz/mcpx")
 *
 * `archipelago=0` (or `false`) is off. The home island's own repo is never grown again.
 */
export interface ArchipelagoLink {
  repos: string[]
  /** The island to start on, as written (resolved once the islands are grown). */
  island?: string
  /** What couldn't be read, in words, for the probe tools. */
  ignored: string[]
}

export function parseArchipelagoLink(search: string): ArchipelagoLink | null {
  const params = new URLSearchParams(search)
  const ignored: string[] = []
  let repos: string[] | undefined
  const listed = params.get("repos")
  if (listed !== null) {
    repos = []
    for (const raw of listed.split(",")) {
      const text = raw.trim()
      if (!text) continue
      let repo: string
      try {
        repo = parseRepo(text)
      } catch (error) {
        ignored.push(`repos: ${(error as Error).message}`)
        continue
      }
      const key = repo.toLowerCase()
      if (key === HOME_REPO.toLowerCase() || repos.some((kept) => kept.toLowerCase() === key)) continue
      if (repos.length >= MAX_ISLANDS) {
        ignored.push(`repos: more than ${MAX_ISLANDS} (${repo} left out)`)
        continue
      }
      repos.push(repo)
    }
  } else if (params.has("archipelago")) {
    const value = (params.get("archipelago") ?? "").toLowerCase()
    if (value === "0" || value === "false") return null
    repos = [...DEFAULT_ARCHIPELAGO]
  }
  if (!repos || repos.length === 0) return null
  const island = params.get("island")?.trim()
  return { repos, ...(island ? { island } : {}), ignored }
}

/**
 * `?repo=owner/name&split`: the repo as an archipelago of its packages (world/gen/split.ts), the
 * core its home island. A repo that has nothing to split stays the one island it was.
 */
export interface SplitLink {
  repo: string
  /** The island to start on, as written (`island=`: "map", a package's name or its id). */
  island?: string
}

export function parseSplitLink(search: string): SplitLink | null {
  const params = new URLSearchParams(search)
  const value = params.get("repo")?.trim()
  if (!params.has("split") || !value || value === "home" || value === "sample") return null
  const split = (params.get("split") ?? "").toLowerCase()
  if (split === "0" || split === "false") return null
  let repo: string
  try {
    repo = parseRepo(value)
  } catch {
    return null
  }
  const island = params.get("island")?.trim()
  return { repo, ...(island ? { island } : {}) }
}

/**
 * Which island a link's `island=` means: -1 the home island, an index into `repos`, "map" for the
 * map of them all, or undefined. A split repo's islands are "owner/name#folder": a package's name
 * (its folder's last part) or its whole id will do.
 */
export function islandIndexOf(wanted: string, repos: readonly string[]): number | "map" | undefined {
  const key = wanted.trim().toLowerCase()
  if (key === "map") return "map"
  if (key === "home" || key === HOME_REPO.toLowerCase() || key === HOME_REPO.split("/")[1]?.toLowerCase())
    return -1
  const found = repos.findIndex((repo) => {
    const lower = repo.toLowerCase()
    const folder = lower.split("#")[1]
    return lower === key || lower.split("/")[1] === key || folder === key || folder?.split("/").pop() === key
  })
  return found >= 0 ? found : undefined
}
