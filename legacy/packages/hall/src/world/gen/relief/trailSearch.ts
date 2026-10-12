import { Heap } from "../heap.ts"
import { CIRCUM, CORNERS, type HeightGrid, RES } from "./lattice.ts"

/**
 * The trail search (terrain v2 §3.2): a Dijkstra over a massif's lattice, every `stride`-th vertex a
 * node and the six lattice neighbours the ways out of it. A trail climbs by its own grade, not the
 * ground's: a state is a vertex and the height the trail stands at there, within a few units of the
 * ground (the shelf is cut or filled to meet it), so a mountain steeper than any trail can be
 * climbed in switchbacks. A move costs its length in 3D, more for the grade, for ground that slopes
 * across it, for the cut or fill it needs, and for a turn; past the steepest grade it is not made
 * at all. Switchbacks are what is left when the grade is capped: nothing scripts them, and the
 * hairpin's price keeps their count down.
 */

/** The grade (rise over run) of a walking trail, 18°; up to STAIR a leg is steps (27°); beyond it nobody climbs. */
export const SLOPE = 0.33
export const STAIR = 0.5
/** Heights a trail stands at come in steps of this, world units: one step is a gentle grade over a lattice step, two a stair's. */
const BAND = 0.72
/** The bands above and below the ground's a trail may stand at (a cut or a fill of up to this many bands). */
const WINDOW = 6
const SPAN = 2 * WINDOW + 1
/** What a turn costs by the angle it makes, in 60° steps (straight, 60°, 120°, back on itself). */
const TURN = [0, 0.5, 3, 8] as const
/** Cost per world unit the shelf is cut into the ground, and filled over it (a fill hangs in the air). */
const CUT = 0.5
const FILL = 1.1
const NONE = 6
/** How many steps back a trail remembers the vertices it has crossed. */
const MEMORY = 30

/** What the search reads: a massif's coarse lattice and the ground to climb. */
export interface Lattice {
  grid: HeightGrid
  stride: number
  /** The ground (a little smoothed), indexed like the grid; NaN where the massif owns nothing. */
  ground: Float32Array
  /** Vertices that may start a trail but not be walked through (the rim), and those no trail may touch (rivers). */
  rim: ReadonlySet<number>
  blocked: ReadonlySet<number>
}

/** A trailhead: a vertex of the lattice, and what it already costs to be there (the walk from the road). */
export interface Head {
  at: number
  cost: number
}

/** A trail found: its lattice vertices from the trailhead, every step a neighbour of the last, and the height at each. */
export interface Found {
  chain: number[]
  heights: number[]
}

export interface Reach {
  /** The cheapest cost to stand at a vertex at the ground's height, Infinity when no trail gets there. */
  cost(vertex: number): number
  path(vertex: number): Found | undefined
}

export const at = (grid: HeightGrid, vertex: number, di: number, dj: number): number => {
  const w = grid.width
  return grid.index(grid.i0 + (vertex % w) + di, grid.j0 + Math.floor(vertex / w) + dj)
}

/** Where a vertex stands in the lattice, (i, j). */
export const ijOf = (grid: HeightGrid, vertex: number): [number, number] => [
  grid.i0 + (vertex % grid.width),
  grid.j0 + Math.floor(vertex / grid.width),
]

/** The steps between two directions, 0–3 (60° each). */
const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b)
  return Math.min(d, 6 - d)
}

/** A lattice's walkable vertices numbered, and what leaves each: worked out once, since the ground only changes at the shelves. */
interface Topology {
  slot: Int32Array
  vertices: number[]
  /** For each slot and direction: the vertex it reaches, -1 where it can't be walked to. */
  next: Int32Array
  /** For each slot and direction: how steeply the ground slopes across the move. */
  across: Float32Array
}

const topologies = new WeakMap<Lattice, Topology>()

function topologyOf(lattice: Lattice): Topology {
  const cached = topologies.get(lattice)
  if (cached) return cached
  const { grid, stride, ground, rim, blocked } = lattice
  const pitch = (CIRCUM / RES) * stride
  const slot = new Int32Array(grid.data.length).fill(-1)
  const vertices: number[] = []
  for (let v = 0; v < slot.length; v++) {
    const [i, j] = ijOf(grid, v)
    if (!Number.isNaN(ground[v] as number) && i % stride === 0 && j % stride === 0) {
      slot[v] = vertices.length
      vertices.push(v)
    }
  }
  const next = new Int32Array(vertices.length * 6).fill(-1)
  const across = new Float32Array(vertices.length * 6)
  vertices.forEach((v, s) => {
    for (let m = 0; m < 6; m++) {
      const [di, dj] = CORNERS[m] as readonly [number, number]
      const w = at(grid, v, di * stride, dj * stride)
      if (w >= 0 && (slot[w] as number) >= 0 && !rim.has(w) && !blocked.has(w)) next[s * 6 + m] = w
      const [ai, aj] = CORNERS[(m + 1) % 6] as readonly [number, number]
      const [bi, bj] = CORNERS[(m + 5) % 6] as readonly [number, number]
      const left = ground[at(grid, v, ai * stride, aj * stride)] as number
      const right = ground[at(grid, v, bi * stride, bj * stride)] as number
      across[s * 6 + m] =
        Number.isNaN(left) || Number.isNaN(right) ? 0.5 : Math.abs(left - right) / (pitch * 1.73)
    }
  })
  const made = { slot, vertices, next, across }
  topologies.set(lattice, made)
  return made
}

