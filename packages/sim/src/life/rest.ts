import { hash } from "@guildhall/core"
import type { LifeSpot } from "@guildhall/world"

/**
 * A hero's life once its work is over (decisions.md "User review notes (10-14 evening)": the world never
 * freezes): what the planner (itineraries.ts) does with a hero whose session has finished or gone quiet,
 * and with the hall's resident guild (a repo's top contributors at home on its island, no session at all).
 *
 *   rest       the hero sits a while at its seat in the Guildhall's gathering, then goes about the
 *              island's day: to a haunt (the tavern's yard, a square) to chat, back to its seat to sit,
 *              in the evening to the tavern; a resident by day works at its own places too
 *   sleep      at night it walks to the Guildhall's door or the tavern's, stops on its threshold (clear of
 *              the wall: never drawn through it) and is gone, indoors; at its dawn it
 *              comes out of that door again
 *   leave      a subagent whose session ends walks into the Guildhall (fades at its door), not into air
 *   ghost      a fallen subagent that leaves slumps, then rises as a pale ghost that drifts to the
 *              graveyard and fades at a grave (`Itinerary.ghost`; the renderer draws it translucent)
 *
 * Everything here is pure: the choice of what comes next is a function of the hero's seed, its count of
 * moves and the hour (`hourAt` on the planner's `DayClock`), so the same log, kit and day give the same
 * itineraries.
 */

/** Where heroes go when their work is over: the island's haunts, its doors and its graves (studio `kitOf`). */
export interface RestKit {
  /** Where heroes at rest go besides the Guildhall's gathering (its seats are the kit's home spots). */
  haunts: readonly Haunt[]
  /** On the thresholds of the doors a hero goes in at (facing in, clear of the wall): the Guildhall's, the tavern's, then the nearest. */
  doors: readonly LifeSpot[]
  /** By the graveyard's graves: where a ghost fades. */
  graves: readonly LifeSpot[]
}

/** A haunt: a tavern's yard (standing, toasting) or a square (standing, chatting), and its places. */
export interface Haunt {
  kind: "tavern" | "square"
  spots: readonly LifeSpot[]
}

/**
 * The day's clock as the island shows it, for the planner's events' clock: at `at` (ms) it is `hour`,
 * and it runs `rate` day-hours to a real hour (the studio's SPEEDUP: 20 by default).
 */
export interface DayClock {
  at: number
  hour: number
  rate?: number
}

/** Day-hours to a real hour when a `DayClock` does not say (the studio's life: lifePlan.ts SPEEDUP). */
export const DAY_RATE = 20

/** The hour at `t` (ms) on `day`, 0–24; midday with no day clock. */
export function hourAt(day: DayClock | null, t: number): number {
  if (!day) return 13
  const h = day.hour + ((t - day.at) / 3_600_000) * (day.rate ?? DAY_RATE)
  return ((h % 24) + 24) % 24
}

/** ms from `t` until the day next reads `hour` (0 when it reads it now). */
export function msUntilHour(day: DayClock | null, t: number, hour: number): number {
  if (!day) return Number.POSITIVE_INFINITY
  const ahead = (((hour - hourAt(day, t)) % 24) + 24) % 24
  return (ahead / (day.rate ?? DAY_RATE)) * 3_600_000
}

/** Night falls for heroes at rest at this hour, and they come out again from `DAWN` (plus their own lie-in). */
export const NIGHT_FROM = 22
export const DAWN = 6.5
/** The evening: heroes at rest go to the tavern. */
export const EVENING_FROM = 17
/** A resident works at its places by day. */
export const WORK_FROM = 8
export const WORK_TO = 17

export const isNight = (h: number): boolean => h >= NIGHT_FROM || h < DAWN
export const isEvening = (h: number): boolean => h >= EVENING_FROM && h < NIGHT_FROM

/** A hero home from its finished work sits this long at its seat first (ms), give or take its seed's. */
export const REST_SETTLE_MS = 20_000
/** A hero heard nothing of for this long (a live session gone quiet) begins to rest (ms). */
export const QUIET_MS = 90_000
/** How long a hero at rest stays at a haunt or its seat (ms): `REST_STAY_MS` and up to as much again. */
export const REST_STAY_MS = 40_000
/** How long a resident works at one of its places (ms), and up to as much again. */
export const RESIDENT_WORK_MS = 60_000
/** A hero going in at a door is seen at it this long before it is gone (ms). */
export const DOOR_MS = 900
/** A hero comes out at dawn up to this many day-hours after `DAWN`, by its seed. */
export const LIE_IN_HOURS = 1.2

