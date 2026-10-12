import { compilePrefab, type PrefabRecipe, validatePrefab } from "@guildhall/assets"
import type { CameraPose, FrameStats } from "@guildhall/core"
import { log } from "@guildhall/core"
import {
  createSky,
  createStage,
  createStaticBatch,
  createSun,
  disposeObject,
  loadPiece,
  type StaticBatch,
  testBox,
} from "@guildhall/render"
import { libraryUrl, loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"
import type { Screen } from "../screens.ts"
import { batchLayout, CELL, type House, parseN } from "./layout.ts"

const logger = log("studio:batch")

/** Trees and crops to scatter (the ones the library has); houses come from `data/recipes/houses`. */
const TREES = [
  "kenney-town/tree-high",
  "kenney-town/tree-high-round",
  "kaykit-forest/tree-2-b-color1",
  "kaykit-forest/tree-4-b-color1",
  "kenney-mini-forest/tree-high",
  "kenney-castle/tree-large",
]
const CROPS = [
  "kenney-nature/crops-corn-stage-a",
  "kenney-nature/crops-leafs-stage-a",
  "kenney-nature/crop-pumpkin",
  "quaternius-crops/wheat-2",
  "quaternius-crops/corn-2",
  "quaternius-crops/beet-2",
]
/** Each house recipe compiled for these seeds, for variety. */
const SEEDS = [1, 2, 3]
const SEED = 7

const PANEL_STYLE = [
  "position:absolute",
  "left:12px",
  "bottom:12px",
  "padding:6px 10px",
  "border-radius:4px",
  "background:rgba(21,17,13,0.78)",
  "color:#f3e9d4",
  "font:12px/1.5 ui-monospace,Menlo,monospace",
  "white-space:pre",
  "pointer-events:none",
].join(";")

/** Every house recipe in `data/recipes/houses`, compiled for each of SEEDS; a broken one is skipped. */
async function houses(catalog: NonNullable<Awaited<ReturnType<typeof loadCatalog>>>): Promise<House[]> {
  const ids = await data.list("recipes/houses")
  const recipes = await Promise.all(ids.map((id) => data.load("recipes/houses", id)))
  return recipes.flatMap((json, i) => {
    if (json === null || validatePrefab(json).length > 0) return []
    try {
      return SEEDS.map((seed) => ({
        key: `${ids[i]}:${seed}`,
        parts: compilePrefab(json as PrefabRecipe, seed, catalog).recipe.instances,
      }))
    } catch (error) {
      logger.warn("house skipped", { id: ids[i], error: String(error) })
      return []
    }
  })
}

/**
 * The static-batch bench (`/lab/batch?n=10000`, R2 / ADR 007): `n` library pieces (compiled houses,
 * crop fields, woods) in one BatchedMesh under the cascaded sun, with the draw counters in a panel.
 * The draw calls stay flat whatever `n` is; triangles stay in budget by LOD (pieces by screen size, a far
 * cell — house, field, wood — as one merged shell), the tiers drawn shown in the panel. `?move=pan` sweeps the camera's target so the near cascades
 * re-render every frame (the worst case; an orbit about a still target re-renders none); `guildhall.ext.batch.stats()` reads the batch.
 */
export const batch: Screen = {
  id: "batch",
  title: "Batch",
  mount(host, ctx) {
    const n = parseN(ctx.query.get("n"))
    const stage = createStage(host)
    ctx.attach(stage)
    // A first guess at the extent (fields hold the most per cell); the build re-aims at the real one.
    const half = (Math.ceil(Math.sqrt(n / 60)) * CELL) / 2
    const pose: CameraPose = { target: [0, 0, 0], azimuth: 40, elevation: 38, distance: 2.2 * half + 30 }
    stage.setCamera(pose)
    const ground = testBox(1, "#8f9a6a")
    ground.receiveShadow = true
    stage.scene.add(ground)

    let sun: ReturnType<typeof createSun> | null = null
    let sky: ReturnType<typeof createSky> | null = null
    let built: StaticBatch | null = null
    let disposed = false

    const build = async () => {
      const catalog = await loadCatalog()
      if (!catalog) {
        logger.warn("no library: nothing to batch")
        return
      }
      const present = (ids: readonly string[]) => ids.filter((id) => catalog.get(id))
      const { clusters, cells } = batchLayout(
        n,
        { houses: await houses(catalog), trees: present(TREES), crops: present(CROPS) },
        SEED,
      )
      const reach = Math.ceil(Math.sqrt(cells.house + cells.field + cells.wood) / 2 + 1) * CELL
      ground.scale.set(2 * reach + 40, 1, 2 * reach + 40)
      ground.position.y = -0.5
      sun = createSun(stage, { town: { min: [-reach, 0, -reach], max: [reach, 25, reach] } })
      sky = createSky(stage, { sun, reach: 1.4 * reach })
      Object.assign(pose, { distance: 1.6 * reach + 30 })
      stage.setCamera(pose)
      const next = await createStaticBatch(
        stage,
        [],
        async (id) => {
          const entry = catalog.get(id)
          if (!entry) throw new Error(`batch: unknown piece "${id}"`)
          return loadPiece(libraryUrl(entry.files.glb))
        },
        clusters,
      )
      if (disposed) {
        next.dispose()
        return
      }
      built = next
      sun.markDirty()
      logger.info("batch", { n, instances: next.count, geometries: next.geometries, cells })
    }
    ctx.load(build()).catch((error: unknown) => logger.error("build failed", { error: String(error) }))

    const panel = document.createElement("div")
    panel.style.cssText = PANEL_STYLE
    host.append(panel)
    const pan = ctx.query.get("move") === "pan"
    let t = 0
    let frame = 0
    const unsubscribe = stage.onFrame((dt) => {
      if (pan) {
        t += dt
        const [x, y, z] = pose.target
        stage.setCamera({ ...pose, target: [x + 20 * Math.sin(t * 0.6), y, z] })
      }
      if (frame++ % 10 === 0) panel.textContent = describe(built, stage.stats())
    })
    const ext = window.guildhall?.ext
    if (ext)
      ext.batch = {
        stats: () => ({
          n,
          instances: built?.count ?? 0,
          geometries: built?.geometries ?? 0,
          clusters: built?.clusters ?? 0,
          lod: built?.lod ?? null,
        }),
      }

    return () => {
      disposed = true
      if (ext) delete ext.batch
      unsubscribe()
      panel.remove()
      built?.dispose()
      sky?.dispose()
      sun?.dispose()
      disposeObject(ground)
      stage.dispose()
    }
  },
}

function describe(b: StaticBatch | null, f: FrameStats): string {
  if (!b) return "building the batch…"
  return [
    `batch: ${b.count} instances · ${b.geometries} geometries · ${b.clusters} cells`,
    `lod: pieces ${b.lod.tiers.join(" / ")} (full / mid / low) · cells ${b.lod.near} near / ${b.lod.shells} shells`,
    `main ${f.mainCalls ?? "?"} calls · ${f.mainTris ?? "?"} tris · shadow ${f.shadowCalls ?? "?"} calls · ${f.shadowTris ?? "?"} tris`,
    `cost p95 ${f.costMs?.p95.toFixed(1) ?? "?"} ms · dpr ${f.dpr}`,
  ].join("\n")
}
