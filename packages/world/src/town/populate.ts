/**
 * Populate (plan W7; decisions "The land is alive", "Relief must be walkable"): the townsfolk and
 * their day. Pure and deterministic by seed.
 *
 * - **Who.** One worker per station, matched by kind to a role (`STATION_ROLE`; a hall by the
 *   building it serves: chapel → monk, guildhall → mage, keep → guard), picked round the kinds so a
 *   town gets its innkeeper, smith, clerk and gate guards before its fortieth stall-holder; a night
 *   watch who lights the lamps at dusk and walks the squares all night; and wanderers who stroll
 *   between wells, stalls and the inn, meeting in pairs at a well. How many by tier: `POPULATION`.
 * - **Where they live.** A house (a farmer a farmhouse if there is one), near their work.
 * - **Their day.** A schedule from 00:00 to 24:00 (`SHIFTS`): home (indoors) → work → lunch at the
 *   inn, a well or a stall → work → home, some to the inn for the evening. Every leg is A* on the walk
 *   graph (route.ts) with the edge's clip and speed, each walker keeping to their own side of the way;
 *   every stay is booked, so no two people ever stand on one spot at once.
 *
 * `poseAt` / `simulate` sample a day at any hour for render.
 */
import type { NpcRecipe } from "@guildhall/assets"
import { hash, roll } from "@guildhall/core"
import { axes } from "../geom/obb.ts"
import { centroid } from "../geom/poly.ts"
import { add, dist, norm, perp, scale, snap, sub, type Vec2 } from "../geom/vec.ts"
import { pointAlong } from "./farms.ts"
import type { TownLayout } from "./index.ts"
import { nearestOnWalk, routeGraph } from "./route.ts"
import {
  ahead,
  Bookings,
  DayBuilder,
  type Gait,
  heading,
  type Pose,
  poseOf,
  Router,
  type Spot,
  type StayAs,
  type Step,
} from "./routine.ts"
import type { Actor, Placement, Station, StationKind, Tier } from "./types.ts"

export { LANE_ROOM } from "./route.ts"
export type { Pose, Stay, Step, Walk } from "./routine.ts"

/** How many townsfolk a tier gets (decisions: village 15, town 30, city 45). */
export const POPULATION: Readonly<Record<Tier, number>> = {
  hamlet: 8,
  village: 15,
  town: 30,
  city: 45,
  capital: 60,
}

/** The role (data/npcs) that works a station of each kind; halls go by their building (`HALL_ROLE`). */
export const STATION_ROLE: Readonly<Partial<Record<StationKind, string>>> = {
  tavern: "tavern-keeper",
  forge: "smith",
  gate: "guard",
  dock: "fisher",
  pier: "fisher",
  fishing: "fisher",
  market: "merchant",
  field: "farmer",
  pasture: "farmer",
  lumber: "lumberjack",
  sawmill: "lumberjack",
  quarry: "miner",
  mine: "miner",
  shrine: "monk",
  ruins: "mage",
  training: "archer",
  lookout: "archer",
  lighthouse: "night-watch",
}
const HALL_ROLE: Readonly<Record<string, string>> = { chapel: "monk", hall: "mage", keep: "guard" }
/** Kinds in the order workers are drawn round them: the town's characters first, then the many. */
const KIND_ORDER: readonly StationKind[] = [
  "tavern",
  "forge",
  "hall",
  "gate",
  "dock",
  "market",
  "field",
  "pasture",
  "lumber",
  "sawmill",
  "quarry",
  "mine",
  "fishing",
  "pier",
  "shrine",
  "training",
  "lookout",
  "lighthouse",
  "ruins",
]

/**
 * A worker's day, hours: at work from `start` to `end`, lunch from `lunch` for `meal` hours (on site
 * when `onSite`: sitting by their work), a walk round their beat every couple of hours (`beat`), and
 * the chance they spend the evening at the inn. Each person shifts these by up to ±25 minutes.
 */
