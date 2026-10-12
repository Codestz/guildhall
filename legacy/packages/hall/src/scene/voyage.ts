import type { AdventurerView } from "../guild/store.ts"
import { fromSea, type Isle, isleOf, type Sea, seaNow, toSea } from "../world/abroad.ts"
import { type FerryState, ferryAt, nextDeparture } from "../world/ferrySchedule.ts"
import { wayAcross, wayIn, wayOut } from "../world/hall/build.ts"
import { covers } from "../world/hall/site.ts"
import { HEX_SCALE } from "../world/lands.ts"
import { BERTH_BACK } from "../world/lanes.ts"
import type { Spot } from "../world/layout.ts"
import type { LinkRoute } from "../world/linkNet.ts"
import type { Quay } from "../world/linkStub.ts"
import { route } from "../world/paths.ts"
import { type Leg, travelBetween } from "../world/travel.ts"

/**
 * Going from island to island, and across a far island to its hall (scene/brain.ts asks for it every
 * frame). Given where a figure is and where its view sends it (`view.hall`, else the home island), a
 * `Voyage` says how to get there: on foot over the island's roads (and through its hall's gate and
 * along its lane), then by the crossing the planner picks (world/travel.ts `travelBetween`):
 *
 *   ferry   along the pier to the boat's berth, wait for the boat to lie at the quay with time to
 *           spare, step aboard, ride the lane (on the deck, where the ferry is at story time:
 *           world/ferrySchedule.ts), step off at the other pier
 *   bridge  up the ramp, across the deck, down the other ramp: on foot, as the bridge is laid
 *
 * and on foot again from the landing. Nobody walks on the water: the roads end at the quays (the
 * `Q` nodes: world/quays.ts), the piers and bridges are structures, and a ferry carries them
 * across. Pure but for its state: the time is the story's, so a seek or a replay crosses alike.
 */

/** Where to aim this frame, in the archipelago's coordinates. */
export interface Aim {
  /** Changes whenever `path` does: the brain takes the new path then. */
  key: string
  /** The spots to walk through, the last being the goal. */
  path: readonly Spot[]
  /** The height of whatever is underfoot (ground, a pier's deck, a bridge's). */
  ground: (x: number, z: number) => number
  /** Aboard a ferry (or stepping across): put there and turned, not walked. */
  ride?: { x: number; y: number; z: number; heading: number }
  /** Waiting: face this way. */
  face?: number
}

type Mode = "ashore" | "toPier" | "board" | "ride" | "land" | "toBridge" | "deck"
type Crossing = Extract<Leg, { kind: "ferry" | "bridge" }>

/** Stepping between a pier and a deck takes this long (s). */
const STEP_S = 0.9
/** A boat is boarded only with this long to spare before it casts off (s). */
const SPARE_S = 1.8
/** The deck stands this far above the hull's origin (model units; the ferry's own: scene/links/LinksLayer.tsx DRAFT is 1). */
const DECK = 1.9
const DRAFT = 1
/** A pier's deck is as dockMesh.ts lays it: the coast's height (at most MAX_GROUND) and RISE. */
const PIER_DECK = (quay: Quay): number => Math.min(quay.height, 0.5) + 0.35
/** Close enough to a spot to have reached it. */
const NEAR = 1
/** Where on the stage the riders step off from, across from the boat (world units off the pier's axis). */
const STAGE_AT = 1.4

const dist = (a: Spot, b: Spot): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/** The island whose land the point lies on or by (its reach and a little more), nearest first. */
export function isleAt(sea: Sea, at: Spot): Isle | undefined {
  let best: Isle | undefined
  let nearest = Number.POSITIVE_INFINITY
  for (const isle of [sea.home, ...sea.far]) {
    const reach = dist(isle.at, at)
    if (reach < nearest) {
      best = isle
      nearest = reach
    }
  }
  return best
}

/** Where on a pier's stage a rider waits, abreast of the boat's berth. */
export function stageOf(quay: Quay): Spot {
  const [ux, uz] = [Math.sin(quay.facing), Math.cos(quay.facing)]
  const side = STAGE_AT * quay.berthSide
  return [quay.end[0] - ux * BERTH_BACK + uz * side, quay.end[1] - uz * BERTH_BACK - ux * side]
}

/** The sea's surface (as scene/Ships.tsx draws it: test/voyage.test.ts keeps the two equal). */
export const SEA_Y = -0.2 * HEX_SCALE + 0.05

const ferry: FerryState = { x: 0, z: 0, heading: 0, moored: undefined, s: 0, speed: 0 }

