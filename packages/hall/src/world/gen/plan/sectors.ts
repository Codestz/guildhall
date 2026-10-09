import { DMath } from "../../dmath.ts"
import { type Cell, cellToWorld } from "../../lands.ts"
import { cellAt, key, neighbours, noise, unkey } from "../hex.ts"
import type { PlanDistrict } from "../plan.ts"
import { BAY, type Form, HUB, HUB_X, HUB_Z, patch, RESERVED, RING } from "./keep.ts"
import { majority, type Owners, spanOf } from "./land.ts"

/**
 * The districts round the hub in sectors sized by their land, each grown hex by hex from a seed
 * (its square, where its road ends), so every district is one piece. A split workspace's packages
 * (repo.ts) share one sector as a cluster: the biggest at its heart, the rest fanned round it away
 * from the hub: a town. Holes left between districts fill in from their neighbours.
 */

/** The arc a workspace's packages fan over round its biggest, centred on the way out from the hub. */
const FAN = (240 * Math.PI) / 180
/** How far out along its ray (a share of the mass's reach that way) a district's square is sought. */
const INWARD = 0.6

export interface Sectors {
  owner: Owners
  /** A workspace package's district → its biggest package's (the head of its cluster). */
  heads: Map<number, number>
  /** Rings from the hub that held the land as the last hole was filled: how far its roads may search. */
  radius: number
}

/**
 * Seeds every district's square (written into it) and grows its land; the reserve is the harbour's.
 * Inside a mass (generator v2's form) nothing grows past it, and what is left of it is shared out.
 */
export function growSectors(
  districts: PlanDistrict[],
  seed: number,
  random: () => number,
  form: Form = RING,
): Sectors {
  const { bay, mass } = form
  const heads = seedSquares(districts, random, form)
  const owner: Owners = new Map()
  const frontiers = districts.map(() => new Set<string>())
  const claim = (cell: Cell, i: number): void => {
    const id = key(cell)
    owner.set(id, i)
    for (const frontier of frontiers) frontier.delete(id)
    for (const next of neighbours(cell)) {
      const nextId = key(next)
      if (!owner.has(nextId) && !bay(next) && (!mass || mass.has(nextId))) frontiers[i]?.add(nextId)
    }
  }
  for (const id of RESERVED) owner.set(id, 0)
  districts.forEach((district, i) => {
    claim(district.square, i)
  })
  // Each district claims the frontier hex nearest its seed, the emptiest first.
  const claimed = districts.map(() => 1)
  for (;;) {
    let pick = -1
    let emptiest = Number.POSITIVE_INFINITY
    districts.forEach((district, i) => {
      const fill = (claimed[i] ?? 0) / district.quota
      if (fill < 1 && (frontiers[i]?.size ?? 0) > 0 && fill < emptiest) {
        emptiest = fill
        pick = i
      }
    })
    const district = districts[pick]
    if (!district) break
    const [sx, sz] = cellToWorld(district.square)
    const reach = patch(district.quota)
    let best: string | undefined
    let bestScore = Number.POSITIVE_INFINITY
    for (const id of frontiers[pick] ?? []) {
      const cell = unkey(id)
      const [x, z] = cellToWorld(cell)
      const score = DMath.hypot(x - sx, z - sz) / reach + 0.3 * noise(seed, cell, `grow${pick}`)
      if (score < bestScore) {
        bestScore = score
        best = id
      }
    }
    if (best === undefined) break
    claim(unkey(best), pick)
    claimed[pick] = (claimed[pick] ?? 0) + 1
  }

  let radius = 0
  for (let pass = 0; pass < 3; pass++) {
    const span = spanOf(owner)
    radius = span.radius
    for (const cell of span.cells) {
      if (owner.has(key(cell)) || bay(cell)) continue
      const { count, district } = majority(owner, cell)
      if (count >= 4) owner.set(key(cell), district)
    }
  }
  if (mass) radius = shareOut(owner, mass)
  return { owner, heads, radius }
}

/**
 * The mass's hexes no district reached (one filled its quota first, or was walled in), each given
 * to the neighbour district holding most of its sides, from the coast of what is claimed inward,
 * so every district stays one piece. Returns the rings that hold the land after.
 */
