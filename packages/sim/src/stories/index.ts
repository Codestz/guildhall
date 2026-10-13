import { type Change, type GuildEvent, type SeaEvent, WIRE_VERSION } from "@guildhall/core"
import { factions } from "./factions.ts"
import { rehome, type StoryUnit } from "./rehome.ts"
import { SAGA_REPO, SAGA_UNITS, type SagaBeat, sagaTale } from "./saga.ts"
import { parties, party, rush, solo } from "./scenarios.ts"
import type { Chapter } from "./script.ts"
import { seas } from "./seas.ts"

/**
 * The told stories (plan-hud-events.md D1, the site's story cards in apps/studio/src/site/stories.ts):
 * simulated guild runs, in the wire's own words, that a StoryFeed plays like a recorded one.
 *
 *   script     V1's Script/Adventurer DSL (main:packages/sim), ported as is and golden-tested
 *   scenarios  V1's solo, party, parties and rush; factions; seas (with its GitHub sea and backlog)
 *   saga       the showcase, re-authored for the hex island in this repo's own paths
 *   rehome     a story's paths moved onto another repo's units, so its heroes still spread out
 *
 * `story(id, opts)` tells one: its guild events (seq from 1, `at` in ms from the story's start plus
 * `start`), its GitHub sea, and how long it runs. The same id and options always tell the same story.
 */

export type StoryId = "saga" | "solo" | "party" | "parties" | "rush" | "seas" | "factions"

export const STORY_IDS: readonly StoryId[] = ["saga", "solo", "party", "parties", "rush", "seas", "factions"]

export interface StoryRepo {
  /** `owner/name`: the sea's repo. */
  name?: string
  /** The repo's units (a chronicle's `unitsAt`): with them the story's paths are rehomed onto them. */
  units?: readonly StoryUnit[]
}

export interface StoryOptions {
  /** The repo the story is told on; without it, the story's own layout and sea. */
  repo?: StoryRepo
  /** The jitter's seed (default 1). */
  seed?: number
  /** `rush`: how many adventurers (default 12). */
  count?: number
  /** Added to every `at` (default 0): a feed that plays on the epoch's clock passes its start. */
  start?: number
  /** The guild the events belong to (default `story:<id>`). */
  guild?: string
}

export interface Story {
  id: StoryId
  events: GuildEvent[]
  seas: SeaEvent[]
  /** From the story's start to its last event, ms. */
  duration: number
  chapters: Chapter[]
  /** The saga's authored beats, at their `at` (start added). Empty for the other stories. */
  beats: { beat: SagaBeat; at: number }[]
}

/** Wrap a script's changes as wire events for one guild (V1's `toEvents`). */
export function toEvents(changes: readonly Change[], guild: string): GuildEvent[] {
  return changes.map((change, index) => ({ v: WIRE_VERSION, guild, seq: index + 1, change }))
}

interface Told {
  changes: Change[]
  sea: SeaEvent[]
  chapters: Chapter[]
  beats: { beat: SagaBeat; at: number }[]
  /** The districts to rehome first (the biggest units go to them). */
  first?: readonly string[]
}

function tell(id: StoryId, seed: number, opts: StoryOptions): Told {
  const plain = (changes: Change[]): Told => ({ changes, sea: [], chapters: [], beats: [] })
  switch (id) {
    case "saga": {
      const tale = sagaTale(seed, opts.repo?.name ?? SAGA_REPO)
      const first = [SAGA_UNITS.world, SAGA_UNITS.render, SAGA_UNITS.studio]
      return { changes: tale.changes, sea: tale.sea, chapters: tale.chapters, beats: tale.beats, first }
    }
    case "solo":
      return plain(solo(seed))
    case "party":
      return plain(party(seed))
    case "parties":
      return plain(parties(seed))
    case "rush":
      return plain(rush(opts.count ?? 12, seed))
    case "factions":
      return plain(factions(seed))
    case "seas": {
      const tale = seas(seed)
      const repo = opts.repo?.name
      const sea = repo ? tale.sea.map((e) => ({ ...e, repo, id: e.id.replace("acme/shop", repo) })) : tale.sea
      return { changes: tale.changes, sea, chapters: [], beats: [] }
    }
  }
}

/** Tell story `id` (see the top of this file). */
export function story(id: StoryId, opts: StoryOptions = {}): Story {
  const told = tell(id, opts.seed ?? 1, opts)
  const units = opts.repo?.units
  const changes = units?.length ? rehome(told.changes, units, told.first) : told.changes
  const start = opts.start ?? 0
  const shift = <T extends { at: number }>(x: T): T => (start === 0 ? x : { ...x, at: x.at + start })
  const last = Math.max(changes.at(-1)?.at ?? 0, ...told.sea.map((e) => e.at))
  return {
    id,
    events: toEvents(changes.map(shift), opts.guild ?? `story:${id}`),
    seas: told.sea.map(shift),
    duration: last - (changes[0]?.at ?? 0),
    chapters: told.chapters.map(shift),
    beats: told.beats.map(shift),
  }
}

export { factions } from "./factions.ts"
export { districtMap, districtOf, rehome, type StoryUnit, storyPaths } from "./rehome.ts"
export { SAGA_REPO, SAGA_TAIL_MS, SAGA_UNITS, type SagaBeat, type SagaTale, sagaTale } from "./saga.ts"
export { parties, party, rush, solo } from "./scenarios.ts"
export {
  Adventurer,
  type Chapter as StoryChapter,
  type DeedOptions,
  type Economy,
  Script,
  type ScriptOptions,
} from "./script.ts"
export { RELEASE_TAIL_MS, type SeaTale, seas } from "./seas.ts"
