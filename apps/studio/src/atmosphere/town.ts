/**
 * The island town the atmosphere lab lights: grown on the main thread from a seed (a lab waits a
 * second, it needs no worker), every placed prefab compiled, dressed flat and drawn as one static
 * batch, on its ground and water with the open sea carried out past the bounds to the haze. A plain
 * stand-in for the town screen's streamed build: the lab judges the sky over a town, not the build.
 */
import { type Catalog, compilePrefab, type PrefabRecipe, type Recipe } from "@guildhall/assets"
import { log } from "@guildhall/core"
import {
  createGround,
  createStaticBatch,
  createWater,
  type Ground,
  loadPiece,
  type Stage,
  type StaticBatch,
  type Water,
} from "@guildhall/render"
import {
  area,
  clip,
  dressTown,
  generateTown,
  type MultiPolygon,
  recipeKey,
  type TownDraw,
  type TownLayout,
  type TownSpecInput,
  type Vec2,
} from "@guildhall/world"
import { libraryUrl } from "../catalog.ts"
import type { JobLib } from "../planner/job.ts"

const logger = log("studio:atmosphere")

/** How far the sea runs past the bounds, in half sides of the bounds (the haze hides its edge). */
const SEA_REACH = 3

export interface LabTown {
  layout: TownLayout
  draw: TownDraw
  ground: Ground
  water: Water
  batch: StaticBatch
  dispose(): void
}

/** Every placement's variant compiled; a recipe that fails is drawn bare (its prefab id alone). */
function compileAll(layout: TownLayout, recipes: readonly PrefabRecipe[], catalog: Catalog) {
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const out = new Map<string, Recipe>()
  for (const p of layout.placements) {
    const recipe = byId.get(p.prefab)
    const key = recipeKey(p.prefab, p.seed)
    if (!recipe || out.has(key)) continue
    try {
      out.set(key, compilePrefab(recipe, p.seed, catalog).recipe)
    } catch (error) {
      logger.warn("variant left bare", { key, error: String(error) })
    }
  }
  return out
}

/** The land as the bounds minus the (unioned) water: its largest piece and that piece's holes. */
function landOf(bounds: readonly Vec2[], water: readonly Vec2[][]): { land: Vec2[]; holes: Vec2[][] } {
  if (water.length === 0) return { land: [...bounds], holes: [] }
  let sea: MultiPolygon = []
  for (const ring of water) sea = sea.length === 0 ? clip(ring, ring, "union") : clip(sea, ring, "union")
  let best: Vec2[][] | null = null
  for (const p of clip([...bounds], sea, "difference"))
    if (p[0] && (!best || Math.abs(area(p[0])) > Math.abs(area(best[0] as Vec2[])))) best = p
  return best ? { land: best[0] as Vec2[], holes: best.slice(1) } : { land: [...bounds], holes: [] }
}

/** The water plus four bands of open sea round the bounds; foam only on the land's own outline. */
function withSea(draw: TownDraw, bounds: readonly Vec2[]): TownDraw["water"] {
  const xs = bounds.map((p) => p[0])
  const zs = bounds.map((p) => p[1])
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const r = SEA_REACH * Math.max(x1 - x0, z1 - z0) * 0.5
  const box = (a: number, b: number, c: number, d: number): Vec2[] => [
    [a, b],
    [c, b],
    [c, d],
    [a, d],
  ]
  const { land, holes } = draw.ground
  const shore = [land, ...holes].filter((ring) => ring.length > 2).map((ring) => [...ring, ring[0] as Vec2])
  return {
    ...draw.water,
    polys: [
      ...draw.water.polys,
      box(x0 - r, z0 - r, x1 + r, z0),
      box(x0 - r, z1, x1 + r, z1 + r),
      box(x0 - r, z0, x0, z1),
      box(x1, z0, x1 + r, z1),
    ],
    shore,
  }
}

/** Grows, dresses and draws the town; ground falls back to bare land when its overlays will not paint. */
export async function buildLabTown(
  stage: Stage,
  spec: TownSpecInput,
  lib: JobLib,
  recipes: readonly PrefabRecipe[],
  catalog: Catalog,
): Promise<LabTown> {
  const t0 = performance.now()
  const layout = generateTown(spec, lib.town as Parameters<typeof generateTown>[1])
  const compiled = compileAll(layout, recipes, catalog)
  const dressed = dressTown(layout, compiled)
  const draw: TownDraw = { ...dressed, ground: { ...dressed.ground, ...landOf(layout.bounds, layout.water) } }
  draw.water = withSea(draw, layout.bounds)
  let ground: Ground
  try {
    ground = createGround(stage, draw.ground, { seed: spec.seed })
  } catch (error) {
    logger.warn("ground drawn bare", { error: String(error).slice(0, 160) })
    ground = createGround(stage, { ...draw.ground, overlays: [] }, { seed: spec.seed })
  }
  const water = createWater(stage, draw.water)
  const load = (id: string) => {
    const entry = catalog.get(id)
    if (!entry) return Promise.reject(new Error(`atmosphere: unknown piece "${id}"`))
    return loadPiece(libraryUrl(entry.files.glb))
  }
  const batch = await createStaticBatch(stage, draw.pieces, load)
  logger.info("town", { seed: spec.seed, pieces: draw.pieces.length, ms: Math.round(performance.now() - t0) })
  return {
    layout,
    draw,
    ground,
    water,
    batch,
    dispose() {
      batch.dispose()
      water.dispose()
      ground.dispose()
    },
  }
}
