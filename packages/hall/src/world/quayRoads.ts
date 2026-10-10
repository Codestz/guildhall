import { blocker, type Obstacle, onDryLand } from "./clearance.ts"
import { DMath } from "./dmath.ts"
import { Heap } from "./gen/heap.ts"
import type { Spot } from "./layout.ts"
import type { World } from "./world.ts"

/**
 * The road from a quay to the keep's network: straight to the nearest road it can reach over dry,
 * clear ground; where the coast is cut by an inlet or a town, round them, by the shortest way over a
 * grid of such ground, drawn tight. Pure; deterministic.
 */

/** A road is at most this long. */
export const ROAD_REACH = 100
/** The search grid's spacing. */
const GRID = 2.5
/** A walk is checked at this spacing. */
const STEP = 2
/** A road keeps this far off a building or a tree; a grid point, a little more. */
const CLEAR = 0.5
const GRID_CLEAR = 0.9

/** A stop on a road: an existing node of the network (`id`), or a new waypoint. */
export interface Stop {
  at: Spot
  id?: string
}

const distance = (a: Spot, b: Spot): number => DMath.hypot(a[0] - b[0], a[1] - b[1])

/** Whether a straight walk from `a` to `b` stays on dry land and clear of the obstacles. */
function clearWalk(world: World, obstacles: readonly Obstacle[], a: Spot, b: Spot): boolean {
  const n = Math.ceil(distance(a, b) / STEP)
  for (let k = 1; k < n; k++) {
    const at: Spot = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]
    if (!onDryLand(at, world) || blocker(at, obstacles, CLEAR)) return false
  }
  return true
}

/** The grid's points that are dry and clear, found as they are asked (by their column and row). */
const grids = new WeakMap<readonly Obstacle[], Map<string, boolean>>()
function openAt(world: World, obstacles: readonly Obstacle[], col: number, row: number): boolean {
  let known = grids.get(obstacles)
  if (!known) {
    known = new Map()
    grids.set(obstacles, known)
  }
  const id = `${col},${row}`
  let open = known.get(id)
  if (open === undefined) {
    const at: Spot = [col * GRID, row * GRID]
    open = onDryLand(at, world) && !blocker(at, obstacles, GRID_CLEAR)
    known.set(id, open)
  }
  return open
}

const AROUND = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

interface Cell {
  col: number
  row: number
  /** The way to the network over the grid: its length, and the cell before this one (none: a road node is in sight). */
  cost: number
  from?: string
  /** The node in sight, for a cell that has one. */
  node?: readonly [string, Spot]
}
const cellKey = (col: number, row: number): string => `${col},${row}`
const pointOf = (cell: { col: number; row: number }): Spot => [cell.col * GRID, cell.row * GRID]

const fields = new WeakMap<readonly Obstacle[], Map<string, Cell>>()
/**
 * Every grid point within ROAD_REACH of the network, over dry clear ground, with its shortest way
 * there: one search from the network's nodes outwards, kept for the world.
 */
function fieldOf(
  world: World,
  obstacles: readonly Obstacle[],
  network: readonly (readonly [string, Spot])[],
): Map<string, Cell> {
  let field = fields.get(obstacles)
  if (field) return field
  field = new Map<string, Cell>()
  const open = new Heap<Cell>((a, b) => a.cost < b.cost)
  for (const node of network) {
    const [c0, r0] = [Math.round(node[1][0] / GRID), Math.round(node[1][1] / GRID)]
    for (let dc = -2; dc <= 2; dc++)
      for (let dr = -2; dr <= 2; dr++) {
        const [col, row] = [c0 + dc, r0 + dr]
        const cost = distance(node[1], pointOf({ col, row }))
        const key = cellKey(col, row)
        if (cost >= (field.get(key)?.cost ?? Number.POSITIVE_INFINITY)) continue
        if (
          !openAt(world, obstacles, col, row) ||
          !clearWalk(world, obstacles, node[1], pointOf({ col, row }))
        )
          continue
        const cell: Cell = { col, row, cost, node }
        field.set(key, cell)
        open.push(cell)
      }
  }
  for (let item = open.pop(); item; item = open.pop()) {
    if (item !== field.get(cellKey(item.col, item.row))) continue
    for (const [dc, dr] of AROUND) {
      const [col, row] = [item.col + dc, item.row + dr]
      const cost = item.cost + GRID * (dc && dr ? Math.SQRT2 : 1)
      const key = cellKey(col, row)
      if (cost > ROAD_REACH || cost >= (field.get(key)?.cost ?? Number.POSITIVE_INFINITY)) continue
      if (!openAt(world, obstacles, col, row)) continue
      const cell: Cell = { col, row, cost, from: cellKey(item.col, item.row) }
      field.set(key, cell)
      open.push(cell)
    }
  }
  fields.set(obstacles, field)
  return field
}

