import { type Cell, cellToWorld, type LandPlacement } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { DOOR_DEPTH, doorsOf, fixturesOf, instantiate, type Prefab, prefab } from "../../prefabs/index.ts"
import { VENUE_KINDS, type Venue, venueKindOf } from "../../venues.ts"
import { key, neighbours } from "../hex.ts"
import type { IslandPlan, PlanDistrict } from "../plan.ts"
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

export function venuesOf(
  plan: IslandPlan,
  roads: DressedRoads,
  avoid: readonly Anchor[] = [],
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
    const free = (cell: Cell): boolean => {
      const [x, z] = cellToWorld(cell)
      return avoid.every(([ax, az, r]) => Math.hypot(x - ax, z - az) >= r)
    }
    // Its landmark hex, unless something civic stands there: then the nearest free hex round its square.
    const cell = free(district.site)
      ? district.site
      : around(district.square, plan.land).find((next) => {
          const hex = plan.land.get(key(next))
          return (
            hex?.district === i &&
            BUILDABLE.includes(hex.char) &&
            hex.level === undefined &&
            !taken.has(key(next)) &&
            free(next)
          )
        })
    if (!cell) return
    taken.add(key(cell))
    const placed = place(prefab(VENUE_KINDS[kind].prefab), kind, district, cell, roads)
    if (placed) out.push(placed)
  })
  return out
}

/** The hexes within two steps of a hex: inland ones first (a venue by the shore may stand in a river's mouth), then nearest. */
function around(cell: Cell, land: ReadonlyMap<string, unknown>): Cell[] {
  const first = neighbours(cell)
  const seen = new Set([key(cell), ...first.map(key)])
  const second = first.flatMap(neighbours).filter((next) => !seen.has(key(next)) && seen.add(key(next)))
  const [cx, cz] = cellToWorld(cell)
  const far = (next: Cell): number => Math.hypot(cellToWorld(next)[0] - cx, cellToWorld(next)[1] - cz)
  const wet = (next: Cell): number => neighbours(next).filter((n) => !land.has(key(n))).length
  return [...first, ...second].sort(
    (a, b) => wet(a) - wet(b) || far(a) - far(b) || (key(a) < key(b) ? -1 : 1),
  )
}

/** A venue of `item` on `cell`, facing the district's square. */
function place(
  item: Prefab,
  kind: Venue["kind"],
  district: PlanDistrict,
  cell: Cell,
  roads: DressedRoads,
): PlacedVenue | undefined {
  const { folder } = district
  const at = cellToWorld(cell)
  const rot = facing(at, cellToWorld(district.square))
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
