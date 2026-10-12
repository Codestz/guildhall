import type { Cell } from "../../lands.ts"
import { Heap } from "../heap.ts"
import { key, neighbours, rings, unkey } from "../hex.ts"

/** Dijkstra over the hexes within `radius` rings; `cost` undefined means impassable. */
export function cheapest(
  from: Cell,
  to: Cell,
  radius: number,
  cost: (cell: Cell) => number | undefined,
): Cell[] {
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
