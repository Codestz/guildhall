import type { Archipelago } from "./archipelagoSource.ts"
import type { Spot } from "./layout.ts"

/**
 * Where islands lie relative to each other, for travel (the switcher's ←/→, a followed adventurer's
 * crossing, a shareable link). Data-agnostic: an island is a centre and a reach, home first, then
 * the far ones by index — however the archipelago was made.
 */

/** Where the viewer can be: the home island (where the guild and the Bard are), a far island (its index), or the map of them all. */
export type Stop = "map" | number
export const HOME = -1

export interface Place {
  at: Spot
  reach: number
}

/** Home first, then the far islands: an archipelago's places in list order. */
export function placesOf(archipelago: Archipelago): Place[] {
  return [archipelago.home, ...archipelago.islands]
}

const stopOf = (index: number): Stop => (index === 0 ? HOME : index - 1)

/**
 * The stops in the order a viewer hops them: home, then every far island clockwise round it (by the
 * angle of its keep as seen from home, from the north), a ring that closes on home again.
 */
export function ringOf(places: readonly Place[]): Stop[] {
  const [home, ...far] = places
  if (!home) return []
  const angle = (place: Place) => Math.atan2(place.at[1] - home.at[1], place.at[0] - home.at[0])
  const order = far.map((place, i) => ({ stop: i, angle: angle(place) }))
  order.sort((a, b) => a.angle - b.angle || a.stop - b.stop)
  return [HOME, ...order.map((one) => one.stop)]
}

/**
 * The stop `step` places along the ring from `from` (-1 back, 1 on), wrapping round. From the map
 * (or an unknown stop) on goes to the first stop, back to the last.
 */
export function neighbour(ring: readonly Stop[], from: Stop, step: 1 | -1): Stop | undefined {
  if (ring.length === 0) return undefined
  const at = ring.indexOf(from)
  if (at < 0) return step > 0 ? ring[0] : ring[ring.length - 1]
  return ring[(at + step + ring.length) % ring.length]
}

/**
 * The stop whose land holds the point (x, z) — within its reach of its keep, the nearest keep when
 * two reaches overlap — or undefined at sea: someone on a crossing is on no island.
 */
export function islandAt(places: readonly Place[], x: number, z: number): Stop | undefined {
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  places.forEach((place, i) => {
    const d = Math.hypot(x - place.at[0], z - place.at[1])
    if (d <= place.reach && d < bestDistance) {
      best = i
      bestDistance = d
    }
  })
  return best < 0 ? undefined : stopOf(best)
}

/**
 * What a link's `island=` says for a stop (world/archipelagoLink.ts `islandIndexOf` reads it back):
 * "map", an island's short name (its repo when two share one), or null for home — the link's default.
 */
export function islandParam(stop: Stop, archipelago: Archipelago): string | null {
  if (stop === "map") return "map"
  if (stop === HOME) return null
  const island = archipelago.islands[stop]
  if (!island) return null
  const same = archipelago.islands.filter((one) => one.name.toLowerCase() === island.name.toLowerCase())
  return same.length > 1 ? island.repo : island.name
}
