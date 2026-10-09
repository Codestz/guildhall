import { type Cell, cellToWorld, type LandPlacement } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { DOOR_DEPTH, doorsOf, fixturesOf, instantiate, type Prefab, prefab } from "../../prefabs/index.ts"
import { VENUE_KINDS, type Venue, venueKindOf } from "../../venues.ts"
import { cellAt, key, neighbours } from "../hex.ts"
import type { IslandPlan, PlanDistrict } from "../plan.ts"
import type { Cover } from "./cover.ts"
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

const NO_COVER: Cover = { massifs: new Set(), rivers: new Set() }

export function venuesOf(
  plan: IslandPlan,
  roads: DressedRoads,
  avoid: readonly Anchor[] = [],
  cover: Cover = NO_COVER,
): PlacedVenue[] {
  const code = plan.districts
    .filter((district) => district.biome === "village")
    .sort((a, b) => b.folder.bytes - a.folder.bytes || (a.folder.name < b.folder.name ? -1 : 1))[0]
  const taken = new Set(plan.districts.flatMap((district) => (district.site ? [key(district.site)] : [])))
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
        avoid.every(([ax, az, r]) => Math.hypot(x - ax, z - az) >= r)
      )
    }
    const spare = (cell: Cell): boolean => {
      if (key(cell) === key(district.site as Cell)) return open(cell)
      const hex = plan.land.get(key(cell))
      return (
        hex?.district === i &&
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
    const choices = [
      ...(flank ? [flank] : []),
      ...[district.site, ...around(district.square, plan.land)]
        .filter(spare)
        .map((cell) => ({ cell, towards: square })),
    ]
    let placed: PlacedVenue | undefined
    for (const { cell, towards } of choices) {
      const next = place(prefab(VENUE_KINDS[kind].prefab), kind, district, cell, towards, roads)
      if (!next) continue
      placed ??= next
      if (!onBeach(next.venue.door.step, plan.land)) {
        placed = next
        break
      }
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
      const d = Math.hypot(cx - mx, cz - mz)
      if (d < near) [near, ax, az] = [d, (cx - mx) / d, (cz - mz) / d]
    }
    for (const road of first.filter((n) => roads.links.has(key(n)))) {
      const [rx, rz] = cellToWorld(road)
      if ((rx - cx) * ax + (rz - cz) * az < 0) continue
      const rank = slope * 1000 + Math.hypot(cx - sx, cz - sz)
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
  const far = (next: Cell): number => Math.hypot(cellToWorld(next)[0] - cx, cellToWorld(next)[1] - cz)
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
    return !land.has(key(next)) && Math.hypot(x - spot[0], z - spot[1]) < BEACH
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
    round(step[0] - Math.sin(door.rot) * depth),
    round(step[1] - Math.cos(door.rot) * depth),
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
    const distance = Math.hypot(at[0] - spot[0], at[1] - spot[1])
    if (distance < bestDistance) {
      best = name
      bestDistance = distance
    }
  }
  return best
}
