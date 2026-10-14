import type { Grave, Show, ShowWho } from "./worldEvents.ts"
import { SHOW_RULES } from "./worldEvents.ts"

/**
 * The graveyard's state at a time (plan .probe/v1events Task B), from the world events' graves
 * (worldEvents.ts `Grave`): what a grave's skeleton is doing at run time `t`, and which skeleton it is.
 * Pure, so a scrub and a play agree: render undead/ draws it, life graveStrike.ts sends the fixer.
 *
 *   rise     lying still in the earth, then clawing up (`rise` → `vigil`, 2.8 s)
 *   vigil    standing at its grave, now and then a taunt
 *   struck   the fixer's blow lands (`strike` → `sink`, 0.6 s): it reels
 *   sink     it dies again and goes down into the earth (`sink` → its show's end, 2.6 s)
 */
export type GravePhase = "rise" | "vigil" | "struck" | "sink"

export interface GraveState {
  phase: GravePhase
  /** ms since the phase began. */
  ms: number
}

/** A grave's state at `t` (run time, ms); null before it rises and once it is gone. */
export function graveAt(g: Grave, t: number): GraveState | null {
  if (t < g.rise) return null
  if (g.sink !== undefined && t >= g.sink) {
    const ms = t - g.sink
    return ms < SHOW_RULES.sinkMs ? { phase: "sink", ms } : null
  }
  if (g.strike !== undefined && t >= g.strike) return { phase: "struck", ms: t - g.strike }
  if (t < g.vigil) return { phase: "rise", ms: t - g.rise }
  return { phase: "vigil", ms: t - g.vigil }
}

/** The four KayKit skeletons. */
export const UNDEAD_KINDS = ["warrior", "mage", "rogue", "minion"] as const
export type UndeadKind = (typeof UNDEAD_KINDS)[number]

/**
 * Which skeleton a grave raises (V1's `undeadOf`, by the fallen's body): knights and barbarians are
 * warriors, mages mages, rogues and rangers rogues; wanderers and automatons (and a failed deed's
 * flavour) minions. A red CI's grave, with nobody fallen, raises a warrior.
 */
export function undeadKind(
  g: Pick<Grave, "minion" | "cause">,
  who?: Pick<ShowWho, "archetype" | "body">,
): UndeadKind {
  if (g.minion) return "minion"
  if (!who) return g.cause === "ci" ? "warrior" : "minion"
  if (who.archetype === "wanderer" || who.archetype === "automaton") return "minion"
  switch (who.body) {
    case "knight":
    case "barbarian":
      return "warrior"
    case "mage":
      return "mage"
    case "rogue":
    case "ranger":
      return "rogue"
    default:
      return "minion"
  }
}

/** The graves among `shows` (undead shows), with their show. */
export function gravesOf(shows: readonly Show[]): { show: Show; grave: Grave }[] {
  const out: { show: Show; grave: Grave }[] = []
  for (const show of shows)
    if (show.kind === "undead" && show.params.grave) out.push({ show, grave: show.params.grave })
  return out
}
