import type { Cell } from "../../lands.ts"
import { key, rings } from "../hex.ts"
import type { PlanDistrict } from "../plan.ts"
import { AVENUE, type Form, GATE, HUB, RESERVED, RING } from "./keep.ts"
import type { PlanLake } from "./lakes.ts"
import type { Owners } from "./land.ts"
import { cheapest } from "./route.ts"
import { growStreets } from "./streets.ts"

/** What a road pays to cross a range's hex, over a plain hex's 1. */
const CLIMB = 2.5
/** What a road pays to cross a lake's stream corridor. */
const STREAM = 6
const NONE: ReadonlySet<string> = new Set()

/**
 * The roads: the avenue, then hub → every square, nearest first, reusing what's laid (Dijkstra over
 * the hexes); a workspace's packages after it, each from its biggest package's square. A road over
 * sea is a causeway and makes land, its district's. A range (v2) is crossed only where the detour
 * round it costs more: the passes.
 */
export function layRoads(
  districts: readonly PlanDistrict[],
  owner: Owners,
  heads: ReadonlyMap<number, number>,
  radius: number,
  { bay, mass, reserved = RESERVED }: Form = RING,
  ranges: ReadonlySet<string> = NONE,
  lakes: readonly PlanLake[] = [],
): { road: Set<string>; roads: Cell[][] } {
  // A lake's basin and shore are never crossed; its stream is, at a price (the rivers bridge it where the road runs straight).
  const wet = new Set(lakes.flatMap((lake) => [...lake.cells, ...lake.shore]))
  const streams = new Set(lakes.flatMap((lake) => lake.inlet))
  const road = new Set<string>([key(HUB), key(AVENUE), key(GATE)])
  const roads: Cell[][] = [[HUB, AVENUE]]
  const price = (cell: Cell): number | undefined => {
    const id = key(cell)
    if (bay(cell) || (reserved.has(id) && !road.has(id)) || id === key(GATE) || wet.has(id)) return undefined
    if (road.has(id)) return 0.4
    return (owner.has(id) ? 1 : 8) + (ranges.has(id) ? CLIMB : 0) + (streams.has(id) ? STREAM : 0)
  }
  const byDistance = districts
    .map((district, i) => ({ i, d: rings(district.square) }))
    .filter(({ i }) => i > 0)
    .sort((a, b) => Number(heads.has(a.i)) - Number(heads.has(b.i)) || a.d - b.d || a.i - b.i)
  for (const { i } of byDistance) {
    const district = districts[i]
    if (!district) continue
    const head = heads.get(i)
    const from = head === undefined ? HUB : (districts[head]?.square ?? HUB)
    const path = cheapest(from, district.square, radius + 2, price)
    for (const cell of path) {
      const id = key(cell)
      road.add(id)
      if (!owner.has(id)) owner.set(id, i)
    }
    roads.push(path)
  }
  // Generator v2: the streets grow with the island (plan/streets.ts).
  if (mass)
    growStreets({
      districts,
      owner,
      road,
      roads,
      radius,
      price,
      ranges,
      wet: new Set([...wet, ...streams]),
      reserved,
    })
  return { road, roads }
}
