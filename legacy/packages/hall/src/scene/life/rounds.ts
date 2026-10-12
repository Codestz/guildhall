import type { Weather } from "../../guild/environment.ts"
import {
  ahead,
  type Behaviour,
  type Held,
  type Place,
  type Step,
  spotsOf,
  type Tool,
} from "../../world/behaviours.ts"
import type { Model } from "../../world/cast.ts"
import { island, type LandPlacement } from "../../world/lands.ts"
import type { Post, Spot } from "../../world/layout.ts"

/**
 * The villagers' daily rounds (Life): a door to come out of at dawn and go back into at dusk, and
 * a loop of stops along the village streets, each with how long they stay and what they do there.
 * Points are picked by eye on open ground and road (world units).
 */
export interface Stop {
  x: number
  z: number
  /** Seconds to stay. */
  wait?: number
  clip?: string
  /** Heading while standing (rotation-y). */
  facing?: number
}

export interface Round {
  id: string
  /** Character model key (world/cast.ts MODELS). */
  model: string
  door: Stop
  stops: readonly Stop[]
}

/** Smaller and slower than adventurers (who walk at 3.4): an amble, with the stride slowed to match. */
export const VILLAGER = { scale: 0.82, speed: 1.6, stride: 0.6 } as const

const EAST = Math.PI / 2

export const ROUNDS: readonly Round[] = [
  {
    // The farmer: tends the east fields, a strip at a time.
    id: "farmer",
    model: "barbarian",
    door: { x: 36.63, z: -8.85 },
    stops: [
      { x: 43.3, z: -6 },
      { x: 48, z: -6.4, wait: 14, clip: "Digging", facing: EAST },
      { x: 47.4, z: -12, wait: 12, clip: "Digging", facing: EAST },
      { x: 47.4, z: -17.5, wait: 14, clip: "Digging", facing: EAST },
      { x: 43.3, z: -15 },
      { x: 38.5, z: -11, wait: 4, clip: "Idle_B" },
    ],
  },
  {
    // West of the avenue: water from the well, a look round the blue market, home. Round the well,
    // never through it.
    id: "well",
    model: "rogue",
    door: { x: -15.33, z: 28.85 },
    stops: [
      { x: -11.5, z: 26.5 },
      { x: -9.2, z: 23.9 },
      { x: -2.8, z: 23.4 },
      { x: -3.9, z: 26.6, wait: 5, clip: "Interact", facing: -Math.PI / 2 },
      { x: -2.6, z: 31.6 },
      { x: -4.4, z: 31.6, wait: 7, clip: "Idle_A", facing: -0.77 },
      { x: -2.6, z: 31.6 },
      { x: -2.8, z: 23.4 },
      { x: -9.2, z: 23.9 },
      { x: -14.6, z: 28.4, wait: 6, clip: "Idle_B" },
    ],
  },
  {
    // East of the avenue: down the road to the red market and back.
    id: "market",
    model: "ranger",
    door: { x: 26.68, z: 19.2 },
    stops: [
      { x: 17.3, z: 20 },
      { x: 8.66, z: 25 },
      { x: 2.4, z: 28.2, wait: 8, clip: "Interact", facing: 0.91 },
      { x: 8.66, z: 25 },
      { x: 17.3, z: 20, wait: 3, clip: "Idle_B" },
      { x: 21.6, z: 19.8 },
      { x: 25.98, z: 19.6, wait: 5, clip: "Idle_A" },
      { x: 21.6, z: 19.8 },
    ],
  },
]

// ---- The townsfolk: everyone who lives on the island, and their day ----------------------------

/**
 * The townsfolk (roadmap "More life on the map"): farmers, a fisher, merchants, gate guards,
 * children, a graveyard keeper and villagers, each with a small loop of work run by the activity
 * engine (world/behaviours.ts `Routine`, ADR 0009): the same steps, spots and carries the agents'
 * work uses. They read as townsfolk, never agents (scene/life/Villagers.tsx): smaller, bare-headed in
 * muted homespun, no ring, no name, no sigil.
 *
 * Every NPC has a door (indoors at night and, for most, in the rain), a `way` from that door to their
 * post (walked straight, stop by stop), and a festival spot on the square. Spots are picked by eye on
 * open ground; test/townsfolk.test.ts holds them clear of props, buildings, wilds, lights, crops,
 * the graveyard's fence and graves, each other, and the agents' work spots.
 */