export interface Shift {
  start: number
  end: number
  lunch: number | null
  meal: number
  onSite?: boolean
  beat?: boolean
  /** Hours of a morning errand round wells and stalls (the monk's alms), if any. */
  errand?: number
  evening: number
}
export const SHIFTS: Readonly<Record<string, Shift>> = {
  "tavern-keeper": { start: 9.5, end: 23.5, lunch: null, meal: 0, evening: 0 },
  smith: { start: 7, end: 17.5, lunch: 12, meal: 0.75, evening: 0.5 },
  merchant: { start: 7.5, end: 18, lunch: 12.5, meal: 0.75, evening: 0.4 },
  farmer: { start: 5.75, end: 18, lunch: 11.75, meal: 0.75, onSite: true, evening: 0.3 },
  fisher: { start: 4.75, end: 16.5, lunch: 11.5, meal: 1, evening: 0.5 },
  monk: { start: 5.5, end: 19, lunch: 12, meal: 0.5, onSite: true, errand: 9, evening: 0 },
  mage: { start: 8.5, end: 17.5, lunch: 12, meal: 0.75, evening: 0.4 },
  guard: { start: 6, end: 18.5, lunch: null, meal: 0, beat: true, evening: 0.4 },
  archer: { start: 7, end: 19, lunch: 12.5, meal: 0.5, beat: true, evening: 0.3 },
  lumberjack: { start: 6, end: 17.5, lunch: 12, meal: 0.75, onSite: true, evening: 0.4 },
  miner: { start: 6, end: 17, lunch: 12, meal: 0.75, onSite: true, evening: 0.5 },
  "night-watch": { start: 18, end: 5.5, lunch: null, meal: 0, evening: 0 },
}

/** Walking pace, metres an hour (1.3 m/s), before each person's own speed. */
export const PACE = 4680

export interface PopulateOptions {
  /** How many townsfolk; defaults to the tier's `POPULATION`. */
  count?: number
  /** Street lamp positions the night watch lights at dusk (townLights' street points); else spaced along the main streets. */
  lamps?: readonly Vec2[]
  /** Metres an hour on a street (default `PACE`); a faster clock may want it slower. */
  pace?: number
  /** The hour the pinned Actor fields (`at`, `facing`, `clip`, `path`) show (default 10). */
  hour?: number
}

/** A townsperson: the pinned Actor (where they are at `options.hour`) plus who they are and their day. */
export interface Townsperson extends Actor {
  id: string
  /** The role recipe id (data/npcs). */
  role: string
  /** What they do: works a station, keeps the night watch, or wanders. */
  kind: "worker" | "watch" | "wanderer"
  home: { lot?: number; at: Vec2 }
  /** The station they work, if any. */
  work: string | null
  /** 00:00–24:00 without a gap: stays and walks. */
  day: Step[]
}

export type PopulateInput = Pick<
  TownLayout,
  "spec" | "stations" | "walk" | "placements" | "streets" | "sizes"
>

type Recipe = Pick<NpcRecipe, "id" | "activity" | "vary">

/** Where someone may stop, by what it is (the clip a visitor plays there follows from it). */
interface Public extends Spot {
  type: "tavern" | "well" | "stall" | "hall"
}

