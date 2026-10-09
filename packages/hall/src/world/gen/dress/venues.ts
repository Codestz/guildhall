import { DMath } from "../../dmath.ts"
import { type Cell, cellToWorld, type LandPlacement } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { DOOR_DEPTH, doorsOf, fixturesOf, instantiate, type Prefab, prefab } from "../../prefabs/index.ts"
import { VENUE_KINDS, type Venue, venueKindOf } from "../../venues.ts"
import { cellAt, key, neighbours, unkey } from "../hex.ts"
import { keepOf } from "../plan/lakes.ts"
import type { IslandPlan, PlanDistrict } from "../plan.ts"
import type { Cover } from "./cover.ts"
import { crowds, type Footprint, footprintsOf } from "./footprints.ts"
import type { DressedRoads } from "./roads.ts"
import { facing, round } from "./sites.ts"

/**
 * A venue on each district's landmark hex (generator v2, world-gen v2 §3.3): the venue the district's
 * kind calls for (world/venues.ts), facing its square, in place of the landmark and its props. The
 * door's step lies at the hex's front edge, on the square's paving, so it joins the road graph.
 * Where the civic centre's wall or hall stands on the landmark's hex, the venue takes another free
 * hex beside the square, or the district keeps its landmark.
 */

/** Natural clutter within this of a venue is cleared (trees, rocks, fields' fences); lots too. */
export const VENUE_CLEAR = 6

/** A door's step lies within this (world units) of its road node, or when no hex clear of the other venues allows, this. */
const BY_ROAD = 8.5
const STRAY = 14

/** The room kept between one venue's buildings and another's. */
const VENUE_GAP = 0.5

/** A spot (x, z) and a radius round it that a venue keeps clear of. */
export type Anchor = readonly [number, number, number]

export interface PlacedVenue {
  venue: Venue
  placements: LandPlacement[]
  district: PlanDistrict
  /** The hex it stands on: the district's landmark hex, or another beside its square. */
  cell: Cell
  /** The building's own piece: what the district's posts are measured from. */
  main: LandPlacement["piece"]
  /** How far in front of the venue the district's posts stand. */
  front: number
}

/** Ground a venue may stand on when it leaves its landmark hex: plain meadow, woods or a village lot. */
const BUILDABLE = ".fv"
/** A door's step keeps this far (world units) from a river hex's centre when it can: a bridge's footprint. */
const BRIDGE = 8

/** A hex a venue may stand on and the spot it faces. */
type Choice = { cell: Cell; towards: Spot }

const NO_COVER: Cover = { massifs: new Set(), rivers: new Set() }

