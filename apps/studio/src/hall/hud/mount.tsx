/**
 * Mounts a repo's hall HUD (HallHud.tsx) on the island's Viewer once the island is built: reads the
 * repo's chronicle (already fetched for the build, site/chronicle.ts), tells its story by era (sim
 * `repoLegendOf`, places named as the island built them) and its card (`repoRecapOf`), turns the Viewer's
 * HUD regions on under the key `hall`, and draws into them. Returns the unmount.
 */
import { repoLegendMarkdown, repoLegendOf, repoRecapOf, requestChronicleUrl } from "@guildhall/sim"
import { holdHudStyle } from "@guildhall/ui"
import { createRoot } from "react-dom/client"
import type { HudParts } from "../../hexworld/index.ts"
import { kindWord } from "../../hexworld/places.ts"
import { hallChronicle } from "../../site/chronicle.ts"
import type { HallTime } from "../clock.ts"
import { createSession, feedKindOf, type HallSession, openFeed } from "../feeds/index.ts"
import { sessionPlaces } from "../feeds/places.ts"
import { HallHud, REMEMBERED } from "./HallHud.tsx"
import type { HudSession } from "./SessionHud.tsx"
import { holdHallHudStyle } from "./style.ts"

export interface HallHudOptions {
  slug: string
  go(url: string): void
  hrefs: { another: string; demos: string }
  /** Opens the hall again for a fresh read of its chronicle. */
  retry(): void
  /** The hall's link: `?feed=live|replay|story` starts its session (hall/feeds), and its knobs. */
  query?: URLSearchParams
  /** The hall's time, which the session's clock joins (the bar's Session scale). */
  time?: HallTime | null
}

let current: HallSession | null = null

/**
 * The hall's session while a hall with a `?feed=` is up (null otherwise): for life (L1/L2), which poses
 * the heroes from `session.log()` at `session.clock.get().at`, and listens to `onReset` for a new log.
 */
export const hallSession = (): HallSession | null => current

/** Starts the session a link asks for, its places bound to the island's; null without a `?feed=`. */
function startSession(parts: HudParts, opts: HallHudOptions): HudSession | null {
  const query = opts.query
  const kind = query ? feedKindOf(query) : null
  if (!query || !kind) return null
  const st = Number(query.get("st"))
  const session = createSession(openFeed(kind, opts.slug, query), {
    autoplay: query.get("play") !== "0",
    ...(query.has("st") && Number.isFinite(st) ? { openAt: Math.max(0, st) } : {}),
  })
  const places = sessionPlaces(parts.repo, parts.places)
  session.start(places.placeOf)
  return { session, places, repo: opts.slug.split("/").pop() || opts.slug }
}

export function mountHallHud(parts: HudParts, opts: HallHudOptions): () => void {
  const releaseHud = holdHudStyle()
  const releaseHall = holdHallHudStyle()
  const { viewer, ...rest } = parts
  viewer.hud.use("hall", REMEMBERED)
  // for shots: the HUD's state and its dispatch (`guildhall.ext.hud.dispatch({type: "open", id: "places"})`)
  const ext = window.guildhall?.ext as Record<string, unknown> | undefined
  if (ext) ext.hud = viewer.hud
  const host = document.createElement("div")
  host.className = "gh hall-hud-root"
  viewer.root.append(host)
  // the book and the card are dialogs over the whole page (the site's crest included)
  const modals = document.createElement("div")
  modals.className = "gh hall-hud-modals"
  document.body.append(modals)
  const root = createRoot(host)
  let gone = false
  // the session (`?feed=`): started now, its clock run by the frames, joined to the bar's scales
  const live = startSession(parts, opts)
  let raf = 0
  if (live) {
    current = live.session
    opts.time?.setSession(live.session)
    if (ext) ext.session = live.session
    let last = performance.now()
    const frame = (now: number) => {
      live.session.frame(Math.max(0, (now - last) / 1000))
      last = now
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
  }
  void hallChronicle(opts.slug).then((found) => {
    if (gone) return
    const chronicle = found.status === "ok" ? found.chronicle : null
    // the book names a unit's place as the island built it: "the village of react-dom"
    const label = (unit: string) => {
      const p = parts.places.find((q) => q.id === unit)
      if (!p) return undefined
      const kind = kindWord(p.kind)
      return kind === "capital" ? "the capital" : `the ${kind} of ${p.label}`
    }
    const legend = chronicle ? repoLegendOf(chronicle, { placeOf: label }) : null
    const [owner = "", repo = ""] = opts.slug.split("/")
    root.render(
      <HallHud
        hud={viewer.hud}
        modals={modals}
        parts={rest}
        slug={opts.slug}
        chronicle={chronicle}
        legend={legend}
        {...(legend ? { legendMarkdown: repoLegendMarkdown(legend) } : {})}
        recap={chronicle ? repoRecapOf(chronicle, { placeOf: label }) : null}
        go={opts.go}
        hrefs={opts.hrefs}
        {...(found.status === "not-chronicled" ? { request: requestChronicleUrl(owner, repo) } : {})}
        {...(found.status === "unavailable" ? { onRetry: opts.retry } : {})}
        {...(live ? { session: live } : {})}
        time={opts.time ?? null}
      />,
    )
  })
  return () => {
    gone = true
    if (live) {
      cancelAnimationFrame(raf)
      live.session.stop()
      opts.time?.setSession(null)
      if (current === live.session) current = null
    }
    setTimeout(() => {
      root.unmount()
      host.remove()
      modals.remove()
      releaseHall()
      releaseHud()
    }, 0)
  }
}
