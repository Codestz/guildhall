import type { Home } from "../homes.ts"
import type { Spot } from "../layout.ts"
import type { Venue, VenueDoor, VenueKind } from "../venues.ts"
import type { World } from "../world.ts"
import type { Anchors, WallRun } from "./anchors.ts"
import { facing, type Ground, round } from "./spots.ts"
import type { Lift, Slot, Stop } from "./types.ts"

/**
 * The loops of stops each part of a folk's day is made of (types.ts). Every builder takes spots
 * from the ground (spots.ts), so no two folk share one; a role the island has no place for gets
 * none (plan.ts leaves it out).
 */

/** How far above the ground a wall's walk lies (the pack's wall piece at 5×). */
export const WALL_TOP = 5.45

export interface Kit {
  world: World
  anchors: Anchors
  ground: Ground
  home: Home
}

/** The loop of each slot; `home` is the same for everyone. */
export type Stops = Record<Slot, readonly Stop[]>

/** What a venue's work looks like. */
const WORK_CLIP: Readonly<Record<VenueKind, string>> = {
  forge: "Hammering",
  library: "Working_B",
  market: "Interact",
  mine: "Pickaxing",
  watchtower: "Ranged_Bow_Aiming_Idle",
  tavern: "Interact",
}

const stand = (at: Spot, face: number, clip: string, wait: number): Stop => ({ at, face, clip, wait })

/** In at a door and out again after `wait` seconds (a full house waits at the step). */
function visit(door: VenueDoor, venue: string, wait: number, cap?: number): Stop {
  return { at: door.step, face: door.inward, clip: "Idle_A", wait, door, venue, ...(cap ? { cap } : {}) }
}

export function homeStops(home: Home): readonly Stop[] {
  return [visit(home.door, home.id, Number.POSITIVE_INFINITY)]
}

/** Standing about the square: a word, a wave, a look round. */
export function plazaStops(kit: Kit, district: string): readonly Stop[] {
  const { anchors, ground } = kit
  // Their own square, then (when it is full) the harbour's, then the keep's gate.
  for (const square of [anchors.squares.get(district), anchors.hub, anchors.gate]) {
    const at = square ? ground.near(square, SQUARE_RINGS) : undefined
    if (!at || !square) continue
    const face = facing(at, square)
    return [stand(at, face, "Idle_A", 9), stand(at, face, "Waving", 3), stand(at, face, "Idle_B", 8)]
  }
  return homeStops(kit.home)
}

/** Rings of standing room round a square, nearest first. */
const SQUARE_RINGS = [3.8, 5.2, 6.6, 8.2, 10, 12]

/** The evening inn: in at its door for a good while, then the step outside; the square where there is none. */
export function innStops(kit: Kit, district: string): readonly Stop[] {
  const { anchors, ground } = kit
  const inn = anchors.inn
  if (!inn) return plazaStops(kit, district)
  const { step, inward } = inn.door
  const at = ground.near(step, [2.4, 3.6, 4.8]) ?? step
  return [
    visit(inn.door, inn.id, 40, inn.capacity),
    stand(at, facing(at, step), "Idle_A", 14),
    stand(at, facing(at, step), "Cheering", 3),
    stand(at, inward + Math.PI, "Idle_B", 10),
  ]
}

const venueOf = (world: World, district: string): Venue | undefined =>
  world.venues?.find((venue) => venue.district === district)

/** A villager works the trade of their district's venue: at its posts, and in at its door between. */
export function villagerWork(kit: Kit): readonly Stop[] {
  const { world, anchors, ground, home } = kit
  const venue = venueOf(world, home.district)
  const district = anchors.districts.get(home.district)
  const post = district?.posts[0]
  const around: Spot = venue
    ? venue.door.step
    : post
      ? [post[0], post[1]]
      : (anchors.squares.get(home.district) ?? anchors.gate)
  const clip = venue ? WORK_CLIP[venue.kind] : "Working_A"
  const a = ground.near(around, [1.8, 2.8, 3.8])
  const b = ground.near(around, [2.2, 3.2, 4.2], Math.PI)
  const out: Stop[] = []
  const look = (at: Spot): number => facing(at, venue ? venue.at : (district?.at ?? around))
  if (a) out.push(stand(a, look(a), clip, 18))
  if (venue) out.push(visit(venue.door, venue.id, 14, venue.capacity))
  if (b) out.push(stand(b, look(b), "Idle_B", 7), stand(b, look(b), clip, 12))
  return out.length > 0 ? out : [stand(around, 0, "Idle_A", 20)]
}

