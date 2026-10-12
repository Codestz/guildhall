/**
 * The 3D town on a stage, built in stages so the first frame comes fast: sky, sun, bare land and
 * water as soon as the layout is dressed, then the pieces streamed in, each stage drawn before the
 * next loads: the houses as LOD clusters, the walls and props added to their batch, the plants as
 * clusters in a second batch (a batch only takes clusters when it is made); last the painted ground
 * in place of the bare land (seconds for a city: render builds it on the main thread). A newer town
 * abandons an older build between stages. The light keeps its hour across towns.
 */
import type { Catalog } from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  createGround,
  createSky,
  createStaticBatch,
  createSun,
  createWater,
  type Ground,
  type LodCounts,
  loadPiece,
  type Sky,
  type Stage,
  type StaticBatch,
  type Sun,
  type Water,
} from "@guildhall/render"
import { normalizeSpec, type TownLayout } from "@guildhall/world"
import { libraryUrl } from "../catalog.ts"
import { sheet } from "./camera.ts"
import type { Dressed } from "./dress.ts"
import { bareGround, paintGround } from "./ground.ts"

const logger = log("studio:town")

/** The tallest thing a town holds (the keep's towers), metres: the town cascade's ceiling. */
const CEILING = 40
/** The town cascade's half side, in town radii (the town is centred on the origin). */
const SHADOW_REACH = 2

/** What the last build took, ms: to the first frame (bare land, water, sky), per batch stage, the ground. */
export interface BuildTimes {
  firstFrameMs: number
  /** Houses, walls and props, plants. */
  stagesMs: number[]
  groundMs: number
  /** The snap the ground's overlays went through (ground.ts); null: bare land. */
  groundSnap: number | null
  totalMs: number
}

export interface TownScene {
  /** Replaces the town on the stage; resolves when every stage is in (null: a newer build took over). */
  show(layout: TownLayout, dressed: Dressed): Promise<BuildTimes | null>
  setHour(hour: number): void
  /** What the last frame's main pass drew per LOD tier, both batches together. */
  lod(): LodCounts
  dispose(): void
}

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))

const NO_LOD: LodCounts = { tiers: [], near: 0, shells: 0 }

/** Two batches' LOD counts as one. */
export function sumLod(a: LodCounts, b: LodCounts): LodCounts {
  const n = Math.max(a.tiers.length, b.tiers.length)
  return {
    tiers: Array.from({ length: n }, (_, k) => (a.tiers[k] ?? 0) + (b.tiers[k] ?? 0)),
    near: a.near + b.near,
    shells: a.shells + b.shells,
  }
}

export function createTownScene(stage: Stage, catalog: Catalog, initialHour: number): TownScene {
  let hour = initialHour
  let sun: Sun | null = null
  let sky: Sky | null = null
  let ground: Ground | null = null
  let water: Water | null = null
  /** The town (houses, then walls and props added) and the plants: one draw each per pass. */
  let town: StaticBatch | null = null
  let plants: StaticBatch | null = null
  let build = 0
  let disposed = false

  const load = (id: string) => {
    const entry = catalog.get(id)
    if (!entry) return Promise.reject(new Error(`town: unknown piece "${id}"`))
    return loadPiece(libraryUrl(entry.files.glb))
  }

  const clear = () => {
    town?.dispose()
    plants?.dispose()
    ground?.dispose()
    water?.dispose()
    sky?.dispose()
    sun?.dispose()
    town = null
    plants = null
    ground = null
    water = null
    sky = null
    sun = null
  }

  return {
    async show(layout, dressed) {
      const mine = ++build
      const start = performance.now()
      clear()
      // The town cascade covers the town and its farms (the far island would spread its texels thin).
      const t = SHADOW_REACH * normalizeSpec(layout.spec).radius
      const light = createSun(stage, { town: { min: [-t, 0, -t], max: [t, CEILING, t] } })
      sun = light
      sky = createSky(stage, { hour, sun: light, reach: 0.9 * sheet(layout).half })
      const seed = layout.spec.seed
      const bare = createGround(stage, bareGround(dressed.draw.ground), { seed })
      ground = bare
      water = createWater(stage, dressed.draw.water)
      await nextFrame()
      const firstFrameMs = performance.now() - start
      const stagesMs: number[] = []
      const stale = () => mine !== build || disposed
      /** A batch made for this build, or null (and disposed) when a newer build took over meanwhile. */
      const own = (made: StaticBatch): StaticBatch | null => {
        if (!stale()) return made
        made.dispose()
        return null
      }

      const steps: (() => Promise<void>)[] = [
        async () => {
          town = own(await createStaticBatch(stage, [], load, dressed.houses))
        },
        async () => {
          await town?.add(dressed.loose)
        },
        async () => {
          plants = own(await createStaticBatch(stage, [], load, dressed.plants))
        },
      ]
      for (const step of steps) {
        if (stale()) return null
        const t0 = performance.now()
        try {
          await step()
        } catch (error) {
          // A newer build disposed the batch under this one's add: not an error, just late.
          if (!stale()) throw error
        }
        if (stale()) return null
        light.markDirty()
        await nextFrame()
        stagesMs.push(performance.now() - t0)
      }
      const t1 = performance.now()
      const painted = paintGround(dressed.draw.ground, (g) => createGround(stage, g, { seed }))
      if (painted.failures.length > 0) logger.warn("ground snapped", { failures: painted.failures })
      bare.dispose()
      ground = painted.built
      const groundMs = performance.now() - t1
      await nextFrame()
      const totalMs = performance.now() - start
      logger.info("town drawn", {
        seed,
        tier: layout.spec.tier,
        pieces: (town?.count ?? 0) + (plants?.count ?? 0),
        clusters: (town?.clusters ?? 0) + (plants?.clusters ?? 0),
        firstFrameMs: Math.round(firstFrameMs),
        totalMs: Math.round(totalMs),
      })
      return { firstFrameMs, stagesMs, groundMs, groundSnap: painted.snap, totalMs }
    },
    setHour(next) {
      hour = next
      sky?.setHour(next)
    },
    lod: () => sumLod(town?.lod ?? NO_LOD, plants?.lod ?? NO_LOD),
    dispose() {
      disposed = true
      clear()
    },
  }
}
