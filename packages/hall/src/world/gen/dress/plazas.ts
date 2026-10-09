import { DMath } from "../../dmath.ts"
import { type Cell, cellToWorld, HEX_SCALE, type LandPlacement, PIECES } from "../../lands.ts"
import type { Spot } from "../../layout.ts"
import { toSegment } from "../../lights.ts"
import { instantiate, type Prefab } from "../../prefabs/index.ts"
import type { KitColour } from "../biomes.ts"
import { cellAt, key, step, unkey } from "../hex.ts"
import type { IslandPlan } from "../plan.ts"
import { crowds, type Footprint, footprintsOf } from "./footprints.ts"

/**
 * Where a plaza's fountain or well may stand (dress/town.ts): beside the road, never on it. The
 * roads are the dressed ones' own geometry, each road hex's centre to the centre of every
 * neighbour it opens onto (a square opens onto all its land neighbours: paved), and the lots'
 * houses are off-limits too. The centrepiece must be clear; its lamps, stall and props are left out
 * where they would stand on a road or in a house.
 */

/** Half the drawn road's width, and a body's room beside it. */
const ROAD_HALF = 0.9
const VERGE = 0.3
/** Room kept between the centrepiece and a house. */
const HOUSE_GAP = 0.3
/** Foothills, knolls and mountains: raised ground. */
const RAISED = "hHmM"
/** Candidate spots round the square: how far out (world units) and how many ways round. */
const RINGS = [2.4, 3.6, 4.8, 5.6, 6.4, 7.2]
const TURNS = 48

type Segment = readonly [Spot, Spot]

/** The road segments within `reach` of `at`. */
function roadsNear(links: ReadonlyMap<string, ReadonlySet<number>>, at: Spot, reach: number): Segment[] {
  const out: Segment[] = []
  for (const [id, dirs] of links) {
    const from = unkey(id)
    const a = cellToWorld(from)
    if (DMath.hypot(a[0] - at[0], a[1] - at[1]) > reach) continue
    for (const dir of dirs) {
      const next = step(from, dir)
      const b = cellToWorld(next)
      // A paved square's spoke into a hex with no road of its own stops at that hex's edge.
      const open = links.get(key(next))?.has((dir + 3) % 6)
      out.push([a, open ? b : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]])
    }
  }
  return out
}

/** A piece's footing as a circle's radius: its mean half-side at its scale. */
function radiusOf(item: LandPlacement): number {
  const bounds = (PIECES as Record<string, { size: number[] }>)[item.piece]
  const [x = 0, , z = 0] = bounds?.size ?? []
  return Math.max(0.3, ((x + z) / 4) * HEX_SCALE * (item.scale ?? 1))
}

const squareAt = (x: number, z: number, r: number): Footprint => [
  [x - r, z - r],
  [x + r, z - r],
  [x + r, z + r],
  [x - r, z + r],
]

const onRoad = (item: LandPlacement, roads: readonly Segment[]): boolean =>
  roads.some(([a, b]) => toSegment([item.x, item.z], a, b) < ROAD_HALF + VERGE + radiusOf(item))

/**
 * The prefab stood beside the square's roads, as near its hex's middle as it fits (starting from the
 * way `first` points), or undefined where no spot clears them.
 */
export function plazaBeside(
  plan: IslandPlan,
  links: ReadonlyMap<string, ReadonlySet<number>>,
  square: Cell,
  prefab: Prefab,
  kit: KitColour,
  seed: number,
  houses: readonly Footprint[],
  first: number,
): LandPlacement[] | undefined {
  const centre = cellToWorld(square)
  const roads = roadsNear(links, centre, 16)
  // Level land under its whole footing: no sea, no foothill or mountain (a slope would lift the ground off it).
  const standsOn = (item: LandPlacement): boolean => {
    const r = radiusOf(item)
    return [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ].every(([dx = 0, dz = 0]) => {
      const char = plan.land.get(key(cellAt([item.x + dx, item.z + dz])))?.char
      return char !== undefined && !RAISED.includes(char)
    })
  }
  const houseCrowds = (item: LandPlacement): boolean => {
    const shape = footprintsOf([item])[0] ?? squareAt(item.x, item.z, radiusOf(item))
    return houses.some((h) => crowds(shape, h, HOUSE_GAP))
  }
  const clearOf = (item: LandPlacement): boolean =>
    standsOn(item) && !onRoad(item, roads) && !houseCrowds(item)
  for (const ring of RINGS)
    for (let n = 0; n < TURNS; n++) {
      const angle = first + (n % 2 ? -1 : 1) * Math.ceil(n / 2) * ((2 * Math.PI) / TURNS)
      const at: [number, number] = [centre[0] + DMath.sin(angle) * ring, centre[1] + DMath.cos(angle) * ring]
      const made = instantiate(prefab, at, 0, kit, 0, seed)
      const [core, ...rest] = made
      if (core && clearOf(core)) return [core, ...rest.filter(clearOf)]
    }
  return undefined
}
