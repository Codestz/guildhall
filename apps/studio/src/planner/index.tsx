import type { PrefabRecipe } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { TIERS, type Tier, type TownPlan } from "@guildhall/world"
import { createRoot } from "react-dom/client"
import { holdStudioStyle } from "../browser/style.ts"
import { loadCatalog } from "../catalog.ts"
import { type DataKind, list, load } from "../data.ts"
import type { Screen } from "../screens.ts"
import { replaceQuery } from "../shell/router.ts"
import { createPlanner } from "./controller.ts"
import { buildLibrary } from "./library.ts"
import { Controls, Stats, Status, Strip } from "./Panels.tsx"
import { parsePlannerQuery, plannerParams } from "./query.ts"
import type { PlanStats } from "./stats.ts"
import { holdPlannerStyle } from "./style.ts"

const logger = log("studio:planner")

/** Every recipe folder a town can draw from; a folder that does not exist yet is just empty. */
const RECIPE_KINDS: readonly DataKind[] = [
  "recipes/houses",
  "recipes/landmarks",
  "recipes/stalls",
  "recipes/docks",
  "recipes/farm",
]

async function loadRecipes(): Promise<PrefabRecipe[]> {
  const folders = await Promise.all(
    RECIPE_KINDS.map(async (kind) => {
      const ids = await list(kind).catch(() => [] as string[])
      const files = await Promise.all(ids.map((id) => load(kind, id).catch(() => null)))
      return files.filter((f): f is PrefabRecipe => f !== null && typeof f === "object")
    }),
  )
  return folders.flat()
}

/** What agents drive the planner through: `window.guildhall.ext.planner`. */
export interface PlannerExt {
  /** The town on screen (null while the first one grows). */
  plan(): TownPlan | null
  stats(): PlanStats | null
  /** Each resolves once the new town is generated and drawn. */
  setSeed(seed: number): Promise<void>
  setTier(tier: Tier): Promise<void>
}

/**
 * The town planner (`/planner?seed=&tier=&layers=`): a live top-down map of a generated town, drawn as a
 * stylised fantasy map from the same plan the 3D town renders, for judging layout fast.
 */
export const planner: Screen = {
  id: "planner",
  title: "Town planner",
  mount(host, ctx) {
    const studio = holdStudioStyle()
    const own = holdPlannerStyle()
    const node = document.createElement("div")
    node.className = "gh gh-planner"
    const canvas = document.createElement("canvas")
    canvas.className = "map"
    canvas.tabIndex = 0
    canvas.setAttribute("role", "img")
    const panels = {
      controls: document.createElement("aside"),
      stats: document.createElement("aside"),
      strip: document.createElement("nav"),
      status: document.createElement("div"),
    }
    panels.controls.className = "gh-panel gh-pl-controls"
    panels.controls.setAttribute("aria-label", "Town settings")
    panels.stats.className = "gh-panel gh-pl-stats"
    panels.stats.setAttribute("aria-label", "Plan statistics")
    panels.strip.className = "gh-panel gh-pl-strip"
    panels.strip.setAttribute("aria-label", "Neighbouring seeds")
    node.append(canvas, panels.controls, panels.stats, panels.strip, panels.status)
    host.append(node)

    const lib = Promise.all([loadCatalog(), loadRecipes()]).then(([catalog, recipes]) => {
      logger.info("library", { recipes: recipes.length, catalog: catalog ? catalog.all().length : 0 })
      return buildLibrary(recipes, catalog)
    })
    const initial = parsePlannerQuery(ctx.query)
    const p = createPlanner(canvas, lib, initial, (q) => replaceQuery(plannerParams(q)))
    ctx.attach(p.stage)
    ctx.load(Promise.all([studio.ready, p.settled()]))

    const label = () => {
      const q = p.state().query
      canvas.setAttribute(
        "aria-label",
        `Map of a ${q.tier}, seed ${q.seed}. Arrow keys pan, plus and minus zoom, 0 fits the whole sheet.`,
      )
    }
    label()
    const unsub = p.subscribe(label)

    const roots = Object.values(panels).map((el) => createRoot(el))
    const [rc, rs, rt, rx] = roots
    rc?.render(<Controls planner={p} />)
    rs?.render(<Stats planner={p} />)
    rt?.render(<Strip planner={p} />)
    rx?.render(<Status planner={p} />)
    // Labels and the compass are lettered in the studio faces: redraw once they have loaded.
    void studio.ready.then(() => p.set({}))

    const measure = () => {
      const visible = (el: HTMLElement) => el.offsetParent !== null
      const box = node.getBoundingClientRect()
      const c = panels.controls.getBoundingClientRect()
      const s = panels.stats.getBoundingClientRect()
      const t = panels.strip.getBoundingClientRect()
      // On a narrow screen the settings sit as a sheet along the bottom instead of down the left.
      const sheet = visible(panels.controls) && c.top > box.top + box.height * 0.3
      p.setInsets({
        left: visible(panels.controls) && !sheet ? c.right - box.left : 0,
        right: visible(panels.stats) ? box.right - s.left : 0,
        top: 0,
        bottom: Math.max(sheet ? box.bottom - c.top : 0, visible(panels.strip) ? box.bottom - t.top : 0),
      })
    }
    const observer = new ResizeObserver(measure)
    for (const el of [node, panels.controls, panels.stats, panels.strip]) observer.observe(el)

    // `[` and `]` step the seed from anywhere on the screen but a text field.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const seed = p.state().query.seed
      if (e.key === "]") p.set({ seed: seed + 1 })
      else if (e.key === "[") p.set({ seed: Math.max(0, seed - 1) })
    }
    addEventListener("keydown", onKey)

    const ext = window.guildhall?.ext
    const api: PlannerExt = {
      plan: () => p.state().result?.map.plan ?? null,
      stats: () => p.state().result?.stats ?? null,
      setSeed: async (seed) => {
        p.set({ seed: Math.max(0, Math.floor(seed)) })
        await p.settled()
      },
      setTier: async (tier) => {
        if (!TIERS.includes(tier)) throw new Error(`planner: unknown tier "${tier}"`)
        p.set({ tier })
        await p.settled()
      },
    }
    if (ext) ext.planner = api

    return () => {
      if (ext) delete ext.planner
      removeEventListener("keydown", onKey)
      observer.disconnect()
      unsub()
      p.dispose()
      node.style.display = "none"
      // The shell tears screens down from its own React commit; nested roots unmount after it.
      setTimeout(() => {
        for (const r of roots) r.unmount()
        node.remove()
        own.release()
        studio.release()
      }, 0)
    }
  },
}