/** A ghost rises out of its slump this long (ms), glides at this many times the walking pace, waits at its grave this long and fades over `GHOST_FADE_MS`. */
export const GHOST_RISE_MS = 1400
export const GHOST_PACE = 1.8
export const GHOST_LINGER_MS = 2500
/** A ghost's long drift is pressed to take about this long (ms), gliding no faster than `GHOST_TOP` m/s. */
export const GHOST_DRIFT_MS = 25_000
export const GHOST_TOP = 6
export const GHOST_FADE_MS = 2000
/** A ghost floats this far off the ground (metres), bobbing by `GHOST_BOB` over `GHOST_BOB_MS`. */
export const GHOST_LIFT = 0.22
export const GHOST_BOB = 0.06
export const GHOST_BOB_MS = 1700

/** What a hero at rest does next (`restNext`): where it goes and how it stands there. */
export type RestGo =
  | { kind: "seat" }
  | { kind: "haunt"; haunt: number; stand: "chat" | "toast" }
  | { kind: "work"; zone: number }
  | { kind: "sleep" }

/** A number in [0, 1) from the hero's seed and a salt (pure). */
export const restRnd = (seed: number, salt: string | number): number =>
  (hash("rest", seed, salt) >>> 0) / 2 ** 32

/**
 * What a hero at rest goes to next, its `k`th move: to bed at night; in the evening to the tavern
 * (else its seat); a resident by day mostly to work at one of its places in turn; otherwise round its
 * seat and the haunts, never the same place twice running. Pure.
 */
export function restNext(o: {
  seed: number
  k: number
  hour: number
  haunts: readonly Haunt[]
  /** A resident's own places (zones), in order; none for a hero whose session is over. */
  zones?: readonly number[]
  /** Where it was last: a haunt's index, -1 its seat, -2 at work, null nowhere yet. */
  last: number | null
}): RestGo {
  const { seed, k, hour, haunts } = o
  if (isNight(hour)) return { kind: "sleep" }
  const tavern = haunts.findIndex((h) => h.kind === "tavern")
  if (isEvening(hour)) {
    if (tavern >= 0) return { kind: "haunt", haunt: tavern, stand: "toast" }
    return { kind: "seat" }
  }
  const zones = o.zones ?? []
  if (zones.length && hour >= WORK_FROM && hour < WORK_TO && (o.last === -2 ? restRnd(seed, k) < 0.4 : true))
    return { kind: "work", zone: zones[(k + (seed % zones.length)) % zones.length] as number }
  // round the seat and the haunts, by the seed, never where it was
  const options: number[] = [-1, ...haunts.map((_, i) => i)].filter((x) => x !== o.last)
  const pick = options[Math.floor(restRnd(seed, `go${k}`) * options.length)] ?? -1
  if (pick < 0) return { kind: "seat" }
  const h = haunts[pick] as Haunt
  return { kind: "haunt", haunt: pick, stand: h.kind === "tavern" ? "toast" : "chat" }
}

/** How long a hero at rest stays where it went (ms): a stay's length by its seed and count of moves. */
export function restStay(seed: number, k: number, go: RestGo): number {
  const r = restRnd(seed, `stay${k}`)
  return go.kind === "work" ? RESIDENT_WORK_MS * (1 + r) : REST_STAY_MS * (1 + r)
}

/** The hour a hero comes out of its door in the morning (its own lie-in after `DAWN`). */
export const wakeHour = (seed: number): number => DAWN + restRnd(seed, "wake") * LIE_IN_HOURS

/**
 * How visible a ghost is at `t` (0–1): rising from 0 over `GHOST_RISE_MS` from when it rose, fading
 * to 0 over `GHOST_FADE_MS` from `fade`; null before it rose (not a ghost yet).
 */
export function ghostAt(ghost: { from: number; fade: number }, t: number): number | null {
  if (t < ghost.from) return null
  const up = Math.min(1, (t - ghost.from) / GHOST_RISE_MS)
  const down = t <= ghost.fade ? 1 : Math.max(0, 1 - (t - ghost.fade) / GHOST_FADE_MS)
  return Math.max(0.05, up) * down
}

/** A ghost's lift off the ground at `t` (metres): floating, bobbing gently. */
export const ghostLift = (ghost: { from: number }, t: number): number =>
  Math.min(1, Math.max(0, (t - ghost.from) / GHOST_RISE_MS)) *
  (GHOST_LIFT + GHOST_BOB * Math.sin(((t - ghost.from) / GHOST_BOB_MS) * Math.PI * 2))
