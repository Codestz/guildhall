import type { Mount } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { holdStudioStyle } from "../browser/style.ts"
import { loadCatalog } from "../catalog.ts"
import { list, loadOverlay } from "../data.ts"
import type { Screen } from "../screens.ts"
import { HOME_ID } from "../shell/directory.ts"
import { createDiorama, type Diorama } from "./diorama.ts"
import { Home } from "./Home.tsx"
import { studioStats } from "./stats.ts"
import { holdHomeStyle } from "./style.ts"

const logger = log("studio:home")

/**
 * The home page (`?screen=home`, the default): the studio's front door, with a live diorama, the
 * library's numbers, every tool by purpose and how the assets are made.
 */
export const home: Screen = {
  id: HOME_ID,
  title: "Home",
  mount(host, ctx) {
    const style = holdStudioStyle()
    const own = holdHomeStyle()
    const node = document.createElement("div")
    node.style.cssText = "position:absolute;inset:0"
    host.append(node)
    const root = createRoot(node)
    let disposed = false

    const data = Promise.all([
      loadCatalog(),
      loadOverlay()
        .then((o) => o.mounts as Record<string, Mount> | undefined)
        .catch(() => undefined),
    ])

    /** The diorama lives as long as its element; it waits for the catalog it draws from. */
    const vignette = (plate: HTMLElement) => {
      let diorama: Diorama | null = null
      let gone = false
      const start = data.then(([catalog, mounts]) => {
        if (gone || disposed) return
        diorama = createDiorama(plate, catalog, mounts)
        ctx.attach(diorama.stage)
        return diorama.ready
      })
      ctx.load(start).catch((error: unknown) => logger.error("diorama failed", { error: String(error) }))
      return () => {
        gone = true
        diorama?.dispose()
      }
    }

    root.render(<Home stats={null} vignette={vignette} />)

    const boot = async () => {
      const [[catalog, mounts]] = await Promise.all([data, style.ready, own.ready])
      const stats = await studioStats(catalog, mounts, (kind) => list(kind))
      if (disposed) return
      logger.info("stats", { ...stats })
      flushSync(() => root.render(<Home stats={stats} vignette={vignette} />))
    }
    ctx.load(boot()).catch((error: unknown) => logger.error("boot failed", { error: String(error) }))

    return () => {
      disposed = true
      node.style.display = "none"
      // The shell tears screens down from its own React commit; a nested root unmounts after it.
      setTimeout(() => {
        root.unmount()
        node.remove()
        own.release()
        style.release()
      }, 0)
    }
  },
}
