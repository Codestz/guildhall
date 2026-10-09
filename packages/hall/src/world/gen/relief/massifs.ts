import type { Cell } from "../../lands.ts"
import { key, neighbours, unkey } from "../hex.ts"
import { RESERVED } from "../plan/keep.ts"
import { CAP, type Tier, tierOf } from "../plan/tier.ts"
import type { IslandPlan } from "../plan.ts"

/** Mountains stand this far from the keep (world units); the plan keeps the ranges clear of it. */
export { CLEAR as SITE_REACH } from "../plan/zones.ts"
export { CAP, type Tier, tierOf }

/**
 * Which hexes become massifs (terrain v2 §2.1, as amended): the ranges the plan reserved across the
 * island (plan/zones.ts), less whatever a road, a square, a site or the keep took back since (the
 * passes), each piece kept if it is big enough to stand a mountain on.
 */

/** Fewer hexes than this is a hill, not a massif. */
const MIN_CELLS = 7

/** Ground that is never taken: roads, the keep, lots, sites and fields. */
const BLOCKED = new Set(["=", "K", "V", "v", "s", "w", "d"])

export interface Footprint {
  cells: Cell[]
  /** Which of the plan's ranges it was cut from (0 the main range). */
  range: number
  /** The hexes' keys. */
  keys: ReadonlySet<string>
  /** Plan districts' share: per district index, how many of its hexes this footprint holds. */
  held: ReadonlyMap<number, number>
}

/** The footprints for a plan, the main range's biggest piece first (a range cut by a pass gives several). */
export function footprintsOf(plan: IslandPlan, tier: Tier): Footprint[] {
  if (tier === "hamlet") return []
  const { land } = plan
  const free = (id: string): boolean => {
    const hex = land.get(id)
    return !!hex && !BLOCKED.has(hex.char) && !RESERVED.has(id)
  }
  const out: Footprint[] = []
  plan.ranges.forEach((range, r) => {
    for (const part of pieces(tidy([...range].filter(free), free))) {
      if (part.size < MIN_CELLS) continue
      const held = new Map<number, number>()
      for (const id of part) {
        const district = land.get(id)?.district ?? 0
        held.set(district, (held.get(district) ?? 0) + 1)
      }
      out.push({ cells: [...part].map(unkey), range: r, keys: part, held })
    }
  })
  return out.sort((a, b) => a.range - b.range || b.cells.length - a.cells.length)
}

/** A set's connected pieces, in key order. */
function pieces(set: ReadonlySet<string>): Set<string>[] {
  const seen = new Set<string>()
  const out: Set<string>[] = []
  for (const start of [...set].sort()) {
    if (seen.has(start)) continue
    const part = new Set<string>([start])
    seen.add(start)
    for (const id of part)
      for (const next of neighbours(unkey(id))) {
        const nid = key(next)
        if (set.has(nid) && !seen.has(nid)) {
          seen.add(nid)
          part.add(nid)
        }
      }
    out.push(part)
  }
  return out
}

/** Spikes (one neighbour) shaved off, then one-hex holes filled: a footprint a mountain can stand on. */
function tidy(ids: readonly string[], eligible: (id: string) => boolean): Set<string> {
  const set = new Set(ids)
  const inside = (id: string): number => neighbours(unkey(id)).filter((n) => set.has(key(n))).length
  for (let pass = 0; pass < 2; pass++) for (const id of [...set]) if (inside(id) < 2) set.delete(id)
  for (const id of ids)
    for (const n of neighbours(unkey(id))) {
      const nid = key(n)
      if (!set.has(nid) && eligible(nid) && inside(nid) >= 5) set.add(nid)
    }
  return set
}
