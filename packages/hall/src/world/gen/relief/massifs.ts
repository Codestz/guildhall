import { type Cell, cellToWorld } from "../../lands.ts"
import { Heap } from "../heap.ts"
import { key, neighbours, noise, unkey } from "../hex.ts"
import { HUB, RESERVED } from "../plan/keep.ts"
import type { IslandPlan } from "../plan.ts"

/**
 * Which hexes become massifs (terrain v2 §2.1): the island's raised ground, grown into one or a few
 * hex-snapped footprints that leave the keep, the roads, the squares and the village lots alone, and
 * leave every district at least 40% of its own hexes on the lowland.
 *
 * The plan (plan/ground.ts) already raised the deep districts' outer hexes (H foothills, m / M
 * mountains); those are the seeds. The footprint then grows over open ground by priority flood,
 * outwards from the hub and with noise, until it holds its tier's share of the island's land.
 */

export type Tier = "hamlet" | "village" | "town" | "city"

/** The tallest a tier's main peak gets, world units (decided: 60 / 40 / 22; a hamlet has hills only). */
export const CAP: Readonly<Record<Tier, number>> = { hamlet: 0, village: 22, town: 40, city: 60 }
/** The share of an island's land its massifs hold. */
const SHARE: Readonly<Record<Tier, number>> = { hamlet: 0, village: 0.12, town: 0.18, city: 0.26 }
/** How many massifs a tier has at most. */
const COUNT: Readonly<Record<Tier, number>> = { hamlet: 0, village: 1, town: 2, city: 3 }
/** Mountains stay this far from the keep (world units, v2 R3): the guild's work stays on level ground. */
export const SITE_REACH = 90
/** A district keeps at least this share of its hexes off the massifs. */
const KEEP_LOW = 0.4
/** Fewer hexes than this is a hill, not a massif. */
const MIN_CELLS = 7

/** The tier of a repo by its files (world-gen v2 §1.2). */
export function tierOf(files: number): Tier {
  if (files < 50) return "hamlet"
  if (files < 500) return "village"
  return files < 3000 ? "town" : "city"
}

/** Ground that is never taken: roads, the keep, lots, sites and fields. */
const BLOCKED = new Set(["=", "K", "V", "v", "s", "w", "d"])
const OPEN = new Set([".", "f", "F", "h", "H", "m", "M"])
const RAISED = new Set(["H", "m", "M"])

export interface Footprint {
  cells: Cell[]
  /** The hexes' keys. */
  keys: ReadonlySet<string>
  /** Plan districts' share: per district index, how many of its hexes this footprint holds. */
  held: ReadonlyMap<number, number>
}