function shareOut(owner: Owners, mass: ReadonlySet<string>): number {
  const left = [...mass].filter((id) => !owner.has(id)).sort()
  for (let grew = true; grew; ) {
    grew = false
    const given: [string, number][] = []
    for (const id of left) {
      if (owner.has(id)) continue
      const { count, district } = majority(owner, unkey(id))
      if (count > 0) given.push([id, district])
    }
    for (const [id, district] of given) owner.set(id, district)
    grew = given.length > 0
  }
  return spanOf(owner).radius
}

/** Each unit's square round the hub, the bay left open; a workspace's packages round its biggest. */
function seedSquares(districts: PlanDistrict[], random: () => number, form: Form): Map<number, number> {
  // A workspace's packages are one unit here: one sector, one cluster (its first is its biggest).
  const units: number[][] = []
  const heads = new Map<number, number>()
  districts.forEach((district, i) => {
    if (i === 0) return
    const group = district.folder.group
    const unit =
      group === undefined ? undefined : units.find((u) => districts[u[0] ?? 0]?.folder.group === group)
    if (unit) {
      heads.set(i, unit[0] ?? i)
      unit.push(i)
    } else units.push([i])
  })
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[units[i], units[j]] = [units[j] ?? [], units[i] ?? []]
  }
  const quotaOfUnit = (unit: readonly number[]): number =>
    unit.reduce((sum, i) => sum + (districts[i]?.quota ?? 0), 0)
  const total = units.reduce((sum, unit) => sum + quotaOfUnit(unit), 0)
  const rootRadius = patch(districts[0]?.quota ?? 7)
  const seeded = new Set([key(HUB), ...RESERVED])
  const { bay, mass } = form
  const free = (cell: Cell): boolean => !seeded.has(key(cell)) && !bay(cell) && (!mass || mass.has(key(cell)))
  /**
   * Out along a ray from [x, z]: the first free hex (no seed yet, not in the bay) at `distance` or
   * past it; inside a mass, the free hex nearest the point, which is drawn in to INWARD of the
   * ray's reach so a big district starts well inside the coast rather than out on a cape.
   */
  const seedAt = (x: number, z: number, angle: number, distance: number): Cell => {
    const at = (d: number): Cell => cellAt([x + d * DMath.sin(angle), z + d * DMath.cos(angle)])
    let cell = at(distance)
    if (mass) cell = nearestFree(mass, at(Math.min(distance, INWARD * reachOf(mass, at))), free)
    else
      while (!free(cell)) {
        distance += 5
        cell = at(distance)
      }
    seeded.add(key(cell))
    return cell
  }
  let swept = 0
  for (const unit of units) {
    const land = quotaOfUnit(unit)
    const angle = BAY + (2 * Math.PI - 2 * BAY) * ((swept + land / 2) / total)
    swept += land
    const [first, ...ring] = unit
    const head = districts[first ?? 0]
    if (!head) continue
    head.square = seedAt(HUB_X, HUB_Z, angle, rootRadius + patch(land) + 4)
    // The rest of a workspace fan round its biggest package on the side away from the hub (a ray
    // towards it would be pushed on through the harbour), each a patch's width off its square.
    const [cx, cz] = cellToWorld(head.square)
    ring.forEach((i, n) => {
      const district = districts[i]
      if (!district) return
      const around = angle + FAN * ((n + 0.5) / ring.length - 0.5)
      district.square = seedAt(cx, cz, around, patch(head.quota) + patch(district.quota))
    })
  }
  return heads
}

/** The furthest a ray (`at`: its hex at a distance) stays on the mass, world units, sampled every 5. */
function reachOf(mass: ReadonlySet<string>, at: (distance: number) => Cell): number {
  let reach = 0
  for (let d = 5; d <= 600; d += 5) if (mass.has(key(at(d)))) reach = d
  return reach
}

/** The mass's free hex nearest `target` (the lowest key on a tie). */
function nearestFree(mass: ReadonlySet<string>, target: Cell, free: (cell: Cell) => boolean): Cell {
  const [tx, tz] = cellToWorld(target)
  let best: Cell = target
  let bestDistance = Number.POSITIVE_INFINITY
  for (const id of mass) {
    const cell = unkey(id)
    if (!free(cell)) continue
    const [x, z] = cellToWorld(cell)
    const distance = DMath.hypot(x - tx, z - tz)
    if (distance < bestDistance || (distance === bestDistance && id < key(best))) {
      bestDistance = distance
      best = cell
    }
  }
  return best
}