/** When they are out: by day (most), by night (the watchman), or always (the gate guards). */
export type Hours = "day" | "night" | "always"
/** In the rain: home, under their stall's eaves (their post), or on with the job. */
export type RainPlan = "home" | "shelter" | "stay"
/** How they move: an amble, a guard's measured pace, a child's run. */
export interface Gait {
  speed: number
  clip: "Walking_A" | "Running_A"
  /** Clip time scale, matched to the speed. */
  rate: number
}

export interface Townsperson {
  id: string
  /** Character model key (world/cast.ts MODELS). */
  model: Model
  /** Homespun colour the body's palette is pulled towards. */
  tint: string
  scale: number
  gait: Gait
  door: Spot
  /** From the door to the post, in order (both ends excluded): walked straight. */
  way: readonly Spot[]
  post: Post
  work: Behaviour
  hours: Hours
  rain: RainPlan
  /**
   * At a festival: from the post to their place on the square, straight stop by stop (empty: they
   * cheer where they work).
   */
  rally: readonly Spot[]
  /** Carries a lantern after dark. */
  lantern?: true
}

const AMBLE: Gait = { speed: VILLAGER.speed, clip: "Walking_A", rate: VILLAGER.stride }
const PACE: Gait = { speed: 1.3, clip: "Walking_A", rate: 0.5 }
const RUN: Gait = { speed: 3.4, clip: "Running_A", rate: 0.75 }
const ADULT = VILLAGER.scale
const CHILD = 0.6

/** Stop, look round, shift weight: slipped into a loop now and then (the routine's pauses). */
const PAUSES: readonly (readonly Step[])[] = [
  [{ clip: "Idle_B", s: [2, 3], soft: true }],
  [{ clip: "Idle_A", s: [1.5, 2.5], soft: true }],
]

/**
 * The routine's "tool call" when their day calls them away (dusk, rain, a festival): it steers a
 * nearby loop straight back to the post (world/behaviours.ts steers), cutting a long wait short.
 */
export const CALLED_AWAY = "called-away"

/**
 * A loop of work. Most loops stay near the post: there, being called away cuts any standing step
 * short (they are soft) and walks back to the post. A loop that goes `afield` (a market trip down
 * the avenue) is finished first instead: the catch is delivered, then they go.
 */
function job(
  spots: Readonly<Record<string, Spot>>,
  marks: readonly string[],
  loop: readonly Step[],
  options: { tool?: Tool; pauses?: readonly (readonly Step[])[]; afield?: true } = {},
): Behaviour {
  const near = !options.afield
  return {
    spots: () => spots,
    marks: new Set(marks),
    loop: near
      ? loop.map((step) => ("clip" in step && !step.take && !step.drop ? { ...step, soft: true } : step))
      : loop,
    pauses: options.pauses ?? PAUSES,
    ...(near ? { steer: [{ tools: new Set([CALLED_AWAY]), steps: [{ walk: "post" }] }] } : {}),
    ...(options.tool ? { tool: options.tool } : {}),
  }
}

const pickUp = (item: Held, face: string): Step => ({ clip: "PickUp", s: 1.3, face, take: item })
const putDown = (face: string): Step => ({
  clip: "PickUp",
  s: 1.3,
  face,
  drop: true,
  beat: { kind: "dust", at: face, first: 0.7 },
})

/** A villager's round as a loop (stop 0 is the post): the old rounds, run by the routine engine. */
function roundWork(
  round: Round,
  options: { tool?: Tool; afield?: true } = {},
): { post: Post; work: Behaviour } {
  const first = round.stops[0] ?? round.door
  const post: Post = [first.x, first.z, first.facing ?? 0]
  const spots: Record<string, Spot> = {}
  const marks: string[] = []
  const loop: Step[] = []
  round.stops.forEach((stop, i) => {
    if (i > 0) spots[`s${i}`] = [stop.x, stop.z]
    if (stop.facing !== undefined) {
      spots[`f${i}`] = ahead([stop.x, stop.z, stop.facing], 2)
      marks.push(`f${i}`)
    }
    if (i > 0) loop.push({ walk: `s${i}` })
    if (stop.wait)
      loop.push({
        clip: stop.clip ?? "Idle_A",
        s: [stop.wait * 0.8, stop.wait * 1.2],
        ...(stop.facing !== undefined ? { face: `f${i}` } : {}),
      })
  })
  loop.push({ walk: "post" })
  return { post, work: job(spots, marks, loop, options) }
}

