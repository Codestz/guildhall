import { applyOverlay, createCatalog, type NpcRecipe, validateNpc } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { tilePrefabs } from "@guildhall/world"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { holdStudioStyle } from "../browser/style.ts"
import { loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import { param } from "../params.ts"
import type { Screen } from "../screens.ts"
import { loadTiles } from "../tiles.ts"
import { parseTileId } from "./model.ts"
import { holdComposerStyle } from "./style.ts"
import { type ComposerData, type ComposerState, TileComposer } from "./TileComposer.tsx"

const logger = log("studio:composer")

/** `guildhall.ext.composer`: what the composer holds, for agents and shots. */
export interface ComposerExt {
  state(): ComposerState | null
}

/** The rig every KayKit townsperson plays. */
const RIG = "rig-medium"

/** The library (with `data/mounts.json` over it, so props carry their grips), the tiles, the roles, the clips. */
async function boot(): Promise<ComposerData | null> {
  const [catalog, overlay, ids] = await Promise.all([
    loadCatalog(),
    data.loadOverlay().catch(() => ({})),
    data.list("npcs").catch((): string[] => []),
    loadTiles(),
  ])
  if (!catalog) return null
  const mounted = createCatalog(catalog.index, [applyOverlay(catalog.all(), overlay)])
  const recipes = await Promise.all(ids.map((id) => data.load("npcs", id).catch(() => null)))
  const roles = new Map(
    recipes
      .filter((r): r is NpcRecipe => r !== null && validateNpc(r).length === 0)
      .map((r) => [r.id, r] as const),
  )
  const clips = (catalog.rig(RIG)?.clips ?? []).map((c) => c.name)
  return { catalog: mounted, tiles: tilePrefabs(), roles, clips }
}

/**
 * The tile composer (`/composer/<tile-id>`, decisions.md "Polish round"): a tile prefab on one hex at
 * scale B with its neighbours; its pieces placed and turned with the gizmo, its activity spots and
 * blockers drawn and edited, "try" stands townsfolk on every spot; saves to `data/tiles/<id>.json`.
 * `?try=1` and `?around=grass|shore|step` open it in that state (the composer writes them as they change).
 */
export const composer: Screen = {
  id: "composer",
  title: "Tile composer",
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

    const start = async () => {
      const [input] = await Promise.all([boot(), style.ready])
      if (disposed) return
      const initial = parseTileId(param(ctx.query, "tile")) ?? "tavern"
      flushSync(() =>
        root.render(
          input?.tiles.length ? (
            <TileComposer
              ctx={ctx}
              input={input}
              initial={initial}
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
      await new Promise<void>((done) => requestAnimationFrame(() => done()))
    }
    ctx.load(start()).catch((error: unknown) => logger.error("boot failed", { error: String(error) }))

    return () => {
      disposed = true
      if (window.guildhall?.ext.composer === ext) delete window.guildhall.ext.composer
      node.style.display = "none"
      // the shell tears screens down from its own React commit; a nested root unmounts after it
      setTimeout(() => {
        root.unmount()
        node.remove()
        own.release()
        style.release()
      }, 0)
    }
  },
}
