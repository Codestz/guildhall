import type { GrowthPlan } from "./growth.ts"

/**
 * When the film's mountains rise (ADR 0021), pure. A massif rises as one, with its land: its birth
 * is when the majority of its hexes have first come up out of the sea (the median of their first
 * births), and it eases up a beat after, over a longer climb than a tile's pop, so the ground
 * round it is always there first. It is a function of the film time and the birth alone, never of
 * a hex that may sink again (a district shrinking, a ghost let go), so it never sinks back.
 */

/** A mountain starts to rise this long after the majority of its land is up, and takes this long. */
export const RELIEF_LAG_S = 0.8
export const RELIEF_RISE_S = 2.4

/** The film time a massif (its hex keys) is born: when half of its land hexes have first risen. */
export function massifBirth(g: GrowthPlan, keys: Iterable<string>): number {
  const firsts: number[] = []
  for (const id of keys) {
    const h = g.index.get(id)
    if (h !== undefined) firsts.push(Math.max(0, (g.any[h] as number[])[0] ?? Number.POSITIVE_INFINITY))
  }
  if (firsts.length === 0) return Number.POSITIVE_INFINITY
  firsts.sort((a, b) => a - b)
  return firsts[Math.ceil(firsts.length / 2) - 1] as number
}

/** How far up a mountain born at `birth` is at film time `t`: 0 (not yet) → 1, never falling. */
export function mountainUp(t: number, birth: number): number {
  const p = Math.min(1, Math.max(0, (t - birth - RELIEF_LAG_S) / RELIEF_RISE_S))
  return p * p * (3 - 2 * p)
}