const [FARMER, WELL, MARKET] = ROUNDS as readonly [Round, Round, Round]
const farmerRound = roundWork(FARMER, { tool: "hoe" })
/** Round the well: going straight back from its far side would cut through it, so the round is finished. */
const wellRound = roundWork(WELL, { afield: true })
const marketRound = roundWork(MARKET)

/** The lane west of the keep, from the tavern down to the well. */
const LANE = ["lane0", "lane1", "lane2", "lane3", "lane4", "lane5", "lane6", "lane7"] as const

/** The square, where a festival gathers them (guild/events.ts; the show stands at (0, 28)). */
export const SQUARE: Spot = [0, 28]
/** The red market's crate and barrel: where the catch and the harvest are left. */
const STALL_CRATE: Spot = [5.3, 37.2]

/** How many of them each quality tier shows (Low, Medium, High, Ultra): each is a skinned draw. */
export const TOWNSFOLK_PER_TIER: Readonly<Record<0 | 1 | 2 | 3, number>> = { 0: 4, 1: 8, 2: 14, 3: 14 }

/**
 * Who lives here, most visible first: the quality tier shows the first 4 (Low), 8 (Medium) or all
 * (High, Ultra) of them (scene/life/Villagers.tsx).
 */
export const TOWNSFOLK: readonly Townsperson[] = [
  {
    // West of the gate: stands watch, walks a short beat along the wall and back.
    id: "guard-west",
    model: "knight",
    tint: "#7d8590",
    scale: ADULT,
    gait: PACE,
    door: [-1.2, 14.4],
    way: [],
    post: [-2.3, 17.4, 0],
    work: job(
      { out: [-2.3, 21], beat: [-5.6, 20.4], road: [-9, 23.5] },
      ["out", "road"],
      [
        { clip: "Idle_A", s: [8, 14], face: "out" },
        { walk: "beat" },
        { clip: "Idle_B", s: [2.5, 4], face: "road" },
        { walk: "post" },
      ],
      { tool: "spear" },
    ),
    hours: "always",
    rain: "stay",
    rally: [],
    lantern: true,
  },
  {
    // The blue market: waves the passers-by in, fetches stock from the back and stacks it.
    id: "merchant-blue",
    model: "mage",
    tint: "#9c7b55",
    scale: ADULT,
    gait: AMBLE,
    door: [-10.54, 18.22],
    way: [
      [-6, 20.6],
      [-2.6, 24.2],
      [-2.2, 31.6],
    ],
    post: [-4, 34, 2.1],
    work: job(
      { street: [0.6, 32.2], stock: [-1.25, 37.7], front: [-2.8, 35.85], stall: [-7.7, 35] },
      ["street", "stall"],
      [
        { clip: "Waving", s: [2.4, 3.6], face: "street" },
        { clip: "Idle_A", s: [3, 6], face: "street" },
        { walk: "stock" },
        pickUp("crate", "stall"),
        { walk: "front" },
        putDown("stall"),
        { walk: "post" },
        { clip: "Interact", s: 1.6, face: "stall" },
      ],
    ),
    hours: "day",
    rain: "shelter",
    rally: [[-1.8, 33]],
  },
  {
    id: FARMER.id,
    model: "barbarian",
    tint: "#8d8577",
    scale: ADULT,
    gait: AMBLE,
    door: [FARMER.door.x, FARMER.door.z],
    way: [],
    ...farmerRound,
    hours: "day",
    rain: "home",
    rally: [],
  },
  {
    id: WELL.id,
    model: "rogue",
    tint: "#7f8a72",
    scale: ADULT,
    gait: AMBLE,
    door: [WELL.door.x, WELL.door.z],
    way: [],
    ...wellRound,
    hours: "day",
    rain: "home",
    rally: [
      [-9.2, 23.9],
      [-2.8, 23.4],
      [-2.6, 31.6],
      [-2.6, 35],
    ],
  },
  // Two children chase round a ring west of the well, one on the outside, one on the inside.
  child(
    "child-a",
    "ranger",
    "#b49a6a",
    [
      [-11.8, 22.8],
      [-14.2, 25.6],
      [-12.4, 29.8],
      [-9.6, 28.8],
    ],
    [
      [-9.2, 23.9],
      [-2.8, 23.4],
      [-0.9, 35.4],
    ],
  ),
  child(
    "child-b",
    "rogue",
    "#9aa07a",
    [
      [-12.2, 28.3],
      [-10.8, 27.8],
      [-11.9, 24.8],
      [-13.1, 26.2],
    ],
    [
      [-9.2, 23.9],
      [-2.8, 23.4],
      [0.9, 35.4],
    ],
  ),
  {
    // The quay's end: casts, waits, reels in; the first catch into the crate on the quay, the
    // second carried up the avenue to the red market.
    id: "fisher",
    model: "ranger",
    tint: "#6f7f86",
    scale: ADULT,
    gait: AMBLE,
    door: [14.2, 29.01],
    way: [
      // Off the step, clear of the house's corner, then down the lane.
      [12.9, 29.6],
      [13.4, 31],
      [13, 37.4],
      [9.6, 40.6],
      [2.4, 40.4],
      [2, 53],
      [1.6, 59],
      [0.1, 64.5],
      [0.1, 72],
    ],
    post: [1.3, 78.6, 0],
    work: job(
      {
        work: [1.3, 82],
        crate: [-3, 77.6],
        bin: [-4.5, 77.5],
        deck: [0.1, 72],
        shore: [0.1, 64.5],
        market: [4, 40.4],
        stall: STALL_CRATE,
      },
      ["work", "bin", "stall"],
      [
        ...catchFish(),
        { walk: "crate" },
        putDown("bin"),
        { walk: "post" },
        ...catchFish(),
        { walk: "deck" },
        { walk: "shore" },
        { walk: "market" },
        putDown("stall"),
        { walk: "shore" },
        { walk: "deck" },
        { walk: "post" },
      ],
      {
        tool: "rod",
        pauses: [[{ clip: "Fishing_Idle", s: [2.3, 4.6], face: "work", soft: true }]],
        afield: true,
      },
    ),
    hours: "day",
    rain: "home",
    rally: [],
  },
  {
    // The graveyard's keeper, who lodges with the family by the well: sweeps the path through the
    // arch and tends the candles on the graves.
    id: "keeper",
    model: "mage",
    tint: "#5e5a63",
    scale: ADULT,
    gait: PACE,
    door: [WELL.door.x, WELL.door.z],
    way: [
      [-13.4, 30.4],
      [-15.2, 31.4],
      [-15.9, 32.4],
      [-16.4, 34.6],
      [-15.6, 37.6],
      [-12, 40.6],
      [-11, 41.2],
      [-5.5, 41.2],
      [-4.8, 41],
      [-2.6, 44.4],
      [-2.4, 51],
      [-7.4, 51],
    ],
    post: [-10.4, 51, -Math.PI / 2],
    work: job(
      {
        path: [-14, 51],
        candles: [-8.6, 50],
        candle: [-9.6, 49.4],
        graves: [-12.8, 51.4],
        candle2: [-12.4, 52.8],
      },
      ["path", "candle", "candle2"],
      [
        { clip: "Working_A", s: [5, 8], face: "path", beat: { kind: "dust", at: "self", every: 1.5 } },
        { walk: "candles" },
        { clip: "Interact", s: [2, 3], face: "candle" },
        { walk: "post" },
        { clip: "Working_A", s: [4, 6], face: "path", beat: { kind: "dust", at: "self", every: 1.5 } },
        { walk: "graves" },
        { clip: "Interact", s: [2, 3], face: "candle2" },
        { clip: "Idle_B", s: [2, 3], face: "candle2" },
        { walk: "post" },
      ],
      { tool: "broom" },
    ),
    hours: "day",
    rain: "home",
    rally: [],
  },
  {
    // The red market: waves, fetches crates from behind the stall.
    id: "merchant-red",
    model: "rogue",
    tint: "#a0806a",
    scale: ADULT,
    gait: AMBLE,
    door: [14.2, 29.01],
    way: [
      [12.6, 26.2],
      [2.2, 27.6],
      [2.4, 31.4],
    ],
    post: [3.62, 33, -1.9],
    work: job(
      {
        street: [-0.6, 31.6],
        stock: [2.1, 36.5],
        crate: STALL_CRATE,
        front: [2.9, 34.45],
        stall: [7.7, 32.5],
      },
      ["street", "crate", "stall"],
      [
        { clip: "Waving", s: [2.4, 3.6], face: "street" },
        { clip: "Idle_A", s: [4, 7], face: "street" },
        { walk: "stock" },
        pickUp("crate", "crate"),
        { walk: "front" },
        putDown("stall"),
        { walk: "post" },
        { clip: "Interact", s: 1.6, face: "stall" },
      ],
    ),
    hours: "day",
    rain: "shelter",
    rally: [[1.8, 33]],
  },
  {
    // The lettuce plot by the north road: waters two rows from a bucket, then takes a basket of
    // the harvest to the red market.
    id: "farmer-water",
    model: "barbarian",
    tint: "#8f8a62",
    scale: ADULT,
    gait: AMBLE,
    door: [FARMER.door.x, FARMER.door.z],
    way: [
      [42.6, -4],
      [45, -1],
    ],
    post: [46.9, 1.4, Math.PI / 2],
    work: job(
      { bed: [49, 1.4], row: [46.8, -1.6], bed2: [49, -1.6], market: [3, 37.6], stall: STALL_CRATE },
      ["bed", "bed2", "stall"],
      [
        { clip: "Use_Item", s: [3, 4.5], face: "bed", beat: { kind: "splash", at: "bed", every: 1.1 } },
        { walk: "row" },
        { clip: "Use_Item", s: [3, 4.5], face: "bed2", beat: { kind: "splash", at: "bed2", every: 1.1 } },
        { clip: "Idle_B", s: [1.5, 2.5], face: "bed2" },
        pickUp("produce", "bed2"),
        { walk: "market" },
        putDown("stall"),
        { walk: "post" },
      ],
      { tool: "bucket", afield: true },
    ),
    hours: "day",
    rain: "home",
    rally: [],
  },
  {
    id: "guard-east",
    model: "knight",
    tint: "#8a7f6a",
    scale: ADULT,
    gait: PACE,
    door: [1.2, 14.4],
    way: [],
    post: [2.3, 17.4, 0],
    work: job(
      { out: [2.3, 21], beat: [5.6, 20.4], road: [9, 23.5] },
      ["out", "road"],
      [
        { clip: "Idle_A", s: [9, 15], face: "out" },
        { walk: "beat" },
        { clip: "Idle_B", s: [2.5, 4], face: "road" },
        { walk: "post" },
      ],
      { tool: "spear" },
    ),
    hours: "always",
    rain: "stay",
    rally: [],
    lantern: true,
  },
  {
    id: MARKET.id,
    model: "ranger",
    tint: "#8a7468",
    scale: ADULT,
    gait: AMBLE,
    door: [MARKET.door.x, MARKET.door.z],
    way: [],
    ...marketRound,
    hours: "day",
    rain: "home",
    rally: [
      [8.66, 25],
      [2.4, 28.2],
      [0, 37.6],
    ],
  },
  {
    // From home to the tavern for a chat, down the lane west of the keep to the well, and back.
    id: "tavern",
    model: "rogue-hooded",
    tint: "#7c6f5f",
    scale: ADULT,
    gait: AMBLE,
    door: [-20.21, -8.72],
    way: [[-19.6, -11.2]],
    post: [-22.2, -13.2, -Math.PI / 2],
    work: job(
      {
        tavern: [-24, -14],
        homeDoor: [-23.5, -8.5],
        lane0: [-19.6, -11.2],
        lane1: [-19.6, -5],
        lane2: [-19.6, 2],
        lane3: [-19.6, 9],
        lane4: [-19.4, 15.6],
        lane5: [-17.6, 19.6],
        lane6: [-14, 22.2],
        lane7: [-10.6, 24.6],
        well: [-6.2, 23.6],
        bucket: [-6.2, 26.5],
      },
      ["tavern", "homeDoor", "bucket"],
      [
        { clip: "Interact", s: [2, 3], face: "tavern" },
        { clip: "Idle_A", s: [5, 9], face: "tavern" },
        ...LANE.map((spot): Step => ({ walk: spot })),
        { walk: "well" },
        { clip: "Interact", s: [3, 4.5], face: "bucket" },
        { clip: "Idle_B", s: [2, 3], face: "bucket" },
        ...[...LANE]
          .reverse()
          .slice(0, -1)
          .map((spot): Step => ({ walk: spot })),
        { clip: "Idle_B", s: [3, 5], face: "homeDoor" },
        { walk: "lane0" },
        { walk: "post" },
      ],
      { afield: true },
    ),
    hours: "day",
    rain: "home",
    rally: [],
  },
  {
    // The night watchman: out at dusk with a lantern, walking the avenue from the gate to the square.
    id: "watchman",
    model: "knight",
    tint: "#6a6458",
    scale: ADULT,
    gait: PACE,
    door: [10.98, 19.27],
    way: [],
    post: [1.8, 23.6, 0],
    work: job(
      { square: [-0.4, 35.2], quay: [1.9, 46.5], look: [1.8, 27], east: [6, 46.5], west: [-6, 35.5] },
      ["look", "east", "west"],
      [
        { clip: "Idle_B", s: [3, 5], face: "look" },
        { walk: "square" },
        { clip: "Idle_A", s: [3, 5], face: "west" },
        { walk: "quay" },
        { clip: "Idle_B", s: [3, 5], face: "east" },
        { walk: "square" },
        { walk: "post" },
      ],
      { tool: "spear" },
    ),
    hours: "night",
    rain: "stay",
    rally: [[-2.8, 31.4]],
    lantern: true,
  },
]

