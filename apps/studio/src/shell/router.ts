/**
 * The studio's routes: one path per screen, with at most one id in the path (`/pieces/<pack>/<slug>`);
 * every other parameter is view state in the query (seed, clip, t, hour…). A screen reads the id from
 * its query under the key it always used (`id`, `recipe`, `piece`), so parsers stay as they were.
 *
 * Old deep links (`?screen=<id>&…`) resolve too, and the shell replaces them with the path form.
 */
import { BASE } from "../env.ts"

export interface Route {
  /** The screen id (`screens.ts`). */
  screen: string
  /** The path under the base, no slash at either end; "" is the home page. */
  path: string
  /** The query key the trailing path segments carry, and how many segments the id has. */
  param?: { key: string; parts: number }
}

export const ROUTES: readonly Route[] = [
  { screen: "home", path: "" },
  { screen: "pieces", path: "pieces", param: { key: "id", parts: 2 } },
  { screen: "scale", path: "scale" },
  { screen: "palette", path: "palette" },
  { screen: "lineup", path: "lineup" },
  { screen: "composer", path: "composer", param: { key: "recipe", parts: 2 } },
  { screen: "npc", path: "npcs", param: { key: "recipe", parts: 1 } },
  { screen: "grips", path: "grips" },
  { screen: "grip", path: "grips/editor", param: { key: "piece", parts: 2 } },
  { screen: "site", path: "site" },
  { screen: "shadows", path: "shadows" },
  { screen: "m0", path: "lab/m0" },
  { screen: "batch", path: "lab/batch" },
  { screen: "planner", path: "planner" },
  { screen: "town", path: "town", param: { key: "town", parts: 1 } },
  { screen: "night", path: "lab/night" },
  { screen: "atmosphere", path: "lab/atmosphere" },
  { screen: "crowd", path: "lab/crowd" },
  { screen: "terra", path: "lab/terra" },
  { screen: "terra3d", path: "lab/terra3d" },
  { screen: "island", path: "island" },
  { screen: "hexmap", path: "lab/hexmap" },
  { screen: "hexscale", path: "lab/hexscale" },
  { screen: "hextiles", path: "lab/hextiles" },
]

/** Longest path first, so `/grips/editor` is never read as `/grips` plus an id. */
const BY_LENGTH = [...ROUTES].sort((a, b) => b.path.length - a.path.length)

export interface Resolved {
  /** The screen the URL names; null for a path no route matches. */
  screen: string | null
  /** The query the screen reads: the URL's own, with the path's id under its key and no `screen`. */
  query: URLSearchParams
}

const segments = (path: string): string[] => path.split("/").filter(Boolean)

/** A URL's pathname and search → the screen and its query. */
export function resolve(pathname: string, search: string, base = BASE): Resolved {
  const query = new URLSearchParams(search)
  const named = query.get("screen")
  if (named !== null) {
    query.delete("screen")
    return { screen: ROUTES.some((r) => r.screen === named) ? named : null, query }
  }
  const root = base.replace(/\/$/, "")
  if (pathname !== root && !pathname.startsWith(`${root}/`)) return { screen: null, query }
  let parts: string[]
  try {
    parts = segments(pathname.slice(root.length)).map(decodeURIComponent)
  } catch {
    return { screen: null, query }
  }
  for (const route of BY_LENGTH) {
    const head = segments(route.path)
    if (!head.every((part, i) => parts[i] === part)) continue
    const rest = parts.slice(head.length)
    if (rest.length === 0) return { screen: route.screen, query }
    if (route.param && rest.length === route.param.parts) {
      query.set(route.param.key, rest.join("/"))
      return { screen: route.screen, query }
    }
  }
  return { screen: null, query }
}

/** Slashes and commas read better unescaped, and both are safe in a query value. */
const readable = (query: URLSearchParams): string =>
  query.toString().replaceAll("%2F", "/").replaceAll("%2C", ",")

/**
 * The canonical URL (path and query) of a screen with `query`: the id moves into the path when it has
 * the route's shape, everything else stays in the query. Throws for a screen with no route.
 */
export function href(
  screen: string,
  query: URLSearchParams | Record<string, string> | string = "",
  base = BASE,
): string {
  const route = ROUTES.find((r) => r.screen === screen)
  if (!route) throw new Error(`router: no route for screen "${screen}"`)
  const rest = new URLSearchParams(query)
  rest.delete("screen")
  let path = route.path
  const id = route.param ? rest.get(route.param.key) : null
  if (route.param && id) {
    const parts = id.split("/")
    if (parts.length === route.param.parts && parts.every(Boolean)) {
      path = [path, ...parts.map(encodeURIComponent)].filter(Boolean).join("/")
      rest.delete(route.param.key)
    }
  }
  const search = readable(rest)
  return `${base}${path}${search ? `?${search}` : ""}`
}

/**
 * Any form a caller hands `guildhall.open` or a link → the URL to show: a path (`/pieces?q=barrel`, under
 * the base or not), or an old query (`?screen=pieces&q=barrel`, `screen=pieces`; no screen is home). A
 * URL no route matches comes back as it was, so the shell can say so.
 */
export function canonical(target: string, base = BASE): string {
  const isPath = target.startsWith("/")
  const url = new URL(isPath ? target : `?${target.replace(/^\?/, "")}`, "http://studio.invalid/")
  const root = base.replace(/\/$/, "")
  const pathname = !isPath
    ? base
    : url.pathname === root || url.pathname.startsWith(`${root}/`)
      ? url.pathname
      : `${root}${url.pathname}`
  const found = resolve(pathname, url.search, base)
  return found.screen ? href(found.screen, found.query, base) : `${pathname}${url.search}`
}

/** The URL the browser shows now, path and query. */
export const here = (): string => `${location.pathname}${location.search}`

/** The current URL resolved: the screen and the query it reads. */
export const current = (): Resolved => resolve(location.pathname, location.search)

/** The query the open screen reads (its path id folded in), for screens that re-read their deep link. */
export const currentQuery = (): URLSearchParams => current().query

/**
 * Rewrites the deep link in place (no history entry, no remount) to the open screen with `query`:
 * what a screen calls as its state changes, so a reload or a shared link opens what is on screen.
 */
export function replaceQuery(query: URLSearchParams | string): void {
  const { screen } = current()
  if (!screen) return
  const url = href(screen, query)
  if (url !== here()) history.replaceState(null, "", url)
}
