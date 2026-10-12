import type { DeckPoint } from "./bridges.ts"
import { type End, nextDeparture } from "./ferrySchedule.ts"
import type { Spot } from "./layout.ts"
import type { LinkNet, LinkRoute } from "./linkNet.ts"
import type { IslandLink } from "./linkStub.ts"

/**
 * Crossing the archipelago, planned (nothing draws or follows it yet): the legs one traveller takes
 * from one island to another, leaving at story time `t`. Pure and deterministic, like the ferries'
 * timetables it reads.
 *
 *   walk    on an island, to a quay (a ferry's pier end, a bridge's landing)
 *   ferry   board at the next departure, ride the lane, step off at the other pier
 *   bridge  walk the bridge's deck to the other landing
 *
 * The plan is the earliest arrival (a route through a third island is a walk across it between two
 * crossings). It starts at the island's centre and ends on the pier or landing it arrives at; a
 * caller walks the rest.
 */

/** World units a second on foot (as scene/brain.ts WALK_SPEED). */
export const WALK_SPEED = 3.4

export type Leg =
  | { kind: "walk"; island: string; from: Spot; to: Spot; startAt: number; endAt: number }
  | {
      kind: "ferry"
      link: IslandLink
      from: string
      to: string
      /** Where the traveller boards and steps off: the two piers' ends. */
      board: Spot
      alight: Spot
      /** The departure, and the arrival. */
      startAt: number
      endAt: number
    }
  | {
      kind: "bridge"
      link: IslandLink
      from: string
      to: string
      /** The deck from the leaving landing to the arriving one. */
      path: readonly DeckPoint[]
      startAt: number
      endAt: number
    }

const dist = (a: Spot, b: Spot): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Length of a walk along a deck (its slope counted). */
function deckLength(path: readonly DeckPoint[]): number {
  let length = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as DeckPoint
    const b = path[i] as DeckPoint
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return length
}

interface Reach {
  at: number
  /** Where the traveller stands on arriving. */
  spot: Spot
  legs: Leg[]
}

/** The crossing `route` offers from island `from`, started by someone at `spot` at time `t`. */
function cross(route: LinkRoute, from: string, spot: Spot, t: number): { to: string; reach: Reach } {
  const here: End = route.link.a === from ? "a" : "b"
  const mine = route.quays[here === "a" ? 0 : 1]
  const theirs = route.quays[here === "a" ? 1 : 0]
  const to = here === "a" ? route.link.b : route.link.a
  if (route.bridge) {
    const path = here === "a" ? route.bridge.path : [...route.bridge.path].reverse()
    const first = path[0] as DeckPoint
    const last = path[path.length - 1] as DeckPoint
    const ready = t + dist(spot, mine.land) / WALK_SPEED
    const endAt = ready + deckLength(path) / WALK_SPEED
    return {
      to,
      reach: {
        at: endAt,
        spot: [last[0], last[1]],
        legs: [
          ...(dist(spot, mine.land) > 0.5 ? [walk(from, spot, [first[0], first[1]], t, ready)] : []),
          { kind: "bridge", link: route.link, from, to, path, startAt: ready, endAt },
        ],
      },
    }
  }
  const table = route.table
  if (!table) throw new Error(`link ${route.link.a}|${route.link.b} has neither bridge nor ferry`)
  const ready = t + dist(spot, mine.end) / WALK_SPEED
  const startAt = nextDeparture(table, here, ready)
  const endAt = startAt + table.sail
  return {
    to,
    reach: {
      at: endAt,
      spot: theirs.end,
      legs: [
        walk(from, spot, mine.end, t, ready),
        {
          kind: "ferry",
          link: route.link,
          from,
          to,
          board: mine.end,
          alight: theirs.end,
          startAt,
          endAt,
        },
      ],
    },
  }
}

const walk = (island: string, from: Spot, to: Spot, startAt: number, endAt: number): Leg => ({
  kind: "walk",
  island,
  from,
  to,
  startAt,
  endAt,
})

/**
 * The legs from island `from` to island `to` for someone setting out at story time `t`, or null when
 * the links don't join them. Earliest arrival wins; ties go to the route found first (the links'
 * order), so the plan is stable.
 */
export function travelBetween(net: LinkNet, from: string, to: string, t: number): Leg[] | null {
  const start = net.set.islands.find((island) => island.id === from)
  if (!start) return null
  if (from === to) return []
  const best = new Map<string, Reach>([[from, { at: t, spot: start.center, legs: [] }]])
  const done = new Set<string>()
  for (;;) {
    // The unsettled island reached soonest.
    let current: string | undefined
    for (const [id, reach] of best)
      if (!done.has(id) && (current === undefined || reach.at < (best.get(current) as Reach).at)) current = id
    if (current === undefined) return null
    if (current === to) return (best.get(to) as Reach).legs
    done.add(current)
    const here = best.get(current) as Reach
    for (const route of net.routes) {
      if (route.link.a !== current && route.link.b !== current) continue
      const step = cross(route, current, here.spot, here.at)
      const known = best.get(step.to)
      if (done.has(step.to) || (known && known.at <= step.reach.at)) continue
      best.set(step.to, { ...step.reach, legs: [...here.legs, ...step.reach.legs] })
    }
  }
}