/** Fishing at the post until a fish is landed (the river site's casts, ADR 0009). */
function catchFish(): Step[] {
  return [
    { clip: "Fishing_Cast", s: 1.93, face: "work", beat: { kind: "splash", first: 1.35 } },
    { clip: "Fishing_Idle", s: [3, 6.5], face: "work", soft: true },
    { clip: "Fishing_Reeling", s: [1.6, 3.2], face: "work", beat: { kind: "splash", every: 0.8 } },
    { clip: "Fishing_Catch", s: 3.23, face: "work", take: "fish", beat: { kind: "splash", first: 0.9 } },
  ]
}

/**
 * A child of the house by the well: runs a ring round it (the other child runs the same way a little
 * behind, so they chase), waves at the well, jumps for joy.
 */
function child(
  id: string,
  model: Model,
  tint: string,
  ring: readonly Spot[],
  rally: readonly Spot[],
): Townsperson {
  const [a = SQUARE, b = SQUARE, c = SQUARE, d = SQUARE] = ring
  return {
    id,
    model,
    tint,
    scale: CHILD,
    gait: RUN,
    door: [WELL.door.x, WELL.door.z],
    way: [],
    post: [a[0], a[1], 0],
    work: job(
      { b, c, d, well: [-6.2, 26.5] },
      ["well"],
      [
        { walk: "b" },
        { clip: "Waving", s: [1.4, 2.2], face: "well" },
        { walk: "c" },
        { clip: "Cheering", s: [1.2, 2], face: "well" },
        { walk: "d" },
        { walk: "post" },
        { clip: "Idle_B", s: [0.8, 1.6], face: "well" },
      ],
      { pauses: [[{ clip: "Waving", s: [1.2, 2], face: "well" }]] },
    ),
    hours: "day",
    rain: "home",
    rally,
  }
}

