/**
 * The site's routes, as pure rules (the router and the shell read them; `site/index.tsx` draws them):
 *
 * - `/`            the live island, with the first-visit welcome card
 * - `/demos`       the demo picker over the island, for a direct visit (a story opens as `/?story=<id>`);
 *                  from inside the site the picker opens over the page in place (nav.ts `openDemosWith`)
 * - `/harbour`     the live chronicles: every repo with its whole history read
 * - `/built`       How it's built, with the journey
 * - `/hall/<o>/<r>` a repo's island; `/hall` alone asks for the repo
 * - `/studio`, `/pieces`, …  the Studio, public and view-only off localhost
 *
 * The island, the demos and a bare `/hall` are one world: moving between them keeps the island that is
 * already built (`worldKey`).
 */
import { parseRepo, type SiteDest, type Story } from "@guildhall/ui"
import { hasParam, param, worldEntries } from "../params.ts"
import { canonical, href } from "../shell/router.ts"

/** The screen ids that belong to the site (everything else is the Studio). */
export const SITE_SCREENS: readonly string[] = ["island", "demos", "harbour", "built", "hall"]

export const isSiteScreen = (id: string | null): id is string => id !== null && SITE_SCREENS.includes(id)

/** Where each crest-menu destination goes. "Your repo" is `/hall`, which asks for the repo. */
export const DEST_SCREEN: Record<SiteDest, string> = {
  repo: "hall",
  demos: "demos",
  harbour: "harbour",
  studio: "home",
  built: "built",
}

/** The address of a crest-menu destination, under the base. */
export const destHref = (dest: SiteDest): string => href(DEST_SCREEN[dest])

/** The valid `owner/repo` a hall's path names, or null (`/hall`, or a path that is not a GitHub repo). */
export function hallSlug(query: URLSearchParams): string | null {
  const text = param(query, "repo")
  if (!text) return null
  const parsed = parseRepo(text)
  return parsed.ok ? parsed.slug : null
}

/**
 * The seed a repo's island grows from. There is no tree reader behind the site yet, so the island is the
 * generator's own: sized by default, and always the same for the same name (FNV-1a over the lower-cased
 * slug), so a link to a repo shows what it showed before. 1 – 9,000.
 */
export function hallSeed(slug: string): number {
  let h = 0x811c9dc5
  for (const ch of slug.toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % 9000) + 1
}

/**
 * What the island's world is made from: the keys that change the map (seed, files, hour, weather…), in a
 * stable order. A hall with a repo is its own world; `/`, `/demos` and `/hall` share the default one.
 */
export function worldKey(screen: string, query: URLSearchParams): string {
  const slug = screen === "hall" ? hallSlug(query) : null
  // the registry's world-building keys (params.ts: not `view`), the repo aside (the slug says it)
  const rest = worldEntries(query)
    .filter((kv) => !kv.startsWith("repo="))
    .join("&")
  return `${slug ? `hall:${slug.toLowerCase()}` : "island"}?${rest}`
}

/**
 * The key the shell remounts a screen on. Studio screens remount on every URL change (a deep link is a
 * fresh load); a site screen only when its world or its section changes, so `/` → `/demos` keeps the island.
 */
export function mountKey(screen: string, query: URLSearchParams, url: string): string {
  if (!isSiteScreen(screen)) return url
  return screen === "built" || screen === "harbour" ? screen : worldKey(screen, query)
}

/** The query the island's world is built with: the repo's seed in a hall, the URL's own otherwise. */
export function worldQuery(screen: string, query: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(query)
  out.delete("repo")
  out.delete("story")
  out.delete("act")
  const slug = screen === "hall" ? hallSlug(query) : null
  if (slug && !hasParam(out, "seed")) out.set("seed", String(hallSeed(slug)))
  // the island's name on its card and loading cover: the repo in a hall, the brand on the site's own island
  if (!hasParam(out, "name")) out.set("name", slug ?? "Guildhall")
  return out
}

/**
 * Where a story's link goes: a `?story=…` or `?hour=…` link opens on the island (`/?story=saga`), a path
 * (`/hall/facebook/react`) as it is. `act` opens a story at that act.
 */
export function storyHref(link: string, act?: number): string {
  if (link.startsWith("/")) return canonical(link)
  const query = new URLSearchParams(link.replace(/^\?/, ""))
  if (act) query.set("act", String(act))
  return href("island", query)
}

/** The story a `?story=` names (and its act, 1 – 5 when the story has acts), or null. */
export function openedStory(
  query: URLSearchParams,
  stories: readonly Story[],
): { story: Story; act?: number } | null {
  const story = stories.find((s) => s.id === param(query, "story"))
  if (!story) return null
  const n = param(query, "act")
  const act = story.acts?.find((a) => a.n === n)?.n
  return act ? { story, act } : { story }
}