/** The townsfolk of a plan, and their day. Roles whose recipe is not in `npcs` are left out. */
export function populate(
  plan: PopulateInput,
  npcs: readonly Recipe[],
  seed: number,
  options: PopulateOptions = {},
): Townsperson[] {
  const tier = plan.spec.tier
  const total = Math.max(0, Math.round(options.count ?? POPULATION[tier]))
  const recipes = new Map(npcs.map((r) => [r.id, r]))
  const watchers = recipes.has("night-watch") && total >= 12 ? Math.max(1, Math.round(total / 15)) : 0
  const wanderers = Math.round(total * 0.2)

  // Workers, drawn round the kinds.
  const jobs = jobsOf(plan, recipes, seed).slice(0, Math.max(0, total - watchers - wanderers))
  const walkers = total - watchers - jobs.length

  // Every spot anyone stops at off the street: doors, places beside stations, lamps.
  const houses = plan.placements.filter(
    (p) => (p.role === "house" && p.lot !== undefined) || p.role === "farmhouse",
  )
  const doors = houses.map((p) => door(p, plan.sizes))
  const publics = publicPlaces(plan)
  const lamps = (options.lamps ?? streetLamps(plan)).map((l) => lampSpot(plan, l))
  const { graph, spotNodes } = routeGraph(plan.walk, [
    ...doors.map((d) => d.at),
    ...publics.map((p) => p.at),
    ...lamps.map((l) => l.at),
  ])
  let k = 0
  const doorSpots = doors.map(
    (d, i): Spot => ({ ...d, key: `home:${i}`, node: spotNodes[k++] as number, y: 0 }),
  )
  const pubSpots = publics.map((p): Public => ({ ...p, node: spotNodes[k++] as number, y: 0 }))
  const lampSpots = lamps.map(
    (l, i): Spot => ({ ...l, key: `lamp:${i}`, node: spotNodes[k++] as number, y: 0 }),
  )
  for (const s of [...doorSpots, ...pubSpots, ...lampSpots]) s.y = graph.nodes[s.node]?.y ?? 0

  const router = new Router(graph)
  const bookings = new Bookings()
  const stationNode = new Map(plan.walk.nodes.flatMap((n) => (n.station ? [[n.station, n.id] as const] : [])))
  const nodeSpot = (id: number): Spot => {
    const n = plan.walk.nodes[id] as { at: Vec2; y: number }
    return { key: `node:${id}`, node: id, at: n.at, y: n.y, facing: 0 }
  }
  const stationSpot = (s: Station): Spot => ({
    key: s.id,
    node: stationNode.get(s.id) as number,
    at: s.at,
    y: plan.walk.nodes[stationNode.get(s.id) as number]?.y ?? 0,
    facing: s.facing,
  })

  const hub = nodeSpot(
    Math.max(
      0,
      plan.streets.nodes.findIndex((n) => n.kind === "plaza"),
    ),
  )

  // Homes: a door near the work (or anywhere for those without), three to a house at most.
  const occupants = doorSpots.map(() => 0)
  const farmhouse = houses.map((p) => p.role === "farmhouse")
  const homeFor = (i: number, near: Spot | null, farmer: boolean): number => {
    // Near the work, or anywhere (a seeded order) for those without; reachable from the square.
    const goal = near ?? hub
    const sorted = doorSpots
      .map((d, h) => ({
        h,
        d: near
          ? dist(d.at, near.at) + (farmer && farmhouse[h] ? -200 : 0)
          : roll(seed, `${h}:${i}:anywhere`),
      }))
      .filter((x) => (occupants[x.h] as number) < 3)
      .sort((a, b) => a.d - b.d || a.h - b.h)
    const order: { h: number }[] = []
    for (const x of sorted) {
      if (order.length >= (near ? 5 : 1)) break
      if (Number.isFinite(router.metres(doorSpots[x.h]?.node as number, goal.node))) order.push(x)
    }
    if (order.length === 0) return -1
    const got = order[Math.floor(roll(seed, `${i}:home`) * order.length)] as { h: number }
    occupants[got.h] = (occupants[got.h] as number) + 1
    return got.h
  }

  const people: Townsperson[] = []
  const pace = options.pace ?? PACE
  const hour = options.hour ?? 10
  const make = (
    i: number,
    role: string,
    kind: Townsperson["kind"],
    work: Station | null,
    build: (day: Ctx) => Step[],
  ): void => {
    const r = recipes.get(role) as Recipe
    const look = hash(seed, i, "look")
    const workSpot = work ? stationSpot(work) : null
    const h = homeFor(i, workSpot, role === "farmer")
    if (h < 0) return
    const home = doorSpots[h] as Spot
    const homeSpot: Spot = { ...home, key: `home:${i}` }
    const idle = r.activity.idle[Math.floor(roll(look, "idle") * r.activity.idle.length)] ?? "Idle_A"
    const gait: Gait = {
      pace: pace * (r.vary.speed[0] + (r.vary.speed[1] - r.vary.speed[0]) * roll(look, "speed")),
      lane: 0.35 + 0.6 * roll(look, "lane"),
      walk: r.activity.walk,
    }
    const who = `${role}:${i}`
    const day = build({
      home: homeSpot,
      work: workSpot,
      clips: { work: r.activity.work, idle },
      jitter: (salt) => (roll(seed, `${i}:${salt}`) - 0.5) * (50 / 60),
      chance: (salt) => roll(seed, `${i}:${salt}`),
      builder: (start, as, until) => new DayBuilder(who, gait, router, bookings, start, as, until),
    })
    const pose = poseOf(day, hour)
    const now = day.find((s) => s.from <= hour && hour < s.to)
    people.push({
      id: who,
      role,
      kind,
      seed: look,
      recipe: role,
      home: { ...(houses[h]?.lot !== undefined ? { lot: houses[h]?.lot as number } : {}), at: home.at },
      work: work?.id ?? null,
      day,
      at: [pose.at[0], pose.at[2]],
      facing: pose.facing,
      clip: pose.indoors ? "" : pose.clip,
      ...(now?.kind === "walk" ? { path: now.pts.map((p): Vec2 => [p[0], p[2]]) } : {}),
    })
  }

  // A worker's own place is theirs all day.
  for (const [n, j] of jobs.entries()) bookings.book(j.station.id, 0, 24, `${j.role}:${watchers + n}`)
  const centre = plazaCentre(plan)
  const rounds = watchRounds(plan, watchers, centre)
  const lampTours = splitByAngle(lampSpots, watchers, centre)
  let i = 0
  for (let w = 0; w < watchers; w++, i++) {
    const loop = (rounds[w] ?? []).map(nodeSpot)
    make(i, "night-watch", "watch", null, (c) => watchDay(c, loop, lampTours[w] ?? []))
  }
  for (const j of jobs) {
    const shift = SHIFTS[j.role] ?? (SHIFTS.merchant as Shift)
    const beats = shift.beat ? beatsOf(plan, j.station).map(nodeSpot) : []
    make(i, j.role, "worker", j.station, (c) => workerDay(c, shift, pubSpots, beats))
    i++
  }
  // Wanderers, in pairs that meet at a well in the afternoon.
  const wells = pubSpots.filter((p) => p.type === "well")
  const commoners = ["merchant", "farmer", "fisher", "smith", "tavern-keeper", "monk"].filter((r) =>
    recipes.has(r),
  )
  for (let w = 0; w < walkers && commoners.length > 0; w++, i++) {
    const role = commoners[Math.floor(roll(seed, `${i}:wanderer`) * commoners.length)] as string
    const pair = Math.floor(w / 2)
    const meetAt = 14.5 + roll(seed, `${pair}:meet`) * 1.5
    const well =
      wells.length > 0 ? Math.floor(roll(seed, `${pair}:well`) * Math.max(1, wells.length / 4)) * 4 : -1
    const slot = well >= 0 ? (wells[well + (w % 2) * 2] ?? null) : null
    const meet =
      slot && walkers - (w - (w % 2)) >= 2 ? { spot: slot, from: meetAt, until: meetAt + 0.75 } : null
    if (meet) bookings.book(meet.spot.key, meet.from - 0.5, meet.until, `${role}:${i}`)
    make(i, role, "wanderer", null, (c) => wanderDay(c, pubSpots, meet))
  }
  return people
}