/** The place an NPC works: their post and their spots, for the routine (world/behaviours.ts). */
export function placeOfNpc(npc: Townsperson): Place {
  return {
    key: `npc:${npc.id}`,
    behaviour: npc.work,
    berth: 0,
    post: npc.post,
    spots: spotsOf(npc.work, npc.post, 0),
  }
}

// ---- Their day: out, home, under the eaves, at the festival ------------------------------------

/** What an NPC is about: their work, going home, sheltering, or cheering at a festival. */
export type Errand = "work" | "home" | "shelter" | "festival"

/** Night falls below this daylight and lifts above the second: a gap, so dawn doesn't flicker. */
export const DUSK = 0.3
export const DAWN = 0.42

/** Is it night, given whether it was (hysteresis between DUSK and DAWN)? */
export function nightOf(daylight: number, was: boolean): boolean {
  return was ? daylight <= DAWN : daylight < DUSK
}

/** Rain or a storm sends people in; snow and clouds don't. */
export function raining(weather: Weather): boolean {
  return weather === "rain" || weather === "storm"
}

/**
 * What an NPC does now. A festival brings everyone out to the square, day or night, rain or not;
 * otherwise their hours send them home, and rain sends them home or under the eaves.
 */
export function errandOf(
  npc: Townsperson,
  now: { night: boolean; rain: boolean; festival: boolean },
): Errand {
  if (now.festival) return "festival"
  const off = npc.hours === "day" ? now.night : npc.hours === "night" ? !now.night : false
  if (off) return "home"
  if (now.rain && npc.rain === "home") return "home"
  if (now.rain && npc.rain === "shelter") return "shelter"
  return "work"
}

