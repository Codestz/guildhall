import { DMath } from "../dmath.ts"
import type { Civic } from "../gen/dress/civic.ts"
import { anything, crowds, type Footprint, footprintsOf } from "../gen/dress/footprints.ts"
import type { MainBuilding } from "../gen/dress/main.ts"
import { cellAt, key } from "../gen/hex.ts"
import type { IslandPlan } from "../gen/plan.ts"
import type { LandPlacement } from "../lands.ts"
import type { Spot } from "../layout.ts"
import { buildHall, cornersOf, sizeOf, toIsland } from "./build.ts"
import { STYLE_OF } from "./styles.ts"
import type { Hall } from "./types.ts"

/**
 * Where an island's hall stands: right in front of its main landmark's door, the hall's back wall
 * open onto the door's step, its gate looking away from the landmark towards the keep's open ground
 * (the generator keeps the keep's block and the heart's rings clear before anything grows). The
 * biggest hall the island's size and its landmark's reach allow whose floor stands on level, dry
 * ground and keeps off the other civic buildings; failing that, a smaller one; failing all, none.
 */

/** Level ground a hall may stand on: meadow, a lot's ground, the keep's block, the roads, shore grass. */
const FLAT = ".fvVKs="
/** Between the landmark's door step and the hall's back wall, and the wall's thickness all round. */
const GAP = 0.8
const WALL = 1
/** The floor is looked at this finely when asking whether it is dry level land. */
const SAMPLE = 2

/** A hall is no narrower than this, nor shallower: what a smaller island's still gets. */
const SMALLEST = { w: 12, d: 12 }
/** How far past the door (world units) a hall may stand to clear the landmark's forecourt. */
const FORECOURT = 9

/**
 * What a landmark scatters before its door that can make way: its well and fountain, carts, crates,
 * flags, stalls and the like (prefabs/composite). The hall takes their place (`dropLoose`); a drawbridge, a
 * tower or a wall it never does.
 */
export const LOOSE =
  /^(building_well|t2_fountain|bucket_|barrel|crate_|sack|wheelbarrow|t2_cart|t2_fence|t2_planks|rock_single|book_set|flag_|t2_c_flag|t2_lantern|t2_stall|t2_tree|resource_|rope_|weaponrack|t2_pillar)/

/** The landmark without the loose things standing where the hall does: they are gone from its pieces. */
export function dropLoose(civic: Civic, hall: Hall): void {
  const goes = (item: LandPlacement): boolean => LOOSE.test(item.piece) && covers(hall, item.x, item.z, 1)
  civic.placements = civic.placements.filter((item) => !goes(item))
  if (civic.parts) civic.parts = civic.parts.filter((item) => !goes(item))
}

/** A door looks towards the keep when its outward way and the way to the island's middle make less than 60°. */
const TOWARD = 0.5

/**
 * The door of `main` its hall opens onto: of those that look towards the keep (the island's middle),
 * the nearest to it (the front door, not one at the building's back that happens to face the same
 * way); failing any, the nearest of all. The first of two equally near.
 */
export function entryOf(main: MainBuilding): MainBuilding["doors"][number] | undefined {
  const reach = (door: MainBuilding["doors"][number]): number => DMath.hypot(door.x, door.z)
  const facing = (door: MainBuilding["doors"][number]): boolean =>
    (-door.x * DMath.sin(door.rot) - door.z * DMath.cos(door.rot)) / (reach(door) || 1) > TOWARD
  const front = main.doors.filter(facing)
  let best: MainBuilding["doors"][number] | undefined
  for (const door of front.length > 0 ? front : main.doors)
    if (!best || reach(door) < reach(best) - 1e-9) best = door
  return best
}

/** The footprint of a hall's floor and walls, as four corners. */
export const footprintOf = (hall: Pick<Hall, "at" | "rot" | "w" | "d">): Footprint =>
  cornersOf(hall, WALL).map(([x, z]) => [x, z] as [number, number])