/** A farmer tends a field, a row at a time, and rests between. */
export function farmerWork(kit: Kit, nth: number): readonly Stop[] {
  const { anchors, ground, home } = kit
  const [hx, hz] = home.door.step
  const fields = [...anchors.fields].sort(
    (a, b) => Math.hypot(a[0] - hx, a[1] - hz) - Math.hypot(b[0] - hx, b[1] - hz),
  )
  const field = fields[nth % Math.max(1, Math.min(fields.length, 6))]
  if (!field) return []
  // Inside the plot (crops stand in rows, a hex 10 across): three rows of it.
  const rows: Spot[] = [
    [-2.4, -1.2],
    [2.4, 0.8],
    [0, 2.6],
  ]
  const spots = rows.map(
    ([dx, dz]): Spot => ground.take([round(field[0] + (dx as number)), round(field[1] + (dz as number))]),
  )
  const out: Stop[] = spots.map((at) => stand(at, facing(at, field) + Math.PI / 2, "Digging", 17))
  const [first] = spots
  if (first) out.splice(1, 0, stand(first, facing(first, field), "Idle_B", 5))
  return out
}

export function minerWork(kit: Kit): readonly Stop[] {
  const mine = kit.anchors.mine
  if (!mine) return []
  const { step } = mine.door
  const a = kit.ground.near(step, [2, 3, 4])
  const out: Stop[] = []
  if (a) out.push(stand(a, facing(a, mine.at), "Pickaxing", 20))
  out.push(visit(mine.door, mine.id, 26, mine.capacity))
  const b = kit.ground.near(step, [2.4, 3.4, 4.4], Math.PI)
  if (b) out.push(stand(b, facing(b, mine.at), "Idle_B", 6))
  return out
}

/** Quay lanes: two files of fishers along the planks, seaward. */
export function fisherWork(kit: Kit, nth: number): readonly Stop[] {
  const dock = kit.anchors.dock
  if (!dock) return []
  const lane = nth % 2 === 0 ? -0.8 : 0.8
  const row = Math.floor(nth / 2) % 5
  const at: Spot = kit.ground.take([round(dock[0] + lane), round(dock[1] - 10.5 + row * 2.2)])
  return [
    stand(at, 0, "Fishing_Cast", 2.4),
    stand(at, 0, "Fishing_Idle", 11),
    stand(at, 0, "Fishing_Reeling", 3.4),
    stand(at, 0, "Fishing_Catch", 2.4),
  ]
}

/** A trader walks the road between the market and the quay, a stall's wait at each end. */
export function traderWork(kit: Kit, nth: number): readonly Stop[] {
  const { anchors, ground } = kit
  // Each trades from one of the three halls nearest the quay.
  const market = anchors.markets[nth % Math.min(3, anchors.markets.length)]
  const quay = anchors.dock
  if (!market || !quay) return []
  const a = ground.near(market.door.step, [2.6, 3.6, 4.6], nth) ?? market.door.step
  const at: Spot = [quay[0] + (nth % 2 === 0 ? -2.6 : 2.6), quay[1] - 12.5]
  const b = ground.near(at, [0.1, 1.2, 2.2]) ?? at
  return [stand(a, facing(a, market.at), "Interact", 12), stand(b, 0, "Waving", 10)]
}

/** The watch: up and down a stretch of wall; or, where there is none, at the keep's gate. */
export function guardWork(kit: Kit, nth: number): { stops: readonly Stop[]; lift?: Lift } {
  const { anchors, ground } = kit
  const run = anchors.runs[nth % Math.max(1, anchors.runs.length)]
  if (run && anchors.runs.length > 0) return onWall(run)
  const gate = anchors.gate
  const side = nth % 2 === 0 ? -3.2 : 3.2
  const at = ground.near([gate[0] + side, gate[1] + 4], [0.1, 1.2, 2.4]) ?? [gate[0] + side, gate[1] + 4]
  const back = ground.near([gate[0] + side * 1.8, gate[1] + 8], [0.1, 1.2, 2.4]) ?? at
  return {
    stops: [stand(at, 0, "Idle_A", 14), stand(at, 0, "Idle_B", 5), stand(back, 0, "Idle_A", 10)],
  }
}

function onWall(run: WallRun): { stops: Stop[]; lift: Lift } {
  const { from, to, inside } = run
  const out: Spot = [-inside[0], -inside[1]]
  // A beat of a few points between the ends; each guard of a run starts a little way along it.
  const points = [0, 0.34, 0.67, 1].map(
    (t): Spot => [round(from[0] + (to[0] - from[0]) * t), round(from[1] + (to[1] - from[1]) * t)],
  )
  const stops = points.map((at, i): Stop => {
    const end = i === 0 || i === points.length - 1
    return {
      at,
      face: Math.atan2(out[0], out[1]),
      clip: end ? "Idle_B" : "Idle_A",
      wait: end ? 7 : 0,
      up: WALL_TOP,
    }
  })
  return {
    stops,
    lift: {
      step: [round(from[0] + inside[0] * 3.4), round(from[1] + inside[1] * 3.4)],
      sill: [round(from[0] + inside[0] * 1.2), round(from[1] + inside[1] * 1.2)],
      top: from,
      up: WALL_TOP,
    },
  }
}
