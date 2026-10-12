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

/** A repo's contributors rank by commits (ADR 0022): the bars are set by the repo's own spread. */
export type CommitRule = (commits: number) => Rank

/** Commits a journeyman and a master need at least, however small the repo. */
export const COMMIT_FLOOR = { journeyman: 10, master: 50 } as const
/** The share of a repo's contributors each rank starts above: the top 40% journeymen, the top 10% masters. */
export const COMMIT_QUANTILE = { journeyman: 0.6, master: 0.9 } as const

/**
 * The commits rule for one repo, from every contributor's total (`commits`, any order). A rank's bar
 * is its quantile of that spread, never under its floor: in react (1,800 commits at the top, three
 * at the bottom of the list) a master has ~120, while in a two-person repo nobody is a master on
 * 20 commits. Bots are best left out of `commits`: they would raise the bars for everyone.
 */
export function commitRank(commits: readonly number[]): CommitRule {
  const sorted = [...commits].sort((a, b) => a - b)
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const journeyman = Math.max(COMMIT_FLOOR.journeyman, at(COMMIT_QUANTILE.journeyman))
  const master = Math.max(COMMIT_FLOOR.master, at(COMMIT_QUANTILE.master))
  return (n) => (n >= master ? "master" : n >= journeyman ? "journeyman" : "apprentice")
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