/** What a day is laid out with. */
interface Ctx {
  home: Spot
  work: Spot | null
  clips: { work: string; idle: string }
  /** A shift in hours, within ±25 minutes, by salt. */
  jitter: (salt: string) => number
  chance: (salt: string) => number
  builder: (start: Spot, as: StayAs, until: number) => DayBuilder
}

const INDOORS: StayAs = { clip: "Idle_A", indoors: true }

/** Where a visitor stands at a public place, what they play there. */
function visit(p: Public, c: Ctx, salt: string): StayAs {
  if (p.type === "stall") return { clip: "Interact" }
  if (p.type === "well" && c.chance(salt) < 0.4) return { clip: "Sit_Floor_Idle" }
  return { clip: c.clips.idle }
}

/** Goes on to the first of `list` reachable and free, playing what a visitor plays there. */
function goVisit(
  day: DayBuilder,
  c: Ctx,
  list: readonly Public[],
  salt: string,
  when: { until?: number; dwell?: number },
): boolean {
  return list.some((p) => day.go([p], visit(p, c, salt), when))
}

/** The station a spot belongs to (`market:3#1` → `market:3`). */
const placeOf = (key: string): string => key.split("#")[0] as string

/** Public places nearest `from` first (the nearest `take`), optionally of some types. */
function nearest(list: readonly Public[], from: Vec2, take: number, types?: Public["type"][]): Public[] {
  return list
    .filter((p) => !types || types.includes(p.type))
    .map((p) => ({ p, d: dist(p.at, from) }))
    .sort((a, b) => a.d - b.d || (a.p.key < b.p.key ? -1 : 1))
    .slice(0, take)
    .map((x) => x.p)
}

