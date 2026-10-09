import type { Change, SeaEvent } from "@guildhall/core"
import { type Chapter, factions, parties, party, rush, sagaTale, seas, solo, type Tale } from "@guildhall/sim"

/** The told stories the sim feed (guild/feeds/sim.ts) plays: Settings → Story, a deep link's `story`. */

/** How many adventurers `rush` sends out (unset: the story's own 12); a deep link's `n` sets it. */
export const RUSH: { count?: number } = {}

/** A story as told: its changes alone, or with acts and hours, and the GitHub sea beside it. */
export type Told = Change[] | (Tale & { sea?: readonly SeaEvent[] })

export const SCENARIOS: Record<
  "saga" | "party" | "solo" | "rush" | "parties" | "factions" | "seas",
  () => Told
> = {
  /** The showcase's story: five acts, ~17 min watched, every world event (sim/saga.ts). */
  saga: () => sagaTale(),
  party: () => party(),
  solo: () => solo(),
  rush: () => rush(RUSH.count),
  /** Three conversations at once: several parties on one island (guild/parties.ts). */
  parties: () => parties(),
  /** Two harnesses at once: an OpenCode party and a Claude Code party (sim/factions.ts). */
  factions: () => factions(),
  /** A party with its GitHub sea beside it: a push, a PR, red then green CI, a merge, a release (sim/seas.ts). */
  seas: () => {
    const { changes, sea } = seas()
    return { changes, chapters: [], hours: [], sea }
  },
}
export type ScenarioId = keyof typeof SCENARIOS

/** A chapter of the story being played (the Saga's acts), at run time `at` (ms). */
export type StoryChapter = Chapter