const postSpot = (npc: Townsperson): Spot => [npc.post[0], npc.post[1]]

// ---- Doors: where a house's door really is ---------------------------------------------------

/**
 * A house's door in the piece's own frame (the front is +z), in world units at the scale the
 * island places it (HEX_SCALE), measured from lands.glb: home A's door is in the middle of its
 * front at ground level; home B's is right of centre (+x), at the top of a flight of steps.
 *   x      across the front          sill   the doorway itself: in from the front face
 *   y      the sill's height         step   where you stand outside: a pace off the front, or the
 *                                           foot of the steps
 */
export const DOOR_OF = {
  A: { x: 0, sill: 1.65, y: 0, step: 2.3 },
  B: { x: 0.7, sill: 1.8, y: 0.79, step: 3.2 },
} as const

/** A house's door on the island: stand at `step`, go in through `sill` (at height `y`) facing `inward`. */
export interface Doorway {
  step: Spot
  sill: Spot
  y: number
  /** Heading (rotation-y) of someone facing the door, about to go in. */
  inward: number
  house: LandPlacement
}

const HOUSE = /^building_home_([AB])_/
const round2 = (value: number): number => Math.round(value * 100) / 100

/** Every house door on the island (world/lands.ts decor), from each house's placement and turn. */
export const DOORWAYS: readonly Doorway[] = island().decor.flatMap((house): Doorway[] => {
  const type = HOUSE.exec(house.piece)?.[1] as keyof typeof DOOR_OF | undefined
  if (!type) return []
  const door = DOOR_OF[type]
  const rot = house.rot ?? 0
  const scale = house.scale ?? 1
  // The piece's own (x, z) to the world: turned by rot about y, like the renderer.
  const at = (x: number, z: number): Spot => [
    round2(house.x + (x * Math.cos(rot) + z * Math.sin(rot)) * scale),
    round2(house.z + (-x * Math.sin(rot) + z * Math.cos(rot)) * scale),
  ]
  return [
    {
      step: at(door.x, door.step),
      sill: at(door.x, door.sill),
      y: door.y * scale,
      inward: rot + Math.PI,
      house,
    },
  ]
})

