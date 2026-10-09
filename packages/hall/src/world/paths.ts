import { activeWorld } from "./active.ts"
import { Heap } from "./gen/heap.ts"
import { ROAD_EDGES, ROAD_NODES } from "./lands.ts"
import { ROOM, type Spot } from "./layout.ts"

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

/** A hall node, or a road node (named in lands.ts, or a road hex like "R-3_5"). */
type Id = keyof typeof HALL | (string & {})

/**
 * The island's walking graph (world/world.ts `World.roads`). `costs`, aligned with `edges`, is what
 * walking an edge costs when it is not its length: a trail up a mountain costs by its grade (gen/relief/trails.ts).
 */
type Roads = {
  nodes: Readonly<Record<string, Spot>>
  edges: readonly (readonly [string, string])[]
  costs?: readonly number[]
}

const HALL_EDGES: readonly (readonly [Id, Id])[] = [
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
]

/** The hall's aisles plus an island's roads, joined at the gate (ADR 0006). */
interface Graph {
  nodes: Readonly<Record<string, Spot>>
  edges: readonly (readonly [Id, Id])[]
  /** The nodes an edge joins each node to, with what walking it costs. */
  adjacent: Map<Id, [Id, number][]>
  ids: Id[]
  /** The island's road nodes (no hall aisles), where spots outside the keep join the graph. */
  roadIds: Id[]
}

function graphOf(roads: Roads): Graph {
  const nodes: Readonly<Record<string, Spot>> = { ...HALL, ...roads.nodes }
  // The gate opens onto the road hex nearest it (the hand map's OUT; a repo island's avenue).
  let out: string | undefined
  for (const [id, at] of Object.entries(roads.nodes))
    if (out === undefined || distance(at, HALL.GATE) < distance(roads.nodes[out] ?? at, HALL.GATE)) out = id
  const edges: (readonly [Id, Id])[] = [
    ...HALL_EDGES,
    ...(out ? [["GATE", out] as const] : []),
    ...roads.edges,
  ]
  // The hall's aisles and the gate's edge cost their length; the island's roads their own cost, where given.
  const lead = edges.length - roads.edges.length
  const adjacent = new Map<Id, [Id, number][]>()
  edges.forEach(([a, b], i) => {
    const cost = roads.costs?.[i - lead] ?? distance(nodes[a] ?? [0, 0], nodes[b] ?? [0, 0])
    adjacent.set(a, [...(adjacent.get(a) ?? []), [b, cost]])
    adjacent.set(b, [...(adjacent.get(b) ?? []), [a, cost]])
  })
  return { nodes, edges, adjacent, ids: Object.keys(nodes) as Id[], roadIds: Object.keys(roads.nodes) }
}

const HAND_ROADS: Roads = { nodes: ROAD_NODES, edges: ROAD_EDGES }
const graphs = new WeakMap<Roads, Graph>()
function graphFor(roads: Roads): Graph {
  let graph = graphs.get(roads)
  if (!graph) {
    graph = graphOf(roads)
    graphs.set(roads, graph)
  }
  return graph
}

function distance(a: Spot, b: Spot): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Inside the keep's walls, or on the apron at its gate (the aisles' GATE node is just inside). */
function inKeep([x, z]: Spot): boolean {
  return Math.abs(x) <= ROOM.width / 2 && z >= -ROOM.depth / 2 && z <= ROOM.depth / 2 + 4
}

/** An open node: its cost so far, when it joined the open set, its id. */
type Open = readonly [number, number, Id]

/** A trail's node (gen/relief/trails.ts names them `T<massif>.<trail>.<i>`), and how near a spot must be to join at one. */
const TRAIL = /^T\d+\./
const ON_TRAIL = 3.2

/** Short trips (same corner of the hall) go straight; longer ones take the aisles. */
const STRAIGHT_BELOW = 3.5

/**
 * The spots to walk through from `from` to `to`, ending at `to`, on the active world's roads
 * (world/active.ts; the hand map's by default). Dijkstra over a graph of a few dozen to a couple of
 * thousand nodes, its open set a heap: cheap enough to run whenever a target changes.
 */
export function route(from: Spot, to: Spot, roads: Roads = activeWorld()?.roads ?? HAND_ROADS): Spot[] {
  if (distance(from, to) < STRAIGHT_BELOW) return [to]
  const { nodes: points, adjacent, ids, roadIds } = graphFor(roads)
  const node = (id: Id): Spot => points[id] ?? [0, 0]
  // A spot out on the island joins the graph at a road, never at an aisle behind the keep's wall.
  const nearest = (spot: Spot): Id => {
    const pool = inKeep(spot) ? ids : roadIds
    let best: Id = pool[0] ?? "A4"
    // A trail's nodes are joined only by a spot on the mountain, within a few paces of one; from the lowland, by the road.
    for (const id of pool)
      if (
        distance(node(id), spot) < distance(node(best), spot) &&
        (!TRAIL.test(id) || distance(node(id), spot) < ON_TRAIL)
      )
        best = id
    return best
  }
  const start = nearest(from)
  const goal = nearest(to)
  const cost = new Map<Id, number>([[start, 0]])
  const previous = new Map<Id, Id>()
  // The open set, cheapest first; between equals, the node that joined it first.
  const joined = new Map<Id, number>([[start, 0]])
  const open = new Heap<Open>((a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))
  open.push([0, 0, start])
  for (let item = open.pop(); item; item = open.pop()) {
    const [spent, , current] = item
    if (spent > (cost.get(current) ?? Number.POSITIVE_INFINITY)) continue
    if (current === goal) break
    for (const [next, walk] of adjacent.get(current) ?? []) {
      const through = spent + walk
      if (through < (cost.get(next) ?? Number.POSITIVE_INFINITY)) {
        cost.set(next, through)
        previous.set(next, current)
        if (!joined.has(next)) joined.set(next, joined.size)
        open.push([through, joined.get(next) ?? 0, next])
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

/**
 * How high the ground stands under a walker: a mountain's (the active world's relief), 0 anywhere
 * else, which is where people have always walked. Walkers follow it up the trails (scene/brain.ts).
 */
export function groundAt(x: number, z: number): number {
  return activeWorld()?.relief?.heightAt(x, z) ?? 0
}

/**
 * How fast a walker goes on a slope, as a share of the pace on the flat: uphill it falls with the
 * grade (a walking trail's 0.33 is 0.8, a stair's 0.5 is 0.7), downhill it is a touch slower than
 * the flat for the care it takes. `grade` is rise over run, positive uphill.
 */
export function pace(grade: number): number {
  return grade > 0 ? 1 - 0.6 * Math.min(grade, 0.6) : grade < -0.05 ? 0.95 : 1
}

/** Exported for tests and the Lab: the hand map's graph itself. */
export const AISLES = (({ nodes, edges }: Graph) => ({ nodes, edges }))(graphFor(HAND_ROADS))
