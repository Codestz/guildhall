import type { PrefabRecipe } from "@guildhall/assets"
import { validatePrefab } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { holdStudioStyle } from "../browser/style.ts"
import { loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import type { Screen } from "../screens.ts"
import { Composer, type ComposerState, type Initial } from "./Composer.tsx"
import { blank, DEFAULT_REF, parseRef, parseSeed } from "./model.ts"
import { holdComposerStyle } from "./style.ts"

const logger = log("studio:composer")

/** `guildhall.ext.composer`: what the composer holds, for agents and shots. */
export interface ComposerExt {
  state(): ComposerState | null
}

/** The recipe the deep link names: its saved file, else a template of that id (unsaved). */
async function initial(query: URLSearchParams): Promise<Initial> {
  const ref = parseRef(query.get("recipe")) ?? DEFAULT_REF
  const seed = parseSeed(query.get("seed"))
  const strip = query.get("strip") === "1"
  // Listed first: a missing file would be a 404 the browser logs as an error.
  const saved = await data.list(ref.kind).catch((): string[] => [])
  const json = saved.includes(ref.id) ? await data.load(ref.kind, ref.id) : null
  if (json !== null && validatePrefab(json).length === 0)
    return { ref, recipe: json as PrefabRecipe, source: "saved", seed, strip }
  if (json !== null)
    logger.warn("saved recipe is invalid, starting fresh", { problems: validatePrefab(json) })
  return { ref, recipe: blank(ref.id), source: "new", seed, strip }
}

/**
 * The house composer (`?screen=composer&recipe=<kind/id>&seed=<n>&strip=1`, ADR 005): blueprint
 * controls, panel-click edits and gizmo-placed dressing over a live compile, the hero beside it, a
 * strip of six seeds, and save/load through `data/recipes/<kind>/<id>.json`.
 */
export const composer: Screen = {
  id: "composer",
  title: "Composer",
  mount(host, ctx) {
    const style = holdStudioStyle()
    const own = holdComposerStyle()
    const node = document.createElement("div")
    node.style.cssText = "position:absolute;inset:0"
    host.append(node)
    const root = createRoot(node)
    let read: (() => ComposerState) | null = null
    let disposed = false
    const ext: ComposerExt = { state: () => read?.() ?? null }
    if (window.guildhall) window.guildhall.ext.composer = ext

    const boot = async () => {
      const [catalog, start] = await Promise.all([loadCatalog(), initial(ctx.query), style.ready])
      if (disposed) return
      flushSync(() =>
        root.render(
          catalog ? (
            <Composer
              catalog={catalog}
              ctx={ctx}
              initial={start}
              bind={(next) => {
                read = next
              }}
            />
          ) : (
            <div className="gh gh-composer empty">
              <div className="gh-empty">
                <h2>No library yet</h2>
                <p>
                  Run <code>bun import</code> first: the composer draws library pieces.
                </p>
              </div>
            </div>
          ),
        ),
      )
      // The first draw is registered with `ctx.load` by now; `ready()` waits for it.
      await new Promise<void>((done) => requestAnimationFrame(() => done()))
    }
    ctx.load(boot()).catch((error: unknown) => logger.error("boot failed", { error: String(error) }))

    return () => {
      disposed = true
      if (window.guildhall?.ext.composer === ext) delete window.guildhall.ext.composer
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
