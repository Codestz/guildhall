import { compilePrefab, type PrefabRecipe, type Recipe, validatePrefab } from "@guildhall/assets"
import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  type BatchCluster,
  createGround,
  createNight,
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  createWater,
  type Ground,
  loadPiece,
  type Night,
  type StaticBatch,
  type Water,
} from "@guildhall/render"
import {
  bbox,
  centroid,
  dressTown,
  generateTown,
  type Placement,
  prefabLibrary,
  recipeKey,
  type TownLayout,
  townLights,
} from "@guildhall/world"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import type { Screen } from "../screens.ts"
import { clock, parseNightQuery } from "./params.ts"

const logger = log("studio:night")

const PANEL_STYLE = [
  "position:absolute",
  "left:12px",
  "bottom:12px",
  "padding:8px 12px",
  "border-radius:4px",
  "background:rgba(21,17,13,0.8)",
  "color:#f3e9d4",
  "font:12px/1.5 ui-monospace,Menlo,monospace",
  "display:grid",
  "gap:6px",
  "min-width:300px",
].join(";")

/** The authored house recipes, each compiled once (seed 0) by prefab id: what dressing reads. */
async function recipes(catalog: NonNullable<Awaited<ReturnType<typeof loadCatalog>>>) {
  const ids = await data.list("recipes/houses")
  const all = (await Promise.all(ids.map((id) => data.load("recipes/houses", id)))).filter(
    (json): json is PrefabRecipe => json !== null && validatePrefab(json).length === 0,
  )
  const compiled = new Map<string, Recipe>()
  for (const r of all)
    try {
      compiled.set(r.id, compilePrefab(r, 0, catalog).recipe)
    } catch (error) {
      logger.warn("recipe skipped", { id: r.id, error: String(error) })
    }
  return { all, compiled }
}

/** Every compiled building as a batch cluster (its pieces near, one shell far). */
function clustersOf(plan: TownLayout, compiled: ReadonlyMap<string, Recipe>) {
  const clusters: BatchCluster[] = []
  const loose: Placement[] = []
  for (const p of plan.placements) {
    const key = compiled.has(recipeKey(p.prefab, p.seed)) ? recipeKey(p.prefab, p.seed) : p.prefab
    const recipe = compiled.get(key)
    if (!recipe) {
      loose.push(p)
      continue
    }
    clusters.push({ key, parts: recipe.instances, x: p.at[0], y: 0, z: p.at[1], rot: p.rot, scale: 1 })
  }
  return { clusters, loose }
}

/**
 * The night bench (`/lab/night?hour=21&seed=2&tier=town`): a generated town with its lamps (world
 * `townLights`), lit windows and lamplight, under a sky that runs from day to night. A slider sets the
 * hour, a button plays the cycle (`?play=0.5` hours a second starts it). `guildhall.ext.night` has
 * `setHour(h)`, `cycle(speed)` and `stats()`.
 */
