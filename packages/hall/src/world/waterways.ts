import { direction, key, neighbours } from "./gen/hex.ts"
import { type Cell, cellToWorld, HEX_SCALE } from "./lands.ts"
import type { Spot } from "./layout.ts"

/**
 * Inland water as data (world-gen v2 §2.3, slice 2's water): rivers and lakes on the hex terraces,
 * and the waterfalls where a river steps down. Given the terrain's levels, each river's course and
 * the hexes under lakes, `waterwaysOf` sorts the water into the bodies the scene draws
 * (scene/nature/Rivers.tsx) and the tiles a dresser fits (a river hex's `ins` and `out` are the
 * edges its channel opens onto, in lands.ts' edge numbering). Pure and deterministic: the
 * generator's descent decides where water runs; this checks that it can (every river reaches the
 * sea or another river, never runs uphill, every lake drains by exactly one outlet) and says what
 * it is.
 */

/** The terrain under the water: a land hex's terrace level (0 is sea level), undefined on open sea. */
export interface WaterTerrain {
  level(cell: Cell): number | undefined
}

export interface WaterInput extends WaterTerrain {
  /**
   * Each river's course, source first: neighbouring hexes, never rising, ending on the open sea or
   * on water an earlier course laid (a confluence: one of its river hexes, or its lake). A course
   * may rise in a lake (a tarn) and may run through lakes on its way.
   */
  rivers: readonly (readonly Cell[])[]
  /** The hexes under lakes: touching ones are one lake, all at one level. */
  lakes?: Iterable<Cell>
}

/** A river hex: the edges its water comes in by (none at a spring, two at a confluence) and leaves by. */
export interface RiverHex {
  cell: Cell
  level: number
  ins: number[]
  out: number
}

/** A run of river hexes on one level, upstream first: one stretch of water at one height. */
export interface Reach {
  level: number
  hexes: RiverHex[]
  /** The hex upstream of the first (absent at a spring): a fall's lip, a lake, a higher reach. */
  prev?: Cell
  /** Where the water goes after the last hex: over a fall, into a lake, the sea, or another river. */
  next: Cell
}

/** What a waterfall pours from and into. */
export type WaterKind = "river" | "lake" | "sea"

/** A waterfall: water stepping down from `from` to its neighbour `to`, over `from`'s edge `dir`. */
export interface Fall {
  from: Cell
  to: Cell
  dir: number
  /** The levels at its lip and at its foot (the sea's is 0). */
  top: number
  bottom: number
  source: Exclude<WaterKind, "sea">
  into: WaterKind
}

export interface Lake {
  level: number
  cells: Cell[]
  /** Land round it on its own level (not river): where lakeshore tiles go, and its water reaches under. */
  shore: Cell[]
  /** Where it drains: the lake hex and the edge the water leaves by. */
  outlet: { cell: Cell; dir: number }
}

export interface Waterways {
  rivers: Reach[]
  lakes: Lake[]
  falls: Fall[]
}

const at = (cell: Cell): string => key(cell)

/**
 * Sorts the water of `input` into reaches, lakes and falls. Throws, naming the hex, when a course
 * breaks a rule: a step between hexes that aren't neighbours, water running uphill, a river that
 * ends inland or runs back onto its own water, a lake on two levels, a lake with no outlet or more
 * than one, or one that would spill over a lower edge besides its outlet.
 */