/** A rider's place on the deck: along the hull, by their slot (0, 1, 2). */
function deckAt(slot: number, state: FerryState): { x: number; y: number; z: number } {
  const along = (slot - 1) * 1.3
  return {
    x: state.x + Math.sin(state.heading) * along,
    y: SEA_Y - DRAFT + DECK,
    z: state.z + Math.cos(state.heading) * along,
  }
}

const flat = (_x: number, _z: number): number => 0

export class Voyage {
  private isle: string | undefined
  private mode: Mode = "ashore"
  private leg: Crossing | undefined
  private route: LinkRoute | undefined
  private since = 0
  private cached = { key: "", path: [] as readonly Spot[] }
  private readonly slot: number

  constructor(who: string) {
    let h = 0
    for (let i = 0; i < who.length; i++) h = (h * 31 + who.charCodeAt(i)) >>> 0
    this.slot = h % 3
  }

  /** On a pier, a ferry or a bridge: not on an island's own ground. */
  get crossing(): boolean {
    return this.mode !== "ashore"
  }

  /**
   * How to go on this frame, or undefined when nothing here is the voyage's to say (no sea, or the
   * figure is on the home island with the home island to go about: the brain's own walking then).
   */
  aim(view: AdventurerView, at: Spot, now: number): Aim | undefined {
    const sea = seaNow()
    if (!sea?.net) return undefined
    this.isle ??= isleAt(sea, at)?.id ?? sea.home.id
    const dest = view.hall?.island ?? sea.home.id
    if (this.mode === "ashore") {
      if (this.isle === dest) {
        if (dest === sea.home.id) return undefined
        return this.walk(sea, `on:${dest}:${view.target[0]},${view.target[1]}`, at, [
          view.target[0],
          view.target[1],
        ])
      }
      return this.depart(sea, at, dest, now)
    }
    return this.cross(sea, at, now)
  }

  /** Sets off from the island the figure is on for `dest`: the first crossing of the planner's route. */
  private depart(sea: Sea, at: Spot, dest: string, now: number): Aim {
    const net = sea.net as NonNullable<Sea["net"]>
    const leg = travelBetween(net, this.isle as string, dest, now)?.find(
      (one): one is Crossing => one.kind !== "walk",
    )
    const route = leg && net.routes.find((one) => one.link === leg.link)
    if (!leg || !route) return this.hold(at)
    this.leg = leg
    this.route = route
    this.mode = leg.kind === "bridge" ? "toBridge" : "toPier"
    return this.cross(sea, at, now)
  }

  /** No way across: they stay where they stand. */
  private hold(at: Spot): Aim {
    return this.set(`hold:${this.isle}`, [at], flat)
  }

  private set(key: string, path: readonly Spot[], ground: Aim["ground"], extra: Partial<Aim> = {}): Aim {
    if (this.cached.key !== key) this.cached = { key, path }
    return { key, path: this.cached.path, ground, ...extra }
  }

  /** The quay of the island the crossing leaves (`from`) or reaches. */
  private quay(which: "from" | "to"): Quay {
    const route = this.route as LinkRoute
    const leg = this.leg as Crossing
    const here = route.link.a === leg.from ? 0 : 1
    return route.quays[which === "from" ? here : 1 - here] as Quay
  }

