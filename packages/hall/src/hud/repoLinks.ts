import { HOME_REPO, MAX_ISLANDS } from "../world/archipelago.ts"
import { parseArchipelagoLink } from "../world/archipelagoLink.ts"

/**
 * The links the repo door (hud/RepoDoor.tsx) goes to: pure, over a page's `search`, so they are
 * tested without a browser. Slashes, commas and colons are kept as written, so a shared link reads as
 * `?repo=Codestz/mcpx`, not `?repo=Codestz%2Fmcpx`.
 */

/** The params that name a place on the island being left: a new island has its own. */
const PLACE_PARAMS = ["look", "select", "island"]

function query(params: URLSearchParams): string {
  const text = params
    .toString()
    .replace(/%2F/gi, "/")
    .replace(/%2C/gi, ",")
    .replace(/%3A/gi, ":")
    .replace(/=(?=&|$)/g, "")
  return text ? `?${text}` : ""
}

/** This hall at `repo`'s island: the page's other params kept (the story, the hour, `showcase`). */
export function islandLink(repo: string, search: string): string {
  const params = new URLSearchParams(search)
  for (const name of PLACE_PARAMS) params.delete(name)
  params.set("repo", repo)
  return query(params)
}

/** The link to share for `repo`'s island: just the island (and the showcase, if this page is it). */
export function shareLink(repo: string, search: string): string {
  const params = new URLSearchParams()
  if (new URLSearchParams(search).has("showcase")) params.set("showcase", "")
  params.set("repo", repo)
  return query(params)
}

export type ArchipelagoAdd = { ok: true; search: string; already: boolean } | { ok: false; reason: "full" }

/**
 * The archipelago with `repo` added to the page's (`?repos=`, or `?archipelago`'s default set),
 * starting on that island. Already there (or the home island's own repo): the same set, starting on it.
 */
export function addToArchipelago(repo: string, search: string): ArchipelagoAdd {
  const params = new URLSearchParams(search)
  const repos = parseArchipelagoLink(search)?.repos ?? []
  const key = repo.toLowerCase()
  const home = key === HOME_REPO.toLowerCase()
  const already = home || repos.some((one) => one.toLowerCase() === key)
  if (!already && repos.length >= MAX_ISLANDS) return { ok: false, reason: "full" }
  for (const name of PLACE_PARAMS) params.delete(name)
  params.delete("archipelago")
  params.set("repos", (already ? repos : [...repos, repo]).join(","))
  params.set("island", home ? "home" : repo)
  // An empty set (only the home repo asked for) is no archipelago: just go home.
  if (repos.length === 0 && home) {
    params.delete("repos")
    params.delete("island")
  }
  return { ok: true, search: query(params), already }
}
