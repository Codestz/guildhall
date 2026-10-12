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
  normalizeSpec,
  prefabLibrary,
  recipeKey,
  type Terra,
  type TerraLandmark,
  type TerraPlan,
  type TownLights,
  type TownPlan,
  terraDistricts,
  terraHeightAt,
  terraLandmarks,
  townLights,
} from "@guildhall/world"
import type { loadCatalog } from "../catalog.ts"
import * as data from "../data.ts"

const logger = log("studio:terra-towns")

/** Compiled variants per house recipe. */
const VARIANTS = 6

type Catalog = NonNullable<Awaited<ReturnType<typeof loadCatalog>>>

export interface BuiltPlaces {
  /** Compiled buildings, one cluster each (its pieces near, one shell far). */
  clusters: BatchCluster[]
  /** Each of `buildings`' cluster, or null where its recipe did not compile (same order). */
  byBuilding: (BatchCluster | null)[]
  /** Streets and squares, as [centreline, half width] in world metres (squares: closed, half 0). */
  streets: { line: [number, number][]; half: number }[]
  /** The old town's cobbled streets and square, the same way. */
  paved: { line: [number, number][]; half: number }[]
  /** The old town (roads inside it are cobbled too). */
  core: { at: [number, number]; r: number } | null
  /** Lamp posts and other loose pieces. */
  pieces: BatchInstance[]
  /** Every building the districts and landmarks stood up: recipe, where, facing (for other skins). */
  buildings: { prefab: string; at: [number, number]; rot: number; y: number; landmark: boolean }[]
  /** Lamps and lit windows for the night, standing on the ground. */
  lights: TownLights
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
  // the castle takes its hill before the town spreads
  const reserved = new Uint8Array(t.w * t.h)
  const castle = terraLandmarks(t, plan, reserved, lib.prefabs, ["castle"])
  const d = terraDistricts(t, plan, lib.prefabs, reserved)
  const clusters: BatchCluster[] = []
  const byBuilding: (BatchCluster | null)[] = []
  const byId = new Map(all.map((r) => [r.id, r]))
  for (const b of d.buildings) {
    // a few variants per recipe (roof and wall colours, details), so neighbours differ
    const v = b.seed % VARIANTS
    const key = recipeKey(b.prefab, v)
    if (!compiled.has(key)) {
      const r = byId.get(b.prefab)
      try {
        if (r) compiled.set(key, compilePrefab(r, v, catalog).recipe)
      } catch (error) {
        logger.warn("variant skipped", { key, error: String(error) })
      }
    }
    const recipe = compiled.get(key) ?? compiled.get(b.prefab)
    if (!recipe) {
      byBuilding.push(null)
      continue
    }
    const cluster = {
      key,
      parts: recipe.instances,
      x: b.at[0],
      y: b.y - 0.1,
      z: b.at[1],
      rot: b.rot,
      scale: 1,
    }
    clusters.push(cluster)
    byBuilding.push(cluster)
  }
  const streets: BuiltPlaces["streets"] = d.streets
    .filter((s) => !s.paved)
    .map((s) => ({ line: s.line as [number, number][], half: s.half }))
  const paved: BuiltPlaces["paved"] = [
    ...d.streets.filter((s) => s.paved).map((s) => ({ line: s.line as [number, number][], half: s.half })),
    ...d.squares.map((sq) => ({ line: [...sq, sq[0]!] as [number, number][], half: 0 })),
  ]
  const pieces: BatchInstance[] = []
  const ground = districtGround(t, d)
  for (let i = 0; i < ground.length; i++) if (reserved[i]) ground[i] = 1
  const landmarks = [
    ...castle,
    ...terraLandmarks(
      t,
      plan,
      ground,
      lib.prefabs,
      ["watermill", "windmill", "lighthouse", "ruins", "campsite"],
      castle,
    ),
  ]
  for (const l of landmarks) {
    const recipe = compiled.get(l.prefab)
    const cluster = recipe
      ? { key: l.prefab, parts: recipe.instances, x: l.at[0], y: l.y - 0.1, z: l.at[1], rot: l.rot, scale: 1 }
      : null
    if (cluster) clusters.push(cluster)
    byBuilding.push(cluster)
  }
  const report = [
    ...plan.anchors.map((a, i) => `${a.kind}: ${d.counts[i] ?? 0} buildings`),
    `landmarks: ${landmarks.map((l) => l.kind).join(", ") || "none"}`,
  ]
  logger.info("districts", { ms: d.ms, buildings: d.buildings.length, streets: d.streets.length })
  // the night: lamps by the streets and doors, lit windows, worked out as for a town (flat), then
  // each lifted onto the ground under the building or the street it belongs to
  const flat: TownPlan = {
    spec: normalizeSpec({ seed: t.spec.seed, tier: "town", walls: false }),
    bounds: [],
    water: [],
    plazas: d.squares,
    streets: {
      nodes: [],
      edges: d.streets.map((st, id) => ({
        id,
        a: 0,
        b: 0,
        points: st.line,
        cls: st.paved ? ("street" as const) : ("lane" as const),
        width: st.half * 2,
      })),
    },
    blocks: [],
    lots: [],
    placements: d.buildings.map((b) => ({ prefab: b.prefab, seed: b.seed % VARIANTS, at: b.at, rot: b.rot })),
    edges: [],
    fields: [],
    nature: [],
    stations: [],
    hash: "",
  }
  const raw = townLights(flat, compiled, lib)
  const groundUnder = (x: number, z: number): number => {
    let best = Infinity
    let y = terraHeightAt(t, x, z)
    for (const b of d.buildings) {
      const dd = Math.hypot(b.at[0] - x, b.at[1] - z)
      if (dd < 9 && dd < best) {
        best = dd
        y = b.y
      }
    }
    return y
  }
  const lights: TownLights = {
    pieces: raw.pieces.map((p) => ({ ...p, y: p.y + groundUnder(p.x, p.z) })),
    points: raw.points.map((q) => ({
      ...q,
      at: [q.at[0], q.at[1] + groundUnder(q.at[0], q.at[2]), q.at[2]],
    })),
    windows: raw.windows.map((w) => ({
      ...w,
      at: [w.at[0], w.at[1] + groundUnder(w.at[0], w.at[2]), w.at[2]],
    })),
  }
  pieces.push(...lights.pieces)
  return {
    clusters,
    byBuilding,
    lights,
    buildings: [
      ...d.buildings.map((b) => ({
        prefab: b.prefab,
        at: [b.at[0], b.at[1]] as [number, number],
        rot: b.rot,
        y: b.y,
        landmark: false,
      })),
      ...landmarks.map((l) => ({
        prefab: l.prefab,
        at: [l.at[0], l.at[1]] as [number, number],
        rot: l.rot,
        y: l.y,
        landmark: true,
      })),
    ],
    streets,
    paved,
    core: d.core ? { at: [d.core.at[0], d.core.at[1]], r: d.core.r } : null,
    pieces,
    report,
    ground,
    landmarks,
  }
}
