import { type Bridge, bridgeOf } from "./bridges.ts"
import { type Wall, wallOf } from "./bridgeWalls.ts"
import { type Timetable, timetableOf } from "./ferrySchedule.ts"
import { type Lane, laneClear, laneOf } from "./lanes.ts"
import type { IslandLink, LinkSet, Quay } from "./linkStub.ts"

/**
 * Every link of an archipelago made concrete (what the scene draws and the travel planner reads):
 * a ferry link gets its sea lane and timetable, a bridge link its bridge. Built once per
 * archipelago; pure. The bridges are laid first: the ferries' lanes go round them, and a ferry with no
 * way round (or none that keeps clear) is not run: its link has no route.
 */
export interface LinkRoute {
  link: IslandLink
  /** The quays at the link's `a` and `b` ends. */
  quays: readonly [Quay, Quay]
  lane?: Lane
  table?: Timetable
  bridge?: Bridge
}

export interface LinkNet {
  set: LinkSet
  routes: readonly LinkRoute[]
  /** The bridges' axes: where no ship goes (world/bridgeWalls.ts). */
  walls: readonly Wall[]
}

export function netOf(set: LinkSet): LinkNet {
  const routes: LinkRoute[] = []
  const ends = (link: IslandLink): [Quay, Quay] | undefined => {
    const qa = set.islands.find((island) => island.id === link.a)?.quays[link.b]
    const qb = set.islands.find((island) => island.id === link.b)?.quays[link.a]
    return qa && qb ? [qa, qb] : undefined
  }
  for (const link of set.links) {
    const quays = link.kind === "bridge" ? ends(link) : undefined
    if (quays) routes.push({ link, quays, bridge: bridgeOf(quays[0], quays[1]) })
  }
  const walls = routes.flatMap((route) => (route.bridge ? [wallOf(route.bridge)] : []))
  for (const link of set.links) {
    const quays = link.kind === "bridge" ? undefined : ends(link)
    if (!quays) continue
    const others = set.islands
      .filter((island) => island.id !== link.a && island.id !== link.b)
      .map(({ center, reach }) => ({ center, reach }))
    const lane = laneOf(quays[0], quays[1], others, walls)
    if (!laneClear(lane, walls)) continue
    routes.push({ link, quays, lane, table: timetableOf(lane, `${link.a}|${link.b}`) })
  }
  return { set, routes, walls }
}