/** Rotated so it starts at a drawn index (variety among equally near choices). */
const rotate = <T>(list: readonly T[], k: number): T[] => [...list.slice(k), ...list.slice(0, k)]

function workerDay(c: Ctx, s: Shift, pubs: readonly Public[], beats: readonly Spot[]): Step[] {
  const work = c.work as Spot
  const at = (h: number, salt: string) => h + c.jitter(salt)
  const start = at(s.start, "start")
  const end = Math.min(23.5, at(s.end, "end"))
  const day = c.builder(c.home, INDOORS, start)
  const atWork: StayAs = { clip: c.clips.work }
  const toWork = (until: number) => day.go([work], atWork, { until })

  // The morning: work, an errand round the wells and stalls, or a beat.
  const lunch = s.lunch === null ? null : at(s.lunch, "lunch")
  const morningEnd = lunch ?? end
  if (s.errand !== undefined) {
    toWork(s.errand)
    const round = rotate(nearest(pubs, work.at, 6, ["well", "stall"]), Math.floor(c.chance("errand") * 3))
    for (const p of round.slice(0, 2)) day.go([p], { clip: "Interact" }, { dwell: 0.3 })
    toWork(morningEnd)
  } else if (beats.length > 0) {
    beatRound(day, work, beats, atWork, c.clips.idle, s.start + 2.5, morningEnd)
  } else toWork(morningEnd)

  if (lunch !== null) {
    const back = lunch + s.meal
    if (s.onSite) day.go([work], { clip: "Sit_Floor_Idle" }, { until: back })
    else {
      const eat = rotate(
        nearest(pubs, work.at, 8, ["tavern", "well", "stall"]),
        Math.floor(c.chance("eat") * 3),
      )
      goVisit(day, c, eat, "eat:sit", { until: back })
    }
    if (beats.length > 0) beatRound(day, work, beats, atWork, c.clips.idle, back + 1.5, end)
    else toWork(end)
  }

  // The evening at the inn, or home.
  if (c.chance("evening") < s.evening && end < 21) {
    const inns = nearest(pubs, work.at, 8, ["tavern"])
    goVisit(day, c, inns, "evening:sit", { until: Math.min(23, at(20.75, "late")) })
  }
  return day.close()
}

/** At the post until `end`, walking out to a beat and back every two hours from `first`. */
function beatRound(
  day: DayBuilder,
  post: Spot,
  beats: readonly Spot[],
  as: StayAs,
  idle: string,
  first: number,
  end: number,
) {
  let n = 0
  for (let t = first; t + 0.6 < end; t += 2) {
    day.go([post], as, { until: t })
    day.go([beats[n++ % beats.length] as Spot], { clip: idle }, { dwell: 0.1 })
  }
  day.go([post], as, { until: end })
}

