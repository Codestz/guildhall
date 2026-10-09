import { HAND_IN, HAND_INS, type Post, type Spot } from "../world/layout.ts"
import type { Party } from "./parties.ts"

/**
 * How newcomers come on stage and leavers go (guild/views.ts hands them out): by the keep's gate
 * and down the avenue, or summoned at their guildmaster's side.
 */

/**
 * How a newcomer comes on stage. `gate`: from out on the avenue, walking in through the keep's
 * gate (a new conversation's guildmaster, anyone with no guildmaster on stage to send them).
 * `dais`: summoned at their guildmaster's side, where loot is handed in, facing them, as the
 * guildmaster casts the summon (Ranged_Magic_Summon while a task is being sent).
 */
export interface Entrance {
  kind: "gate" | "dais"
  at: Post
}

/**
 * Down the avenue from the keep's gate (the road hex at z 30, one and three-quarter hexes past the
 * wall): newcomers from afar appear here, and leavers walk here and dissolve. On the road graph
 * (world/paths.ts), clear of the stalls, the well and the festival's poles (test/arrivals.test.ts).
 */
export const AVENUE_END: Spot = [0, 30]
/** Two who come or go together don't walk inside each other: each keeps to their own side, ±this. */
export const ROAD_SPREAD = 1
/** Summoned together, each appears up to this far either side of the hand-in spot. */
export const DAIS_SPREAD = 0.6
/** After GONE_MS, a leaver still walks down the avenue this long before the stage lets them go. */
export const EXIT_MS = 7000

/** -1…1, stable per id: which side of the road (or of the hand-in spot) someone keeps to. */
function sideOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) / 4294967295) * 2 - 1
}

/** Where a leaver walks to, down the avenue (facing on, away from the keep), and dissolves. */
export function exitOf(id: string): Post {
  return [AVENUE_END[0] + sideOf(id) * ROAD_SPREAD, AVENUE_END[1], 0]
}

/**
 * Where a newcomer appears (see `Entrance`). A subagent whose guildmaster is on stage (and not
 * going home) is summoned beside them; everyone else walks in from the avenue, facing the keep.
 */
export function entranceOf(id: string, party: Party, master: boolean): Entrance {
  const side = sideOf(id)
  if (!master && party.root && !party.leaving) {
    const [x, z, facing] = HAND_INS[party.seat] ?? HAND_IN
    // Across their facing: side by side in front of the guildmaster, never in a line through them.
    return {
      kind: "dais",
      at: [x + Math.cos(facing) * side * DAIS_SPREAD, z - Math.sin(facing) * side * DAIS_SPREAD, facing],
    }
  }
  return { kind: "gate", at: [AVENUE_END[0] + side * ROAD_SPREAD, AVENUE_END[1], Math.PI] }
}