/** The house door whose step `door` is (within a hand's breadth), if it is one. */
export function doorwayOf(door: Spot): Doorway | undefined {
  return DOORWAYS.find((d) => Math.hypot(d.step[0] - door[0], d.step[1] - door[1]) < 0.15)
}

/**
 * A townsperson's way in and out. Most live in a house (`doorwayOf`); the gate guards' "door" is
 * the keep's gate, which they never go in by (always on watch): a plain spot, facing the gate.
 */
function doorwayFor(npc: Townsperson): Doorway {
  const house = doorwayOf(npc.door)
  if (house) return house
  const [x, z] = npc.door
  return {
    step: npc.door,
    sill: npc.door,
    y: 0,
    inward: Math.atan2(x - npc.post[0], z - npc.post[1]),
    house: { piece: "building_home_A_blue", x, z },
  }
}

/** At the door they stop and face it this long before it opens and they step in. */
export const DOOR_PAUSE_S = 0.6
/** Housemates come out one after another, this far apart, not all through the doorway at once. */
export const DOOR_STAGGER_S = 1.4

/** How long after dawn (or the rain) this one comes out: their place among those sharing the door. */
export function staggerOf(npc: Townsperson): number {
  const housemates = TOWNSFOLK.filter((n) => n.door[0] === npc.door[0] && n.door[1] === npc.door[1])
  return Math.max(0, housemates.indexOf(npc)) * DOOR_STAGGER_S
}

/**
 * Where an NPC is in their day:
 *   indoors   at home, unseen                     out     walking from the door to the post
 *   work      running their loop (the routine)    post    standing at the post (sheltering, cheering)
 *   in        walking home from the post           rally   walking from the post to the square
 *   cheer     cheering on the square               back    walking from the square to the post
 *   enter     at their door: facing it, then stepping in through it (dissolving as they go)
 *   exit      stepping out of their doorway (dissolving in), down to the step
 */
export type Phase = "indoors" | "out" | "work" | "post" | "in" | "rally" | "cheer" | "back" | "enter" | "exit"

/**
 * One NPC's day, as a state machine (pure: no three.js, no allocation per update). Errands change
 * only at the post or the door: a worker finishes the loop back to their post (the catch delivered,
 * the crate put down) before going home, under the eaves or to the festival, and every walk outside
 * the loop is a fixed, tested polyline: the way home, the way out, the rally to the square.
 */
