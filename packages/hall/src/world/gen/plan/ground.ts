import { type Cell, cellToWorld } from "../../lands.ts"
import { key, neighbours, noise, unkey } from "../hex.ts"
import type { PlanDistrict, PlanHex } from "../plan.ts"
import { HUB, KEEP, RESERVED } from "./keep.ts"
import { type Owners, wet } from "./land.ts"

/**
 * A level hex beside each district's square for its landmark (written into it as `site`), inland
 * and its own if it can be. Returns the sites' keys.
 */
export function placeSites(
  districts: readonly PlanDistrict[],
  owner: Owners,
  road: ReadonlySet<string>,
  seed: number,
): Set<string> {
  const sites = new Set<string>()
  const [hx, hz] = cellToWorld(HUB)
  districts.forEach((district, i) => {
    let best: Cell | undefined
    let bestScore = Number.NEGATIVE_INFINITY
    for (const cell of neighbours(district.square)) {
      const id = key(cell)
      if (road.has(id) || sites.has(id) || KEEP.has(id) || !owner.has(id)) continue
      const [x, z] = cellToWorld(cell)
      const score =
        (owner.get(id) === i ? 100 : 0) +
        (wet(owner, cell).length === 0 ? 50 : 0) +
        Math.hypot(x - hx, z - hz) / 10 +
        noise(seed, cell, "site")
      if (score > bestScore) {
        bestScore = score
        best = cell
      }
    }
    if (!best) return
    district.site = best
    sites.add(key(best))
  })
  return sites
}

/**
 * What grows where, in lands.ts' MAP legend: elevation from each district's level (its inland
 * hexes furthest from its square raised), then each biome's ground. Writes each district's `hexes`.
 */
export function groundOf(
  districts: readonly PlanDistrict[],
  owner: Owners,
  road: ReadonlySet<string>,
  sites: ReadonlySet<string>,
  seed: number,
): Map<string, PlanHex> {
  const land = new Map<string, PlanHex>()
  const nearRoad = (cell: Cell): boolean => neighbours(cell).some((next) => road.has(key(next)))
  districts.forEach((district, i) => {
    const own = [...owner].filter(([, d]) => d === i).map(([id]) => unkey(id))
    district.hexes = own.length
    const raised = new Set<string>()
    if (district.level > 0) {
      const [sx, sz] = cellToWorld(district.square)
      const inland = own
        .filter((cell) => !road.has(key(cell)) && !sites.has(key(cell)) && !nearRoad(cell))
        .map((cell) => {
          const [x, z] = cellToWorld(cell)
          return { cell, far: Math.hypot(x - sx, z - sz) + noise(seed, cell, "rise") * 5 }
        })
        .sort((a, b) => b.far - a.far)
      const count = Math.round(inland.length * (district.level === 1 ? 0.35 : 0.5))
      for (const { cell } of inland.slice(0, count)) raised.add(key(cell))
    }
    for (const cell of own) {
      const id = key(cell)
      let char: string
      if (road.has(id)) char = "="
      else if (KEEP.has(id)) char = KEEP.get(id) ?? "K"
      else if (sites.has(id)) char = "s"
      // The ring round the keep: open lots, kept clear like the hand map's (lands.ts' V).
      else if (RESERVED.has(id)) char = "V"
      else if (raised.has(id))
        char =
          district.level === 1 ? "H" : neighbours(cell).every((next) => raised.has(key(next))) ? "M" : "m"
      else char = ground(district, noise(seed, cell, "ground"), noise(seed, cell, "crop"))
      land.set(id, { char, district: i })
    }
  })
  return land
}

/** A hex's ground in a district's biome; `roll` against its density decides how full it is. */
function ground(district: PlanDistrict, roll: number, crop: number): string {
  const d = district.density
  switch (district.biome) {
    case "village":
      return roll < d ? "v" : roll < d + 0.15 ? "f" : "."
    case "harbour":
      return roll < d * 0.6 ? "v" : roll < d * 0.6 + 0.1 ? "f" : "."
    case "proving":
      return roll < d * 0.5 ? "s" : roll < 0.8 ? "." : "f"
    case "library":
      return roll < d ? "f" : roll > 0.8 ? "h" : "."
    case "quarry":
      return roll < d * 0.6 ? "h" : "."
    case "forest":
      return roll < d ? "F" : "f"
    case "farms":
      return roll < d ? (crop < 0.6 ? "w" : "d") : "."
    case "wilds":
      return roll < 0.3 ? "f" : roll < 0.45 ? "h" : "."
  }
}