/** The footprints for a plan, main range first. */
export function footprintsOf(plan: IslandPlan, tier: Tier): Footprint[] {
  if (tier === "hamlet") return []
  const { land } = plan
  const [hubX, hubZ] = cellToWorld(HUB)
  let extent = 0
  for (const id of land.keys()) {
    const [x, z] = cellToWorld(unkey(id))
    extent = Math.max(extent, Math.hypot(x, z))
  }
  // A small island has no room 90 units out: the reach is 40% of its own extent at most.
  const reach = Math.min(SITE_REACH, extent * 0.4)
  // Roads, lots and fields are never taken; the keep and the sites keep a ring of open ground too.
  const blocked = new Set<string>()
  for (const [id, hex] of land) {
    if (BLOCKED.has(hex.char) || RESERVED.has(id)) blocked.add(id)
    if (hex.char === "s" || RESERVED.has(id)) for (const near of neighbours(unkey(id))) blocked.add(key(near))
  }
  const eligible = (id: string): boolean => {
    const hex = land.get(id)
    if (!hex || !OPEN.has(hex.char) || blocked.has(id)) return false
    const [x, z] = cellToWorld(unkey(id))
    return Math.hypot(x, z) >= reach
  }

  const score = (id: string): number => {
    const [x, z] = cellToWorld(unkey(id))
    const raised = RAISED.has(land.get(id)?.char ?? "") ? 18 : 0
    return Math.hypot(x - hubX, z - hubZ) + raised + noise(plan.seed, unkey(id), "massif") * 22
  }

  // Seeds: the open ground of the island's raised districts, the plan's own raised hexes first. A
  // village-sized island whose districts are all shallow still gets its one range, from the
  // farthest open hex.
  const raisedDistrict = (id: string): boolean =>
    (plan.districts[land.get(id)?.district ?? 0]?.level ?? 0) >= 1
  const seeds = new Set([...land.keys()].filter((id) => eligible(id) && raisedDistrict(id)))
  if (seeds.size === 0) {
    const far = [...land.keys()].filter(eligible).sort((a, b) => score(b) - score(a))[0]
    if (far) seeds.add(far)
  }
  if (seeds.size === 0) return []
  const weight = (id: string): number => (land.get(id)?.char === "H" ? 1 : 3)

  // The seeds' components, hexes up to two apart counting as one range.
  const owner = new Map<string, number>()
  const parts: string[][] = []
  for (const start of seeds) {
    if (owner.has(start)) continue
    const part: string[] = []
    const stack = [start]
    owner.set(start, parts.length)
    while (stack.length > 0) {
      const id = stack.pop() as string
      part.push(id)
      for (const next of neighbours(unkey(id)).flatMap((n) => [n, ...neighbours(n)])) {
        const nid = key(next)
        if (owner.has(nid) || !seeds.has(nid)) continue
        owner.set(nid, parts.length)
        stack.push(nid)
      }
    }
    parts.push(part)
  }
  const worth = (part: readonly string[]): number => part.reduce((sum, id) => sum + weight(id), 0)
  const ranked = parts
    .map((part, i) => ({ part, i }))
    .sort((a, b) => worth(b.part) - worth(a.part) || a.i - b.i)
  const chosen = ranked.slice(0, COUNT[tier])

  // Grow: one flood for all, each range spreading round its anchor (its part's densest raised ground,
  // farthest from the hub), raised hexes and noise pulling it out into a mountain's shape.
  const target = Math.round(SHARE[tier] * land.size)
  const total = chosen.reduce((sum, { part }) => sum + worth(part), 0)
  const claimed = new Map<string, number>()
  // Each range gets half its worth's share of the land, and half an equal share.
  const room = chosen.map(({ part }) =>
    Math.max(4, Math.round(target * (0.5 * (worth(part) / total) + 0.5 / chosen.length))),
  )
  const count = chosen.map(() => 0)
  const taken = new Map<number, number>()
  const hexes = plan.districts.map((d) => d.hexes)
  const anchors = chosen.map(({ part }) => {
    let best = part[0] as string
    let bestScore = Number.NEGATIVE_INFINITY
    for (const id of part) {
      const around = [...neighbours(unkey(id)).flatMap((n) => [n, ...neighbours(n)])].filter((n) =>
        RAISED.has(land.get(key(n))?.char ?? ""),
      ).length
      const here = around * 4 + score(id) / 10
      if (here > bestScore) {
        bestScore = here
        best = id
      }
    }
    return best
  })
  const anchorAt = anchors.map((id) => cellToWorld(unkey(id)))
  const pull = (id: string, m: number): number => {
    const [x, z] = cellToWorld(unkey(id))
    const [ax, az] = anchorAt[m] as readonly [number, number]
    const raised = RAISED.has(land.get(id)?.char ?? "") ? 9 : 0
    return raised + noise(plan.seed, unkey(id), "massif") * 9 - Math.hypot(x - ax, z - az)
  }
  type Item = { id: string; m: number; p: number }
  const heap = new Heap<Item>((a, b) => a.p > b.p)
  const claim = (id: string, m: number): boolean => {
    const district = land.get(id)?.district ?? 0
    if ((taken.get(district) ?? 0) + 1 > Math.floor((hexes[district] ?? 0) * (1 - KEEP_LOW))) return false
    if (neighbours(unkey(id)).some((n) => claimed.get(key(n)) !== undefined && claimed.get(key(n)) !== m))
      return false
    claimed.set(id, m)
    count[m] = (count[m] ?? 0) + 1
    taken.set(district, (taken.get(district) ?? 0) + 1)
    for (const n of neighbours(unkey(id))) {
      const nid = key(n)
      if (!claimed.has(nid) && eligible(nid)) heap.push({ id: nid, m, p: pull(nid, m) })
    }
    return true
  }
  anchors.forEach((id, m) => void claim(id, m))
  for (let item = heap.pop(); item; item = heap.pop()) {
    if (claimed.has(item.id) || (count[item.m] as number) >= (room[item.m] as number)) continue
    claim(item.id, item.m)
  }

  return chosen.flatMap((_, m): Footprint[] => {
    const ids = tidy(
      [...claimed].filter(([, owned]) => owned === m).map(([id]) => id),
      eligible,
    )
    if (ids.size < MIN_CELLS) return []
    const held = new Map<number, number>()
    for (const id of ids) {
      const district = land.get(id)?.district ?? 0
      held.set(district, (held.get(district) ?? 0) + 1)
    }
    return [{ cells: [...ids].map(unkey), keys: ids, held }]
  })
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
