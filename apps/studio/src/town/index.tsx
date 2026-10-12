import type { PrefabRecipe } from "@guildhall/assets"
import { log } from "@guildhall/core"
import { createStage } from "@guildhall/render"
import {
  TIERS,
  type Tier,
  type TownLayout,
  type TownReport,
  type TownSpecInput,
  validateTownSpec,
} from "@guildhall/world"
import { createRoot } from "react-dom/client"
import { holdStudioStyle } from "../browser/style.ts"
import { loadCatalog } from "../catalog.ts"
import { type DataKind, list, load } from "../data.ts"
import { buildLibrary } from "../planner/library.ts"
import { holdPlannerStyle } from "../planner/style.ts"
import type { Screen } from "../screens.ts"
import { replaceQuery } from "../shell/router.ts"
import { createTownController, type TownLib } from "./controller.ts"
import { Compare, Controls, Stats } from "./Panels.tsx"
import { CAMS, type Cam, parseTownQuery, townParams, townSpec } from "./query.ts"
import { holdTownStyle } from "./style.ts"

const logger = log("studio:town")

/** Every recipe folder a town draws from (as the planner); a folder that does not exist is empty. */
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

/** A preset from `data/towns/<id>.json`, checked; a missing or broken one is an error on screen. */
async function loadPreset(id: string): Promise<TownSpecInput> {
  const json = await load("towns", id)
  if (json === null) throw new Error(`no town preset "${id}" in data/towns`)
  const problems = validateTownSpec(json)
  if (problems.length > 0) throw new Error(`data/towns/${id}.json: ${problems.join("; ")}`)
  return json as TownSpecInput
}

/** What agents drive the town through: `window.guildhall.ext.town`. */
export interface TownExt {
  /** The layout on screen (null while the first one grows). */
  layout(): TownLayout | null
  /** The town's numbers, the build's timings and the last frame's counters. */
  stats(): Record<string, unknown> | null
  /** Each resolves once the new town is grown and every stage drawn. */
  setSeed(seed: number): Promise<void>
  setTier(tier: Tier): Promise<void>
  setHour(hour: number): Promise<void>
  setCam(cam: Cam): Promise<void>
}

/**
 * The town (`/town/<seed or preset>?tier=&hour=&harbour=&walls=&cam=hero|street|map&compare=1&ui=0`,
 * plan §6 U1): a generated town in 3D under the golden-hour sun. The layout grows in a worker, the
 * prefab variants compile here (cached), and the build streams in: sky, ground and water first, then
 * the buildings, the walls and dressing, the plants, all in one static batch. `ui=0` hides the panels
 * for clean shots.
 */
export const town: Screen = {
  id: "town",
  title: "Town",
  mount(host, ctx) {
    const studio = holdStudioStyle()
    const planner = holdPlannerStyle()
    const own = holdTownStyle()
    const node = document.createElement("div")
    node.className = "gh gh-town"
    if (ctx.query.get("ui") === "0") node.dataset.ui = "off"
    const view = document.createElement("div")
    view.className = "view"
    const panels = {
      controls: document.createElement("aside"),
      stats: document.createElement("aside"),
      compare: document.createElement("div"),
    }
    panels.controls.className = "gh-panel gh-pl-controls"
    panels.controls.setAttribute("aria-label", "Town settings")
    panels.stats.className = "gh-panel gh-pl-stats"
    panels.stats.setAttribute("aria-label", "Town statistics")
    node.append(view, panels.controls, panels.stats, panels.compare)
    host.append(node)

    const stage = createStage(view)
    ctx.attach(stage)
    const initial = parseTownQuery(ctx.query)
    const lib: Promise<TownLib> = Promise.all([loadCatalog(), loadRecipes()]).then(([catalog, recipes]) => {
      if (!catalog) throw new Error("the town needs the asset library (library/catalog)")
      logger.info("library", { recipes: recipes.length, catalog: catalog.all().length })
      return { job: buildLibrary(recipes, catalog), catalog, recipes }
    })
    const spec = initial.preset ? loadPreset(initial.preset) : Promise.resolve(townSpec(initial))
    const c = createTownController(stage, lib, initial, spec, (q) => replaceQuery(townParams(q)))
    ctx.load(Promise.all([studio.ready, c.settled()]))

    const roots = [createRoot(panels.controls), createRoot(panels.stats), createRoot(panels.compare)] as const
    roots[0].render(<Controls town={c} rig={stage.rig} />)
    roots[1].render(<Stats town={c} stage={stage} />)
    roots[2].render(<Compare town={c} />)

    // `[` and `]` step the seed from anywhere on the screen but a text field.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const seed = c.state().query.seed
      if (e.key === "]") c.set({ seed: seed + 1 })
      else if (e.key === "[") c.set({ seed: Math.max(0, seed - 1) })
    }
    addEventListener("keydown", onKey)

    const ext = window.guildhall?.ext
    const api: TownExt = {
      layout: () => c.state().job?.layout ?? null,
      stats: () => {
        const s = c.state()
        if (!s.report) return null
        const report: TownReport = s.report
        return {
          spec: s.spec,
          houses: report.houses,
          pieces: report.pieces,
          builtPct: report.builtPct,
          estTris: report.estTris,
          stagePieces: s.stagePieces,
          genMs: s.genMs,
          stageMs: s.job?.times ?? {},
          ...s.dressed,
          build: s.build,
          frame: stage.stats(),
          lod: c.lod(),
        }
      },
      setSeed: async (seed) => {
        c.set({ seed: Math.max(0, Math.floor(seed)) })
        await c.settled()
      },
      setTier: async (tier) => {
        if (!TIERS.includes(tier)) throw new Error(`town: unknown tier "${tier}"`)
        c.set({ tier })
        await c.settled()
      },
      setHour: async (hour) => {
        c.set({ hour })
        await c.settled()
      },
      setCam: async (cam) => {
        if (!CAMS.includes(cam)) throw new Error(`town: unknown camera "${cam}"`)
        c.set({ cam })
        await c.settled()
      },
    }
    if (ext) ext.town = api

    return () => {
      if (ext) delete ext.town
      removeEventListener("keydown", onKey)
      c.dispose()
      stage.dispose()
      node.style.display = "none"
      // The shell tears screens down from its own React commit; nested roots unmount after it.
      setTimeout(() => {
        for (const r of roots) r.unmount()
        node.remove()
        own.release()
        planner.release()
        studio.release()
      }, 0)
    }
  },
}
