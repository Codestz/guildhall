import { type Cell, cellToWorld } from "../lands.ts"
import type { Biome } from "./biomes.ts"
import { rng, unkey } from "./hex.ts"
import { smoothCoast } from "./plan/coast.ts"
import { groundOf, placeSites } from "./plan/ground.ts"
import { type Form, GATE, HUB, QUAY, RESERVED, RING } from "./plan/keep.ts"
import { layRoads } from "./plan/roads.ts"
import { growSectors } from "./plan/sectors.ts"
import type { Folder, RepoShape } from "./repo.ts"

export { HUB, KEEP } from "./plan/keep.ts"

/**
 * An island planned from a repo's shape, before any tile is chosen: which hex is land, which
 * district holds it, and what grows there, written in lands.ts' own MAP legend (~ sea, = road,
 * . meadow, f/F woods, h knoll, H foothill, m/M mountain, w/d fields, v village lot, s site ground)
 * so the adapter (dress.ts) can tile it exactly the way lands.ts tiles the hand-drawn map.
 *
 * The keep stands at the origin with the harbour (the root's own files) south of its gate, its
 * block and the ring round it reserved (plan/keep.ts). Then, in order:
 *   sectors   the folders round the hub, each grown from its square into one piece (plan/sectors.ts)
 *   roads     hub → every square, reusing what's laid (plan/roads.ts)
 *   coast     smoothed until the coast tiles can draw every hex (plan/coast.ts)
 *   ground    a landmark site per district, elevation, and each biome's ground (plan/ground.ts)
 */

export interface PlanDistrict {
  folder: Folder
  biome: Biome
  /** Hexes it was meant to grow to (quotaOf, or gen/scale.ts' share of the island's land). */
  quota: number
  /** Where its road ends. */
  square: Cell
  /** Its landmark's hex, beside the square (none if the shore left no room). */
  site?: Cell
  /** Land hexes it holds in the end (road hexes included). */
  hexes: number
  /** Elevation from its folder depth: 0 level, 1 foothills, 2 mountains. */
  level: 0 | 1 | 2
  /** 0–1: how built-up or wooded its hexes are, from files per hex. */
  density: number
}

export interface PlanHex {
  char: string
  district: number
}

export interface IslandPlan {
  hash: number
  seed: number
  /** Every land hex by key ("q,line"). Anything missing is sea. */
  land: Map<string, PlanHex>
  /** [0] is the harbour (the root), then the folders in RepoShape order. */
  districts: PlanDistrict[]
  /** The avenue (hub → the gate's apron), then hub → each square, hex by hex; consecutive hexes are neighbours. */
  roads: Cell[][]
  /** The hub, and the sea hex its quay runs out over (straight south). */
  hub: Cell
  quay: Cell
  /** The road hex at the keep's gate: drawn, opening south onto the avenue, not walked (lands.ts' [0, 2] stub). */
  gate: Cell
  /** Rings from the hub that hold all the land. */
  radius: number
}

/** Land ∝ code size, log-scaled: 1 KB ≈ 7 hexes, 100 KB ≈ 25, 10 MB ≈ 47. */
export function quotaOf(bytes: number): number {
  return Math.round(4 + 3.2 * Math.log2(1 + bytes / 1024))
}

function levelOf(folder: Folder): 0 | 1 | 2 {
  if (folder.biome === "harbour") return 0
  const base = folder.depth < 1.6 ? 0 : folder.depth < 3 ? 1 : 2
  if (folder.biome === "quarry") return Math.min(2, base + 1) as 1 | 2
  if (folder.biome === "library") return Math.max(1, base) as 1 | 2
  return base
}

/**
 * How far the land may reach from the origin along x or z, world units: the shore's distance bake
 * covers ±120 (scene/nature/shore.ts SHORE.half), and a coast tile's sand runs to its hex's edge.
 */
export const LAND_HALF = 118
/** Each try shrinks every district's land by this much until the island fits. */
const SHRINK = 0.85
/** The smallest share of its land a district is shrunk to (a giant monorepo still gets an island). */
const SMALLEST = 0.3

/** How far a plan's land reaches along x or z, to its hexes' edges. */
export function extentOf(plan: IslandPlan): number {
  let extent = 0
  for (const id of plan.land.keys()) {
    const [x, z] = cellToWorld(unkey(id))
    extent = Math.max(extent, Math.abs(x) + HEX_RADIUS, Math.abs(z) + HEX_APOTHEM)
  }
  return extent
}
const HEX_RADIUS = 10 / Math.sqrt(3)
const HEX_APOTHEM = 5

/** The island for a repo's shape (generator v1), its land shrunk until it fits inside ±LAND_HALF. */
export function fitIsland(shape: RepoShape, seed: number): IslandPlan {
  const quotas = quotasOf([shape.root, ...shape.folders])
  let plan = planIsland(shape, seed, quotas)
  for (let scale = SHRINK; extentOf(plan) > LAND_HALF && scale >= SMALLEST; scale *= SHRINK)
    plan = planIsland(
      shape,
      seed,
      quotas.map((quota) => quota * scale),
    )
  return plan
}

/** A workspace's land: its whole size's quota times this, shared among its packages ∝ their own. */
const TOWN = 2

/** Each district's quota before scaling: its own, or its share of its workspace's. */
function quotasOf(folders: readonly Folder[]): number[] {
  const groups = new Map<string, { bytes: number; own: number }>()
  for (const folder of folders) {
    if (folder.group === undefined) continue
    const group = groups.get(folder.group) ?? { bytes: 0, own: 0 }
    group.bytes += folder.bytes
    group.own += quotaOf(folder.bytes)
    groups.set(folder.group, group)
  }
  return folders.map((folder) => {
    const group = folder.group === undefined ? undefined : groups.get(folder.group)
    if (!group) return quotaOf(folder.bytes)
    return (quotaOf(group.bytes) * TOWN * quotaOf(folder.bytes)) / group.own
  })
}

/**
 * The island for a repo's shape, each district (the root first, then its folders) grown to its
 * quota: freely round the hub (v1), or inside the outline `formOf` draws for the island's land.
 */
export function planIsland(
  shape: RepoShape,
  seed: number,
  quotas: readonly number[],
  formOf?: (land: number) => Form,
): IslandPlan {
  const districts: PlanDistrict[] = [shape.root, ...shape.folders].map((folder, i) => {
    const own = Math.max(3, Math.round(quotas[i] ?? 0))
    const quota = i === 0 ? Math.max(7, own) : own
    return {
      folder,
      biome: folder.biome,
      quota,
      square: HUB,
      hexes: 0,
      level: levelOf(folder),
      density: Math.min(0.85, Math.max(0.15, Math.log2(1 + folder.files / quota) / 4)),
    }
  })
  const form = formOf?.(districts.reduce((sum, district) => sum + district.quota, RESERVED.size)) ?? RING
  const { owner, heads, radius: searched } = growSectors(districts, seed, rng(seed), form)
  const { road, roads } = layRoads(districts, owner, heads, searched, form)
  const radius = smoothCoast(owner, road, form)
  const sites = placeSites(districts, owner, road, seed)
  const land = groundOf(districts, owner, road, sites, seed)
  return { hash: shape.hash, seed, land, districts, roads, hub: HUB, quay: QUAY, gate: GATE, radius }
}
