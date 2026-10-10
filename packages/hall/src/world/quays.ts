import { blocker, islandObstacles, type Obstacle, onDryLand } from "./clearance.ts"
import { DMath } from "./dmath.ts"
import { cellAt } from "./gen/hex.ts"
import type { Post, Spot } from "./layout.ts"
import { WATER_CLEARANCE } from "./wilds.ts"
import type { World } from "./world.ts"

/**
 * Quays: where a ferry or a bridge meets an island. A quay is a spot on dry land at the coast, facing
 * the island it serves, clear of every building and tree, and a short straight walk from the island's
 * roads (the network the keep is on), so someone can walk to it and board. Island-local coordinates
 * (the keep at the origin). Pure; deterministic.
 */

/** How far a quay keeps off a building, a tree or a wall. */
export const QUAY_CLEARANCE = 1.4
/** The sea's nearest hex centre lies within this of a quay: it stands at the water's edge, not inland. */
export const COAST_BAND = WATER_CLEARANCE + 3.5
/** The road network is at most this far from a quay, in a straight, dry walk. */
export const ROAD_REACH = 80
/** Two quays on one island keep this far apart. */
export const QUAY_SPACING = 9
/** …and this far from a bridge's head, which is wide, and which a ferry's berth must keep off. */
export const BRIDGE_SPACING = 24
/**
 * A bridge's head wants an apron, in the quay's frame (out to sea, and across it): this far back
 * inland, this far ahead where the ramp climbs, this far to either side. Clear of every building,
 * wall and tree, so the bridge never lands against one.
 */
export const APRON = { back: 9, ahead: 12, half: 7.5 } as const
/** On a cramped island, at least the head itself: the ramp's length and the deck's width (world/bridges.ts). */
export const HEAD = { back: 3, ahead: 9, half: 6.5 } as const
const APRON_STEP = 2
/** A building, as `islandObstacles` names it: what a bridge must never land against. */
export const BUILDING = /^building_/

const seas = new WeakMap<World, Spot[]>()
/** The open sea's hex centres (a lake is not a harbour). */
function seaOf(world: World): Spot[] {
  let sea = seas.get(world)
  if (!sea) {
    sea = world.island.water.filter((w) => world.terrain.at(cellAt(w)) === "~")
    seas.set(world, sea)
  }
  return sea
}

/** A trail's node (world/gen/relief/trails.ts names them `T<massif>.<trail>.<i>`). */
const TRAIL = /^T\d+\./

interface Roads {
  /** Every node a walker joins from the lowland (trails aside). */
  all: [string, Spot][]
  /** The ids the keep's own network reaches. */
  main: Set<string>
}
const roads = new WeakMap<World, Roads>()
function roadsOf(world: World): Roads {
  let known = roads.get(world)
  if (!known) {
    const adjacent = new Map<string, string[]>()
    for (const [a, b] of world.roads.edges) {
      adjacent.set(a, [...(adjacent.get(a) ?? []), b])
      adjacent.set(b, [...(adjacent.get(b) ?? []), a])
    }
    const all = Object.entries(world.roads.nodes).filter(([id]) => !TRAIL.test(id))
    // From the road node nearest the keep.
    const from = (node: [string, Spot]): number => DMath.hypot(node[1][0], node[1][1])
    const start = [...all].sort((a, b) => from(a) - from(b) || (a[0] < b[0] ? -1 : 1))[0]?.[0]
    const main = new Set<string>(start ? [start] : [])
    for (const id of main) for (const next of adjacent.get(id) ?? []) main.add(next)
    known = { all, main }
    roads.set(world, known)
  }
  return known
}

const distance = (a: Spot, b: Spot): number => DMath.hypot(a[0] - b[0], a[1] - b[1])

/** What a quay keeps off: everything, or (planning) all but the wilds, which a quay's own site clears. */
const obstaclesOf = (world: World, planning: boolean): readonly Obstacle[] =>
  islandObstacles(world).filter((o) => !planning || !o.name.startsWith("wild "))

/**
 * Why `spot` is no quay of `world`'s, or undefined when it is one. `planning`: the wilds don't count
 * (`withQuays` clears them), as when choosing; judged on the finished world they do.
 */
export function quayProblem(world: World, spot: Spot, planning = false): string | undefined {
  if (!onDryLand(spot, world)) return "not dry land"
  const obstacles = obstaclesOf(world, planning)
  if (blocker(spot, obstacles, QUAY_CLEARANCE)) return "blocked by a building or tree"
  if (!seaOf(world).some((w) => distance(w, spot) <= COAST_BAND)) return "not at the coast"
  // The road a walker joins from here: the nearest node, as the router takes it (world/paths.ts).
  const { all, main } = roadsOf(world)
  const road = all.reduce<[string, Spot] | undefined>(
    (best, node) => (!best || distance(node[1], spot) < distance(best[1], spot) ? node : best),
    undefined,
  )
  if (!road || distance(road[1], spot) > ROAD_REACH) return "no road within reach"
  if (!main.has(road[0])) return "its road is cut off from the keep"
  // The last stretch to the road is walked in a straight line: dry and clear all the way.
  const n = Math.ceil(distance(road[1], spot) / 2)
  for (let k = 1; k < n; k++) {
    const at: Spot = [spot[0] + ((road[1][0] - spot[0]) * k) / n, spot[1] + ((road[1][1] - spot[1]) * k) / n]
    if (!onDryLand(at, world)) return "no dry walk to the road"
    if (blocker(at, obstacles, 0.5)) return "a building in the way to the road"
  }
  return undefined
}

