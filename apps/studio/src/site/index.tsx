import { log } from "@guildhall/core"
import { holdSiteStyle } from "@guildhall/ui"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { holdStudioStyle } from "../browser/style.ts"
import type { Screen, ScreenCtx } from "../screens.ts"
import { addShellStyle } from "../shell/style.ts"
import { worldQuery } from "./routes.ts"
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
      const world = document.createElement("div")
      world.className = "site-world"
      const pieces = document.createElement("div")
      pieces.className = "site-pieces"
      root.append(...(withWorld ? [world] : []), pieces)
      host.append(root)
      const react = createRoot(pieces)
      let gone = false

      // The pieces first: fonts permitting (they settle within 3 s), the card is the first paint.
      void studio.ready.then(() => {
        if (!gone) flushSync(() => react.render(<SiteApp />))
      })

      let offWorld = () => {}
      let stopCover = () => {}
      if (withWorld) {
        stopCover = coverUntilReveal(root, ctx.query.get("loader") !== "0")
        const inner: ScreenCtx = { ...ctx, query: worldQuery(id, ctx.query) }
        ctx
          .load(
            import("../hexworld/index.ts").then(({ hexWorldScreen }) => {
              if (!gone) offWorld = hexWorldScreen.mount(world, inner)
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

/** `/`: the live island, with the first-visit welcome card. */
export const island = siteScreen("island", "Island", true)
/** `/demos`: the demo picker over the island. */
export const demos = siteScreen("demos", "Demos", true)
/** `/hall/<owner>/<repo>`: a repo's island (and, bare, the card that asks for the repo). */
export const hall = siteScreen("hall", "Your repo", true)
/** `/built`: How it's built, with the journey. */
export const built = siteScreen("built", "How it's built", false)
