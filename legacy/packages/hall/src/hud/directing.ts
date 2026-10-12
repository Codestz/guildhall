import { MODE, type Mode, PROBE } from "../guild/mode.ts"

/**
 * Whether Settings offers the Director's controls (hud/DirectorControls.tsx): the story, the hour and
 * weather, the mood, the Bard and how it films. The showcase site is a curated film, so a plain visit
 * keeps them out of the way; a visit that asked for a scene gets them:
 *
 *   - `?demo` (every link on /demos carries it), or an explicit scene in the link: `story`, `act`,
 *     `t`, `hour`, `weather`, `n`
 *   - the local app (the hub or `bun run dev`) and probe builds: the console is the point there
 *   - `?demo=0` turns them off anywhere, to preview what a plain visitor sees
 */
const SCENE_PARAMS = ["story", "act", "t", "hour", "weather", "n"] as const

export function directingOf(mode: Mode, probe: boolean, search: string): boolean {
  const params = new URLSearchParams(search)
  const demo = params.get("demo")
  if (demo === "0" || demo === "false") return false
  if (demo !== null) return true
  if (SCENE_PARAMS.some((key) => params.has(key))) return true
  return mode !== "showcase" || probe
}

/** Read once at load: a lever moved later doesn't make the visit a demo. */
export const DIRECTING: boolean = directingOf(
  MODE,
  PROBE,
  typeof location === "undefined" ? "" : location.search,
)

/**
 * The site's pages (vercel.json): the showcase and dev server serve them beside the hall; a hall
 * served by the hub links the public copies, in a new tab so the live guild stays open.
 */
const SITE = "https://guildhall.codestz.dev"
export const SITE_LOCAL: boolean = MODE === "showcase" || import.meta.env.DEV

export function sitePage(path: "/demos" | "/harbour" | "/how"): { href: string; away: boolean } {
  return SITE_LOCAL ? { href: path, away: false } : { href: `${SITE}${path}`, away: true }
}