  private cross(sea: Sea, at: Spot, now: number): Aim {
    const leg = this.leg as Crossing
    const route = this.route as LinkRoute
    const key = `${leg.from}>${leg.to}`
    switch (this.mode) {
      case "toPier": {
        const land = this.quay("from").land
        if (dist(at, land) < NEAR) {
          this.mode = "board"
          return this.cross(sea, at, now)
        }
        return this.walk(sea, `${key}:to:${land}`, at, land)
      }
      case "board": {
        const quay = this.quay("from")
        const stage = stageOf(quay)
        const deck = PIER_DECK(quay)
        if (dist(at, stage) >= NEAR) return this.set(`${key}:pier`, [quay.end, stage], () => deck)
        const table = route.table
        const end = route.link.a === leg.from ? "a" : "b"
        if (
          table &&
          ferryAt(table, now, ferry).moored === end &&
          nextDeparture(table, end, now) - now > SPARE_S
        ) {
          this.mode = "ride"
          this.since = now
          return this.cross(sea, at, now)
        }
        return this.set(`${key}:wait`, [stage], () => deck, {
          face: quay.facing - (Math.PI / 2) * quay.berthSide,
        })
      }
      case "ride": {
        const table = route.table
        const there = route.link.a === leg.from ? "b" : "a"
        if (!table) return this.hold(at)
        const state = ferryAt(table, now, ferry)
        const deck = deckAt(this.slot, state)
        // Stepping aboard: from the stage across to the deck.
        const mine = this.quay("from")
        const u = Math.min(1, (now - this.since) / STEP_S)
        const from = stageOf(mine)
        const place =
          u < 1 ? { x: from[0] + (deck.x - from[0]) * u, z: from[1] + (deck.z - from[1]) * u } : deck
        if (state.moored === there && u >= 1) {
          this.mode = "land"
          this.since = now
          this.isle = leg.to
        }
        return this.set(`${key}:ride`, [[place.x, place.z]], flat, {
          ride: { x: place.x, y: deck.y, z: place.z, heading: state.heading },
        })
      }
      case "land": {
        const table = route.table
        const quay = this.quay("to")
        const stage = stageOf(quay)
        const state = table ? ferryAt(table, now, ferry) : undefined
        const u = Math.min(1, (now - this.since) / STEP_S)
        if (state && u < 1) {
          const deck = deckAt(this.slot, state)
          return this.set(`${key}:off`, [stage], flat, {
            ride: {
              x: deck.x + (stage[0] - deck.x) * u,
              y: deck.y + (PIER_DECK(quay) - deck.y) * u,
              z: deck.z + (stage[1] - deck.z) * u,
              heading: state.heading,
            },
          })
        }
        if (dist(at, quay.land) < NEAR) {
          this.mode = "ashore"
          this.leg = undefined
          this.route = undefined
          return this.hold(at)
        }
        return this.set(`${key}:ashore`, [quay.end, quay.land], (x, z) =>
          dist([x, z], quay.land) > 3 ? PIER_DECK(quay) : 0,
        )
      }
      case "toBridge": {
        const head = (leg as Extract<Crossing, { kind: "bridge" }>).path[0] as readonly [
          number,
          number,
          number,
        ]
        if (dist(at, [head[0], head[1]]) < NEAR) {
          this.mode = "deck"
          return this.cross(sea, at, now)
        }
        return this.walk(sea, `${key}:head`, at, [head[0], head[1]])
      }
      default: {
        const deck = (leg as Extract<Crossing, { kind: "bridge" }>).path
        const last = deck[deck.length - 1] as readonly [number, number, number]
        if (dist(at, [last[0], last[1]]) < NEAR) {
          this.mode = "ashore"
          this.isle = leg.to
          this.leg = undefined
          this.route = undefined
          return this.hold(at)
        }
        return this.set(
          `${key}:deck`,
          deck.map((p): Spot => [p[0], p[1]]),
          (x, z) => heightOn(deck, x, z),
        )
      }
    }
  }

  /** On foot on the island the figure stands on, from `at` to `to`: the roads, and its hall's gate and lane. */
  private walk(sea: Sea, key: string, at: Spot, to: Spot): Aim {
    const isle = isleOf(sea, this.isle as string) as Isle
    const ground = (x: number, z: number): number =>
      isle.world.relief?.heightAt(x - isle.at[0], z - isle.at[1]) ?? 0
    if (this.cached.key !== key) this.cached = { key, path: pathOn(sea, isle, at, to) }
    return { key, path: this.cached.path, ground }
  }
}

/** The height of the deck at the point of `path` nearest (x, z). */
function heightOn(path: readonly (readonly [number, number, number])[], x: number, z: number): number {
  let best = path[0] as readonly [number, number, number]
  for (const p of path) if (Math.hypot(p[0] - x, p[1] - z) < Math.hypot(best[0] - x, best[1] - z)) best = p
  return best[2]
}

/**
 * The way on foot from `from` to `to` on `isle`, in the archipelago's coordinates: the roads; a far
 * island's hall is left by its gate (from its lane) and entered by it (to the lane level with the
 * spot, then straight across), as the hall is laid out (world/hall/build.ts), never through a wall.
 */
export function pathOn(sea: Sea, isle: Isle, from: Spot, to: Spot): Spot[] {
  const a = fromSea(isle, from)
  const b = fromSea(isle, to)
  const hall = isle.world.hall
  const out: Spot[] = []
  let start = a
  let goal = b
  const tail: Spot[] = []
  if (hall) {
    const [inA, inB] = [covers(hall, a[0], a[1]), covers(hall, b[0], b[1])]
    if (inA && inB) return wayAcross(hall, a, b).map((p) => toSea(isle, p))
    if (inA) {
      out.push(...wayOut(hall, a))
      start = hall.door.step
    }
    if (inB) {
      tail.push(...wayIn(hall, b))
      goal = hall.door.step
    }
  }
  const roads = route(start, goal, isle.world.roads, isle === sea.home)
  return [...out, ...roads, ...tail].map((p) => toSea(isle, p))
}
