import { applyOverlay, createCatalog, type NpcRecipe, validateNpc } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { holdStudioStyle } from "../browser/style.ts"
import { loadCatalog } from "../catalog.ts"
import { holdComposerStyle } from "../composer/style.ts"
import * as data from "../data.ts"
import type { Screen } from "../screens.ts"
import { Builder, type Initial, type NpcState } from "./Builder.tsx"
import { blank, parseQuery } from "./model.ts"
import { holdNpcStyle } from "./style.ts"

const logger = log("studio:npc")

/** `guildhall.ext.npc`: what the builder holds, for agents and shots. */
export interface NpcExt {
  state(): NpcState | null
}

/** The role the deep link names: its saved file, else the template of that role (unsaved). */
async function initial(params: URLSearchParams): Promise<Initial> {
  const query = parseQuery(params)
  // Listed first: a missing file would be a 404 the browser logs as an error.
  const saved = await data.list("npcs").catch((): string[] => [])
  const json = saved.includes(query.role) ? await data.load("npcs", query.role) : null
  if (json !== null && validateNpc(json).length === 0)
    return { recipe: json as NpcRecipe, source: "saved", query }
  if (json !== null) logger.warn("saved npc is invalid, starting fresh", { problems: validateNpc(json) })
  return { recipe: blank(query.role), source: "new", query }
}

/** The catalog with `data/mounts.json` laid over it, so props carry the mounts authored so far. */
async function mountedCatalog() {
  const [catalog, overlay] = await Promise.all([loadCatalog(), data.loadOverlay().catch(() => ({}))])
  return catalog && createCatalog(catalog.index, [applyOverlay(catalog.all(), overlay)])
}

/**
 * The NPC builder (`?screen=npc&recipe=<role>&seed=<n>&strip=8&clip=<work|idle|walk>&t=<f>&cam=map`,
 * plan §3.3): a role's options (bodies, hidden parts, outfit ramps, headwear, held props with a mount,
 * clips, variation) over a live strip of seeds and one person large, with save/load through
 * `data/npcs/<role>.json`. `cam=map` views the strip from far and high, as on the town map.
 */
export const npc: Screen = {
  id: "npc",
  title: "NPC builder",
  mount(host, ctx) {
    const style = holdStudioStyle()
    const controls = holdComposerStyle()
    const own = holdNpcStyle()
    const node = document.createElement("div")
    node.style.cssText = "position:absolute;inset:0"
    host.append(node)
    const root = createRoot(node)
    let read: (() => NpcState) | null = null
    let disposed = false
    const ext: NpcExt = { state: () => read?.() ?? null }
    if (window.guildhall) window.guildhall.ext.npc = ext

    const boot = async () => {
      const [catalog, start] = await Promise.all([mountedCatalog(), initial(ctx.query), style.ready])
      if (disposed) return
      flushSync(() =>
        root.render(
          catalog ? (
            <Builder
              catalog={catalog}
              ctx={ctx}
              initial={start}
              bind={(next) => {
                read = next
              }}
            />
          ) : (
            <div className="gh gh-npc empty">
              <div className="gh-empty">
                <h2>No library yet</h2>
                <p>
                  Run <code>bun import</code> first: the builder draws library bodies.
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
      if (window.guildhall?.ext.npc === ext) delete window.guildhall.ext.npc
      node.style.display = "none"
      // The shell tears screens down from its own React commit; a nested root unmounts after it.
      setTimeout(() => {
        root.unmount()
        node.remove()
        own.release()
        controls.release()
        style.release()
      }, 0)
    }
  },
}
