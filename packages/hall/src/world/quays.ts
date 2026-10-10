import { blocker, islandObstacles, type Obstacle, onDryLand } from "./clearance.ts"
import { DMath } from "./dmath.ts"
import { cellAt } from "./gen/hex.ts"
import type { Post, Spot } from "./layout.ts"
import { isLand } from "./linkStub.ts"
import { roadFrom, roadWithin } from "./quayRoads.ts"
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
/**
 * A ferry's dock wants room for its timber, in the quay's frame (as APRON): the deck starts a little
 * inland, the pier runs out to PIER, and its landing stage is wider; clear of every building.
 */
export const DOCK = { back: 3.5, ahead: 12, half: 4.5 } as const
const APRON_STEP = 2
/**
 * A bridge leaves its island at the shore: its way over its own land is at most this long (about a
 * hex), and the rest of it is over the strait. Beyond that the head is not on the coast facing the partner.
 */
export const HEAD_LAND = 10
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
  /** The nodes the keep's own network reaches (trails aside). */
  network: [string, Spot][]
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
    known = { network: all.filter(([id]) => main.has(id)) }
    roads.set(world, known)
  }
  return known
}

const distance = (a: Spot, b: Spot): number => DMath.hypot(a[0] - b[0], a[1] - b[1])

const planned = new WeakMap<World, readonly Obstacle[]>()
/** What a quay keeps off: everything, or (planning) all but the wilds, which a quay's own site clears. */
function obstaclesOf(world: World, planning: boolean): readonly Obstacle[] {
  if (!planning) return islandObstacles(world)
  let known = planned.get(world)
  if (!known) {
    known = islandObstacles(world).filter((o) => !o.name.startsWith("wild "))
    planned.set(world, known)
  }
  return known
}

/**
 * Why `spot` is no quay of `world`'s, or undefined when it is one. `planning`: the wilds don't count
 * (`withQuays` clears them), as when choosing; judged on the finished world they do.
 */
export function quayProblem(world: World, spot: Spot, planning = false): string | undefined {
  if (!onDryLand(spot, world)) return "not dry land"
  const obstacles = obstaclesOf(world, planning)
  if (blocker(spot, obstacles, QUAY_CLEARANCE)) return "blocked by a building or tree"
  if (!seaOf(world).some((w) => distance(w, spot) <= COAST_BAND)) return "not at the coast"
  // The road to the keep's network, over dry clear ground (world/quayRoads.ts).
  return roadWithin(world, spot, obstacles, roadsOf(world).network) ? undefined : "no road within reach"
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

/**
 * Why a bridge head at `spot` facing `facing` (a unit vector out to sea) is not at the shore: its way
 * runs on over its own island's land past HEAD_LAND, within `span`; undefined when it leaves the land at once.
 */
export function headProblem(world: World, spot: Spot, facing: Spot, span: number): string | undefined {
  for (let t = HEAD_LAND; t <= span; t += APRON_STEP)
    if (isLand(world, [spot[0] + facing[0] * t, spot[1] + facing[1] * t])) return "its way runs on over land"
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
 * The valid quays on `world`'s coast, nearest `target` (a point of the island, the coast the partner's
 * lands nearest) first, each at least QUAY_SPACING from each of `taken`: lazily, best tier first (a
 * bridge's head: full apron, then the head alone, then any), none twice. None at all and the island is
 * left without that link.
 */
export function* quayChoices(
  world: World,
  target: Spot,
  taken: readonly Spot[] = [],
  wish: QuayWish = {},
): Generator<Spot> {
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
  // A bridge's head and every other quay keep BRIDGE_SPACING apart, in every tier: a ferry's dock too.
  const apart = (other: Spot): number =>
    wish.bridge || wish.heads?.includes(other) ? BRIDGE_SPACING : QUAY_SPACING
  const tiers: { apron: typeof APRON | typeof HEAD | typeof DOCK; only?: RegExp }[] = !wish.facing
    ? []
    : wish.bridge
      ? [{ apron: APRON }, { apron: HEAD }, { apron: HEAD, only: BUILDING }]
      : [{ apron: DOCK, only: BUILDING }]
  const given = new Set<Spot>()
  // Whether a spot is a quay at all, found once however many tiers look at it.
  const valid = new Map<Spot, boolean>()
  const quay = (at: Spot): boolean => {
    let ok = valid.get(at)
    if (ok === undefined) {
      ok = !taken.some((other) => distance(other, at) < apart(other)) && !quayProblem(world, at, true)
      valid.set(at, ok)
    }
    return ok
  }
  for (const { apron, only } of [...tiers, {} as (typeof tiers)[number]])
    for (const { at } of candidates) {
      if (given.has(at) || !quay(at)) continue
      if (apron && wish.facing && apronProblem(world, at, wish.facing, apron, only)) continue
      given.add(at)
      yield at
    }
}

/** The best quay of `quayChoices`; undefined when the island has no valid spot. */
export const quayFacing = (
  world: World,
  target: Spot,
  taken: readonly Spot[] = [],
  wish: QuayWish = {},
): Spot | undefined => quayChoices(world, target, taken, wish).next().value

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
    // The quay's road: the stops from the quay to the network, new waypoints named `Q<n>.<k>`.
    let from = id
    for (const [k, stop] of (
      roadFrom(world, local, obstaclesOf(world, true), roadsOf(world).network) ?? []
    ).entries()) {
      const to = stop.id ?? `${id}.${k}`
      nodes[to] = stop.at
      edges.push([from, to])
      costs?.push(distance(nodes[from] as Spot, stop.at))
      from = to
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
