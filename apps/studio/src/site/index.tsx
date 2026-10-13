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
      if (withWorld) {
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
