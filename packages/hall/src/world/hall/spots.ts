import type { Craft } from "@guildhall/core"
import type { Hall, HallSpot } from "./types.ts"

/**
 * Which seat or station a visitor takes (guild/hall.ts hands them out; deterministic: the same hall,
 * the same deed and the same spots taken always give the same one). The best fit for the craft goes
 * first (a spot lists the crafts it suits, best first), and between equal fits the one that comes
 * first in the hall's own order; with no craft (they are thinking) a seat before a station, so a
 * thinker sits down. Nothing free: undefined, and they wait at the gate.
 */

/** How well a spot suits a deed: 0 best; a craft it does not list is last. */
function fit(spot: HallSpot, craft: Craft | undefined): number {
  if (craft === undefined) return spot.seat ? 0 : 1
  const at = spot.crafts.indexOf(craft)
  return at < 0 ? spot.crafts.length + 1 : at
}

export function spotFor(
  hall: Pick<Hall, "spots">,
  craft: Craft | undefined,
  taken: ReadonlySet<string>,
): HallSpot | undefined {
  let best: HallSpot | undefined
  let rank = Number.POSITIVE_INFINITY
  for (const spot of hall.spots) {
    if (taken.has(spot.id)) continue
    const here = fit(spot, craft)
    if (here < rank) {
      best = spot
      rank = here
    }
  }
  return best
}

/** A hall's spot by id. */
export const spotById = (hall: Pick<Hall, "spots">, id: string): HallSpot | undefined =>
  hall.spots.find((spot) => spot.id === id)
