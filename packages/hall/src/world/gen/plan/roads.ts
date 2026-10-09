import type { Cell } from "../../lands.ts"
import { Heap } from "../heap.ts"
import { key, neighbours, rings, unkey } from "../hex.ts"
import type { PlanDistrict } from "../plan.ts"
import { AVENUE, GATE, HUB, inBay, RESERVED } from "./keep.ts"
import type { Owners } from "./land.ts"

/**
 * The roads: the avenue, then hub → every square, nearest first, reusing what's laid (Dijkstra over
 * the hexes); a workspace's packages after it, each from its biggest package's square. A road over
 * sea is a causeway and makes land, its district's.
 */
export function layRoads(
  districts: readonly PlanDistrict[],
  owner: Owners,
  heads: ReadonlyMap<number, number>,
  radius: number,
): { road: Set<string>; roads: Cell[][] } {
  const road = new Set<string>([key(HUB), key(AVENUE), key(GATE)])
  const roads: Cell[][] = [[HUB, AVENUE]]
  const byDistance = districts
    .map((district, i) => ({ i, d: rings(district.square) }))
    .filter(({ i }) => i > 0)
    .sort((a, b) => Number(heads.has(a.i)) - Number(heads.has(b.i)) || a.d - b.d || a.i - b.i)
  for (const { i } of byDistance) {
    const district = districts[i]
    if (!district) continue
    const head = heads.get(i)
    const from = head === undefined ? HUB : (districts[head]?.square ?? HUB)
    const path = cheapest(from, district.square, radius + 2, (cell) => {
      const id = key(cell)
      if (inBay(cell) || (RESERVED.has(id) && !road.has(id)) || id === key(GATE)) return undefined
      if (road.has(id)) return 0.4
      return owner.has(id) ? 1 : 8
    })
    for (const cell of path) {
      const id = key(cell)
      road.add(id)
      if (!owner.has(id)) owner.set(id, i)
    }
    roads.push(path)
  }
  return { road, roads }
}

/** Dijkstra over the hexes within `radius` rings; `cost` undefined means impassable. */
function cheapest(from: Cell, to: Cell, radius: number, cost: (cell: Cell) => number | undefined): Cell[] {
  const goal = key(to)
  const best = new Map<string, number>([[key(from), 0]])
  const back = new Map<string, string>()
  const heap = new Heap<[number, string]>((a, b) => a[0] < b[0])
  heap.push([0, key(from)])
  for (let item = heap.pop(); item; item = heap.pop()) {
    const [distance, id] = item
    if (id === goal) break
    if (distance > (best.get(id) ?? Number.POSITIVE_INFINITY)) continue
    for (const next of neighbours(unkey(id))) {
      if (rings(next) > radius) continue
      const step = cost(next)
      if (step === undefined) continue
      const nextId = key(next)
      const total = distance + step
      if (total < (best.get(nextId) ?? Number.POSITIVE_INFINITY)) {
        best.set(nextId, total)
        back.set(nextId, id)
        heap.push([total, nextId])
      }
    }
  }
  const path: Cell[] = [to]
  for (let id = back.get(goal); id !== undefined; id = back.get(id)) path.unshift(unkey(id))
  if (key(path[0] ?? to) !== key(from)) throw new Error(`no road from ${key(from)} to ${goal}`)
  return path
}
