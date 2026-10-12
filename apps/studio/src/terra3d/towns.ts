/**
 * Step 4 of the terrain-first island in 3D: the districts `terraDistricts` lays out (streets grown off
 * the roads along the contours, buildings from the authored recipes lining them, civic buildings on
 * the squares) turned into batch clusters standing at the ground's height, and the streets and squares
 * as draped ribbons.
 */
import { compilePrefab, type PrefabRecipe, type Recipe, validatePrefab } from "@guildhall/assets"
import { log } from "@guildhall/core"
import type { BatchCluster, BatchInstance } from "@guildhall/render"
import {
  districtGround,
  prefabLibrary,
  recipeKey,
  type Terra,
  type TerraLandmark,
  type TerraPlan,
  terraDistricts,
  terraLandmarks,
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
  /** The old town's cobbled streets and square, the same way. */
  paved: { line: [number, number][]; half: number }[]
  /** The old town (roads inside it are cobbled too). */
  core: { at: [number, number]; r: number } | null
  /** Gatehouses: gate, walls and towers as pieces. */
  pieces: BatchInstance[]
  /** One line per place: what was built. */
  report: string[]
  /** The ground the districts and landmarks use; the rest of each claim goes to the parcels. */
  ground: Uint8Array
  landmarks: TerraLandmark[]
}

async function recipes(catalog: Catalog) {
  const load = async (kind: "recipes/houses" | "recipes/landmarks" | "recipes/vignettes") => {
    const ids = await data.list(kind)
    return (await Promise.all(ids.map((id) => data.load(kind, id)))).filter(
      (json): json is PrefabRecipe => json !== null && validatePrefab(json).length === 0,
    )
  }
  const all = [
    ...(await load("recipes/houses")),
    ...(await load("recipes/landmarks")),
    ...(await load("recipes/vignettes")),
  ]
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
  const streets: BuiltPlaces["streets"] = d.streets
    .filter((s) => !s.paved)
    .map((s) => ({ line: s.line as [number, number][], half: s.half }))
  const paved: BuiltPlaces["paved"] = [
    ...d.streets.filter((s) => s.paved).map((s) => ({ line: s.line as [number, number][], half: s.half })),
    ...d.squares.map((sq) => ({ line: [...sq, sq[0]!] as [number, number][], half: 0 })),
  ]
  // a gatehouse: the gate over the road, two wall lengths and a tower either side
  const pieces: BatchInstance[] = []
  for (const g of d.gates) {
    const ax = Math.cos(g.rot)
    const az = -Math.sin(g.rot)
    const put = (piece: string, off: number) =>
      pieces.push({ piece, x: g.at[0] + ax * off, y: g.y - 0.1, z: g.at[1] + az * off, rot: g.rot, scale: 1 })
    put("quaternius-castle/wall-entrance", 0)
    for (const side of [-1, 1]) {
      put("quaternius-castle/wall", side * 3.88)
      put("quaternius-castle/wall", side * 7.76)
      put("quaternius-castle/tower", side * 10.6)
    }
  }
  const ground = districtGround(t, d)
  const landmarks = terraLandmarks(t, plan, ground, lib.prefabs)
  for (const l of landmarks) {
    const recipe = compiled.get(l.prefab)
    if (recipe)
      clusters.push({
        key: l.prefab,
        parts: recipe.instances,
        x: l.at[0],
        y: l.y - 0.1,
        z: l.at[1],
        rot: l.rot,
        scale: 1,
      })
  }
  const report = [
    ...plan.anchors.map((a, i) => `${a.kind}: ${d.counts[i] ?? 0} buildings`),
    `landmarks: ${landmarks.map((l) => l.kind).join(", ") || "none"}`,
  ]
  logger.info("districts", { ms: d.ms, buildings: d.buildings.length, streets: d.streets.length })
  return {
    clusters,
    streets,
    paved,
    core: d.core ? { at: [d.core.at[0], d.core.at[1]], r: d.core.r } : null,
    pieces,
    report,
    ground,
    landmarks,
  }
}
