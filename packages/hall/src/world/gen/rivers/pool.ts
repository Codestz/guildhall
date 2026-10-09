import type { Cell } from "../../lands.ts"
import { Heap } from "../heap.ts"
import { key, neighbours, rings, unkey } from "../hex.ts"
import type { PlanLake } from "../plan/lakes.ts"
import type { IslandPlan } from "../plan.ts"
import { alongRoad, type Course, type Ground, naturalLevel } from "./course.ts"

/**
 * One reserved basin (plan/lakes.ts) made into a stream's course: it rises on the range at the
 * basin's foot, runs down the corridor reserved for it into the basin at its upstream end, crosses
 * the lake and leaves by one outlet, the shortest way over level ground to the sea or to an earlier
 * river. All that is one course (the water layer, `waterwaysOf`, then checks it). The lake sits on
 * level 0 and nothing is carved: it lies in the lowland, clear of the relief.
 */

/** The stream down the range runs this many hexes at most. */
const SLOPE = 6
/** The stream climbs a gentle slope: no hex it takes stands more than this above the one below. */
const RISE = 8
/** A hex beside the lake that the outlet runs along costs this much more: it leaves the shore. */
const HUG = 3

/** What a basin is routed against. */
export interface Terrain {
  plan: IslandPlan
  ground: Ground
  /** Every land hex's terrace level, the rivers' own laid over it. */
  level(cell: Cell): number | undefined
  /** The courses already laid. */
  accepted: readonly Course[]
  /** Hexes water never takes (lots, roads but the crossable, ...), and the road hexes it may cross. */
  dry: ReadonlySet<string>
  bridges: ReadonlyMap<string, number>
  /** Every hex any lake keeps. */
  kept: ReadonlySet<string>
}

/** The lake's course candidates, the farthest exit from the stream's entry first (a basin may offer none). */
export function* coursesFor(lake: PlanLake, t: Terrain): Generator<Course> {
  const taken = new Map<string, number>()
  for (const course of t.accepted)
    course.levels.forEach((level, i) => {
      taken.set(key(course.cells[i] as Cell), level)
    })
  const inlet = lake.inlet.map(unkey)
  const last = inlet[inlet.length - 1]
  const wet = new Set(lake.cells)
  const entry = last
    ? lake.cells.map(unkey).find((c) => neighbours(c).some((n) => key(n) === key(last)))
    : undefined
  if (!entry) return
  const slope = climb(unkey(lake.foot), t, taken)
  const stream = [...slope, ...inlet]
  if (stream.some((c) => taken.has(key(c)))) return
  const far = (c: Cell): number => rings([c[0] - entry[0], c[1] - entry[1]])
  const order = lake.cells.map(unkey).sort((a, b) => far(b) - far(a) || (key(a) < key(b) ? -1 : 1))
  for (const exit of order) {
    const tail = outlet(exit, wet, new Set(stream.map(key)), t, taken)
    if (!tail) continue
    const inside = through(lake.cells, entry, exit)
    const cells = [...stream, ...inside, ...tail.cells]
    // Levels: never rising downstream, the lake's and the lowland's own 0 at the bottom.
    const levels = cells.map(() => 0)
    let held = 0
    for (let i = cells.length - 1; i >= 0; i--) {
      const lowland = i >= slope.length
      held = Math.max(held, lowland ? 0 : naturalLevel(t.ground, cells[i] as Cell))
      levels[i] = held
    }
    const course: Course = {
      cells,
      levels: levels.slice(0, tail.joins ? cells.length : cells.length - 1),
      joins: tail.joins,
    }
    const ids = cells.map(key)
    if (new Set(ids).size !== ids.length || alongRoad(course, t.bridges).length > 0) continue
    // The river meets the water at its entry and its exit alone.
    const into = new Set([key(last as Cell), key(tail.cells[0] as Cell)])
    const now = new Set(ids)
    const offenders = lake.cells.flatMap((id) =>
      neighbours(unkey(id)).filter((m) => now.has(key(m)) && !wet.has(key(m)) && !into.has(key(m))),
    )
    if (offenders.length === 0) yield course
  }
}

