import type { Spot } from "../layout.ts"
import type { World } from "../world.ts"
import type { Anchors } from "./anchors.ts"
import { type Ground, round } from "./spots.ts"
import type { Critter, Species } from "./types.ts"

/**
 * The animals of an island (Kenney's Cube Pets): cows and pigs in the fields, chicks about the
 * houses, dogs on the squares, cats at the doors, rabbits in the meadow. Each wanders a patch of
 * ground on two slow cycles (`wander`), a pure function of the clock, so there is nothing to
 * simulate and nothing to remember.
 */

/** Animals dealt out in this order, whatever the budget. */
const DEAL: readonly Species[] = [
  "cow",
  "chick",
  "dog",
  "pig",
  "chick",
  "cat",
  "bunny",
  "chick",
  "cow",
  "dog",
]
/** The patch each species wanders, world units. */
const RANGE: Readonly<Record<Species, number>> = {
  cow: 2.4,
  pig: 2.2,
  chick: 1.5,
  dog: 3.4,
  cat: 2,
  bunny: 3,
}
/** Animals per folk, and the most there are. */
const PER_FOLK = 0.8
const MOST = 60

export function crittersOf(
  world: World,
  anchors: Anchors,
  ground: Ground,
  folk: number,
  random: () => number,
): Critter[] {
  const total = Math.min(MOST, Math.round(folk * PER_FOLK))
  const homes = world.homes ?? []
  const squares = [...anchors.squares.values()]
  const meadow = world.island.meadow
  const fields = anchors.fields
  const out: Critter[] = []
  let grazing = 0
  const at = (list: readonly Spot[]): Spot | undefined => list[Math.floor(random() * list.length)]
  for (let n = 0; out.length < total && n < total * 3; n++) {
    const species = DEAL[n % DEAL.length] as Species
    const radius = RANGE[species]
    let centre: Spot | undefined
    switch (species) {
      case "cow":
      case "pig":
        // One to a field, the plot's middle.
        centre = fields[grazing++]
        break
      case "chick":
      case "cat": {
        const home = homes[Math.floor(random() * homes.length)]
        centre = home ? ground.near(home.door.step, [radius + 1.6, radius + 3]) : undefined
        break
      }
      case "dog": {
        const square = at(squares)
        centre = square ? ground.near(square, [radius + 3, radius + 5]) : undefined
        break
      }
      case "bunny": {
        const spot = at(meadow)
        centre = spot && ground.open(spot) ? ground.take(spot) : undefined
        break
      }
    }
    if (!centre) continue
    // Whatever stands round the patch shrinks it (fields are crops: nothing to mind).
    const reach = species === "cow" || species === "pig" ? radius : fit(ground, centre, radius)
    if (reach < 0.8) continue
    out.push({
      id: `critter:${out.length}`,
      species,
      at: [round(centre[0]), round(centre[1])],
      radius: reach,
      tempo: [round(0.14 + random() * 0.18), round(0.1 + random() * 0.18)],
      phase: [round(random() * Math.PI * 2), round(random() * Math.PI * 2)],
      roosts: species === "chick",
    })
  }
  return out
}

/** The largest patch up to `radius` round `centre` whose rim is all open ground. */
function fit(ground: Ground, centre: Spot, radius: number): number {
  for (let reach = radius; reach >= 0.8; reach *= 0.8) {
    let clear = true
    for (let k = 0; k < 8 && clear; k++) {
      const angle = (k * Math.PI) / 4
      clear = ground.open([centre[0] + Math.sin(angle) * reach, centre[1] + Math.cos(angle) * reach])
    }
    if (clear) return round(reach)
  }
  return 0
}

/** Where an animal is at `seconds` and which way it faces, with how briskly it is going (0…1). */
export interface Stride {
  x: number
  z: number
  yaw: number
  pace: number
}

export function wander(critter: Critter, seconds: number, out: Stride): Stride {
  const [wa, wb] = critter.tempo
  const a = wa * seconds + critter.phase[0]
  const b = wb * seconds + critter.phase[1]
  // Two cycles fill a square: its corner is a patch's radius away.
  const r = critter.radius * Math.SQRT1_2
  out.x = critter.at[0] + r * Math.sin(a)
  out.z = critter.at[1] + r * Math.sin(b)
  const vx = r * wa * Math.cos(a)
  const vz = r * wb * Math.cos(b)
  out.yaw = Math.atan2(vx, vz)
  out.pace = Math.min(1, Math.hypot(vx, vz) / (r * Math.hypot(wa, wb)))
  return out
}