function watchDay(c: Ctx, loop: readonly Spot[], lamps: readonly Spot[]): Step[] {
  const post = loop[0] ?? c.home
  const lantern: StayAs = { clip: c.clips.work }
  const day = c.builder(post, lantern, 0.25)
  const patrol = (until: number) => {
    for (let n = 1, guard = 0; day.until < until && guard < 64; n++, guard++) {
      const stop = loop[n % Math.max(1, loop.length)] as Spot
      if (!day.go([stop], lantern, { dwell: 0.06 + 0.08 * c.chance(`${n}:dwell`) })) break
    }
  }
  patrol(5)
  day.go([c.home], INDOORS, { until: 17.25 + c.jitter("dusk") / 2 })
  // Dusk: round the lamps, nearest next.
  const left = [...lamps]
  while (left.length > 0) {
    const here = day.here.at
    left.sort((a, b) => dist(a.at, here) - dist(b.at, here) || (a.key < b.key ? -1 : 1))
    const lamp = left.shift() as Spot
    day.go([lamp], { clip: "Use_Item" }, { dwell: 0.03 })
  }
  patrol(23.25)
  return day.close()
}

function wanderDay(
  c: Ctx,
  pubs: readonly Public[],
  meet: { spot: Spot; from: number; until: number } | null,
): Step[] {
  const day = c.builder(c.home, INDOORS, 8 + Math.abs(c.jitter("wake")) * 3)
  // Strolls from place to place (never two spots of one place in a row) until `back`.
  const outing = (back: number) => {
    for (let k = 0; k < 8 && day.until < back - 0.4; k++) {
      const here = placeOf(day.here.key)
      const near = nearest(
        pubs.filter((p) => placeOf(p.key) !== here),
        day.here.at,
        10,
      )
      const tries = rotate(near, Math.floor(c.chance(`${k}:${back}:where`) * near.length))
      const dwell = Math.min(0.3 + 0.6 * c.chance(`${k}:${back}:dwell`), back - day.until - 0.15)
      if (!goVisit(day, c, tries, `${k}:${back}:sit`, { dwell })) break
    }
  }
  outing(12.5)
  day.go([c.home], INDOORS, { until: 13.75 + c.jitter("lunch") / 2 })
  if (meet) {
    // Meeting a friend at the well: the pair face each other across it.
    day.go(
      [meet.spot],
      { clip: c.clips.idle },
      { depart: Math.max(day.until, meet.from - 0.3), until: meet.until },
    )
  }
  outing(18.5)
  return day.close(18.5 + c.jitter("home"))
}

/** The stations that get a worker, round the kinds in `KIND_ORDER`, each kind's in a seeded order. */
function jobsOf(
  plan: PopulateInput,
  recipes: ReadonlyMap<string, Recipe>,
  seed: number,
): { station: Station; role: string }[] {
  const byKind = new Map<StationKind, { station: Station; role: string }[]>()
  for (const s of plan.stations) {
    const role =
      s.kind === "hall"
        ? hallRole(plan, s)
        : s.id === "dock:harbourmaster"
          ? "merchant"
          : STATION_ROLE[s.kind]
    if (!role || !recipes.has(role)) continue
    const list = byKind.get(s.kind) ?? []
    list.push({ station: s, role })
    byKind.set(s.kind, list)
  }
  const queues = KIND_ORDER.map((k) =>
    (byKind.get(k) ?? [])
      .map((j) => ({ j, r: roll(seed, `${j.station.id}:job`) }))
      .sort((a, b) => a.r - b.r || (a.j.station.id < b.j.station.id ? -1 : 1))
      .map((x) => x.j),
  )
  const out: { station: Station; role: string }[] = []
  for (let more = true; more; ) {
    more = false
    for (const q of queues) {
      const j = q.shift()
      if (j) {
        out.push(j)
        more = true
      }
    }
  }
  return out
}