export function venuesOf(
  plan: IslandPlan,
  roads: DressedRoads,
  avoid: readonly Anchor[] = [],
  cover: Cover = NO_COVER,
  halls: readonly Footprint[] = [],
): PlacedVenue[] {
  const code = plan.districts
    .filter((district) => district.biome === "village")
    .sort((a, b) => b.folder.bytes - a.folder.bytes || (a.folder.name < b.folder.name ? -1 : 1))[0]
  const taken = new Set(plan.districts.flatMap((district) => (district.site ? [key(district.site)] : [])))
  // A lake's ground (basin, shore, streams) is no place for a building.
  const lakes = keepOf(plan.lakes)
  const out: PlacedVenue[] = []
  plan.districts.forEach((district, i) => {
    const { folder } = district
    if (!district.site) return
    const kind = venueKindOf(
      { biome: district.biome, name: folder.name, package: folder.group !== undefined },
      district === code,
    )
    if (!kind) return
    // Open ground: nothing civic on it, and no mountain or river about to cover it.
    const open = (cell: Cell): boolean => {
      const [x, z] = cellToWorld(cell)
      return (
        !cover.massifs.has(key(cell)) &&
        !cover.rivers.has(key(cell)) &&
        !lakes.has(key(cell)) &&
        avoid.every(([ax, az, r]) => DMath.hypot(x - ax, z - az) >= r)
      )
    }
    const spare = (cell: Cell, anyDistrict = false): boolean => {
      if (key(cell) === key(district.site as Cell)) return open(cell)
      const hex = plan.land.get(key(cell))
      return (
        (anyDistrict || hex?.district === i) &&
        hex !== undefined &&
        BUILDABLE.includes(hex.char) &&
        hex.level === undefined &&
        !taken.has(key(cell)) &&
        open(cell)
      )
    }
    // A mine into a mountain's flank when a range is near; else the landmark's hex, unless something
    // civic or wild stands there: then the nearest spare hexes round the square, in turn. The first
    // whose door's step is off the beach wins (a venue on a spit has nowhere to stand), else the first.
    const square = cellToWorld(district.square)
    const flank = kind === "mine" ? flankOf(district.site, spare, roads, cover) : undefined
    const hexes = [district.site, ...around(district.square, plan.land)]
    const choices: Choice[] = [
      ...(flank ? [flank] : []),
      ...hexes.filter((cell) => spare(cell)).map((cell) => ({ cell, towards: square })),
    ]
    // A district too small to keep its venue off the beach borrows the free hexes beside its square from its neighbours.
    const borrowed: Choice[] = hexes
      .filter((cell) => spare(cell, true) && !choices.some((choice) => key(choice.cell) === key(cell)))
      .map((cell) => ({ cell, towards: square }))
    // The first whose door's step is off the beach and clear of any river's bridge, else the first off the beach, else the first;
    // standing clear of the venues already placed if any hex allows, else wherever that rule picks.
    const choose = (
      rejected: (next: PlacedVenue) => boolean,
      from: readonly Choice[],
    ): PlacedVenue | undefined => {
      let first: PlacedVenue | undefined
      let inland: PlacedVenue | undefined
      let clear: PlacedVenue | undefined
      for (const { cell, towards } of from) {
        const next = place(prefab(VENUE_KINDS[kind].prefab), kind, district, cell, towards, roads)
        if (!next || rejected(next)) continue
        first ??= next
        if (onBeach(next.venue.door.step, plan.land)) continue
        inland ??= next
        if (!byWater(next.venue.door.step, cover.rivers)) {
          clear = next
          break
        }
      }
      return clear ?? inland ?? first
    }
    const standing = [...halls, ...out.flatMap((venue) => footprintsOf(venue.placements))]
    const touches = (next: PlacedVenue): boolean =>
      footprintsOf(next.placements).some((shape) => standing.some((other) => crowds(shape, other, VENUE_GAP)))
    // A door's step stays on the road graph's side, where a venue that clears the others allows; failing that,
    // a looser reach for the step. A venue never stands through a hall or another venue, nor far from the
    // roads: failing both, the district keeps its landmark.
    const reach = (next: PlacedVenue): number => {
      const [nx, nz] = roads.nodes[next.venue.node] ?? [0, 0]
      return DMath.hypot(next.venue.door.step[0] - nx, next.venue.door.step[1] - nz)
    }
    const attempt = (from: readonly Choice[]): PlacedVenue | undefined =>
      choose((next) => touches(next) || reach(next) >= BY_ROAD, from) ??
      choose((next) => touches(next) || reach(next) >= STRAY, from)
    let placed = attempt(choices)
    if (!placed || onBeach(placed.venue.door.step, plan.land)) {
      const other = attempt(borrowed)
      if (other && !onBeach(other.venue.door.step, plan.land)) placed = other
    }
    if (!placed) return
    taken.add(key(placed.cell))
    out.push(placed)
  })
  return out
}

/**
 * Where a mine goes into a range: a spare hex within two steps of a massif's (the nearest first,
 * then the nearest the district's landmark), its door to a road hex beside it and facing away from
 * the slope. None where no massif is that close.
 */
function flankOf(
  site: Cell,
  spare: (cell: Cell) => boolean,
  roads: DressedRoads,
  cover: Cover,
): { cell: Cell; towards: Spot } | undefined {
  const [sx, sz] = cellToWorld(site)
  let best: { cell: Cell; towards: Spot; rank: number } | undefined
  const consider = (cell: Cell): void => {
    const first = neighbours(cell)
    const slope = first.some((n) => cover.massifs.has(key(n)))
      ? 1
      : first.flatMap(neighbours).some((n) => cover.massifs.has(key(n)))
        ? 2
        : 0
    if (slope === 0 || !spare(cell)) return
    const [cx, cz] = cellToWorld(cell)
    // Away from the nearest massif hex's centre.
    let ax = 0
    let az = 0
    let near = Number.POSITIVE_INFINITY
    for (const m of [...first, ...first.flatMap(neighbours)].filter((n) => cover.massifs.has(key(n)))) {
      const [mx, mz] = cellToWorld(m)
      const d = DMath.hypot(cx - mx, cz - mz)
      if (d < near) [near, ax, az] = [d, (cx - mx) / d, (cz - mz) / d]
    }
    for (const road of first.filter((n) => roads.links.has(key(n)))) {
      const [rx, rz] = cellToWorld(road)
      if ((rx - cx) * ax + (rz - cz) * az < 0) continue
      const rank = slope * 1000 + DMath.hypot(cx - sx, cz - sz)
      if (!best || rank < best.rank) best = { cell, towards: [rx, rz], rank }
    }
  }
  for (const cell of [site, ...neighbours(site).flatMap((n) => [n, ...neighbours(n)])]) consider(cell)
  return best && { cell: best.cell, towards: best.towards }
}

