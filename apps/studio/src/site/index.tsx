import { log } from "@guildhall/core"
import { holdSiteStyle } from "@guildhall/ui"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { holdStudioStyle } from "../browser/style.ts"
import { createClock, createHallTime, type HallTime } from "../hall/clock.ts"
import { playingSeasonDate } from "../hall/seasonPace.ts"
import type { HudParts } from "../hexworld/index.ts"
import type { Screen, ScreenCtx } from "../screens.ts"
import { current, href } from "../shell/router.ts"
import { addShellStyle } from "../shell/style.ts"
import { hallChronicle, hallRepo } from "./chronicle.ts"
import { homeSession } from "./homeHud.tsx"
import { setHudBottom } from "./hudSlot.ts"
import { openUrl } from "./nav.ts"
import { destHref, hallSlug, worldQuery } from "./routes.ts"
import { SiteApp } from "./SiteApp.tsx"
import { holdSiteShellStyle } from "./style.ts"

const logger = log("studio:site")

/** The cover gives way after this long even if the world never says it is revealed (no WebGL, a failed build). */
const COVER_MAX_MS = 60_000

/**
 * Keeps the site's pieces out of sight while the world's loading cover is up, so the cover is the whole
 * screen: `data-cover` on `root` until `<html data-world>` reads "revealed" (after it has read "loading").
 * Returns the stop.
 */
function coverUntilReveal(root: HTMLElement, on: boolean): () => void {
  if (!on) return () => {}
  const html = document.documentElement
  root.dataset.cover = ""
  let loaded = false
  const open = () => {
    watch.disconnect()
    clearTimeout(cap)
    delete root.dataset.cover
  }
  const watch = new MutationObserver(() => {
    if (html.dataset.world === "loading") loaded = true
    else if (html.dataset.world === "revealed" && loaded) open()
  })
  watch.observe(html, { attributes: true, attributeFilter: ["data-world"] })
  const cap = window.setTimeout(open, COVER_MAX_MS)
  return open
}

/**
 * Builds a site screen: the island's world with the site's pieces over it. The island is the hex world,
 * imported when the screen mounts so the page and its card are drawn first and the 3D code streams in
 * behind (the world's own loading cover is another track's); `/built` has no world and never loads it.
 */