/** The role a hall station needs: the building nearest it (chapel, guildhall or keep). */
function hallRole(plan: PopulateInput, s: Station): string | undefined {
  let best: { role: string; d: number } | null = null
  for (const p of plan.placements) {
    const role = p.role ?? ""
    if (!(role in HALL_ROLE)) continue
    const d = dist(p.at, s.at)
    if (!best || d < best.d) best = { role, d }
  }
  return best ? HALL_ROLE[best.role] : undefined
}

/** The point a step out from a building's front (+z), and the way out. */
function door(p: Placement, sizes: Record<string, [number, number]>): { at: Vec2; facing: number } {
  const d = sizes[p.prefab]?.[1] ?? 6
  return { at: snap(ahead(p.at, p.rot, d / 2 + 0.8)), facing: p.rot }
}

/** The nearest placement of some roles to `at` within `max` metres. */
function nearestPlaced(plan: PopulateInput, at: Vec2, roles: string[], max: number): Placement | null {
  let best: { p: Placement; d: number } | null = null
  for (const p of plan.placements) {
    if (!roles.includes(p.role ?? "")) continue
    const d = dist(p.at, at)
    if (d <= max && (!best || d < best.d)) best = { p, d }
  }
  return best?.p ?? null
}

/**
 * The places visitors stand: a ring of four by each inn door, four round each well, a customer in
 * front of each stall or counter, three before each chapel or hall. Keys are `<station>#<n>`.
 */
function publicPlaces(plan: PopulateInput): Omit<Public, "node" | "y">[] {
  const out: Omit<Public, "node" | "y">[] = []
  const ring = (
    s: Station,
    type: Public["type"],
    c: Vec2,
    r: number,
    from: number,
    n: number,
    step: number,
  ) => {
    for (let k = 0; k < n; k++) {
      const a = from + k * step
      const at = snap(add(c, [Math.sin(a) * r, Math.cos(a) * r]))
      out.push({ key: `${s.id}#${k + 1}`, type, at, facing: heading(sub(c, at)) })
    }
  }
  for (const s of plan.stations) {
    if (s.kind === "tavern" || s.kind === "hall") {
      const b = nearestPlaced(plan, s.at, ["tavern", "chapel", "hall", "keep"], 30)
      const out1 = b && dist(b.at, s.at) > 0.1 ? norm(sub(s.at, b.at)) : axes(s.facing + Math.PI).z
      if (s.kind === "tavern")
        ring(s, "tavern", add(s.at, scale(out1, 2.6)), 1.1, heading(out1) + Math.PI / 4, 4, Math.PI / 2)
      else
        for (let k = 0; k < 3; k++) {
          const at = snap(add(add(s.at, scale(out1, 2.4)), scale(perp(out1), (k - 1) * 1.3)))
          out.push({ key: `${s.id}#${k + 1}`, type: "hall", at, facing: heading(scale(out1, -1)) })
        }
    } else if (s.kind === "well") {
      const w = nearestPlaced(plan, s.at, ["well", "fountain"], 6)
      const [w0, d0]: [number, number] = w ? (plan.sizes[w.prefab] ?? [1.6, 1.6]) : [1.6, 1.6]
      const c = w ? w.at : ahead(s.at, s.facing, 1.5)
      const from = heading(sub(s.at, c))
      ring(s, "well", c, Math.max(w0, d0) / 2 + 0.7, from + (2 * Math.PI) / 5, 4, (2 * Math.PI) / 5)
    } else if (s.kind === "market") {
      const stall = nearestPlaced(plan, s.at, ["stall"], 4.5)
      const d = stall ? (plan.sizes[stall.prefab]?.[1] ?? 3) : 0
      const at = stall ? ahead(stall.at, stall.rot, d / 2 + 0.9) : ahead(s.at, s.facing, 1.4)
      out.push({ key: `${s.id}#1`, type: "stall", at: snap(at), facing: heading(sub(s.at, at)) })
    }
  }
  return out
}

