import type { Spot } from "../../layout.ts"
import type { Massif } from "./field.ts"
import type { Relief } from "./index.ts"
import { pointOf } from "./lattice.ts"
import { strideOf } from "./style.ts"
import { carve, settle } from "./trailCarve.ts"
import { distance, footOf, goalNear, headsOf, latticeOf } from "./trailGround.ts"
import { type Found, type Head, ijOf, LAID, type Lattice, reach, SLOPE, STAIR } from "./trailSearch.ts"

/**
 * The trails (terrain v2 §3.2, slice 2c): each big massif gets one to three, from a road at its foot
 * up to a lookout on a summit or a pass between its peaks. A trail is found on the massif's lattice
 * (trailSearch.ts), carved into its relief as a shelf (trailCarve.ts) and joined to the island's
 * walking graph: its nodes `T<massif>.<trail>.<i>` lie on the lattice vertices, the first joined to
 * the road node at the foot, and an edge costs its length in 3D over the grade (walkers ask
 * `heightAt` for the rest). Trails never share a vertex. Pure and deterministic; `trailsOf` carves
 * the relief in place, after the rivers have (a trail never touches a river's hexes).
 */

/** Massifs smaller than this (hexes, units of height) have no trail worth walking. */
const MIN_CELLS = 3
const MIN_HEIGHT = 8
/** Two trails start at least this far apart, and two lookouts stand at least twice as far. */
const APART = 12

export type TrailKind = "summit" | "pass"

export interface Trail {
  /** "T<massif>.<n>". */
  id: string
  massif: number
  kind: TrailKind
  /** The road node it leaves, then its own nodes up to the lookout. */
  nodes: readonly string[]
  /** How many of its legs are steps (steeper than a walking trail). */
  stairs: number
}

/** Where a trail ends: the cairn and flag stand here, on a flat pad. */
export interface Lookout {
  /** "<trail>#lookout". */
  id: string
  kind: TrailKind
  at: Spot
  /** The ground there. */
  y: number
  /** Turned to face the way the trail comes up. */
  rot: number
  /** The trail's last node: where a walker goes to stand at it. */
  node: string
}

export interface TrailNet {
  trails: Trail[]
  lookouts: Lookout[]
  /** The walking graph's additions: the trails' nodes, the edges joining them, and each edge's cost. */
  nodes: Record<string, Spot>
  edges: [string, string][]
  costs: number[]
}

interface Roads {
  nodes: Readonly<Record<string, Spot>>
  edges: readonly (readonly [string, string])[]
}

interface Want {
  kind: TrailKind
  target: Spot
  prefer: "high" | "near"
}

/** What a massif's trails are after: its summit; the main range also its highest pass, and its second peak. */
function wants(massif: Massif): Want[] {
  const peak = massif.peaks[0]
  if (!peak) return []
  const list: Want[] = [{ kind: "summit", target: peak.at, prefer: "high" }]
  if (massif.id !== 0) return list
  const far = (spot: Spot): boolean => list.every((want) => distance(want.target, spot) > 2 * APART)
  const saddle = [...massif.saddles].sort((a, b) => b.height - a.height).find((s) => far(s.at))
  if (saddle) list.push({ kind: "pass", target: saddle.at, prefer: "near" })
  const second = massif.peaks.slice(1).find((p) => far(p.at))
  if (second) list.push({ kind: "summit", target: second.at, prefer: "high" })
  return list
}

/**
 * The way to a want: the cheapest trail from the open trailheads. A trail may pass over itself at
 * another height (a spiral stair), which a carve can't hold: the vertices it crosses are shut and
 * it is found again, a few times.
 */
function route(lat: Lattice, open: readonly Head[], used: Uint8Array, want: Want): Found | undefined {
  const shut = Uint8Array.from(used)
  for (let attempt = 0; attempt < 14; attempt++) {
    const reached = reach(lat, open, shut)
    const end = goalNear(lat, reached, shut, want.target, want.prefer)
    const found = end === undefined ? undefined : reached.path(end)
    if (!found) return undefined
    const again = found.chain.filter((v, k) => found.chain.indexOf(v) !== k)
    if (again.length === 0) return found
    for (const v of again) shut[v] = LAID
  }
  return undefined
}

/** The heights a found chain is carved at: the rim as it is, no leg past the steepest grade. */
function profile(
  massif: Massif,
  chain: readonly number[],
  spots: readonly Spot[],
  found: number[],
): number[] {
  const heights = [...found]
  heights[0] = massif.grid.data[chain[0] as number] as number
  for (let k = 1; k < heights.length; k++) {
    const room = STAIR * distance(spots[k - 1] as Spot, spots[k] as Spot)
    const before = heights[k - 1] as number
    heights[k] = Math.min(before + room, Math.max(before - room, heights[k] as number))
  }
  return heights
}