function siteScreen(id: string, title: string, withWorld: boolean): Screen {
  return {
    id,
    title,
    mount(host, ctx) {
      const studio = holdStudioStyle()
      addShellStyle()
      const releaseSite = holdSiteStyle()
      const releaseShell = holdSiteShellStyle()

      const root = document.createElement("div")
      root.className = "gh site-root"
      // `?dev=1`: the Viewer's tools and Inspector over the site's world, for the studio's own checks
      if (ctx.query.get("dev") === "1") root.dataset.dev = ""
      const world = document.createElement("div")
      world.className = "site-world"
      const pieces = document.createElement("div")
      pieces.className = "site-pieces"
      // the pieces come first: the crest menu is the keyboard's first stop, before the HUD; its z-index keeps it over the world
      root.append(pieces, ...(withWorld ? [world] : []))
      host.append(root)
      const react = createRoot(pieces)
      let gone = false
      // a repo's hall owns its clock (hall/clock.ts): the timeline bar reads it, the history reveal follows it
      const slug = id === "hall" ? hallSlug(ctx.query) : null
      const history = withWorld && slug && ctx.query.get("history") !== "0"
      // `?feed=live|replay|story`: the hall's session (hall/feeds), started by its HUD, on the bar's Session scale
      const feed = withWorld && slug ? ctx.query.get("feed") : null
      // the home (the island, the demos over it, a bare /hall) plays a session of its own: its bar is the Session scale
      const home = withWorld && !slug
      // on localhost a hall with no `?feed=` follows the hub when it answers (hall/feeds/probe.ts): `hallQuery` then says so
      let hallQuery = ctx.query
      const time: HallTime | null = history || feed || home ? createHallTime(createClock()) : null

      // The pieces first: fonts permitting (they settle within 3 s), the card is the first paint.
      void studio.ready.then(() => {
        if (!gone) flushSync(() => react.render(<SiteApp />))
      })

      let offWorld = () => {}
      let stopCover = () => {}
      if (withWorld) {
        stopCover = coverUntilReveal(root, ctx.query.get("loader") !== "0")
        const inner: ScreenCtx = { ...ctx, query: worldQuery(id, ctx.query) }
        // a repo's hall builds from the repo's chronicle (hexworld/hall.ts), read while the 3D code streams in
        const repo = slug ? hallRepo(slug) : undefined
        // the hall's HUD (hall/hud) goes up on the island's Viewer once the island is built
        const hud = home
          ? (parts: HudParts) => {
              let off = () => {}
              let done = false
              setHudBottom(parts.viewer.hud.bottom)
              void import("../hall/hud/mount.tsx").then(({ mountHomeHud }) => {
                if (done || gone || !time) return
                off = mountHomeHud(parts, {
                  go: openUrl,
                  hrefs: { another: href("hall"), demos: destHref("demos"), island: href("island") },
                  query: current().query,
                  time,
                })
              })
              return () => {
                done = true
                setHudBottom(null)
                off()
              }
            }
          : slug
            ? (parts: HudParts) => {
                let off = () => {}
                let done = false
                setHudBottom(parts.viewer.hud.bottom)
                void import("../hall/hud/mount.tsx").then(({ mountHallHud }) => {
                  if (done || gone) return
                  off = mountHallHud(parts, {
                    slug,
                    go: openUrl,
                    hrefs: { another: href("hall"), demos: destHref("demos") },
                    retry: () => openUrl(href("hall", { repo: slug, try: String(Date.now() % 100000) })),
                    query: hallQuery,
                    time,
                  })
                })
                return () => {
                  done = true
                  setHudBottom(null)
                  off()
                }
              }
            : undefined
        ctx
          .load(
            Promise.all([
              import("../hexworld/index.ts"),
              history && time && slug ? import("../hall/history.ts") : null,
              slug
                ? import("../hall/feeds/probe.ts").then((p) =>
                    p.autoFeed(ctx.query, slug, { hostname: location.hostname }),
                  )
                : null,
            ]).then(([{ mountHexWorld }, hall, auto]) => {
              if (gone) return
              if (auto) {
                hallQuery = new URLSearchParams(ctx.query)
                hallQuery.set("feed", auto)
              }
              // the history: the island revealed as it was on the clock's day (`?t=`, today by default)
              const past =
                hall && time && slug
                  ? hall.createHistory({
                      time,
                      chronicle: hallChronicle(slug).then((r) => (r.status === "ok" ? r.chronicle : null)),
                      at: hall.readT(ctx.query.get("t")),
                      onRest: writeT,
                    })
                  : null
              // a hall with a session (`?feed=`) shows its events on the island: CI weather, PR ships, scaffolds
              const fx = hallQuery.has("feed")
              // the season follows the history's date on the bar (Watch it grow cycles its years); a session's: today's
              const seasonDate =
                past && time
                  ? () => {
                      const range = time.range()
                      if (!range || time.scale() !== "history") return null
                      const c = time.clock.get()
                      const date = range.start + c.t * (range.end - range.start)
                      // playing, a chapter keeps one season (seasonPace.ts); at rest, the day's own
                      return c.playing ? playingSeasonDate(date, range) : date
                    }
                  : undefined
              const extra = repo
                ? { repo, hud, fx, ...(seasonDate ? { seasonDate } : {}) }
                : home
                  ? { hud, fx: true, session: homeSession }
                  : {}
              const offMap = mountHexWorld(world, inner, past?.hooks, extra)
              offWorld = () => {
                offMap()
                past?.dispose()
              }
            }),
          )
          .catch((error: unknown) => {
            logger.error("the island did not load", { error: String(error) })
          })
      }

      return () => {
        gone = true
        offWorld()
        stopCover()
        root.style.display = "none"
        setTimeout(() => {
          react.unmount()
          root.remove()
          releaseShell()
          releaseSite()
          studio.release()
        }, 0)
      }
    },
  }
}

/** The hall's `?t=` follows its clock at rest, in place (no history entry, no remount): a link opens on that day. */
function writeT(t: string | null): void {
  const url = new URL(location.href)
  if (t === null) url.searchParams.delete("t")
  else url.searchParams.set("t", t)
  if (url.href !== location.href) history.replaceState(history.state, "", url)
}

/** `/`: the live island with its HUD and the demo guild at work, and the first-visit welcome bar. */
export const island = siteScreen("island", "Island", true)
/** `/demos`: the demo picker over the island. */
export const demos = siteScreen("demos", "Demos", true)
/** `/hall/<owner>/<repo>`: a repo's island (and, bare, the card that asks for the repo). */
export const hall = siteScreen("hall", "Your repo", true)
/** `/harbour`: the repos chronicled from their first commit. */
export const harbour = siteScreen("harbour", "Harbour", false)
/** `/built`: How it's built, with the journey. */
export const built = siteScreen("built", "How it's built", false)
