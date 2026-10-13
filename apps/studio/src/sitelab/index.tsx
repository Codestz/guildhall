import { holdSiteStyle, holdUiStyle } from "@guildhall/ui"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import type { Screen } from "../screens.ts"
import { SiteLab, type SiteView, VIEWS } from "./SiteLab.tsx"

const CSS = /* css */ `
.lab-site-root { position: absolute; inset: 0; overflow: hidden; background: #2d3b2a url("/site/island-hero.webp") center / cover no-repeat; }
.lab-site { position: absolute; inset: 0; }
.lab-note { position: absolute; top: 16px; right: 16px; z-index: 60; max-width: 60%; margin: 0; padding: 8px 12px; border-radius: 5px; background: rgba(21, 17, 13, 0.95); border: 1px solid var(--brass-line); color: var(--paper); font: 13px/1.4 var(--mono); }
@media (max-width: 560px) { .lab-note { top: auto; right: 12px; left: 12px; bottom: 12px; max-width: none; } }
`

/**
 * The site lab (`/lab/site`): the welcome card, the crest menu, the demo picker and "How it's built" over a
 * still of the island. Query: `view` welcome | menu | demos | built; `repo=<text>` fills the welcome field
 * (a bad one shows the validation), `busy=1`, `error=<text>`.
 */
export const siteLab: Screen = {
  id: "sitelab",
  title: "Site lab",
  mount(host, ctx) {
    const q = ctx.query
    const ui = holdUiStyle()
    const releaseSite = holdSiteStyle()
    const lab = document.createElement("style")
    lab.dataset.gh = "sitelab"
    lab.textContent = CSS
    document.head.append(lab)

    const node = document.createElement("div")
    node.className = "gh lab-site-root"
    host.append(node)
    const root = createRoot(node)
    const view = (VIEWS.find((v) => v === q.get("view")) ?? "welcome") as SiteView
    const render = () =>
      root.render(
        <SiteLab
          view={view}
          repo={q.get("repo") ?? ""}
          busy={q.get("busy") === "1"}
          error={q.get("error") ?? ""}
        />,
      )
    ctx.load(ui.ready.then(() => flushSync(render))).catch(() => undefined)

    return () => {
      node.style.display = "none"
      setTimeout(() => {
        root.unmount()
        node.remove()
        lab.remove()
        releaseSite()
        ui.release()
      }, 0)
    }
  },
}
