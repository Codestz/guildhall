/**
 * What it costs a road, a track, a trail or a path to cross each cell of the island's GroundGrid
 * (ADR 012): one function, four tables, nothing else differs between the classes. Water is never
 * crossed, a settlement's built frame only through its exits, rough ground, the shore band, woods and
 * fields cost more, and the network already built costs less, so later routes run along earlier ones
 * and branch off them. M4 adds slope through the router's `step` hook, not here.
 */
import { dist } from "../geom/vec.ts"
import { GROUND_KINDS, type GroundGrid, type RoadClass, type RoadNetwork } from "./types.ts"

/** In this order: `Occupancy.use` stores the index. */
export const OCCUPANTS = ["free", "frame", "field", "pad"] as const
export type Occupant = (typeof OCCUPANTS)[number]

/** What already stands on the land, per GroundGrid cell (same w × h, row-major). */
export interface Occupancy {
  /** Index into `OCCUPANTS`, per cell. */
  use: Uint8Array
  /** Forest cover per cell, 0 (open) to 1 (closed wood); absent = no woods. */
  wood?: Float32Array
}

/** Multipliers on a cell's base cost of 1 (Infinity: never crossed). */
export interface CostTable {
  shore: number
  rough: number
  /** At full cover; the factor is 1 + wood · cover. */
  wood: number
  field: number
  /** On the network already built: replaces everything above (water stays impassable). */
  road: number
}

export const COSTS: Readonly<Record<RoadClass, CostTable>> = {
  road: { shore: 2, rough: 3, wood: 2.5, field: 6, road: 0.3 },
  track: { shore: 1.5, rough: 2, wood: 1, field: 6, road: 0.4 },
  trail: { shore: 1.2, rough: 1.5, wood: 0.2, field: 6, road: 0.5 },
  path: { shore: 1, rough: 1.5, wood: 0.2, field: 6, road: 0.5 },
}

const SEA = GROUND_KINDS.indexOf("sea")
const LAKE = GROUND_KINDS.indexOf("lake")
const SHORE = GROUND_KINDS.indexOf("shore")
const ROUGH = GROUND_KINDS.indexOf("rough")
const FRAME = OCCUPANTS.indexOf("frame")
const FIELD = OCCUPANTS.indexOf("field")
const PAD = OCCUPANTS.indexOf("pad")

/**
 * The cost per metre of each ground cell for `cls`, for gridAStar (`{ w, h, cost, cell, origin }` of
 * the ground). Edges that walk on water (piers, boat lanes) are not road; an `exit` node's cell is
 * open even inside its frame, so routes leave a settlement by its gates.
 */
export function costField(
  ground: GroundGrid,
  cls: RoadClass,
  occupancy: Occupancy | null,
  network?: RoadNetwork,
): Float32Array {
  const t = COSTS[cls]
  const { w, h, kind } = ground
  const cost = new Float32Array(w * h)
  const use = occupancy?.use
  const wood = occupancy?.wood
  const isWater = (i: number) => kind[i] === SEA || kind[i] === LAKE
  // A cell touching water (a lake's edge as much as the coast) costs what the shore band does, so a
  // route keeps a cell's clearance from the water and its rounded corners never brush it.
  const waterside = (i: number): boolean => {
    const x = i % w
    const z = (i - x) / w
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const nz = z + dz
        if (nx >= 0 && nz >= 0 && nx < w && nz < h && isWater(nz * w + nx)) return true
      }
    return false
  }
  for (let i = 0; i < w * h; i++) {
    const k = kind[i] as number
    const u = use ? (use[i] as number) : 0
    if (k === SEA || k === LAKE || u === FRAME || u === PAD) {
      cost[i] = Number.POSITIVE_INFINITY
      continue
    }
    let c = k === SHORE || waterside(i) ? t.shore : k === ROUGH ? t.rough : 1
    if (wood) c *= 1 + t.wood * (wood[i] as number)
    if (u === FIELD) c *= t.field
    cost[i] = c
  }
  if (!network) return cost

  const cellOf = (x: number, z: number): number => {
    const cx = Math.floor((x - ground.origin[0]) / ground.cell)
    const cz = Math.floor((z - ground.origin[1]) / ground.cell)
    return cx < 0 || cz < 0 || cx >= w || cz >= h ? -1 : cz * w + cx
  }
  for (const e of network.edges) {
    if (e.walk === "pier" || e.walk === "boat-lane") continue
    // A quarter-cell walk along each segment: every cell the line enters, 8-connected throughout.
    for (let s = 1; s < e.points.length; s++) {
      const a = e.points[s - 1]
      const b = e.points[s]
      if (!a || !b) continue
      const n = Math.max(1, Math.ceil((4 * dist(a, b)) / ground.cell))
      for (let q = 0; q <= n; q++) {
        const i = cellOf(a[0] + ((b[0] - a[0]) * q) / n, a[1] + ((b[1] - a[1]) * q) / n)
        if (i >= 0 && !isWater(i)) cost[i] = t.road
      }
    }
  }
  for (const node of network.nodes) {
    if (node.kind !== "exit") continue
    const i = cellOf(node.at[0], node.at[1])
    if (i >= 0 && !isWater(i) && !Number.isFinite(cost[i] as number)) cost[i] = 1
  }
  return cost
}
