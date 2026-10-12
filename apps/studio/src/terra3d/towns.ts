/**
 * Step 4 of the terrain-first island in 3D: the districts `terraDistricts` lays out (streets grown off
 * the roads along the contours, buildings from the authored recipes lining them, civic buildings on
 * the squares) turned into batch clusters standing at the ground's height, and the streets and squares
 * as draped ribbons.
 */
import { compilePrefab, type PrefabRecipe, type Recipe, validatePrefab } from "@guildhall/assets"
import { log } from "@guildhall/core"
import type { BatchCluster } from "@guildhall/render"
import {
  districtGround,
  prefabLibrary,
  recipeKey,
  type Terra,
  type TerraPlan,
  terraDistricts,
} from "@guildhall/world"
import type { loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"

const logger = log("studio:terra-towns")

type Catalog = NonNullable<Awaited<ReturnType<typeof loadCatalog>>>

export interface BuiltPlaces {
  /** Compiled buildings, one cluster each (its pieces near, one shell far). */
  clusters: BatchCluster[]
  /** Streets and squares, as [centreline, half width] in world metres (squares: closed, half 0). */
  streets: { line: [number, number][]; half: number }[]
  /** One line per place: what was built. */
  report: string[]
  /** The ground the districts use; the rest of each claim goes to the parcels. */
  ground: Uint8Array
}

async function recipes(catalog: Catalog) {
  const load = async (kind: "recipes/houses" | "recipes/landmarks") => {
    const ids = await data.list(kind)
    return (await Promise.all(ids.map((id) => data.load(kind, id)))).filter(
      (json): json is PrefabRecipe => json !== null && validatePrefab(json).length === 0,
    )
  }
  const all = [...(await load("recipes/houses")), ...(await load("recipes/landmarks"))]
  const compiled = new Map<string, Recipe>()
  for (const r of all)
    try {
      compiled.set(r.id, compilePrefab(r, 0, catalog).recipe)
    } catch (error) {
      logger.warn("recipe skipped", { id: r.id, error: String(error) })
    }
  return { all, compiled }
}

export async function buildPlaces(t: Terra, plan: TerraPlan, catalog: Catalog): Promise<BuiltPlaces> {
  const { all, compiled } = await recipes(catalog)
  const lib = prefabLibrary(all, catalog)
  const d = terraDistricts(t, plan, lib.prefabs)
  const clusters: BatchCluster[] = []
  for (const b of d.buildings) {
    const key = compiled.has(recipeKey(b.prefab, b.seed)) ? recipeKey(b.prefab, b.seed) : b.prefab
    const recipe = compiled.get(key)
    if (!recipe) continue
    clusters.push({
      key,
      parts: recipe.instances,
      x: b.at[0],
      y: b.y - 0.1,
      z: b.at[1],
      rot: b.rot,
      scale: 1,
    })
  }
  const streets: BuiltPlaces["streets"] = [
    ...d.streets.map((s) => ({ line: s.line as [number, number][], half: s.half })),
    ...d.squares.map((sq) => ({ line: [...sq, sq[0]!] as [number, number][], half: 0 })),
  ]
  const report = plan.anchors.map((a, i) => `${a.kind}: ${d.counts[i] ?? 0} buildings`)
  logger.info("districts", { ms: d.ms, buildings: d.buildings.length, streets: d.streets.length })
  return { clusters, streets, report, ground: districtGround(t, d) }
}
