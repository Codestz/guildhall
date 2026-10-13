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
import { HallHud, REMEMBERED } from "./HallHud.tsx"
import { holdHallHudStyle } from "./style.ts"

export interface HallHudOptions {
  slug: string
  go(url: string): void
  hrefs: { another: string; demos: string }
  /** Opens the hall again for a fresh read of its chronicle. */
  retry(): void
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
      />,
    )
  })
  return () => {
    gone = true
    setTimeout(() => {
      root.unmount()
      host.remove()
      modals.remove()
      releaseHall()
      releaseHud()
    }, 0)
  }
}