export const night: Screen = {
  id: "night",
  title: "Night",
  mount(host, ctx) {
    const q = parseNightQuery(ctx.query)
    const stage = createStage(host)
    ctx.attach(stage)
    const pose: CameraPose = { target: [0, 0, 0], azimuth: 40, elevation: 34, distance: 110 }
    stage.setCamera(pose)

    let disposed = false
    let built: StaticBatch | null = null
    let ground: Ground | null = null
    let water: Water | null = null
    let sun: ReturnType<typeof createSun> | null = null
    let sky: ReturnType<typeof createSky> | null = null
    let clockwork: Night | null = null

    const panel = document.createElement("div")
    panel.style.cssText = PANEL_STYLE
    const row = document.createElement("div")
    row.style.cssText = "display:flex;gap:8px;align-items:center"
    const play = document.createElement("button")
    play.textContent = "▶ play"
    play.style.cssText =
      "font:inherit;color:inherit;background:#3a2f22;border:1px solid #6b5636;border-radius:3px;padding:2px 8px;cursor:pointer"
    const time = document.createElement("span")
    const slider = document.createElement("input")
    slider.type = "range"
    slider.min = "0"
    slider.max = "24"
    slider.step = "0.05"
    slider.value = String(q.hour)
    slider.style.cssText = "flex:1"
    const info = document.createElement("div")
    info.style.cssText = "white-space:pre;opacity:0.85"
    row.append(play, time, slider)
    panel.append(row, info)
    host.append(panel)

    let speed = q.play
    const setSpeed = (next: number) => {
      speed = next
      clockwork?.cycle(speed)
      play.textContent = speed > 0 ? "❚❚ pause" : "▶ play"
    }
    play.onclick = () => setSpeed(speed > 0 ? 0 : 0.5)
    slider.oninput = () => {
      setSpeed(0)
      clockwork?.setHour(Number(slider.value))
    }

    const build = async () => {
      const catalog = await loadCatalog()
      if (!catalog) {
        info.textContent = "no library: nothing to light"
        return
      }
      const { all, compiled } = await recipes(catalog)
      const lib = prefabLibrary(all, catalog)
      const t0 = performance.now()
      const plan = generateTown({ seed: q.seed, tier: q.tier }, lib)
      const draw = dressTown(plan, compiled)
      const lights = townLights(plan, compiled, lib)
      const { clusters, loose } = clustersOf(plan, compiled)
      const pieces = [...dressTown({ ...plan, placements: loose }, compiled).pieces, ...lights.pieces]
      logger.info("town", {
        ms: Math.round(performance.now() - t0),
        lamps: lights.points.length,
        windows: lights.windows.length,
        clusters: clusters.length,
        pieces: pieces.length,
      })
      if (disposed) return

      const [min, max] = bbox(draw.ground.land)
      const square = plan.plazas[0]
      const c = square && square.length > 2 ? centroid(square) : [0, 0]
      Object.assign(pose, { target: [c[0], 0, c[1]] })
      stage.setCamera(pose)
      sun = createSun(stage, { town: { min: [min[0], 0, min[1]], max: [max[0], 30, max[1]] } })
      sky = createSky(stage, { sun, hour: q.hour, reach: 200 })
      ground = createGround(stage, draw.ground, { seed: q.seed })
      water = createWater(stage, draw.water)
      const batch = await createStaticBatch(
        stage,
        pieces,
        async (id) => {
          const entry = catalog.get(id)
          if (!entry) throw new Error(`night: unknown piece "${id}"`)
          return loadPiece(libraryUrl(entry.files.glb))
        },
        clusters,
      )
      if (disposed) {
        batch.dispose()
        return
      }
      built = batch
      clockwork = createNight(stage, lights, { sky, hour: q.hour })
      clockwork.cycle(speed)
      sun.markDirty()
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))

    let frame = 0
    const unsubscribe = stage.onFrame(() => {
      if (!clockwork || frame++ % 6 !== 0) return
      const h = clockwork.hour()
      time.textContent = clock(h)
      if (speed > 0) slider.value = String(h)
      const n = clockwork.stats()
      const f = stage.stats()
      info.textContent = [
        `lamps ${n.pools} · windows ${n.windows} · real lights ${n.lights} · glow ${n.lamps.toFixed(2)}`,
        `batch ${built?.count ?? 0} pieces · main ${f.mainCalls ?? "?"} calls · ${f.mainTris ?? "?"} tris`,
        `cost p95 ${f.costMs?.p95.toFixed(1) ?? "?"} ms · dpr ${f.dpr}`,
      ].join("\n")
    })

    const ext = window.guildhall?.ext
    if (ext)
      ext.night = {
        setHour: (h: number) => clockwork?.setHour(h),
        cycle: (s: number) => setSpeed(s),
        stats: () => ({ ...clockwork?.stats(), pieces: built?.count ?? 0 }),
      }

    return () => {
      disposed = true
      if (ext) delete ext.night
      unsubscribe()
      panel.remove()
      clockwork?.dispose()
      built?.dispose()
      ground?.dispose()
      water?.dispose()
      sky?.dispose()
      sun?.dispose()
      stage.dispose()
    }
  },
}
