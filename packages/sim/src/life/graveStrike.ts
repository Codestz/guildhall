import type { LifeSpot } from "@guildhall/world"
import type { WorldEvent } from "../events/world.ts"
import type { Grave } from "../story/worldEvents.ts"
import { ShowEngine } from "../story/worldEvents.ts"
import { STRIKE_GUARD_MS } from "./craft.ts"
import type { HeroAct } from "./itineraries.ts"

/**
 * The fight at the graveyard (plan .probe/v1events Task B, the user's pick): when a grave's cause is
 * mended (a recovered session, a passing test, CI green again), the hero who mended it walks (or runs)
 * to the grave and strikes it once before its skeleton dies and sinks. This is the planner's side of
 * it, a hook kept apart from the choreography in itineraries.ts (`LifePlanner` calls `take` with each
 * event and plans the errand for each strike it returns, `strikeGrave`).
 *
 * The world events (story/worldEvents.ts `Grave`) say who mends a grave and by when it must be struck
 * (`strike`: a deadline, `SHOW_RULES.strikeMs` after the mending). The fixer sets off once what holds
 * it is over and comes as fast as its way allows (a run when it is long), so the blow lands when it
 * gets there: `struck(grave, acts)` reads that time back from its itinerary, for the skeleton to reel
 * and die then (render undead/). One that cannot make it by the deadline does not come, and the grave
 * just sinks at the deadline.
 *
 * A `ShowEngine` of its own reads the same events as the hall's (the graves and their mending do not
 * depend on where watching began), so the errand is a pure function of the log, as the rest of the
 * itinerary: a scrub and a play agree.
 */

/** Where heroes strike the graves: the spot before grave `slot` on the walk graph (none: no graveyard). */
export interface GraveKit {
  strike(slot: number): LifeSpot | undefined
}

/** One mended grave its fixer is to strike. */
export interface GraveStrike {
  /** The hero who mends it (its id). */
  fixer: string
  slot: number
  /** When it was mended, and the latest the blow may land (run time, ms). */
  fixed: number
  deadline: number
}

/** The blow lands this long into the swing (Melee_1H_Attack_Slice_Diagonal's hit at 0.45). */
export const STRIKE_LEAD_MS = 450
/** Arrived, it squares up to the skeleton (sword raised) this long before it swings: the strike's first move. */
export const STRIKE_PAUSE_MS = STRIKE_GUARD_MS
/** A way to a grave longer than this (metres) is run, at STRIKE_RUN_MPS. */
export const STRIKE_WALK_M = 8
export const STRIKE_RUN_MPS = 4.5
/** After the blow it watches the skeleton die and sink this long, then goes back to what it was doing. */
export const STRIKE_WATCH_MS = 3000

/** The graves mended as the events come: `take(ev)` returns those `ev` mended with a fixer. */
export class GraveStrikes {
  private readonly engine = new ShowEngine()
  private readonly events: WorldEvent[] = []
  private readonly seen = new Set<string>()

  take(ev: WorldEvent): GraveStrike[] {
    this.events.push(ev)
    this.engine.feed(this.events)
    const out: GraveStrike[] = []
    for (const show of this.engine.all(ev.at)) {
      const g = show.params.grave
      if (show.kind !== "undead" || !g || g.minion || g.fixed !== ev.at || !g.fixer || g.strike === undefined)
        continue
      if (this.seen.has(show.id)) continue
      this.seen.add(show.id)
      out.push({ fixer: g.fixer.id, slot: g.slot, fixed: g.fixed, deadline: g.strike })
    }
    return out
  }
}

/** ms a fixer takes over a way of `metres` (walking at `mps` metres a ms when it is short, else running). */
export function strikeWalkMs(metres: number, mps: number): number {
  return metres > STRIKE_WALK_M ? (metres / STRIKE_RUN_MPS) * 1000 : metres / mps
}

/**
 * When grave `g`'s blow lands, by its fixer's acts (its itinerary's): the strike it planned between the
 * mending and the deadline, else none (it did not come: the grave sinks at its deadline).
 */
export function struckAt(g: Grave, acts: readonly HeroAct[] | undefined): number | undefined {
  if (g.fixed === undefined || g.strike === undefined || !acts) return undefined
  for (const a of acts)
    if (
      a.play === "strike" &&
      a.grave === g.slot &&
      a.from >= g.fixed &&
      a.from + STRIKE_PAUSE_MS + STRIKE_LEAD_MS <= g.strike
    )
      return a.from + STRIKE_PAUSE_MS + STRIKE_LEAD_MS
  return undefined
}

/**
 * Grave `g` as its fixer strikes it (`struckAt`): the blow when it lands, the sinking after it as the
 * world events would have it (`strike` → `sink` kept); when the fixer does not come, it sinks at its
 * deadline without a blow (`strike` dropped). Without the fixer's acts (no life on the island) the
 * world events' own times stand.
 */
export function asStruck(g: Grave, acts: readonly HeroAct[] | undefined): Grave {
  if (g.strike === undefined || g.sink === undefined || !acts) return g
  const at = struckAt(g, acts)
  if (at === undefined) {
    const { strike: _s, ...rest } = g
    return rest
  }
  return { ...g, strike: at, sink: at + (g.sink - g.strike) }
}