/** Lamp stops spaced along the main streets and streets, at the kerb, alternating sides (no lamps given). */
function streetLamps(plan: PopulateInput): Vec2[] {
  const out: Vec2[] = []
  for (const e of plan.streets.edges) {
    if (e.cls !== "main" && e.cls !== "street") continue
    let l = 0
    for (let k = 1; k < e.points.length; k++) l += dist(e.points[k - 1] as Vec2, e.points[k] as Vec2)
    for (let s = 11, side = 1; s < l - 5; s += 22, side = -side) {
      const a = pointAlong(e.points, s)
      const dir = norm(sub(pointAlong(e.points, s + 0.5), a))
      out.push(add(a, scale(perp(dir), side * (e.width / 2 - 0.3))))
    }
  }
  return out
}

/** Where the lamplighter stands to light a lamp: a step from it towards the way, facing it. */
function lampSpot(plan: PopulateInput, lamp: Vec2): { at: Vec2; facing: number } {
  const on = nearestOnWalk(plan.walk, lamp) ?? lamp
  const toward = dist(on, lamp) > 0.01 ? norm(sub(on, lamp)) : ([1, 0] as Vec2)
  const at = snap(add(lamp, scale(toward, Math.min(0.7, dist(on, lamp)))))
  return { at, facing: heading(scale(toward, -1)) }
}

/** The market square's middle (the origin when the plan has none). */
function plazaCentre(plan: PopulateInput): Vec2 {
  const plaza = plan.streets.nodes.filter((n) => n.kind === "plaza").map((n) => n.at)
  return plaza.length > 0 ? centroid(plaza) : [0, 0]
}

/** `n` runs of `list`, each the ones in one slice of the compass round `centre`. */
function splitByAngle<T extends { at: Vec2 }>(list: readonly T[], n: number, centre: Vec2): T[][] {
  const sorted = [...list].sort((a, b) => angle(a.at, centre) - angle(b.at, centre))
  return Array.from({ length: n }, (_, k) =>
    sorted.slice(Math.floor((k * sorted.length) / n), Math.floor(((k + 1) * sorted.length) / n)),
  )
}
const angle = (p: Vec2, c: Vec2): number => Math.atan2(p[1] - c[1], p[0] - c[0])

/**
 * Each watchman's round: walk nodes at the gates, on the square and at the busier junctions, split by
 * compass slice round the square, at most six, in order round it (the first is their post at midnight).
 */
function watchRounds(plan: PopulateInput, n: number, centre: Vec2): number[][] {
  if (n === 0) return []
  const degree = new Map<number, number>()
  for (const e of plan.streets.edges)
    if (e.cls !== "road") for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) ?? 0) + 1)
  const stops = plan.streets.nodes
    .map((s, i) => ({ s, i, at: s.at }))
    .filter(({ s }) => s.kind === "plaza" || s.kind === "gate" || (degree.get(s.id) ?? 0) >= 4)
  return splitByAngle(stops, n, centre).map((part) => {
    const step = Math.max(1, Math.ceil(part.length / 6))
    return part.filter((_, k) => k % step === 0).map((x) => x.i)
  })
}

/** A post's beat: the street junctions next to the gate the station guards (or near the keep). */
function beatsOf(plan: PopulateInput, s: Station): number[] {
  const nodes = plan.streets.nodes
  let gate = -1
  let best = Infinity
  nodes.forEach((n, i) => {
    const d = dist(n.at, s.at)
    if (d < best) {
      best = d
      gate = i
    }
  })
  const id = nodes[gate]?.id
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  return plan.streets.edges
    .filter((e) => e.cls !== "road" && (e.a === id || e.b === id))
    .map((e) => index.get(e.a === id ? e.b : e.a) as number)
    .filter((i) => i !== undefined)
    .slice(0, 2)
}

/** Where `actor` is at `hour`. */
export const poseAt = (actor: Pick<Townsperson, "day">, hour: number): Pose => poseOf(actor.day, hour)

/** Everyone's pose at `hour` (fractional, wrapped into 0–24), in the order given. */
export const simulate = (actors: readonly Pick<Townsperson, "day">[], hour: number): Pose[] =>
  actors.map((a) => poseOf(a.day, hour))
