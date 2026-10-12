/**
 * The main thread's half of a town: each placed prefab variant compiled once (cached across towns, so
 * stepping seeds re-compiles only what is new), the layout dressed (the metrics' draw
 * list), and its pieces cut into what the static batch streams in, in order: the buildings as LOD
 * clusters (one per house, keyed by recipe and seed, so houses alike share a far shell), then walls,
 * fences, props and the lamps as loose pieces, then the plants clustered (by wood, else grid cell); and
 * the town's lights for the night.
 */
import { type Catalog, compilePrefab, type PrefabRecipe, type Recipe } from "@guildhall/assets"
import { log } from "@guildhall/core"
import type { BatchCluster, BatchInstance } from "@guildhall/render"
import {
  dressTown,
  PLANT_ROLES,
  type Placement,
  recipeKey,
  type TownDraw,
  type TownLayout,
  type TownLibrary,
  type TownLights,
  townLights,
  type Vec2,
} from "@guildhall/world"

const logger = log("studio:town")

/** The variant cache never holds more than this many compiled recipes (a city uses ~600). */
const CACHE = 4000

export interface Dressed {
  /** The whole town as dressTown draws it (the metrics count its pieces; the worker builds the ground and water). */
  draw: TownDraw
  /** The lamps (their posts are among the loose pieces), their light points and the lit windows. */
  lights: TownLights
  /** The same pieces as the batch takes them: houses, loose pieces (edges, props), plants. */
  houses: BatchCluster[]
  loose: BatchInstance[]
  plants: BatchCluster[]
  /** Variants compiled for this town (cache misses), and the ms compiling and dressing took. */
  compiled: number
  compileMs: number
  dressMs: number
}

/** Compiles prefab variants against one catalog; a recipe that fails is logged once and drawn bare. */
export function createCompiler(recipes: readonly PrefabRecipe[], catalog: Catalog) {
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const cache = new Map<string, Recipe | null>()
  return {
    /** Every placement's variant, compiled (cached); the map dressTown reads. */
    compile(layout: TownLayout): { compiled: Map<string, Recipe>; misses: number } {
      const out = new Map<string, Recipe>()
      let misses = 0
      for (const p of layout.placements) {
        const recipe = byId.get(p.prefab)
        if (!recipe) continue
        const key = recipeKey(p.prefab, p.seed)
        let hit = cache.get(key)
        if (hit === undefined) {
          misses++
          try {
            hit = compilePrefab(recipe, p.seed, catalog).recipe
          } catch (error) {
            logger.warn("variant left bare", { key, error: String(error) })
            hit = null
          }
          if (cache.size >= CACHE) cache.delete(cache.keys().next().value as string)
          cache.set(key, hit)
        }
        if (hit) out.set(key, hit)
      }
      return { compiled: out, misses }
    },
  }
}

export type Compiler = ReturnType<typeof createCompiler>

/** Plants are clustered on a grid of this pitch (metres): far away, a cell of crops or trees is one shell. */
export const PLANT_CELL = 16

/**
 * Plants as clusters: those nature grouped (`cluster`: a wood's or the wild's cell) one per group,
 * centred on its plants' mean; the rest (a field's rows, an orchard) one per PLANT_CELL grid cell they
 * stand in, at the cell's centre. Each plant keeps its size and tone (`scale`, `swatchMap`).
 */
export function plantClusters(plants: readonly Placement[]): BatchCluster[] {
  const groups = new Map<string, { centre: Vec2 | null; members: Placement[] }>()
  for (const p of plants) {
    const i = Math.floor(p.at[0] / PLANT_CELL)
    const j = Math.floor(p.at[1] / PLANT_CELL)
    const key = p.cluster ? `plants:${p.cluster}` : `plants:${i},${j}`
    let group = groups.get(key)
    if (!group) {
      group = { centre: p.cluster ? null : [(i + 0.5) * PLANT_CELL, (j + 0.5) * PLANT_CELL], members: [] }
      groups.set(key, group)
    }
    group.members.push(p)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, g]) => {
      const n = g.members.length
      const [x, z] = g.centre ?? [
        g.members.reduce((s, p) => s + p.at[0], 0) / n,
        g.members.reduce((s, p) => s + p.at[1], 0) / n,
      ]
      const parts = g.members.map(
        (p): BatchInstance => ({
          piece: p.prefab,
          x: p.at[0] - x,
          y: 0,
          z: p.at[1] - z,
          rot: p.rot,
          scale: p.scale ?? 1,
          ...(p.swatchMap ? { swatchMap: p.swatchMap } : {}),
        }),
      )
      return { key, parts, x, y: 0, z, rot: 0, scale: 1 }
    })
}

/** Compiles, dresses and clusters a layout. */
export function dress(
  layout: TownLayout,
  compiler: Compiler,
  lib: Pick<TownLibrary, "prefabs">,
  now = () => performance.now(),
): Dressed {
  const t0 = now()
  const { compiled, misses } = compiler.compile(layout)
  const t1 = now()
  const draw = dressTown(layout, compiled)
  const lights = townLights(layout, compiled, lib)
  const houses: BatchCluster[] = []
  const rest: Placement[] = []
  const plants: Placement[] = [...layout.nature]
  for (const p of layout.placements) {
    const key = recipeKey(p.prefab, p.seed)
    const recipe = compiled.get(key)
    if (recipe)
      houses.push({ key, parts: recipe.instances, x: p.at[0], y: 0, z: p.at[1], rot: p.rot, scale: 1 })
    else if (PLANT_ROLES.has(p.role ?? "")) plants.push(p)
    else rest.push(p)
  }
  // Edges and the uncompiled placements, laid out exactly as the full draw lays them out; the lamps.
  const loose = [
    ...dressTown({ ...layout, placements: rest, nature: [] }, new Map()).pieces,
    ...lights.pieces,
  ]
  const t2 = now()
  return {
    draw,
    lights,
    houses,
    loose,
    plants: plantClusters(plants),
    compiled: misses,
    compileMs: t1 - t0,
    dressMs: t2 - t1,
  }
}