/** Why the bridge head at `spot`, facing `facing` (a unit vector out to sea), has no clear apron; undefined when it has. */
export function apronProblem(
  world: World,
  spot: Spot,
  facing: Spot,
  apron: { back: number; ahead: number; half: number } = APRON,
  only?: RegExp,
): string | undefined {
  // The quay's own lantern stands there by design (world/lights.ts); everything else stays off.
  const obstacles = obstaclesOf(world, true).filter(
    (o) => !o.name.startsWith("light ") && (!only || only.test(o.name)),
  )
  const [ux, uz] = facing
  for (let f = -apron.back; f <= apron.ahead; f += APRON_STEP)
    for (let s = -apron.half; s <= apron.half; s += APRON_STEP) {
      const at: Spot = [spot[0] + ux * f + uz * s, spot[1] + uz * f - ux * s]
      const hit = blocker(at, obstacles, 0.4)
      if (hit) return `the apron meets ${hit.name}`
    }
  return undefined
}

/** What a quay is wanted for (island-local `facing`, out to sea): where it must keep its apron, and whom it keeps off. */
export interface QuayWish {
  /** The unit vector from the quay out towards its partner. Given, the quay's apron is kept clear if any spot has one. */
  facing?: Spot
  /** It is a bridge's head: it keeps BRIDGE_SPACING off the others. */
  bridge?: boolean
  /** The bridge heads already on the island. */
  heads?: readonly Spot[]
}

/**
 * A quay on `world`'s coast as near `target` (a point of the island, the coast the partner's lands
 * nearest) as one can be, at least QUAY_SPACING from each of `taken`. Undefined when the island has
 * no valid spot (it is then left without that link).
 */
export function quayFacing(
  world: World,
  target: Spot,
  taken: readonly Spot[] = [],
  wish: QuayWish = {},
): Spot | undefined {
  const candidates: { at: Spot; score: number }[] = []
  for (const tile of world.island.tiles) {
    if (!tile.piece.startsWith("hex_coast")) continue
    // The coast tile's centre, and a step or two in from the water.
    for (const inland of [0, 1.5, 3, 4.5]) {
      const here = DMath.hypot(tile.x, tile.z) || 1
      const at: Spot = [
        Math.round((tile.x - (tile.x / here) * inland) * 100) / 100,
        Math.round((tile.z - (tile.z / here) * inland) * 100) / 100,
      ]
      candidates.push({ at, score: -distance(at, target) })
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.at[0] - b.at[0] || a.at[1] - b.at[1])
  const apart = (other: Spot): number =>
    wish.bridge || wish.heads?.includes(other) ? BRIDGE_SPACING : QUAY_SPACING
  // The best: a full apron and room for the bridge heads; then the head alone; failing both any valid
  // spot (a link is worth a tight landing).
  const tiers: { apron: typeof APRON | typeof HEAD; only?: RegExp }[] =
    wish.bridge && wish.facing ? [{ apron: APRON }, { apron: HEAD }, { apron: HEAD, only: BUILDING }] : []
  for (const [tier, { apron, only }] of [...tiers, {} as (typeof tiers)[number]].entries())
    for (const { at } of candidates) {
      if (taken.some((other) => distance(other, at) < (tier < tiers.length ? apart(other) : QUAY_SPACING)))
        continue
      if (quayProblem(world, at, true)) continue
      if (apron && wish.facing && apronProblem(world, at, wish.facing, apron, only)) continue
      return at
    }
  return undefined
}

/** The road node a quay's walk joins: the nearest one the keep's network reaches. */
function roadFor(world: World, spot: Spot): string | undefined {
  const { all, main } = roadsOf(world)
  let best: [string, Spot] | undefined
  for (const node of all)
    if (main.has(node[0]) && (!best || distance(node[1], spot) < distance(best[1], spot))) best = node
  return best?.[0]
}

/**
 * The world with each quay made a work place with a road of its own (`facing`: a unit vector, out to
 * sea): a post, so the wilds keep off it and lanterns stand by it (world/wilds.ts, world/lights.ts), and a
 * road node `Q<n>` joined to the network, so the router walks to it. A new world; the one given is not changed.
 */
export function withQuays(
  world: World,
  quays: readonly { local: Spot; facing: Spot; span?: number }[],
): World {
  if (quays.length === 0) return world
  const nodes: Record<string, Spot> = { ...world.roads.nodes }
  const edges: (readonly [string, string])[] = [...world.roads.edges]
  const costs = world.roads.costs ? [...world.roads.costs] : undefined
  const sites = quays.map(({ local, facing, span }, n) => {
    const id = `Q${n}`
    nodes[id] = local
    const to = roadFor(world, local)
    if (to) {
      edges.push([id, to])
      costs?.push(distance(local, world.roads.nodes[to] as Spot))
    }
    const post: Post = [local[0], local[1], DMath.atan2(facing[0], facing[1])]
    // A bridge (`span`: its length) keeps its apron and its whole way over land clear of what grows.
    const reserved: [Spot, Spot][] =
      span === undefined
        ? []
        : [
            [
              [local[0] - facing[0] * APRON.back, local[1] - facing[1] * APRON.back],
              [local[0] + facing[0] * span, local[1] + facing[1] * span],
            ],
          ]
    return {
      at: local,
      posts: [post],
      wilds: { mix: { grass: 0.6, rock: 0.4 } },
      ...(reserved.length > 0 ? { reserved } : {}),
    }
  })
  return {
    ...world,
    roads: { nodes, edges, ...(costs ? { costs } : {}) },
    sites: [...world.sites, ...sites],
  }
}