export function waterwaysOf(input: WaterInput): Waterways {
  const lakes = lakesOf(input)
  const lakeAt = new Map<string, LakeBuild>()
  for (const lake of lakes) for (const cell of lake.cells) lakeAt.set(at(cell), lake)
  /** Each river hex, and which course laid it. */
  const hexAt = new Map<string, { hex: RiverHex; course: number }>()
  /** Which course first reached each lake. */
  const filled = new Map<LakeBuild, number>()
  const rivers: Reach[] = []
  const falls: Fall[] = []

  input.rivers.forEach((course, n) => {
    const name = `river ${n + 1}`
    if (course.length < 2) throw new Error(`${name}: a course needs a source and somewhere to go`)
    const source = course[0] as Cell
    if (input.level(source) === undefined) throw new Error(`${name} rises on the open sea at ${at(source)}`)
    if (hexAt.has(at(source))) throw new Error(`${name} rises on another river at ${at(source)}`)
    let reach: Reach | undefined
    let upstream: RiverHex | undefined
    let inLake: LakeBuild | undefined
    const left = new Set<LakeBuild>()

    for (let i = 0; i < course.length; i++) {
      const cell = course[i] as Cell
      const prev = course[i - 1]
      const level = input.level(cell)
      const lake = lakeAt.get(at(cell))
      const last = i === course.length - 1

      // The step in: edges, outlets, a fall where the level drops.
      if (prev) {
        const dir = direction(prev, cell)
        const top = input.level(prev) as number
        const bottom = level ?? 0
        if (bottom > top) throw new Error(`${name} runs uphill from ${at(prev)} to ${at(cell)}`)
        if (upstream) upstream.out = dir
        if (reach) reach.next = cell
        if (inLake && lake !== inLake) {
          inLake.outlets.add(`${at(prev)}:${dir}`)
          inLake.outlet ??= { cell: prev, dir }
          left.add(inLake)
        }
        if (bottom < top)
          falls.push({
            from: prev,
            to: cell,
            dir,
            top,
            bottom,
            source: inLake ? "lake" : "river",
            into: level === undefined ? "sea" : lake ? "lake" : "river",
          })
      }

      // Where it ends: the sea, or water already laid.
      if (level === undefined) {
        if (!last) throw new Error(`${name} crosses the sea at ${at(cell)}`)
        return
      }
      const river = hexAt.get(at(cell))
      if (river) {
        if (river.course === n) throw new Error(`${name} runs back onto itself at ${at(cell)}`)
        if (!last) throw new Error(`${name} runs on through ${at(cell)}, another river's hex`)
        if (prev) river.hex.ins.push(direction(cell, prev))
        return
      }
      if (lake && lake === inLake) continue
      if (lake) {
        if (left.has(lake)) throw new Error(`${name} runs back into its lake at ${at(cell)}`)
        const first = filled.get(lake)
        if (first !== undefined && first !== n) {
          if (!last) throw new Error(`${name} runs on through ${at(cell)}, another river's lake`)
          return
        }
        if (last) throw new Error(`${name} ends in the lake at ${at(cell)}, which drains nowhere`)
        filled.set(lake, n)
        inLake = lake
        reach = undefined
        upstream = undefined
        continue
      }
      if (last)
        throw new Error(`${name} ends inland at ${at(cell)}: a river ends at the sea or joins another`)

      // A river hex: a new reach where the level changes or the river comes out of a lake.
      inLake = undefined
      const hex: RiverHex = { cell, level, ins: prev ? [direction(cell, prev)] : [], out: -1 }
      hexAt.set(at(cell), { hex, course: n })
      upstream = hex
      if (!reach || reach.level !== level) {
        reach = { level, hexes: [], ...(prev ? { prev } : {}), next: cell }
        rivers.push(reach)
      }
      reach.hexes.push(hex)
    }
  })

  const rivered = new Set(hexAt.keys())
  return { rivers, lakes: lakes.map((lake) => finish(lake, input, lakeAt, rivered)), falls }
}

interface LakeBuild {
  level: number
  cells: Cell[]
  /** Every way out any course took ("q,line:dir"): exactly one when all is well. */
  outlets: Set<string>
  outlet?: { cell: Cell; dir: number }
}

/** The lakes: touching lake hexes grouped, in the order first given; each must be land on one level. */
function lakesOf(input: WaterInput): LakeBuild[] {
  const wet = new Map<string, Cell>()
  for (const cell of input.lakes ?? []) wet.set(at(cell), cell)
  const seen = new Set<string>()
  const out: LakeBuild[] = []
  for (const [id, first] of wet) {
    if (seen.has(id)) continue
    const level = input.level(first)
    if (level === undefined) throw new Error(`lake at ${id} is on the open sea`)
    const cells: Cell[] = []
    const queue = [first]
    seen.add(id)
    for (let cell = queue.shift(); cell; cell = queue.shift()) {
      if (input.level(cell) !== level) throw new Error(`lake at ${id} lies on two levels (${at(cell)})`)
      cells.push(cell)
      for (const next of neighbours(cell))
        if (wet.has(at(next)) && !seen.has(at(next))) {
          seen.add(at(next))
          queue.push(next)
        }
    }
    out.push({ level, cells, outlets: new Set() })
  }
  return out
}

/** A lake checked (one outlet, and no other edge lower than its water) and given its shore. */
function finish(
  lake: LakeBuild,
  terrain: WaterTerrain,
  lakeAt: ReadonlyMap<string, LakeBuild>,
  rivered: ReadonlySet<string>,
): Lake {
  const name = `lake at ${at(lake.cells[0] as Cell)}`
  const outlet = lake.outlet
  if (!outlet || lake.outlets.size !== 1)
    throw new Error(`${name} has ${lake.outlets.size} outlets: a lake drains by exactly one`)
  const shore: Cell[] = []
  const known = new Set<string>()
  for (const cell of lake.cells)
    neighbours(cell).forEach((next, dir) => {
      if (lakeAt.get(at(next)) === lake) return
      const level = terrain.level(next)
      const draining = at(cell) === at(outlet.cell) && dir === outlet.dir
      if (!draining && (level === undefined || level < lake.level))
        throw new Error(`${name} would spill over ${at(cell)}'s edge ${dir} as well as its outlet`)
      if (draining || level !== lake.level || rivered.has(at(next)) || known.has(at(next))) return
      known.add(at(next))
      shore.push(next)
    })
  return { level: lake.level, cells: lake.cells, shore, outlet }
}