/** The hexes up the range from its foot hex, top first: climbing the slope by height, at most SLOPE. */
function climb(foot: Cell, t: Terrain, taken: ReadonlyMap<string, number>): Cell[] {
  const height = (c: Cell): number => t.ground.height.get(key(c)) ?? 0
  const slope = [foot]
  if (!t.ground.massif.has(key(foot))) return []
  while (slope.length < SLOPE) {
    const top = slope[0] as Cell
    const next = neighbours(top)
      .filter(
        (c) =>
          t.ground.massif.has(key(c)) &&
          !t.dry.has(key(c)) &&
          !taken.has(key(c)) &&
          !slope.some((m) => key(m) === key(c)) &&
          height(c) > height(top) &&
          height(c) <= height(top) + RISE,
      )
      .sort((a, b) => height(b) - height(a) || (key(a) < key(b) ? -1 : 1))[0]
    if (!next) break
    slope.unshift(next)
  }
  return slope
}

/**
 * The outlet: from beside the lake's exit hex over level 0, the cheapest way to a hex on the coast
 * (then the sea hex beside it) or to an earlier river at level 0. Hexes: the first is the one after the exit.
 */
function outlet(
  exit: Cell,
  wet: ReadonlySet<string>,
  stream: ReadonlySet<string>,
  t: Terrain,
  taken: ReadonlyMap<string, number>,
): { cells: Cell[]; joins: boolean } | undefined {
  const { plan } = t
  const planned = new Set(plan.lakes.flatMap((lake) => (lake.cells.includes(key(exit)) ? lake.outlet : [])))
  const mine = new Set(
    plan.lakes.flatMap((lake) => (lake.cells.includes(key(exit)) ? [...lake.shore, ...lake.outlet] : [])),
  )
  // A bridge never stands beside a square: that is a venue's front yard.
  const squares = new Set(plan.districts.flatMap((d) => [d.square, ...neighbours(d.square)].map(key)))
  const ok = (c: Cell): boolean => {
    const id = key(c)
    if (squares.has(id)) return false
    if (!plan.land.has(id) || wet.has(id) || stream.has(id) || t.ground.massif.has(id)) return false
    if (t.kept.has(id) && !mine.has(id)) return false
    if (t.dry.has(id) && !t.bridges.has(id)) return false
    return t.level(c) === 0
  }
  const best = new Map<string, number>([[key(exit), 0]])
  const back = new Map<string, string>()
  const heap = new Heap<[number, string]>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
  heap.push([0, key(exit)])
  for (let item = heap.pop(); item; item = heap.pop()) {
    const [cost, id] = item
    if (cost > (best.get(id) ?? Number.POSITIVE_INFINITY)) continue
    const here = unkey(id)
    const sea = id === key(exit) ? undefined : neighbours(here).find((n) => !plan.land.has(key(n)))
    const joined = taken.get(id) === 0 && id !== key(exit)
    if (sea || joined) {
      const path: Cell[] = []
      for (let at: string | undefined = id; at && at !== key(exit); at = back.get(at)) path.unshift(unkey(at))
      return { cells: sea ? [...path, sea] : path, joins: !sea }
    }
    for (const next of neighbours(here)) {
      const nid = key(next)
      if (!ok(next) && !(taken.get(nid) === 0 && !wet.has(nid))) continue
      const hug = neighbours(next).some((m) => wet.has(key(m))) ? HUG : 0
      const total = cost + (planned.has(nid) ? 0.4 : 1 + hug)
      if (total < (best.get(nid) ?? Number.POSITIVE_INFINITY)) {
        best.set(nid, total)
        back.set(nid, id)
        heap.push([total, nid])
      }
    }
  }
  return undefined
}

/** The hexes of the lake from `entry` to `exit`, the shortest way through it. */
function through(cells: readonly string[], entry: Cell, exit: Cell): Cell[] {
  const inside = new Set(cells)
  const parent = new Map<string, Cell | undefined>([[key(entry), undefined]])
  const queue = [entry]
  for (let cell = queue.shift(); cell; cell = queue.shift())
    for (const next of neighbours(cell))
      if (inside.has(key(next)) && !parent.has(key(next))) {
        parent.set(key(next), cell)
        queue.push(next)
      }
  const out: Cell[] = []
  for (let at: Cell | undefined = exit; at; at = parent.get(key(at))) out.unshift(at)
  return out
}
