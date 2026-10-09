import { type Cell, cellToWorld } from "../../lands.ts"
import { TERRACE } from "../../waterways.ts"
import { Heap } from "../heap.ts"
import { direction, key, neighbours, rings, unkey } from "../hex.ts"
import { RESERVED } from "../plan/keep.ts"
import { keepOf } from "../plan/lakes.ts"
import type { IslandPlan } from "../plan.ts"
import { type Relief, tierOf } from "../relief/index.ts"

/**
 * Where rivers run (terrain 2c): springs high on the ranges, and the way each one drains to the sea.
 * The ground is read as one height per hex (a massif's mean, a lowland hex's terrace top); a
 * priority flood from the coast gives every hex the way out that never climbs (basins are filled,
 * so a river cuts through a low ridge rather than ending in a pit: a gorge), and a river is that
 * way out followed from its spring, joining an earlier river where it meets one. Lots, sites, the
 * keep and its ring are never water; a road hex is crossed only where the road runs straight, by a
 * bridge (rivers/dress.ts), and the river never runs along it.
 */

/** Rivers a tier gets: a hamlet has no ranges to spring from. */
const COUNT = { hamlet: 0, village: 1, town: 2, city: 3 } as const
/** Springs rise at this share of their massif's height, and keep this many hexes apart. */
const SPRING = 0.72
const APART = 5
/** A river shorter than this many hexes is not worth drawing. */
const LONGEST = 6
/** Hexes a river never takes. */
const DRY = new Set(["K", "V", "v", "s", "w", "d"])

/** The ground as the rivers see it. */
export interface Ground {
  /** Every land hex's height, by key: world units. */
  height: ReadonlyMap<string, number>
  /** The hexes under a massif. */
  massif: ReadonlySet<string>
  /** The terrace level of a hex outside the massifs. */
  level(cell: Cell): number
}

export function groundOf(plan: IslandPlan, relief: Relief, level: (cell: Cell) => number): Ground {
  const height = new Map<string, number>()
  for (const id of plan.land.keys()) {
    const cell = unkey(id)
    if (!relief.massifAt(cell)) {
      height.set(id, level(cell) * TERRACE)
      continue
    }
    const [x, z] = cellToWorld(cell)
    let sum = 0
    let n = 0
    for (let k = -1; k < 6; k++) {
      const r = k < 0 ? 0 : 3.5
      const h = relief.heightAt(x + Math.cos((k * Math.PI) / 3) * r, z + Math.sin((k * Math.PI) / 3) * r)
      if (h !== undefined) {
        sum += h
        n++
      }
    }
    height.set(id, n > 0 ? sum / n : 0)
  }
  return { height, massif: relief.keys, level }
}

/** A river's course, source first: hex by hex, then the hex it ends on (the sea's, or an earlier river's). */
export interface Course {
  cells: Cell[]
  /** The level of each land hex of `cells` (the joined river's hex included), never rising downstream. */
  levels: number[]
  joins: boolean
}

/** The road hexes a river may cross, by the road's axis (0–2): straight, outside the keep's ring and a square. */
function crossable(plan: IslandPlan): Map<string, number> {
  const edges = new Map<string, Set<number>>()
  for (const road of plan.roads)
    road.forEach((cell, i) => {
      const set = edges.get(key(cell)) ?? new Set<number>()
      const before = road[i - 1]
      const after = road[i + 1]
      if (before) set.add(direction(cell, before))
      if (after) set.add(direction(cell, after))
      edges.set(key(cell), set)
    })
  for (const id of [key(plan.hub), key(plan.gate), ...plan.districts.map((d) => key(d.square))])
    edges.delete(id)
  const out = new Map<string, number>()
  for (const [id, set] of edges) {
    const [a, b] = [...set]
    if (set.size === 2 && a !== undefined && b !== undefined && (a + 3) % 6 === b && !RESERVED.has(id))
      out.set(id, Math.min(a, b))
  }
  return out
}

/** The hexes water never takes: lots, fields, the keep, squares, sites, and every road hex but the crossable ones. */
export function dryOf(plan: IslandPlan, bridges: ReadonlyMap<string, number>): Set<string> {
  const roads = new Set(plan.roads.flat().map(key))
  const dry = new Set<string>()
  for (const [id, hex] of plan.land)
    if (DRY.has(hex.char) || RESERVED.has(id) || (roads.has(id) && !bridges.has(id))) dry.add(id)
  for (const { square, site } of plan.districts) {
    dry.add(key(square))
    if (site) dry.add(key(site))
  }
  return dry
}

/** The rivers of an island: their courses, spring to sea, and the road hexes they cross. Deterministic. */
export function coursesOf(
  plan: IslandPlan,
  relief: Relief,
  ground: Ground,
): { courses: Course[]; bridges: Map<string, number> } {
  const tier = tierOf(plan.districts.reduce((sum, d) => sum + d.folder.files, 0))
  const bridges = crossable(plan)
  const dry = dryOf(plan, bridges)
  // A lake's basin, shore and stream corridor are the lake's own: no river runs through them.
  for (const id of keepOf(plan.lakes)) dry.add(id)
  // Floods repeat, closing any road hex a river would run along instead of across.
  for (let attempt = 0; attempt < 6; attempt++) {
    const drain = drainOf(plan, ground, dry)
    const courses = springsOf(relief, ground, drain, dry, COUNT[tier])
    const bad = courses.flatMap((course) => alongRoad(course, bridges))
    if (bad.length === 0) return { courses, bridges }
    for (const id of bad) {
      dry.add(id)
      bridges.delete(id)
    }
  }
  return { courses: [], bridges }
}