/** The grid point `spot` walks to first: the one in sight with the shortest way on (`any`: the first within ROAD_REACH). */
function startOf(
  world: World,
  spot: Spot,
  obstacles: readonly Obstacle[],
  field: Map<string, Cell>,
  any: boolean,
): Cell | undefined {
  let start: Cell | undefined
  let total = ROAD_REACH
  const [c0, r0] = [Math.round(spot[0] / GRID), Math.round(spot[1] / GRID)]
  for (let dc = -2; dc <= 2; dc++)
    for (let dr = -2; dr <= 2; dr++) {
      const cell = field.get(cellKey(c0 + dc, r0 + dr))
      if (!cell) continue
      const cost = cell.cost + distance(spot, pointOf(cell))
      if (cost < total && clearWalk(world, obstacles, spot, pointOf(cell))) {
        if (any) return cell
        start = cell
        total = cost
      }
    }
  return start
}

/** Whether a road from `spot` to the network is no longer than ROAD_REACH (the same search `roadFrom` makes, without drawing the road). */
export function roadWithin(
  world: World,
  spot: Spot,
  obstacles: readonly Obstacle[],
  network: readonly (readonly [string, Spot])[],
): boolean {
  return startOf(world, spot, obstacles, fieldOf(world, obstacles, network), true) !== undefined
}

/** The shortest way from `spot` over the grid to the network, drawn tight; undefined when it is further than ROAD_REACH. */
function gridRoad(
  world: World,
  spot: Spot,
  obstacles: readonly Obstacle[],
  network: readonly (readonly [string, Spot])[],
): Stop[] | undefined {
  const field = fieldOf(world, obstacles, network)
  const start = startOf(world, spot, obstacles, field, false)
  if (!start) return undefined
  const path: Spot[] = [spot]
  let goal: readonly [string, Spot] | undefined
  for (let cell: Cell | undefined = start; cell; cell = cell.from ? field.get(cell.from) : undefined) {
    path.push(pointOf(cell))
    goal = cell.node
  }
  return tighten(world, obstacles, path, goal as readonly [string, Spot])
}

/** A road drawn tight: from each stop to the furthest one in sight, then on from there. */
function tighten(
  world: World,
  obstacles: readonly Obstacle[],
  path: readonly Spot[],
  goal: readonly [string, Spot],
): Stop[] {
  const all = [...path, goal[1]]
  const out: Stop[] = []
  for (let from = 0; from < all.length - 1; ) {
    let to = all.length - 1
    while (to > from + 1 && !clearWalk(world, obstacles, all[from] as Spot, all[to] as Spot)) to--
    out.push(to === all.length - 1 ? { at: goal[1], id: goal[0] } : { at: all[to] as Spot })
    from = to
  }
  return out
}

/**
 * The road from `spot` to one of the `network`'s nodes, its stops in order (the node last), or
 * undefined when none is within ROAD_REACH: straight to the nearest node that is in sight, else round
 * whatever is in the way.
 */
export function roadFrom(
  world: World,
  spot: Spot,
  obstacles: readonly Obstacle[],
  network: readonly (readonly [string, Spot])[],
): Stop[] | undefined {
  const near = network
    .filter(([, node]) => distance(node, spot) <= ROAD_REACH)
    .sort((a, b) => distance(a[1], spot) - distance(b[1], spot) || (a[0] < b[0] ? -1 : 1))
  const straight = near.find(([, node]) => clearWalk(world, obstacles, spot, node))
  if (straight) return [{ at: straight[1], id: straight[0] }]
  return near.length > 0 ? gridRoad(world, spot, obstacles, near) : undefined
}