/** The hexes within three steps of a hex: inland ones first (a venue by the shore may stand in a river's mouth), then nearest. */
function around(cell: Cell, land: ReadonlyMap<string, unknown>): Cell[] {
  const first = neighbours(cell)
  const seen = new Set([key(cell), ...first.map(key)])
  const second = first.flatMap(neighbours).filter((next) => !seen.has(key(next)) && seen.add(key(next)))
  const third = second.flatMap(neighbours).filter((next) => !seen.has(key(next)) && seen.add(key(next)))
  const [cx, cz] = cellToWorld(cell)
  const far = (next: Cell): number => DMath.hypot(cellToWorld(next)[0] - cx, cellToWorld(next)[1] - cz)
  const wet = (next: Cell): number => neighbours(next).filter((n) => !land.has(key(n))).length
  return [...first, ...second, ...third].sort(
    (a, b) => wet(a) - wet(b) || far(a) - far(b) || (key(a) < key(b) ? -1 : 1),
  )
}

/** From a sea hex's centre a coast tile's sand slopes away for this far (world/wilds.ts WATER_CLEARANCE): no standing there. */
const BEACH = 8

/** Whether a spot lies on a beach: within a beach's reach of a hex that is not land. */
function onBeach(spot: Spot, land: ReadonlyMap<string, unknown>): boolean {
  const here = cellAt(spot)
  return [here, ...neighbours(here)].some((next) => {
    const [x, z] = cellToWorld(next)
    return !land.has(key(next)) && DMath.hypot(x - spot[0], z - spot[1]) < BEACH
  })
}

/** Whether a river's hex (where a bridge may stand) lies within a bridge's clearance of a spot. */
function byWater(spot: Spot, rivers: ReadonlySet<string>): boolean {
  return [...rivers].some((id) => {
    const [x, z] = cellToWorld(unkey(id))
    return DMath.hypot(x - spot[0], z - spot[1]) < BRIDGE
  })
}

/** A venue of `item` on `cell`, facing `towards` (the district's square, or the road hex a mine opens onto). */
function place(
  item: Prefab,
  kind: Venue["kind"],
  district: PlanDistrict,
  cell: Cell,
  towards: Spot,
  roads: DressedRoads,
): PlacedVenue | undefined {
  const { folder } = district
  const at = cellToWorld(cell)
  const rot = facing(at, towards)
  const door = doorsOf(item, at, rot)[0]
  const placements = instantiate(item, at, rot, folder.language.kit)
  const main = placements[0]
  if (!door || !main) return undefined
  const step: Spot = [door.x, door.z]
  const depth = door.depth ?? DOOR_DEPTH
  const sill: Spot = [
    round(step[0] - DMath.sin(door.rot) * depth),
    round(step[1] - DMath.cos(door.rot) * depth),
  ]
  const venue: Venue = {
    id: `${folder.name}#${kind}`,
    kind,
    district: folder.name,
    prefab: item.id,
    at,
    rot,
    door: { step, sill, y: door.y ?? 0, inward: round(door.rot + Math.PI) },
    node: nearest(roads.nodes, step),
    capacity: VENUE_KINDS[kind].capacity,
    windows: fixturesOf(item.windows, at, rot),
    chimneys: fixturesOf(item.chimneys, at, rot),
  }
  return {
    venue,
    placements,
    district,
    cell,
    main: main.piece,
    front: Math.min(6.2, (item.doors[0]?.z ?? 4) + 1.2),
  }
}

/** The road node nearest a spot. */
function nearest(nodes: Readonly<Record<string, Spot>>, spot: Spot): string {
  let best = "HARBOUR"
  let bestDistance = Number.POSITIVE_INFINITY
  for (const [name, at] of Object.entries(nodes)) {
    const distance = DMath.hypot(at[0] - spot[0], at[1] - spot[1])
    if (distance < bestDistance) {
      best = name
      bestDistance = distance
    }
  }
  return best
}
