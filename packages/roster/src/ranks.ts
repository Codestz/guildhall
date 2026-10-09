import { ARCHETYPES, type ArchetypeId, type Gear } from "./archetypes.ts"

/**
 * Ranks (ADR 0010): how seasoned an adventurer is, from what they have done. An apprentice looks
 * as every adventurer always did; a journeyman's cape is a deeper dye; a master also carries the
 * finer tools of the trade (`Archetype.master`). The chip shows one banner pip a rank past
 * apprentice.
 *
 * What counts as experience is the source's: a rule turns its activity into a rank. Agents rank by
 * deeds or tokens (`AGENT_RANK`); another source (a repo's contributors, by commits) brings its own.
 */
export type Rank = "apprentice" | "journeyman" | "master"

export const RANKS: readonly Rank[] = ["apprentice", "journeyman", "master"]

/** What an adventurer has done so far, as far as the source can say. */
export interface Activity {
  /** Deeds (tool calls) done. */
  deeds: number
  /** Tokens spent. */
  tokens: number
}

export type RankRule = (activity: Activity) => Rank

/**
 * An agent session: a journeyman past 20 deeds or a million tokens, a master past 60 deeds or four
 * million. Told stories mostly stay apprentices; a long real session earns its rank.
 */
export const AGENT_RANK: RankRule = ({ deeds, tokens }) => {
  if (deeds >= 60 || tokens >= 4_000_000) return "master"
  if (deeds >= 20 || tokens >= 1_000_000) return "journeyman"
  return "apprentice"
}

/** Pips on the chip's banner: none for an apprentice. */
export function pipsOf(rank: Rank): number {
  return RANKS.indexOf(rank)
}

/** What an archetype carries at a rank: a master's finer tools replace the hands they name. */
export function gearAt(archetype: ArchetypeId, rank: Rank): Gear {
  const { gear, master } = ARCHETYPES[archetype]
  return rank === "master" && master ? { ...gear, ...master } : gear
}
