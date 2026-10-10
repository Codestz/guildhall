import type { Cell } from "../../lands.ts"
import { key, neighbours, rings, unkey } from "../hex.ts"
import type { PlanDistrict } from "../plan.ts"
import { RESERVED } from "./keep.ts"
import type { Owners } from "./land.ts"
import { cheapest } from "./route.ts"

/**
 * Generator v2's streets, laid after the roads that join every square to the hub, so the network
 * grows with the island: first the arterials, a link between squares that lie close but are far
 * apart by road (a ring round the hub's spokes); then the streets, a spur from the nearest road to
 * whichever land is furthest from any, until no inland hex is more than DEAD hexes from a road. A
 * big island gets many; a hamlet's land has no such place. Streets keep to land that is not a
 * range, a lake's or the keep's, and never run along the coast. Deterministic: every choice is
 * the furthest, nearest or first by key.
 */

/** Furthest an inland hex may be from a road before a street is laid to it; a small island (under SMALL hexes) is left sparser. */
const DEAD = 4
const SMALL = 150
/** A square's links to its nearest neighbours that the arterials may add. */
const NEAREST = 3
const LINKS = 2
/** Two squares are linked when the road between them is this much longer (plus 3) than the way as the crow flies. */
const DETOUR = 1.7
/** What a street pays to run beside a road it does not join, and along the coast. */
const BESIDE = 1.5
const COAST = 3

export interface Streets {
  districts: readonly PlanDistrict[]
  owner: Owners
  road: Set<string>
  roads: Cell[][]
  radius: number
  /** The roads' own price of a hex (plan/roads.ts), undefined where none may run. */
  price(cell: Cell): number | undefined
  ranges: ReadonlySet<string>
  wet: ReadonlySet<string>
}

export function growStreets(plan: Streets): void {
  const { owner, road, roads, radius, ranges, wet } = plan
  const inland = (cell: Cell): boolean => neighbours(cell).every((next) => owner.has(key(next)))
  /** What a street pays for a hex: only land that is neither a range, a lake's nor kept. */
  const price = (cell: Cell): number | undefined => {
    const id = key(cell)
    const base = plan.price(cell)
    if (base === undefined || !owner.has(id) || ranges.has(id) || wet.has(id)) return undefined
    if (road.has(id)) return base
    return (
      base + (neighbours(cell).some((next) => road.has(key(next))) ? BESIDE : 0) + (inland(cell) ? 0 : COAST)
    )
  }
  const links = new Map<string, Set<string>>()
  /** The road hexes each one joins, by key: what `byRoad` walks. */
  const join = (path: readonly Cell[]): void => {
    path.forEach((cell, n) => {
      const prev = path[n - 1]
      if (!prev) return
      for (const [a, b] of [
        [key(cell), key(prev)],
        [key(prev), key(cell)],
      ] as const)
        links.set(a, (links.get(a) ?? new Set()).add(b))
    })
  }
  const lay = (path: Cell[]): void => {
    for (const cell of path) road.add(key(cell))
    join(path)
    roads.push(path)
  }
  for (const path of roads) join(path)

  // Arterials: squares close by air but far by road.
  const squares = plan.districts.map((district) => district.square)
  const far = (from: Cell, to: Cell): number => rings([from[0] - to[0], from[1] - to[1]])
  const pairs = new Map<string, [number, number]>()
  squares.forEach((a, i) => {
    squares
      .map((b, j) => ({ j, d: far(a, b) }))
      .filter(({ j }) => j !== i)
      .sort((x, y) => x.d - y.d || x.j - y.j)
      .slice(0, NEAREST)
      .forEach(({ j }) => {
        pairs.set(i < j ? `${i}|${j}` : `${j}|${i}`, i < j ? [i, j] : [j, i])
      })
  })
  const extra = new Map<number, number>()
  const byAir = [...pairs.values()].sort(
    (p, q) =>
      far(squares[p[0]] as Cell, squares[p[1]] as Cell) - far(squares[q[0]] as Cell, squares[q[1]] as Cell) ||
      p[0] - q[0] ||
      p[1] - q[1],
  )
  for (const [i, j] of byAir) {
    if ((extra.get(i) ?? 0) >= LINKS || (extra.get(j) ?? 0) >= LINKS) continue
    const [a, b] = [squares[i] as Cell, squares[j] as Cell]
    if (byRoad(links, key(a), key(b)) <= DETOUR * far(a, b) + 3) continue
    try {
      lay(cheapest(a, b, radius + 2, price))
    } catch {
      continue
    }
    extra.set(i, (extra.get(i) ?? 0) + 1)
    extra.set(j, (extra.get(j) ?? 0) + 1)
  }

  // Streets: a spur to the furthest dead ground, until there is none.
  const dead = owner.size < SMALL ? DEAD + 2 : DEAD
  const tried = new Set<string>()
  for (;;) {
    const { reach, from } = flood(owner, road)
    let target: string | undefined
    let most = dead + 1
    for (const [id, d] of reach) {
      if (d < most || tried.has(id) || RESERVED.has(id) || ranges.has(id) || wet.has(id)) continue
      if (!inland(unkey(id)) || (d === most && target !== undefined && id > target)) continue
      if (d > most || target === undefined || id < target) {
        most = d
        target = id
      }
    }
    if (target === undefined) return
    tried.add(target)
    try {
      lay(cheapest(unkey(from.get(target) as string), unkey(target), radius + 2, price))
    } catch {
      // No way through: the ground stays dead.
    }
  }
}

/** Hexes by road from one hex to another (infinite where the roads do not join them). */
function byRoad(links: ReadonlyMap<string, ReadonlySet<string>>, from: string, to: string): number {
  const seen = new Map<string, number>([[from, 0]])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i] as string
    if (id === to) return seen.get(id) as number
    for (const next of links.get(id) ?? []) {
      if (seen.has(next)) continue
      seen.set(next, (seen.get(id) as number) + 1)
      queue.push(next)
    }
  }
  return Number.POSITIVE_INFINITY
}

/** Every land hex's hexes from the nearest road, and which road hex that is. */
function flood(
  owner: Owners,
  road: ReadonlySet<string>,
): { reach: Map<string, number>; from: Map<string, string> } {
  const reach = new Map<string, number>()
  const from = new Map<string, string>()
  const queue = [...road].filter((id) => owner.has(id)).sort()
  for (const id of queue) {
    reach.set(id, 0)
    from.set(id, id)
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i] as string
    for (const next of neighbours(unkey(id))) {
      const nid = key(next)
      if (!owner.has(nid) || reach.has(nid)) continue
      reach.set(nid, (reach.get(id) as number) + 1)
      from.set(nid, from.get(id) as string)
      queue.push(nid)
    }
  }
  return { reach, from }
}