/** The road hexes a course enters or leaves by the road's own axis. */
export function alongRoad(course: Course, bridges: ReadonlyMap<string, number>): string[] {
  const out: string[] = []
  course.cells.forEach((cell, i) => {
    const axis = bridges.get(key(cell))
    if (axis === undefined) return
    for (const other of [course.cells[i - 1], course.cells[i + 1]])
      if (other && direction(cell, other) % 3 === axis) out.push(key(cell))
  })
  return out
}

/** For every hex that can drain: the neighbour it drains to ("sea" at the coast), by key. */
function drainOf(plan: IslandPlan, ground: Ground, dry: ReadonlySet<string>): Map<string, string> {
  const fill = new Map<string, number>()
  const parent = new Map<string, string>()
  const heap = new Heap<[number, string]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
  const open = (id: string): boolean => plan.land.has(id) && !dry.has(id)
  for (const id of plan.land.keys()) {
    if (!open(id) || neighbours(unkey(id)).every((n) => plan.land.has(key(n)))) continue
    fill.set(id, Math.max(0, ground.height.get(id) ?? 0))
    parent.set(id, "sea")
    heap.push([fill.get(id) as number, id])
  }
  for (let item = heap.pop(); item; item = heap.pop()) {
    const [level, id] = item
    if (level > (fill.get(id) ?? level)) continue
    for (const next of neighbours(unkey(id))) {
      const nid = key(next)
      if (!open(nid) || fill.has(nid)) continue
      // A small step per hex keeps a flat plain draining by the shortest way.
      const raised = Math.max(ground.height.get(nid) ?? 0, level + 1e-3)
      fill.set(nid, raised)
      parent.set(nid, id)
      heap.push([raised, nid])
    }
  }
  return parent
}

const heightOf = (ground: Ground, cell: Cell): number => ground.height.get(key(cell)) ?? 0

/** One river per massif in turn (the main range first) up to `want`, from a hex well up its slopes. */
function springsOf(
  relief: Relief,
  ground: Ground,
  drain: ReadonlyMap<string, string>,
  dry: ReadonlySet<string>,
  want: number,
): Course[] {
  const taken = new Map<string, number>()
  const courses: Course[] = []
  const sources: Cell[] = []
  for (let round = 0; courses.length < want && round < want + relief.massifs.length; round++) {
    const massif = relief.massifs[round % relief.massifs.length]
    if (!massif) break
    const aim = massif.height * SPRING
    const candidates = massif.cells
      .filter((cell) => drain.has(key(cell)) && !dry.has(key(cell)))
      .filter((cell) => neighbours(cell).every((n) => ground.height.has(key(n))))
      .sort(
        (a, b) =>
          Math.abs(heightOf(ground, a) - aim) - Math.abs(heightOf(ground, b) - aim) ||
          (key(a) < key(b) ? -1 : 1),
      )
    for (const cell of candidates) {
      if (taken.has(key(cell))) continue
      if (sources.some((other) => rings([cell[0] - other[0], cell[1] - other[1]]) < APART)) continue
      const course = follow(cell, drain, ground, taken)
      if (!course || course.cells.length < LONGEST) continue
      course.levels.forEach((level, i) => {
        taken.set(key(course.cells[i] as Cell), level)
      })
      courses.push(course)
      sources.push(cell)
      break
    }
  }
  return courses
}

/** A course from `spring` down its drainage to the sea or an earlier river; undefined when it can't be one. */
function follow(
  spring: Cell,
  drain: ReadonlyMap<string, string>,
  ground: Ground,
  taken: ReadonlyMap<string, number>,
): Course | undefined {
  const cells: Cell[] = [spring]
  const seen = new Set([key(spring)])
  let joins = false
  for (let id = drain.get(key(spring)); id && id !== "sea"; id = drain.get(id)) {
    if (seen.has(id)) return undefined
    seen.add(id)
    cells.push(unkey(id))
    if (taken.has(id)) {
      joins = true
      break
    }
  }
  if (!joins) {
    // The last land hex opens onto the sea by a side that has no land.
    const sea = neighbours(cells[cells.length - 1] as Cell).find((n) => !ground.height.has(key(n)))
    if (!sea) return undefined
    cells.push(sea)
  }
  // Levels: each hex's own, raised where it must be so that no river climbs.
  const lands = joins ? cells.length : cells.length - 1
  const levels = new Array<number>(lands)
  let floor = 0
  for (let i = lands - 1; i >= 0; i--) {
    const cell = cells[i] as Cell
    const own = taken.get(key(cell)) ?? naturalLevel(ground, cell)
    levels[i] = Math.max(floor, own)
    floor = levels[i] as number
  }
  // A lowland hex keeps its tile's level: a course that would raise one is no river.
  for (let i = 0; i < lands - (joins ? 1 : 0); i++) {
    const cell = cells[i] as Cell
    if (!ground.massif.has(key(cell)) && levels[i] !== ground.level(cell)) return undefined
  }
  return { cells, levels, joins }
}

export const naturalLevel = (ground: Ground, cell: Cell): number =>
  ground.massif.has(key(cell))
    ? Math.max(0, Math.floor(heightOf(ground, cell) / TERRACE))
    : ground.level(cell)
