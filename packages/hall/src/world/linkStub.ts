import { crossingsOf, type Shore } from "./archipelago.ts"
import type { Archipelago } from "./archipelagoSource.ts"
import { DMath } from "./dmath.ts"
import { cellAt, key } from "./gen/hex.ts"
import { BERTH_SIDE } from "./lanes.ts"
import type { Spot } from "./layout.ts"
import type { World } from "./world.ts"

/**
 * THE ADAPTER to the repo-split archipelago's links. Everything about links (ferries, bridges,
 * travel) reads islands and links through the types below; this module is the only place that
 * derives them from the existing `?archipelago` placement (neighbouring islands, world/archipelago.ts
 * `crossingsOf`). When the repo-split archipelago provides its own `IslandLink`s, replace
 * `linkSetOf` and keep the shapes.
 */

/** A link between two islands (by id): how tightly they are coupled, and what joins them. */
export interface IslandLink {
  a: string
  b: string
  weight: number
  /** The strait between the two quays' landings, world units. */
  gap?: number
  kind: "bridge" | "ferry"
}

/** Where a link meets an island's coast, in world coordinates. */
export interface Quay {
  /** The dry coast point the landing stands on. */
  land: Spot
  /** Where the quay's pier ends over the water, straight out from `land` towards the partner. */
  end: Spot
  /** Heading (radians, 0 = +z) from land out to sea, towards the partner. */
  facing: number
  /** The ground's height at `land`. */
  height: number
  /** Which side of the pier a boat lies on: 1 its right (looking out to sea), -1 its left; the side with the water. */
  berthSide: 1 | -1
}

export interface LinkIsland {
  id: string
  center: Spot
  reach: number
  /** One quay per link, keyed by the partner's id. */
  quays: Readonly<Record<string, Quay>>
}

export interface LinkSet {
  islands: readonly LinkIsland[]
  links: readonly IslandLink[]
}

/** Two quays this close (coast to coast) are joined by a bridge, else a ferry. */
export const BRIDGE_MAX = 70
/** How far a pier reaches out from the dry coast. */
export const PIER = 12
/** The sea-ward search for the coast starts this far past an island's furthest land. */
const SEARCH_PAST = 6
/** A quay stands this far inside the first dry point, so it is firmly on land. */
const INLAND = 2

const landSets = new WeakMap<World, Set<string>>()

/** Whether a point is on land: its hex is one of the island's tiles. */
export function isLand(world: World, [x, z]: Spot): boolean {
  let land = landSets.get(world)
  if (!land) {
    land = new Set()
    for (const tile of world.island.tiles)
      if (tile.piece !== "hex_water") land.add(key(cellAt([tile.x, tile.z])))
    landSets.set(world, land)
  }
  return land.has(key(cellAt([x, z])))
}

/** The quay of an island (at `center`, in `world`) facing `toward`: its outermost dry point on that bearing. */
export function quayFacing(world: World, center: Spot, reach: number, toward: Spot): Quay {
  const dx = toward[0] - center[0]
  const dz = toward[1] - center[1]
  const length = DMath.hypot(dx, dz) || 1
  const ux = dx / length
  const uz = dz / length
  const at = (r: number): Spot => [ux * r, uz * r]
  let r = reach + SEARCH_PAST
  while (r > 0 && !isLand(world, at(r))) r -= 1
  const dry = Math.max(0, r - INLAND)
  const [lx, lz] = at(dry)
  const [ex, ez] = at(dry + PIER)
  const facing = DMath.atan2(ux, uz)
  return {
    land: [center[0] + lx, center[1] + lz],
    end: [center[0] + ex, center[1] + ez],
    facing,
    height: world.ground.heightAt(lx, lz),
    berthSide: berthSideOf(world, [ex, ez], facing),
  }
}

/** The side of a pier ending at `end` (the island's own coordinates) where a boat's berth has the least land. */
export function berthSideOf(world: World, end: Spot, facing: number): 1 | -1 {
  const ux = DMath.sin(facing)
  const uz = DMath.cos(facing)
  const landOn = (side: number): number => {
    let count = 0
    // The hull's footprint beside the pier: stern to bow, and out to its beam.
    for (const along of [-9, -6, -3, 0, 3])
      for (const out of [BERTH_SIDE - 2.4, BERTH_SIDE, BERTH_SIDE + 2.4])
        if (isLand(world, [end[0] + ux * along + uz * out * side, end[1] + uz * along - ux * out * side]))
          count++
    return count
  }
  return landOn(1) <= landOn(-1) ? 1 : -1
}

/** Weight of a link: the nearer its quays, the tighter (1 touching, towards 0 far apart). */
const weightOf = (gap: number): number => 1 / (1 + gap / 100)

/**
 * The islands of an archipelago with a quay for each crossing, and the links: every clear crossing
 * is a link, a bridge when the two quays are within BRIDGE_MAX, else a ferry. `bridgeMax` lets a
 * lab force a bridge.
 */
export function linkSetOf(archipelago: Archipelago, home: World, bridgeMax = BRIDGE_MAX): LinkSet {
  const sources = [
    { id: archipelago.home.repo, info: archipelago.home, world: home },
    ...archipelago.islands.map((island) => ({ id: island.repo, info: island, world: island.world })),
  ]
  const shores: Shore[] = sources.map(({ info }) => ({ at: info.at, reach: info.reach }))
  const quays: Record<string, Record<string, Quay>> = Object.fromEntries(sources.map((s) => [s.id, {}]))
  const links: IslandLink[] = []
  for (const [i, j] of crossingsOf(shores)) {
    const a = sources[i]
    const b = sources[j]
    if (!a || !b) continue
    const qa = quayFacing(a.world, a.info.at, a.info.reach, b.info.at)
    const qb = quayFacing(b.world, b.info.at, b.info.reach, a.info.at)
    ;(quays[a.id] as Record<string, Quay>)[b.id] = qa
    ;(quays[b.id] as Record<string, Quay>)[a.id] = qb
    const gap = DMath.hypot(qa.land[0] - qb.land[0], qa.land[1] - qb.land[1])
    links.push({ a: a.id, b: b.id, weight: weightOf(gap), gap, kind: gap <= bridgeMax ? "bridge" : "ferry" })
  }
  return {
    islands: sources.map((s) => ({
      id: s.id,
      center: s.info.at,
      reach: s.info.reach,
      quays: quays[s.id] as Record<string, Quay>,
    })),
    links,
  }
}