/** The chain's positions that turn back on themselves (120° or more): they get a landing. */
function hairpinsOf(spots: readonly Spot[]): number[] {
  const out: number[] = []
  for (let k = 1; k + 1 < spots.length; k++) {
    const a = spots[k - 1] as Spot
    const b = spots[k] as Spot
    const c = spots[k + 1] as Spot
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
    if (dot / (distance(a, b) * distance(b, c)) <= -0.49) out.push(k)
  }
  return out
}

/** The island's trails; carves them into the relief. `river`: the keys of the hexes rivers run through. */
export function trailsOf(relief: Relief, roads: Roads, river: ReadonlySet<string> = new Set()): TrailNet {
  const net: TrailNet = { trails: [], lookouts: [], nodes: {}, edges: [], costs: [] }
  const stride = strideOf(relief.style)
  const feet = footOf(relief, roads.nodes)
  for (const massif of relief.massifs) {
    if (massif.cells.length < MIN_CELLS || massif.height < MIN_HEIGHT) continue
    const lat = latticeOf(massif, stride, river)
    const { grid } = massif
    const { heads, roadOf } = headsOf(lat, feet)
    const used = new Uint8Array(grid.data.length)
    const changed = new Set<number>()
    const taken: Spot[] = []
    let made = 0
    for (const want of heads.length > 0 ? wants(massif) : []) {
      const open = heads.filter((head) => {
        const [i, j] = ijOf(grid, head.at)
        return taken.every((spot) => distance(spot, pointOf(i, j)) >= APART)
      })
      if (open.length === 0) continue
      const found = route(lat, open, used, want)
      if (!found || found.chain.length < 4) continue
      const { chain } = found
      const spots = chain.map((v) => pointOf(...ijOf(grid, v)))
      const heights = profile(massif, chain, spots, found.heights)
      taken.push(spots[0] as Spot)
      for (const v of carve(massif, lat, { chain, heights, hairpins: hairpinsOf(spots) }, true)) {
        lat.ground[v] = grid.data[v] as number
        used[v] = LAID
        changed.add(v)
      }
      const id = `T${massif.id}.${made++}`
      const road = roadOf.get(chain[0] as number) as string
      const names = chain.map((_, k) => `${id}.${k}`)
      // The trailhead's node stands a step inside the rim, where the massif's ground (not the lowland's) is read.
      const [x0, z0] = spots[0] as Spot
      const [x1, z1] = spots[1] as Spot
      const nodes = [[x0 + (x1 - x0) * 0.1, z0 + (z1 - z0) * 0.1] as Spot, ...spots.slice(1)]
      let stairs = 0
      names.forEach((name, k) => {
        const from = k === 0 ? road : (names[k - 1] as string)
        const a = k === 0 ? (roads.nodes[road] as Spot) : (nodes[k - 1] as Spot)
        const run = distance(a, nodes[k] as Spot)
        const rise = k === 0 ? 0 : Math.abs((heights[k] as number) - (heights[k - 1] as number))
        const grade = run > 0 ? rise / run : 0
        if (grade > SLOPE) stairs++
        net.nodes[name] = nodes[k] as Spot
        net.edges.push([from, name])
        net.costs.push(Math.hypot(run, rise) * (1 + 2 * grade) * (grade > SLOPE ? 1.4 : 1))
      })
      const last = chain.length - 1
      const back = spots[last - 1] as Spot
      const top = spots[last] as Spot
      net.trails.push({ id, massif: massif.id, kind: want.kind, nodes: [road, ...names], stairs })
      net.lookouts.push({
        id: `${id}#lookout`,
        kind: want.kind,
        at: top,
        y: Math.round((heights[last] as number) * 100) / 100,
        rot: Math.round(Math.atan2(back[0] - top[0], back[1] - top[1]) * 100) / 100,
        node: names[last] as string,
      })
    }
    if (changed.size > 0) settle(massif, lat, massif.cells, changed, river)
  }
  return net
}

/** The island's walking graph with the trails joined to it (each road edge costs its length, as it did). */
export function joinRoads(roads: Roads, net: TrailNet): Roads & { costs: number[] } {
  const length = (a: string, b: string): number =>
    distance(roads.nodes[a] ?? [0, 0], roads.nodes[b] ?? [0, 0])
  return {
    nodes: { ...roads.nodes, ...net.nodes },
    edges: [...roads.edges, ...net.edges],
    costs: [...roads.edges.map(([a, b]) => length(a, b)), ...net.costs],
  }
}
