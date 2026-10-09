import { MAX_ISLANDS } from "../world/archipelago.ts"
import { CHRONICLES_REPO } from "../world/chronicle/catalog.ts"

/**
 * The links the chronicles backend adds to the hall (docs/adr/0019-chronicles-backend.md): pure, so
 * they are tested without a browser. Nothing here signs in or carries a token: a request for a deep
 * chronicle is a GitHub issue the visitor files themselves, in a new tab.
 */

/** The hall's public address, which badges and shared links point at (never the page's own origin). */
export const SITE = "https://guildhall.codestz.dev"

/** Slashes and commas kept as written, so a link reads `?repo=owner/name`. */
const plain = (repo: string): string => encodeURIComponent(repo).replace(/%2F/gi, "/").replace(/%2C/gi, ",")

/** `repo`'s island, growing through its history: `?repo=owner/name&grow`. */
export function growLink(repo: string): string {
  return `/?repo=${plain(repo)}&grow`
}

/** An archipelago of these repos (the first MAX_ISLANDS): `?repos=a/b,c/d`. */
export function sailLink(repos: readonly string[]): string {
  return `/?repos=${repos.slice(0, MAX_ISLANDS).map(plain).join(",")}`
}

/**
 * The chronicles repo's request form (.github/ISSUE_TEMPLATE/chronicle.yml there), its repo field
 * filled in: GitHub fills an issue form's fields from query params named after their ids.
 */
export function deepenLink(repo: string): string {
  const params = new URLSearchParams({ template: "chronicle.yml", title: `Chronicle: ${repo}`, repo })
  return `https://github.com/${CHRONICLES_REPO}/issues/new?${params}`
}

/** A README badge (a shields.io static badge in the hall's brass and ink) linking to `repo`'s island. */
export function badgeMarkdown(repo: string): string {
  const image = "https://img.shields.io/badge/Guildhall-see_it_as_an_island-dcb662?labelColor=15110d"
  return `[![See ${repo} as an island in Guildhall](${image})](${SITE}${growLink(repo)})`
}
