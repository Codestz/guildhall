import type { Catalog } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { loadCatalog } from "../catalog.ts"
import type { Screen } from "../screens.ts"
import { Browser, type BrowserHandle } from "./Browser.tsx"
import { applyFilters, type Filters, parseFilters } from "./filters.ts"
import { holdStudioStyle } from "./style.ts"

const logger = log("studio:browser")

/** How many ids `ext.studio.query` returns (the count is always the full one). */
const QUERY_IDS = 200

/** `guildhall.ext.studio`: the browser as agents drive it. */
export interface StudioExt {
  /** What the catalog holds and what the browser shows. */
  stats(): {
    entries: number
    packs: Record<string, number>
    shown: number
    selected: string | null
    filters: Filters
    facets: ReturnType<Catalog["facets"]> | null
  }
  /** Opens a piece in the inspector; resolves once it is drawn. False for an unknown id. */
  select(id: string): Promise<boolean>
  /** Sets the browser's filters (text, or a partial filter set); returns the match count and ids. */
  query(q: string | Partial<Filters>): Promise<{ count: number; ids: string[] }>
}

function Empty() {
  return (
    <div className="gh gh-browser" style={{ display: "block" }}>
      <div className="gh-empty">
        <h2>No library yet</h2>
        <p>
          Run <code>bun import</code> to bake the packs in <code>assets/src</code> into <code>library/</code>.
        </p>
      </div>
    </div>
  )
}

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))

/**
 * The piece browser (`?screen=pieces`): search and facet filters over the catalog, a virtualised
 * thumbnail grid and the piece inspector. Deep link: `&q=…&pack=…&cat=…&flag=a,b&misfit=1&id=…`.
 */
export const pieces: Screen = {
  id: "pieces",
  title: "Pieces",
  mount(host, ctx) {
    const style = holdStudioStyle()
    // Its own node per mount: a remount must not reuse a root that is still unmounting.
    const node = document.createElement("div")
    node.style.cssText = "position:absolute;inset:0"
    host.append(node)
    const root = createRoot(node)
    let handle: BrowserHandle | null = null
    let catalog: Catalog | null = null
    let disposed = false

    const settle = async () => {
      await nextFrame()
      await window.guildhall?.ready()
    }
    const ext: StudioExt = {
      stats: () => {
        const filters = handle?.filters() ?? parseFilters(new URLSearchParams())
        return {
          entries: catalog?.all().length ?? 0,
          packs: Object.fromEntries((catalog?.index.packs ?? []).map((p) => [p.id, p.count])),
          shown: catalog ? applyFilters(catalog, filters).length : 0,
          selected: new URLSearchParams(location.search).get("id"),
          filters,
          facets: catalog?.facets() ?? null,
        }
      },
      async select(id) {
        if (!catalog?.get(id) || !handle) return false
        const target = handle
        flushSync(() => target.select(id))
        await settle()
        return true
      },
      async query(q) {
        if (!catalog || !handle) return { count: 0, ids: [] }
        const target = handle
        const next = { ...target.filters(), ...(typeof q === "string" ? { text: q } : q) }
        flushSync(() => target.setFilters(next))
        await settle()
        const found = applyFilters(catalog, next)
        return { count: found.length, ids: found.slice(0, QUERY_IDS).map((e) => e.id) }
      },
    }
    if (window.guildhall) window.guildhall.ext.studio = ext

    const boot = async () => {
      const [loaded] = await Promise.all([loadCatalog(), style.ready])
      if (disposed) return
      catalog = loaded
      flushSync(() =>
        root.render(
          loaded ? (
            <Browser
              catalog={loaded}
              ctx={ctx}
              initial={{ filters: parseFilters(ctx.query), id: ctx.query.get("id") }}
              bind={(next) => {
                handle = next
              }}
            />
          ) : (
            <Empty />
          ),
        ),
      )
      // The inspector's first show (a deep-linked id) is registered by now: let `ready()` wait for it.
      await nextFrame()
    }
    ctx.load(boot()).catch((error: unknown) => logger.error("boot failed", { error: String(error) }))

    return () => {
      disposed = true
      if (window.guildhall?.ext.studio === ext) delete window.guildhall.ext.studio
      // The shell tears screens down from its own React commit; a nested root unmounts after it.
      node.style.display = "none"
      setTimeout(() => {
        root.unmount()
        node.remove()
        style.release()
      }, 0)
    }
  },
}
