import { type Bridge, bridgeOf } from "./bridges.ts"
import { type Timetable, timetableOf } from "./ferrySchedule.ts"
import { type Lane, laneOf } from "./lanes.ts"
import type { IslandLink, LinkSet, Quay } from "./linkStub.ts"

/**
 * Every link of an archipelago made concrete (what the scene draws and the travel planner reads):
 * a ferry link gets its sea lane and timetable, a bridge link its bridge. Built once per
 * archipelago; pure.
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
}

export function netOf(set: LinkSet): LinkNet {
  const routes: LinkRoute[] = []
  for (const link of set.links) {
    const a = set.islands.find((island) => island.id === link.a)
    const b = set.islands.find((island) => island.id === link.b)
    const qa = a?.quays[link.b]
    const qb = b?.quays[link.a]
    if (!qa || !qb) continue
    if (link.kind === "bridge") {
      routes.push({ link, quays: [qa, qb], bridge: bridgeOf(qa, qb) })
      continue
    }
    const others = set.islands
      .filter((island) => island.id !== link.a && island.id !== link.b)
      .map(({ center, reach }) => ({ center, reach }))
    const lane = laneOf(qa, qb, others)
    routes.push({ link, quays: [qa, qb], lane, table: timetableOf(lane, `${link.a}|${link.b}`) })
  }
  return { set, routes }
}