export class Day {
  phase: Phase
  /** The polyline to walk now (outside the loop); bumps `trip` when it changes. */
  path: readonly Spot[] = []
  trip = 0
  /** Their house's door: where they go in and come out. */
  readonly doorway: Doorway
  /** Bumps each time their door opens (going in, coming out): the scene plays the door's sound. */
  opened = 0
  /** At the door, going in: seconds still to wait facing it before it opens. */
  private pause = 0
  /** Indoors, called out: seconds waited so far for their housemates ahead of them. */
  private waited = 0
  private readonly stagger: number
  private readonly out: readonly Spot[]
  private readonly home: readonly Spot[]
  private readonly back: readonly Spot[]

  constructor(
    readonly npc: Townsperson,
    errand: Errand,
  ) {
    const post = postSpot(npc)
    this.doorway = doorwayFor(npc)
    this.stagger = staggerOf(npc)
    this.out = [...npc.way, post]
    this.home = [...[...npc.way].reverse(), npc.door]
    this.back = [...[...npc.rally].reverse().slice(1), post]
    // On load they are already about their day: at home, or at their post.
    this.phase = errand === "home" ? "indoors" : "post"
    if (errand !== "home") this.atPost(errand)
  }

  /** Where they are at the start (inside the doorway, or the post). */
  get start(): Spot {
    return this.phase === "indoors" ? this.doorway.sill : postSpot(this.npc)
  }

  /** Should they be seen? Not indoors, nor once the door is open and they are stepping in. */
  get shown(): boolean {
    return !(this.phase === "indoors" || (this.phase === "enter" && this.pause <= 0))
  }

  /**
   * `arrived`: the current path is walked (or, in the loop, the routine's aim is reached).
   * `free`: the routine is back at the post with empty hands, so the loop may be left.
   * `dt`: seconds since the last update (the pause at the door).
   */
  update(errand: Errand, arrived: boolean, free: boolean, dt = 0): void {
    switch (this.phase) {
      case "indoors":
        // Out of the door: it opens, and they step down from the doorway to the step.
        if (errand === "home") {
          this.waited = 0
          return
        }
        this.waited += dt
        if (this.waited < this.stagger) return
        this.waited = 0
        this.opened++
        this.go("exit", [this.doorway.step])
        return
      case "exit":
        if (arrived) this.go("out", this.out)
        return
      case "enter":
        if (this.pause > 0) {
          // Called back out before the door opened (dawn came, the rain stopped): back to work.
          if (errand !== "home") {
            this.pause = 0
            this.go("out", this.out)
            return
          }
          this.pause -= dt
          if (this.pause > 0) return
          this.opened++
          this.go("enter", [this.doorway.sill])
          return
        }
        if (arrived) this.phase = "indoors"
        return
      case "work":
        if (errand !== "work" && free) this.atPost(errand)
        return
      case "post":
        if (errand !== "shelter" && !(errand === "festival" && this.npc.rally.length === 0))
          this.atPost(errand)
        return
      case "cheer":
        if (errand !== "festival") this.go("back", this.back)
        return
      default:
        if (!arrived) return
        if (this.phase === "in") {
          // At the door: stop, face it, and wait for it to open (no path: they stand).
          this.pause = DOOR_PAUSE_S
          this.go("enter", [])
        } else if (this.phase === "rally") this.phase = "cheer"
        else this.atPost(errand)
    }
  }

  private atPost(errand: Errand): void {
    if (errand === "work") this.phase = "work"
    else if (errand === "home") this.go("in", this.home)
    else if (errand === "festival" && this.npc.rally.length > 0) this.go("rally", this.npc.rally)
    else this.phase = "post"
  }

  private go(phase: Phase, path: readonly Spot[]): void {
    this.phase = phase
    this.path = path
    this.trip++
  }
}

/**
 * The quay's deck (lands.ts: floor_wood_large planks off the avenue's end, their top 0.4 below the
 * turf): a stem out from the beach and a cross-piece at its end. People there stand on the planks.
 */
export const QUAY_DECK = -0.4
export function onQuay(x: number, z: number): boolean {
  return (Math.abs(x) <= 2 && z >= 63.5 && z <= 80) || (Math.abs(x) <= 6 && z >= 76 && z <= 80)
}
