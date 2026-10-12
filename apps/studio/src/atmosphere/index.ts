import type { PrefabRecipe } from "@guildhall/assets"
import type { CameraPose } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  type Atmosphere,
  type AtmosphereParams,
  createAtmosphere,
  createSky,
  createStage,
  createSun,
  type Wake,
} from "@guildhall/render"
import { normalizeSpec, type TownSpecInput } from "@guildhall/world"
import { loadCatalog } from "../catalog.ts"
import { list, load } from "../data.ts"
import { buildLibrary } from "../planner/library.ts"
import type { Screen } from "../screens.ts"
import { createPanel } from "./panel.ts"
import { type AtmosphereQuery, CAMS, type Cam, parseAtmosphereQuery } from "./query.ts"
import { buildLabTown, type LabTown } from "./town.ts"

const logger = log("studio:atmosphere")

async function loadRecipes(): Promise<PrefabRecipe[]> {
  const kinds = [
    "recipes/houses",
    "recipes/landmarks",
    "recipes/stalls",
    "recipes/docks",
    "recipes/farm",
  ] as const
  const folders = await Promise.all(
    kinds.map(async (kind) => {
      const ids = await list(kind).catch(() => [] as string[])
      const files = await Promise.all(ids.map((id) => load(kind, id).catch(() => null)))
      return files.filter((f): f is PrefabRecipe => f !== null && typeof f === "object")
    }),
  )
  return folders.flat()
}

/** What agents and shots drive the lab through: `window.guildhall.ext.atmosphere`. */
export interface AtmosphereExt {
  set(params: Partial<AtmosphereParams>): void
  params(): AtmosphereParams
  setHour(hour: number): void
  setCam(cam: Cam): void
  /** Turns the demo boat wake on or off. */
  setWake(on: boolean): void
}

/** The three framings the lab is judged from: the hero view, the harbour close up, the whole island. */
function camPose(cam: Cam, spec: TownSpecInput): CameraPose {
  const s = normalizeSpec(spec)
  const r = s.radius
  const bearing = s.harbour?.bearing ?? 0
  if (cam === "coast") {
    const at: [number, number] = [Math.cos(bearing) * 0.95 * r, Math.sin(bearing) * 0.95 * r]
    return {
      target: [at[0], 0, at[1]],
      azimuth: (-bearing * 180) / Math.PI + 200,
      elevation: 20,
      distance: 0.75 * r,
    }
  }
  if (cam === "wide") return { target: [0, 0, 0], azimuth: 40, elevation: 46, distance: 6.2 * r }
  return { target: [0, 0, 0], azimuth: 40, elevation: 38, distance: 2.4 * r }
}

/**
 * The atmosphere lab (`/lab/atmosphere?seed=&hour=&coverage=&wind=&speed=&clouds=&shadows=&reflections=
 * &skylight=&haze=&grade=&wake=&cam=hero|coast|wide&ui=0`): the island town under drifting clouds, their shadows and the
 * water's reflections, each switchable, with the hour, coverage and wind on sliders. `ui=0` hides the
 * panel for shots.
 */
export const atmosphereLab: Screen = {
  id: "atmosphere",
  title: "Atmosphere",
  mount(host, ctx) {
    const q: AtmosphereQuery = parseAtmosphereQuery(ctx.query)
    const spec: TownSpecInput = { seed: q.seed, tier: "town", harbour: { bearing: q.harbour } }
    const r = normalizeSpec(spec).radius
    const stage = createStage(host)
    ctx.attach(stage)
    stage.setCamera(camPose(q.cam, spec))
    const t = 2 * r
    const sun = createSun(stage, { town: { min: [-t, 0, -t], max: [t, 40, t] } })
    const sky = createSky(stage, { hour: q.hour, sun, reach: 1.4 * r, look: q.look })
    const atmosphere: Atmosphere = createAtmosphere(stage, {
      light: () => sky.light(),
      centre: [0, 0],
      reach: 2.4 * r,
      seed: q.seed,
      params: q.params,
    })
    let town: LabTown | null = null
    let disposed = false

    // A demo wake: a boat leaving the harbour, round and round (the hook's data; boats come later).
    const wakeAt = (time: number): Wake[] => {
      const a = q.harbour + 0.4 * Math.sin(time * 0.05)
      const d = 1.2 * r + 10 * Math.sin(time * 0.1)
      return [{ x: Math.cos(a) * d, z: Math.sin(a) * d, heading: a + Math.PI / 2, speed: 3 }]
    }
    let clock = 0
    const unsubscribe = stage.onFrame((dt) => {
      clock += dt
      town?.water.setWakes(q.wake ? wakeAt(clock) : [])
    })

    const build = async () => {
      const [catalog, recipes] = await Promise.all([loadCatalog(), loadRecipes()])
      if (!catalog) throw new Error("the atmosphere lab needs the asset library (library/catalog)")
      const lib = buildLibrary(recipes, catalog)
      const built = await buildLabTown(stage, spec, lib, recipes, catalog)
      if (disposed) {
        built.dispose()
        return
      }
      town = built
      sun.markDirty()
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))

    const panel =
      ctx.query.get("ui") === "0"
        ? null
        : createPanel(host, {
            params: atmosphere.params(),
            hour: q.hour,
            wake: q.wake,
            onParams: (p) => atmosphere.set(p),
            onHour: (h) => sky.setHour(h),
            onWake: (on) => {
              q.wake = on
            },
            onCam: (cam) => stage.setCamera(camPose(cam, spec)),
          })

    const ext = window.guildhall?.ext
    const api: AtmosphereExt = {
      set: (p) => atmosphere.set(p),
      params: () => atmosphere.params(),
      setHour: (h) => sky.setHour(h),
      setWake: (on) => {
        q.wake = on
      },
      setCam: (cam) => {
        if (!CAMS.includes(cam)) throw new Error(`atmosphere: unknown camera "${cam}"`)
        stage.setCamera(camPose(cam, spec))
      },
    }
    if (ext) ext.atmosphere = api

    return () => {
      disposed = true
      if (ext) delete ext.atmosphere
      unsubscribe()
      panel?.dispose()
      town?.dispose()
      atmosphere.dispose()
      sky.dispose()
      sun.dispose()
      stage.dispose()
    }
  },
}