/** Vertices another trail was carved over: a new trail does not touch them. */
export const LAID = 2

/** The cheapest ways from the trailheads to every vertex of the lattice, none of them over the vertices `used` marks LAID. */
export function reach(lattice: Lattice, heads: readonly Head[], used?: Uint8Array): Reach {
  const { ground } = lattice
  const { slot, vertices, next, across } = topologyOf(lattice)
  const pitch = (CIRCUM / RES) * lattice.stride
  const base = Int32Array.from(vertices, (v) => Math.round((ground[v] as number) / BAND))
  const cost = new Float64Array(vertices.length * SPAN).fill(Number.POSITIVE_INFINITY)
  const from = new Int32Array(vertices.length * SPAN).fill(-1)
  const heading = new Int8Array(vertices.length * SPAN).fill(NONE)
  const stateOf = (s: number, band: number): number => {
    const k = band - (base[s] as number)
    return k < -WINDOW || k > WINDOW ? -1 : s * SPAN + k + WINDOW
  }
  const bandOf = (state: number): number =>
    (base[Math.floor(state / SPAN)] as number) + (state % SPAN) - WINDOW

  // What a lattice step costs by its rise (down a band, level, up a band); the ground across it adds its own.
  const rises = [-2, -1, 0, 1, 2].map((up) => {
    const rise = up * BAND
    const grade = Math.abs(rise) / pitch
    const length = Math.sqrt(pitch * pitch + rise * rise)
    return grade > STAIR
      ? Number.POSITIVE_INFINITY
      : length * (1 + 6 * grade * grade) + (grade > SLOPE ? 2.5 * length : 0)
  })

  const queue = new Heap<readonly [number, number]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
  for (const head of heads) {
    const s = slot[head.at] as number
    const state = s < 0 ? -1 : stateOf(s, Math.round((ground[head.at] as number) / BAND))
    if (state >= 0 && head.cost < (cost[state] as number)) {
      cost[state] = head.cost
      queue.push([head.cost, state])
    }
  }
  for (let item = queue.pop(); item; item = queue.pop()) {
    const [spent, state] = item
    if (spent > (cost[state] as number)) continue
    const s = Math.floor(state / SPAN)
    const band = bandOf(state)
    const came = heading[state] as number
    for (let m = 0; m < 6; m++) {
      const w = next[s * 6 + m] as number
      if (w < 0 || used?.[w] === LAID) continue
      const ws = slot[w] as number
      // Not back over ground this trail has just crossed (a spiral stair stacks a loop on itself, which a carve cannot hold).
      let crossed = false
      for (let back = from[state] as number, n = 0; back >= 0 && n < MEMORY; back = from[back] as number, n++)
        if (Math.floor(back / SPAN) === ws) {
          crossed = true
          break
        }
      if (crossed) continue
      const turned = came === NONE ? 0 : (TURN[apart(came, m)] as number)
      for (let up = -2; up <= 2; up++) {
        const target = stateOf(ws, band + up)
        if (target < 0) continue
        const step = rises[up + 2] as number
        if (step === Number.POSITIVE_INFINITY) continue
        const off = (band + up) * BAND - (ground[w] as number)
        const total =
          spent + step + 3 * (across[s * 6 + m] as number) + turned + (off > 0 ? FILL * off : -CUT * off)
        if (total < (cost[target] as number)) {
          cost[target] = total
          from[target] = state
          heading[target] = m
          queue.push([total, target])
        }
      }
    }
  }

  const best = (v: number): number => {
    const s = slot[v] as number
    if (s < 0) return -1
    let found = -1
    for (let k = WINDOW - 1; k <= WINDOW + 1; k++)
      if (found < 0 || (cost[s * SPAN + k] as number) < (cost[found] as number)) found = s * SPAN + k
    return found
  }
  return {
    cost: (v) => {
      const state = best(v)
      return state < 0 ? Number.POSITIVE_INFINITY : (cost[state] as number)
    },
    path(v) {
      let state = best(v)
      if (state < 0 || !Number.isFinite(cost[state] as number)) return undefined
      const found: Found = { chain: [], heights: [] }
      for (; state >= 0; state = from[state] as number) {
        found.chain.push(vertices[Math.floor(state / SPAN)] as number)
        found.heights.push(bandOf(state) * BAND)
      }
      found.chain.reverse()
      found.heights.reverse()
      return found
    },
  }
}
