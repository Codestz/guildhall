import type { Spot } from "../layout.ts"
import type { VenueDoor } from "../venues.ts"

/**
 * The island's folk (NPC ecosystem, gen 2 islands): townsfolk who live in its houses and keep the
 * hours of the world clock, and the animals that share the ground. Pure data, no three, no React:
 * the plan (plan.ts) names who they are, the day (day.ts) says where each is at an hour, and the
 * scene's crowd (scene/life/Folk.tsx) walks them.
 */

export type Role = "villager" | "farmer" | "miner" | "fisher" | "trader" | "guard"
export const ROLES: readonly Role[] = ["villager", "farmer", "miner", "fisher", "trader", "guard"]

/** The parts of a day a folk spends somewhere: indoors at home, at work, in the square, in the inn. */
export type Slot = "home" | "work" | "plaza" | "inn"

/** A thing to do where one stands: a spot, the way to face, what to play and for how long (seconds). */
export interface Stop {
  at: Spot
  face: number
  clip: string
  /** Seconds there (spread a little by whoever is doing it); 0 passes straight on. */
  wait: number
  /** A door to go in by: hidden for `wait`, the place lit while they are in (scene/life/occupancy.ts). */
  door?: VenueDoor
  venue?: string
  /** Walking on this stop's level above the ground (a wall's walk). */
  up?: number
  /** A full house keeps them waiting at the step: it holds this many. */
  cap?: number
}

/** A way up to a wall's walk: the foot of the stair, its door in the wall, and the top. */
export interface Lift {
  step: Spot
  sill: Spot
  top: Spot
  up: number
}

export interface Folk {
  /** "folk:<n>": stable for an island and a budget. */
  id: string
  role: Role
  /** A crowd model (world/cast.ts MODELS) and a homespun colour for its tinted part. */
  model: string
  tint: string
  /** The district they work in (their house's), and the house, if they have one. */
  district: string
  home: string | undefined
  /** What each part of the day is: loops of stops, walked in turn, back and forth. */
  stops: Readonly<Record<Slot, readonly Stop[]>>
  /** Hours added to every change of the day: no two leave their door together. */
  jitter: number
  /** Whose shift it is: the day's, or the night watch's (guards). */
  night: boolean
  /** Units a second. */
  speed: number
  /** Pushes a barrow along the road (traders). */
  barrow: boolean
  /** The way up to their stops, when those are on a wall. */
  lift?: Lift
}

export type Species = "dog" | "cat" | "chick" | "cow" | "pig" | "bunny"
export const SPECIES: readonly Species[] = ["dog", "cat", "chick", "cow", "pig", "bunny"]

/** An animal that wanders a patch of ground: where, how far, its own tempo. */
export interface Critter {
  id: string
  species: Species
  at: Spot
  radius: number
  /** Radians a second of its two wander cycles, and where they start. */
  tempo: readonly [number, number]
  phase: readonly [number, number]
  /** Roosts (sleeps out of sight) through the night. */
  roosts: boolean
}

export interface Population {
  folk: readonly Folk[]
  critters: readonly Critter[]
}