// ---- Where the water lies: the contract with whatever shapes the ground ------------------------

/**
 * Every body of water is flat at its level's height, `surfaceY`, over each hex it covers: a reach
 * over each of its river hexes, a lake over its cells and its shore ring (scene/nature/riverMesh.ts
 * draws exactly that). Whatever makes the ground — the hex kit's tiles in the lowland, terrain's
 * carved massifs (docs: terrain v2 §4.1) — clips those flat patches, so it must keep, for any level
 * (0 up to 24 and beyond; nothing here caps it):
 *
 * - a river hex: the ground below the surface within BANK of `courseLine` (the bed), and at least
 *   0.3 above it beyond (the banks hide the rest of the hex's patch);
 * - a fall: a lip at the upper level's ground (`top`·TERRACE) on `from`'s edge `dir`, the face
 *   dropping to `bottom`·TERRACE (the sheet hangs in front of it);
 * - a lake: the ground below the surface on its cells, and at least 0.3 above it round its rim
 *   except at its outlet — which `waterwaysOf` already holds by level (no rim lower than the lake).
 */

/** One terrace: half a tile, as lands.ts builds them. */
export const TERRACE = HEX_SCALE / 2
/** A river's surface over its ground's top and a lake's: the pack's channel and its flat water (Water.tsx's RIVER_Y and SEA_Y). */
const RIVER_Y = -0.1 * HEX_SCALE + 0.06
const LAKE_Y = -0.2 * HEX_SCALE + 0.05

/** The height of a body of water on a level (the sea is level 0's lake height). Linear in level. */
export function surfaceY(kind: WaterKind, level: number): number {
  return level * TERRACE + (kind === "river" ? RIVER_Y : LAKE_Y)
}

/** Half a river channel, course line to the foot of its banks (the pack's river tiles). */
export const BANK = 2.6

const CIRCUMRADIUS = (HEX_SCALE * 2) / Math.sqrt(3)
const INRADIUS = HEX_SCALE
/** Points along a bending channel's arc. */
const ARC_STEPS = 6

/**
 * A reach's course line in world xz, the line its channel follows: from the hex upstream (or, at a
 * spring, the far edge of its first hex: a spring's hex is a straight run, as the pack has no
 * dead-end river tile) through each hex's channel to the hex the water goes on to.
 */
export function courseLine(reach: Reach): Spot[] {
  const line: Spot[] = reach.prev ? [cellToWorld(reach.prev)] : []
  for (const hex of reach.hexes)
    line.push(...channel(cellToWorld(hex.cell), hex.ins[0] ?? (hex.out + 3) % 6, hex.out))
  line.push(cellToWorld(reach.next))
  return line
}

/**
 * A river hex's channel, entry edge to exit edge, as the pack's river tiles cut it: straight across,
 * or an arc — round the neighbour across the middle edge for a wide bend (radius 8.66, through
 * 1.34 of the centre), round the shared corner for a tight one (radius 2.89).
 */
function channel(centre: Spot, from: number, to: number): Spot[] {
  const [cx, cz] = centre
  const at = (angle: number, r: number): Spot => [cx + Math.cos(angle) * r, cz + Math.sin(angle) * r]
  const midOf = (edge: number) => at(Math.PI / 6 + (edge * Math.PI) / 3, INRADIUS)
  const turn = (((to - from) % 6) + 6) % 6
  if (turn === 3) return [midOf(from), midOf(to)]
  const wide = turn === 2 || turn === 4
  const pivot = wide
    ? at(Math.PI / 6 + ((from + (turn === 2 ? 1 : -1)) * Math.PI) / 3, 2 * INRADIUS)
    : at(((from + (turn === 1 ? 1 : 0)) * Math.PI) / 3, CIRCUMRADIUS)
  const angle = (p: Spot) => Math.atan2(p[1] - pivot[1], p[0] - pivot[0])
  const a0 = angle(midOf(from))
  let sweep = angle(midOf(to)) - a0
  if (sweep > Math.PI) sweep -= 2 * Math.PI
  if (sweep < -Math.PI) sweep += 2 * Math.PI
  const r = Math.hypot(midOf(from)[0] - pivot[0], midOf(from)[1] - pivot[1])
  const points: Spot[] = []
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = a0 + (sweep * i) / ARC_STEPS
    points.push([pivot[0] + Math.cos(a) * r, pivot[1] + Math.sin(a) * r])
  }
  return points
}
