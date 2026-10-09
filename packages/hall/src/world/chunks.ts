import { cellAt, key, unkey } from "./gen/hex.ts"
import { type Cell, cellToWorld } from "./lands.ts"
import type { Spot } from "./layout.ts"
import type { World } from "./world.ts"

/**
 * The island cut into regions (research world-gen-v2 §5.2, P0): what the renderer swaps between
 * detail tiers and culls as one. A repo island's regions are its districts, a district of more than
 * SPLIT hexes cut into pieces of about 50–SPLIT by k-means over its hexes; the hand map, which has
 * no districts, is cut the same way as one. Every land hex is in exactly one region; anything off
 * the land (the sea's tiles, a rock in the shallows) belongs to the region whose centre is nearest.
 * Pure and deterministic: the same world always cuts the same way.
 */

/** A district bigger than this many hexes is cut into regions of at most about this size. */
export const SPLIT = 96
/** Lloyd steps for a district's cut: enough for hex-sized regions to settle. */
const STEPS = 8
/** A hex's circumradius, world units: a region's bounds reach its hexes' corners. */
const HEX_RADIUS = 10 / Math.sqrt(3)

export interface Chunk {
  /** Its land hexes (a region is a set of whole hexes: its cuts run along hex edges). */
  cells: readonly Cell[]
  /** Its land's centre, world units. */
  centre: Spot
  /** From the centre to the corner of its furthest hex, world units. */
  radius: number
  /** Land hexes it holds. */
  hexes: number
}

export interface Chunks {
  readonly list: readonly Chunk[]
  /** The region a world point belongs to (its hex's, else the nearest centre's). */
  at(x: number, z: number): number
}

const cut = new WeakMap<World, Chunks>()

/** The world's regions, cut once per world. */
export function chunksOf(world: World): Chunks {
  let chunks = cut.get(world)
  if (!chunks) {
    chunks = chunk(world)
    cut.set(world, chunks)
  }
  return chunks
}

function chunk(world: World): Chunks {
  const { terrain } = world
  const groups = new Map<number, Cell[]>()
  for (const id of [...terrain.cells()].sort()) {
    const cell = unkey(id)
    if (terrain.at(cell) === "~") continue
    const group = terrain.district?.(cell) ?? 0
    const cells = groups.get(group)
    if (cells) cells.push(cell)
    else groups.set(group, [cell])
  }
  const regionOf = new Map<string, number>()
  const list: Chunk[] = []
  for (const group of [...groups.keys()].sort((a, b) => a - b))
    for (const region of split(groups.get(group) ?? [])) {
      const index = list.length
      for (const cell of region) regionOf.set(key(cell), index)
      list.push(boundsOf(region))
    }
  const nearest = (x: number, z: number): number => {
    let best = 0
    let distance = Number.POSITIVE_INFINITY
    list.forEach((chunk, i) => {
      const d = Math.hypot(chunk.centre[0] - x, chunk.centre[1] - z)
      if (d < distance) {
        distance = d
        best = i
      }
    })
    return best
  }
  return { list, at: (x, z) => regionOf.get(key(cellAt([x, z]))) ?? nearest(x, z) }
}

/** A district's hexes in regions of at most about SPLIT (k-means, seeded by farthest points). */
export function split(cells: readonly Cell[]): Cell[][] {
  if (cells.length <= SPLIT) return cells.length ? [[...cells]] : []
  const points = cells.map((cell) => cellToWorld(cell))
  const k = Math.ceil(cells.length / SPLIT)
  // Farthest-point seeds from the first hex: spread, and the same every time.
  const centres: Spot[] = [points[0] ?? [0, 0]]
  while (centres.length < k) {
    let far = 0
    let farthest = -1
    points.forEach(([x, z], i) => {
      const d = Math.min(...centres.map(([cx, cz]) => Math.hypot(cx - x, cz - z)))
      if (d > farthest) {
        farthest = d
        far = i
      }
    })
    centres.push(points[far] ?? [0, 0])
  }
  let owner = assign(points, centres)
  for (let step = 0; step < STEPS; step++) {
    const sums = centres.map(() => [0, 0, 0])
    points.forEach(([x, z], i) => {
      const sum = sums[owner[i] ?? 0] as number[]
      sum[0] = (sum[0] ?? 0) + x
      sum[1] = (sum[1] ?? 0) + z
      sum[2] = (sum[2] ?? 0) + 1
    })
    sums.forEach(([x = 0, z = 0, n = 0], c) => {
      if (n > 0) centres[c] = [x / n, z / n]
    })
    owner = assign(points, centres)
  }
  return centres.map((_, c) => cells.filter((_, i) => owner[i] === c)).filter((region) => region.length)
}

/** Each point's nearest centre (the lowest on a tie). */
function assign(points: readonly Spot[], centres: readonly Spot[]): number[] {
  return points.map(([x, z]) => {
    let best = 0
    let distance = Number.POSITIVE_INFINITY
    centres.forEach(([cx, cz], c) => {
      const d = Math.hypot(cx - x, cz - z)
      if (d < distance) {
        distance = d
        best = c
      }
    })
    return best
  })
}

function boundsOf(cells: readonly Cell[]): Chunk {
  const points = cells.map((cell) => cellToWorld(cell))
  const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length
  const cz = points.reduce((sum, [, z]) => sum + z, 0) / points.length
  const radius = Math.max(...points.map(([x, z]) => Math.hypot(x - cx, z - cz))) + HEX_RADIUS
  return { cells, centre: [cx, cz], radius, hexes: cells.length }
}
