import { type Cell, cellToWorld, type LandPlacement } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { housesOf, instantiate, type Prefab, prefab } from "../../prefabs/index.ts"
import { key, neighbours, noise, step, unkey } from "../hex.ts"
import { tierOf } from "../plan/tier.ts"
import type { IslandPlan } from "../plan.ts"
import { facing } from "./sites.ts"

/**
 * Generator v2's towns (world-gen v2 §3.1, slice 4a): each village district gets a paved plaza where
 * its road ends (a well, and market stalls from Town up), and its `v` lots are filled from the prefab
 * catalogue, each turned to its street: one home at the district's edge, two in the middle, three in
 * its core. Pure and deterministic, like the plan it reads.
 */

export interface Lot {
  prefab: Prefab
  /** The way its front faces: its nearest road hex, else its square. */
  rot: number
}

export interface Town {
  /** The prefab to stand on each `v` hex, by key. */
  lots: Map<string, Lot>
  /** The plazas' dressing, level ground. */
  plazas: LandPlacement[]
}

/** Lots within this many units of the square are its core (three homes); within CORE + MID, two. */
const CORE = 17
const MID = 17
/** How far a plaza's well stands off its hex's centre, off the road's own line. */
const OFF_ROAD = 2.4

/** Districts that are a town: the harbour's lots round the hub and every village-biome district's. */
const isTown = (biome: string): boolean => biome === "village" || biome === "harbour"

export function townOf(plan: IslandPlan, links: Map<string, Set<number>>): Town {
  const tier = tierOf(plan.districts.reduce((sum, d) => sum + d.folder.files, 0))
  const lots = new Map<string, Lot>()
  const plazas: LandPlacement[] = []
  const hasRoad = (cell: Cell): boolean => plan.land.get(key(cell))?.char === "="

  plan.districts.forEach((district, i) => {
    if (!isTown(district.biome)) return
    const square = district.square
    const [sx, sz] = cellToWorld(square)
    if (i > 0) paveSquare(plan, links, square)

    const cells = [...plan.land]
      .filter(([, hex]) => hex.district === i && hex.char === "v")
      .map(([id]) => unkey(id))
      .sort((a, b) => dist(a, sx, sz) - dist(b, sx, sz) || a[0] - b[0] || a[1] - b[1])
    cells.forEach((cell, n) => {
      const id = key(cell)
      const d = dist(cell, sx, sz)
      const count = d <= CORE ? 3 : d <= CORE + MID ? 2 : 1
      const road = neighbours(cell).find(hasRoad)
      const farm = neighbours(cell).some((next) => "wd".includes(plan.land.get(key(next))?.char ?? " "))
      const houses = farm && count === 1 ? [prefab("house-farmhouse")] : housesOf(capped(count, tier, d))
      const pick =
        houses[Math.floor(noise(plan.seed, cell, "lot") * houses.length)] ?? prefab("house-cottage")
      // Town and up: the lot nearest the plaza is the market's.
      const market = n === 0 && tier !== "hamlet" && tier !== "village" && i > 0
      const [cx, cz] = cellToWorld(cell)
      const look: Spot = road ? cellToWorld(road) : [sx, sz]
      lots.set(id, { prefab: market ? prefab("market-stalls") : pick, rot: facing([cx, cz], look) })
    })

    if (i > 0) {
      const free = [0, 1, 2, 3, 4, 5].filter(
        (dir) => !hasRoad(step(square, dir)) && plan.land.has(key(step(square, dir))),
      )
      const dir = free[Math.floor(noise(plan.seed, square, "plaza") * free.length)]
      const angle = dir === undefined ? 0 : Math.atan2(...(offset(square, dir) as [number, number]))
      const at: [number, number] = [sx + Math.sin(angle) * OFF_ROAD, sz + Math.cos(angle) * OFF_ROAD]
      plazas.push(...instantiate(prefab("plaza-well"), at, 0, "blue"))
    }
  })
  return { lots, plazas }
}

/** A hamlet's lots are cottages and a pair at most; a village's never three outside its core. */
function capped(count: number, tier: string, distance: number): 1 | 2 | 3 {
  const most = tier === "hamlet" ? 2 : tier === "village" && distance > CORE ? 2 : 3
  return Math.min(count, most) as 1 | 2 | 3
}

const dist = (cell: Cell, x: number, z: number): number => {
  const [cx, cz] = cellToWorld(cell)
  return Math.hypot(cx - x, cz - z)
}

/** The offset (dx, dz) from a hex to its neighbour in a direction. */
function offset(cell: Cell, dir: number): [number, number] {
  const [x, z] = cellToWorld(cell)
  const [nx, nz] = cellToWorld(step(cell, dir))
  return [nx - x, nz - z]
}

/** The square's road tile opens onto every land neighbour (the road hexes already open back): a paved plaza. */
function paveSquare(plan: IslandPlan, links: Map<string, Set<number>>, square: Cell): void {
  const edges = links.get(key(square)) ?? new Set<number>()
  for (let dir = 0; dir < 6; dir++) if (plan.land.has(key(step(square, dir)))) edges.add(dir)
  links.set(key(square), edges)
}
