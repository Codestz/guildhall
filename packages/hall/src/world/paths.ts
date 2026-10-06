import { ROAD_EDGES, ROAD_NODES } from "./lands.ts"
import type { Spot } from "./layout.ts"

/**
 * Walkable aisles through the great hall, as a small graph. Adventurers walk node to node instead
 * of in a straight line, so they go round tables, beds and the hearth. Coordinates match
 * world/layout.ts and world/furniture.ts; change one, check the other.
 *
 *   back row  (z = -5.5):  A  aisle between the back stations and the middle of the hall
 *   middle    (z =  2.8):  B  aisle between the middle and the front stations
 *   front     (z = 10):    C  along the front wall, to the gate
 *   the hearth sits on x = 0 between A and B, so that column is split round it (H-, H+).
 */

const HALL = {
  A1: [-16, -5.5],
  A2: [-9, -5.5],
  A3: [-3, -5.5],
  A4: [0, -5.5],
  A5: [3, -5.5],
  A6: [9, -5.5],
  A7: [16, -5.5],
  "H-": [-3.2, -1.5],
  "H+": [3.2, -1.5],
  B1: [-16, 2.8],
  B2: [-9, 2.8],
  B3: [-3, 2.8],
  B4: [0, 2.8],
  B5: [3, 2.8],
  B6: [9, 2.8],
  B7: [16, 2.8],
  C1: [-9, 10],
  C2: [0, 10],
  C3: [11, 10],
  GATE: [0, 13.6],
} as const satisfies Record<string, Spot>

/** The hall's aisles plus the island's roads, joined at the gate (ADR 0006). */
const NODES: Readonly<Record<string, Spot>> = { ...HALL, ...ROAD_NODES }

/** A hall node, or a road node (named in lands.ts, or a road hex like "R-3_5"). */
type Id = keyof typeof HALL | (string & {})
const node = (id: Id): Spot => NODES[id] ?? [0, 0]

const EDGES: readonly (readonly [Id, Id])[] = [
  ["A1", "A2"],
  ["A2", "A3"],
  ["A3", "A4"],
  ["A4", "A5"],
  ["A5", "A6"],
  ["A6", "A7"],
  ["B1", "B2"],
  ["B2", "B3"],
  ["B3", "B4"],
  ["B4", "B5"],
  ["B5", "B6"],
  ["B6", "B7"],
  ["A1", "B1"],
  ["A2", "B2"],
  ["A6", "B6"],
  ["A7", "B7"],
  ["A3", "H-"],
  ["H-", "B3"],
  ["A5", "H+"],
  ["H+", "B5"],
  ["B2", "C1"],
  ["B4", "C2"],
  ["B6", "C3"],
  ["C1", "C2"],
  ["C2", "C3"],
  ["C2", "GATE"],
  ["GATE", "OUT"],
  ...ROAD_EDGES,
]

const ADJACENT = new Map<Id, Id[]>()
for (const [a, b] of EDGES) {
  ADJACENT.set(a, [...(ADJACENT.get(a) ?? []), b])
  ADJACENT.set(b, [...(ADJACENT.get(b) ?? []), a])
}
const IDS = Object.keys(NODES) as Id[]

function distance(a: Spot, b: Spot): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function nearest(spot: Spot): Id {
  let best: Id = IDS[0] ?? "A4"
  for (const id of IDS) if (distance(node(id), spot) < distance(node(best), spot)) best = id
  return best
}

/** Short trips (same corner of the hall) go straight; longer ones take the aisles. */
const STRAIGHT_BELOW = 3.5

/**
 * The spots to walk through from `from` to `to`, ending at `to`. Dijkstra over a ~35-node graph:
 * cheap enough to run whenever a target changes.
 */
export function route(from: Spot, to: Spot): Spot[] {
  if (distance(from, to) < STRAIGHT_BELOW) return [to]
  const start = nearest(from)
  const goal = nearest(to)
  const cost = new Map<Id, number>([[start, 0]])
  const previous = new Map<Id, Id>()
  const open = new Set<Id>([start])
  while (open.size > 0) {
    let current: Id | undefined
    for (const id of open)
      if (current === undefined || (cost.get(id) ?? 0) < (cost.get(current) ?? 0)) current = id
    if (current === undefined || current === goal) break
    open.delete(current)
    for (const next of ADJACENT.get(current) ?? []) {
      const through = (cost.get(current) ?? 0) + distance(node(current), node(next))
      if (through < (cost.get(next) ?? Number.POSITIVE_INFINITY)) {
        cost.set(next, through)
        previous.set(next, current)
        open.add(next)
      }
    }
  }
  const nodes: Spot[] = []
  for (let at: Id | undefined = goal; at !== undefined; at = previous.get(at)) {
    nodes.unshift(node(at))
    if (at === start) break
  }
  // Skip a first node that lies behind us: no stepping back to an aisle we are already past.
  if (nodes.length > 1 && nodes[1] && distance(from, nodes[1]) < distance(node(start), nodes[1]))
    nodes.shift()
  return [...nodes, to]
}

/** Exported for tests and the Lab: the graph itself. */
export const AISLES = { nodes: NODES, edges: EDGES }
