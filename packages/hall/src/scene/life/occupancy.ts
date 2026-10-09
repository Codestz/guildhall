/**
 * Who is inside which venue (world/venues.ts), for the venues' lit windows and chimney smoke
 * (scene/life/Venues.tsx). Each figure inside re-states that it is, every frame (scene/visit.ts), so
 * one that is unmounted (a seek, a leaver let go) simply stops counting: nothing to clean up. Time is
 * the caller's clock, seconds.
 */

/** A figure counts for this long after its last word. */
const FRESH_S = 0.4

const inside = new Map<string, Map<string, number>>()
/** Who is on the way to a venue's door (restated every frame like `inside`): they count toward its load. */
const heading = new Map<string, Map<string, number>>()

/** `who` is inside `venue` as of `now`. */
export function occupy(venue: string, who: string, now: number): void {
  let seen = inside.get(venue)
  if (!seen) {
    seen = new Map()
    inside.set(venue, seen)
  }
  seen.set(who, now)
}

/** `who` is walking to `venue`'s door as of `now`. */
export function approach(venue: string, who: string, now: number): void {
  let seen = heading.get(venue)
  if (!seen) {
    seen = new Map()
    heading.set(venue, seen)
  }
  seen.set(who, now)
}

/** `who` has come out of `venue` (or given up going). */
export function vacate(venue: string, who: string): void {
  inside.get(venue)?.delete(who)
  heading.get(venue)?.delete(who)
}

/** How many are inside `venue` or on their way to its door as of `now`, `except` not counted: what a caller weighs before going. */
export function load(venue: string, now: number, except?: string): number {
  const who = new Set<string>()
  for (const seen of [inside.get(venue), heading.get(venue)])
    for (const [name, at] of seen ?? []) if (name !== except && now - at <= FRESH_S) who.add(name)
  return who.size
}

/** How many are inside `venue` as of `now`. */
export function occupants(venue: string, now: number): number {
  const seen = inside.get(venue)
  if (!seen) return 0
  let count = 0
  for (const [who, at] of seen) {
    if (now - at > FRESH_S) seen.delete(who)
    else count++
  }
  return count
}

/** Empties the books (tests; a new island). */
export function clearOccupancy(): void {
  inside.clear()
  heading.clear()
}