/** Whether a point of the island lies on a hall's floor or within `margin` of it. */
export function covers(
  hall: Pick<Hall, "at" | "rot" | "w" | "d">,
  x: number,
  z: number,
  margin = 0,
): boolean {
  const [dx, dz] = [x - hall.at[0], z - hall.at[1]]
  const [sin, cos] = [DMath.sin(hall.rot), DMath.cos(hall.rot)]
  return (
    Math.abs(dx * cos - dz * sin) <= hall.w / 2 + WALL + margin &&
    Math.abs(dx * sin + dz * cos) <= hall.d / 2 + WALL + margin
  )
}

/** Circles (x, z, radius) laid over a hall, for what keeps clear of it (the town's lots, the meadow). */
export function anchorsOf(hall: Pick<Hall, "at" | "rot" | "w" | "d">): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let x = -hall.w / 2; x <= hall.w / 2; x += 4)
    for (let z = -hall.d / 2; z <= hall.d / 2; z += 4) {
      const [ax, az] = toIsland(hall.at, hall.rot, x, z)
      out.push([ax, az, 4])
    }
  return out
}

/** Whether the ground under a hall (and its wall) is level, dry land all over. */
function grounded(plan: IslandPlan, at: Spot, rot: number, w: number, d: number): boolean {
  for (let x = -w / 2 - WALL; x <= w / 2 + WALL; x += SAMPLE)
    for (let z = -d / 2 - WALL; z <= d / 2 + WALL; z += SAMPLE) {
      const hex = plan.land.get(key(cellAt(toIsland(at, rot, x, z))))
      if (!hex || hex.level !== undefined || !FLAT.includes(hex.char)) return false
    }
  return true
}

/**
 * The hall of the island the plan is for, or none: the core (the home island) has the keep's great
 * hall instead, and an island without a main building has no door to open onto.
 */
export function hallFor(plan: IslandPlan, civic: Civic | undefined): Hall | undefined {
  if (!civic?.main || plan.identity?.role === "core") return undefined
  const parts = new Set(civic.parts)
  const others = footprintsOf(civic.placements.filter((item) => !parts.has(item)))
  const files = plan.districts.reduce((sum, district) => sum + district.folder.files, 0)
  // What the landmark has built in front of its door (a drawbridge, a tower) is in the hall's way: it stands past it.
  const forecourt = footprintsOf(civic.parts ?? [], (piece) => anything(piece) && !LOOSE.test(piece))
  return hallOf(plan, civic.main, others, forecourt, files)
}

/** The island's hall, or none (a landmark with no style, no door, or no room). `others` are the civic buildings it keeps off. */
export function hallOf(
  plan: IslandPlan,
  main: MainBuilding,
  others: readonly Footprint[],
  forecourt: readonly Footprint[],
  files: number,
): Hall | undefined {
  const style = STYLE_OF[main.id]
  const door = entryOf(main)
  if (!style || !door) return undefined
  const rot = door.rot
  const [fx, fz] = [DMath.sin(rot), DMath.cos(rot)]
  const first = sizeOf(files, main.rings)
  // From the biggest the island earns down to the smallest, narrower first (the landmark's front is only so wide).
  const sizes: { w: number; d: number }[] = []
  for (let w = first.w; w >= SMALLEST.w; w -= 8)
    for (let d = first.d; d >= SMALLEST.d; d -= 4) sizes.push({ w, d })
  // As close to the door as the landmark's forecourt allows (nearest first), then the biggest that fits there.
  for (let past = 0; past <= FORECOURT; past += 1.5)
    for (const { w, d } of sizes) {
      const near = GAP + past
      const at: Spot = [door.x + fx * (near + d / 2), door.z + fz * (near + d / 2)]
      if (!grounded(plan, at, rot, w, d)) continue
      const hall = buildHall(style, at, rot, w, d, [door.x, door.z])
      const mine = footprintOf(hall)
      if (
        others.some((other) => crowds(mine, other, 0.5)) ||
        forecourt.some((other) => crowds(mine, other, 0.3))
      )
        continue
      return hall
    }
  return undefined
}
