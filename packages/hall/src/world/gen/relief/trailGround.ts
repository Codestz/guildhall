import type { Spot } from "../../layout.ts"
import { cellAt, key, step } from "../hex.ts"
import type { Massif } from "./field.ts"
import type { Relief } from "./index.ts"
import { CORNERS, centreOf, pointOf, RES } from "./lattice.ts"
import { at, type Head, ijOf, LAID, type Lattice, type Reach } from "./trailSearch.ts"

/**
 * What a trail search needs of a massif (trails.ts): the lattice with the ground to climb, the
 * trailheads on its rim, and the vertex nearest a goal that the search reached.
 */

/** A trailhead is a rim vertex this near a road node (world units). */
const HEAD_REACH = 9
/** The lookout stands within these radii of the peak (or saddle), tried in turn. */
const GOAL_RADII = [8, 16, 24] as const
/** Smoothing passes over the ground the search reads, so a ledge's riser is a ramp and a crag's lump is gone. */
const SMOOTH = 3

export const distance = (a: Spot, b: Spot): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/** The rim: every vertex along an edge of the massif that faces a hex outside it. */
function rimOf(massif: Massif): Set<number> {
  const { grid } = massif
  const rim = new Set<number>()
  for (const cell of massif.cells) {
    const [ci, cj] = centreOf(cell)
    for (let d = 0; d < 6; d++) {
      if (massif.keys.has(key(step(cell, d)))) continue
      const [ai, aj] = CORNERS[d] as readonly [number, number]
      const [bi, bj] = CORNERS[(d + 1) % 6] as readonly [number, number]
      for (let a = 0; a <= RES; a++)
        rim.add(grid.index(ci + (RES - a) * ai + a * bi, cj + (RES - a) * aj + a * bj))
    }
  }
  return rim
}

/** Every vertex of the hexes a river runs through: no trail touches them (their beds are fine-cut). */
function wetOf(massif: Massif, river: ReadonlySet<string>): Set<number> {
  const wet = new Set<number>()
  for (const cell of massif.cells) {
    if (!river.has(key(cell))) continue
    const [ci, cj] = centreOf(cell)
    for (let dj = -RES; dj <= RES; dj++)
      for (let di = -RES; di <= RES; di++)
        if (Math.abs(di + dj) <= RES) wet.add(massif.grid.index(ci + di, cj + dj))
  }
  return wet
}

/** The massif's coarse lattice with its ground blurred, the rim and the unowned held. */
export function latticeOf(massif: Massif, stride: number, river: ReadonlySet<string>): Lattice {
  const { grid } = massif
  const rim = rimOf(massif)
  const ground = Float32Array.from(grid.data)
  const coarse: number[] = []
  for (let v = 0; v < ground.length; v++) {
    const [i, j] = ijOf(grid, v)
    if (!Number.isNaN(ground[v] as number) && !rim.has(v) && i % stride === 0 && j % stride === 0)
      coarse.push(v)
  }
  const around = (v: number): number[] =>
    CORNERS.map(([di, dj]) => at(grid, v, di * stride, dj * stride)).filter(
      (n) => n >= 0 && !Number.isNaN(ground[n] as number),
    )
  for (let pass = 0; pass < SMOOTH; pass++) {
    const next = Float32Array.from(ground)
    for (const v of coarse) {
      const near = around(v)
      next[v] =
        ((ground[v] as number) + near.reduce((sum, n) => sum + (ground[n] as number), 0) / near.length) / 2
    }
    ground.set(next)
  }
  let apex = -1
  for (let v = 0; v < grid.data.length; v++)
    if (
      !Number.isNaN(grid.data[v] as number) &&
      (apex < 0 || (grid.data[v] as number) > (grid.data[apex] as number))
    )
      apex = v
  return { grid, stride, ground, apex, rim, blocked: wetOf(massif, river) }
}

/** Road nodes outside every massif: where a trail may start from. */
export function footOf(relief: Relief, nodes: Readonly<Record<string, Spot>>): [string, Spot][] {
  return Object.entries(nodes).filter(([, spot]) => !relief.keys.has(key(cellAt(spot))))
}

/** The trailheads: rim vertices on the lowland, each with the nearest road node (ties by name) it leaves from. */
export function headsOf(
  lat: Lattice,
  feet: readonly (readonly [string, Spot])[],
): { heads: Head[]; roadOf: Map<number, string> } {
  const { grid, stride } = lat
  const heads: Head[] = []
  const roadOf = new Map<number, string>()
  for (const v of lat.rim) {
    const [i, j] = ijOf(grid, v)
    if (i % stride !== 0 || j % stride !== 0 || (grid.data[v] as number) < 0 || lat.blocked.has(v)) continue
    const here = pointOf(i, j)
    let node: string | undefined
    let near = HEAD_REACH
    for (const [name, spot] of feet) {
      const d = distance(spot, here)
      if (d < near || (d === near && node !== undefined && name < node)) {
        near = d
        node = name
      }
    }
    if (node === undefined) continue
    roadOf.set(v, node)
    heads.push({ at: v, cost: near })
  }
  return { heads, roadOf }
}

/**
 * Whether a lookout's pad fits round a vertex: its neighbours are the massif's own, no other trail
 * has been cut over them, and the pad does not take the summit's tip off (the lookout stands beside it).
 */
function padFits(lat: Lattice, used: Uint8Array, v: number): boolean {
  const { grid, stride, ground } = lat
  return (
    v !== lat.apex &&
    CORNERS.every(([di, dj]) => {
      const n = at(grid, v, di * stride, dj * stride)
      return (
        n >= 0 && n !== lat.apex && !Number.isNaN(ground[n] as number) && !lat.rim.has(n) && used[n] !== LAID
      )
    })
  )
}

/**
 * The vertex the search reached nearest a target that a lookout's pad fits on: the highest one
 * within reach of it, or the nearest one.
 */
export function goalNear(
  lat: Lattice,
  reached: Reach,
  used: Uint8Array,
  target: Spot,
  prefer: "high" | "near",
): number | undefined {
  const { grid, ground } = lat
  for (const radius of GOAL_RADII) {
    let best: number | undefined
    for (let v = 0; v < ground.length; v++) {
      if (lat.rim.has(v) || !Number.isFinite(reached.cost(v)) || !padFits(lat, used, v)) continue
      const [i, j] = ijOf(grid, v)
      if (distance(pointOf(i, j), target) > radius) continue
      if (best === undefined) {
        best = v
        continue
      }
      const [bi, bj] = ijOf(grid, best)
      const better =
        prefer === "high"
          ? (ground[v] as number) - (ground[best] as number) || reached.cost(best) - reached.cost(v)
          : distance(pointOf(bi, bj), target) - distance(pointOf(i, j), target)
      if (better > 0) best = v
    }
    if (best !== undefined) return best
  }
  return undefined
}
