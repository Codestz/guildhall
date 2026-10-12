/**
 * The main thread's half of a town: each placed prefab variant compiled once (cached across towns, so
 * stepping seeds re-compiles only what is new), the layout dressed (ground, water, the metrics' draw
 * list), and its pieces cut into what the static batch streams in, in order: the buildings as LOD
 * clusters (one per house, keyed by recipe and seed, so houses alike share a far shell), then walls,
 * fences and props as loose pieces, then the plants clustered by grid cell.
 */
import { type Catalog, compilePrefab, type PrefabRecipe, type Recipe } from "@guildhall/assets"
import { log } from "@guildhall/core"
import type { BatchCluster, BatchInstance } from "@guildhall/render"
import {
  area,
  clip,
  dressTown,
  type MultiPolygon,
  PLANT_ROLES,
  type Placement,
  recipeKey,
  type TownDraw,
  type TownLayout,
  type Vec2,
} from "@guildhall/world"

const logger = log("studio:town")

/** The variant cache never holds more than this many compiled recipes (a city uses ~600). */
const CACHE = 4000

export interface Dressed {
  /** The whole town as dressTown draws it (ground, water with the sea, every piece flat). */
  draw: TownDraw
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
 * Plants as clusters, one per PLANT_CELL grid cell they stand in (a field's rows, a stretch of wood):
 * each cluster sits at its cell's centre with its plants as parts around it, keyed by its cell.
 */
export function plantClusters(plants: readonly Placement[]): BatchCluster[] {
  const cells = new Map<string, { i: number; j: number; parts: BatchInstance[] }>()
  for (const p of plants) {
    const i = Math.floor(p.at[0] / PLANT_CELL)
    const j = Math.floor(p.at[1] / PLANT_CELL)
    const key = `plants:${i},${j}`
    let cell = cells.get(key)
    if (!cell) {
      cell = { i, j, parts: [] }
      cells.set(key, cell)
    }
    const cx = (i + 0.5) * PLANT_CELL
    const cz = (j + 0.5) * PLANT_CELL
    cell.parts.push({ piece: p.prefab, x: p.at[0] - cx, y: 0, z: p.at[1] - cz, rot: p.rot, scale: 1 })
  }
  return [...cells.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, c]) => ({
      key,
      parts: c.parts,
      x: (c.i + 0.5) * PLANT_CELL,
      y: 0,
      z: (c.j + 0.5) * PLANT_CELL,
      rot: 0,
      scale: 1,
    }))
}

/** How far the sea runs past the site's bounds, as a share of their half side (the haze hides its edge). */
const SEA_REACH = 3

/**
 * The water with open sea round the site: four bands (not overlapping, as the water mesh needs) from
 * the bounds' box out to SEA_REACH × its half side. The shore lines (where foam breaks) are the land's
 * outline and its holes, exactly: the seams where an island's sea pieces meet, or a lake meets the
 * bounds, are water on both sides and get none. On an island site the sea is inside the bounds
 * already; the bands then only carry it out to the haze.
 */
export function withSea(
  water: TownDraw["water"],
  bounds: readonly Vec2[],
  { land, holes }: { land: readonly Vec2[]; holes: readonly Vec2[][] },
): TownDraw["water"] {
  if (bounds.length < 3) return water
  let x0 = Number.POSITIVE_INFINITY
  let z0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let z1 = Number.NEGATIVE_INFINITY
  for (const [x, z] of bounds) {
    x0 = Math.min(x0, x)
    z0 = Math.min(z0, z)
    x1 = Math.max(x1, x)
    z1 = Math.max(z1, z)
  }
  const r = SEA_REACH * Math.max(x1 - x0, z1 - z0) * 0.5
  const box = (a: number, b: number, c: number, d: number): Vec2[] => [
    [a, b],
    [c, b],
    [c, d],
    [a, d],
  ]
  const bands = [
    box(x0 - r, z0 - r, x1 + r, z0),
    box(x0 - r, z1, x1 + r, z1 + r),
    box(x0 - r, z0, x0, z1),
    box(x1, z0, x1 + r, z1),
  ]
  const closed = (ring: readonly Vec2[]): Vec2[] => [...ring, ring[0] as Vec2]
  const shore = [land, ...holes].filter((ring) => ring.length > 2).map(closed)
  return { ...water, polys: [...water.polys, ...bands], shore: shore.length > 0 ? shore : water.shore }
}

/**
 * The land as the bounds minus the water: its largest piece and that piece's holes. The water rings
 * are unioned first: an island's sea comes in pieces that overlap, and a difference taken against
 * overlapping pieces leaves sea in the land (dressTown's own land does, so it is redone here).
 */
export function landOf(bounds: readonly Vec2[], water: readonly Vec2[][]): { land: Vec2[]; holes: Vec2[][] } {
  if (water.length === 0) return { land: [...bounds], holes: [] }
  let sea: MultiPolygon = []
  for (const ring of water) sea = sea.length === 0 ? clip(ring, ring, "union") : clip(sea, ring, "union")
  const parts = clip([...bounds], sea, "difference")
  let best: Vec2[][] | null = null
  for (const p of parts)
    if (p[0] && (!best || Math.abs(area(p[0])) > Math.abs(area(best[0] as Vec2[])))) best = p
  return best ? { land: best[0] as Vec2[], holes: best.slice(1) } : { land: [...bounds], holes: [] }
}

/** Compiles, dresses and clusters a layout. */
export function dress(layout: TownLayout, compiler: Compiler, now = () => performance.now()): Dressed {
  const t0 = now()
  const { compiled, misses } = compiler.compile(layout)
  const t1 = now()
  const dressed = dressTown(layout, compiled)
  const draw = { ...dressed, ground: { ...dressed.ground, ...landOf(layout.bounds, layout.water) } }
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
  // Edges and the uncompiled placements, laid out exactly as the full draw lays them out.
  const loose = dressTown({ ...layout, placements: rest, nature: [] }, new Map()).pieces
  const t2 = now()
  return {
    draw: { ...draw, water: withSea(draw.water, layout.bounds, draw.ground) },
    houses,
    loose,
    plants: plantClusters(plants),
    compiled: misses,
    compileMs: t1 - t0,
    dressMs: t2 - t1,
  }
}
