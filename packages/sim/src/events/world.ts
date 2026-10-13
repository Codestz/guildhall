import type { CiState, Craft, PrStatus } from "@guildhall/core"
import type { ArchetypeId } from "../roster/archetypes.ts"
import type { Body } from "../roster/bodies.ts"
import type { Rank } from "../roster/ranks.ts"

/**
 * The world's events (plan-hud-events.md §3.1): what the guild and its project did, in the world's
 * own words, ordered by `at` then `seq`. `normalize` makes them from the wire (a `GuildEvent`'s change,
 * read through the session model and its moments, or a `SeaEvent`); `reduce` folds them into a
 * `GuildWorld`. Only transitions are events: a change that moved nothing (a streamed thought, a
 * re-sent running call) makes none.
 *
 * A place is a zone index, as `PlaceBinding.placeOf` gives it; `undefined` is the hall (the castle),
 * where every hero starts and where work that names no file is done.
 */

/** Who an actor is, as the hall names them at the moment the event was made. */
export interface Who {
  /** Session id. */
  id: string
  /** The session that sent them; absent for a guildmaster (a root session). */
  parent?: string
  /** The source's agent name (`build`, `explore`, `guild-implementer`). */
  agent: string
  archetype: ArchetypeId
  /** The KayKit adventurer that draws them. */
  body: Body
  /** The hall's name for them (`Scout`, `Implementer II`, `Guildmaster`). */
  name: string
  /** Their role's colour. */
  color: string
  /** The session's own title, when the host gave one. */
  title: string
  /** The task they were given (their first prompt), once known. */
  task?: string
}

/** A tool call, as the world sees it: what it means, what it is about and where that is. */
export interface Work {
  id: string
  call: string
  /** The host's tool name (`read`, `Bash`, `subagent`). */
  tool: string
  craft: Craft
  /** What it is about in a few words (`life.ts`, `bun test`, `"pattern"`). */
  target: string
  /** The file paths its input names (none for a search of nothing, a fetch, a quest). */
  paths: string[]
  /** The place of each path, in order (empty when the normaliser has no binding). */
  places: number[]
}

export type WorldHappening =
  /** A session is seen for the first time. */
  | ({ kind: "actor.join" } & Who)
  /** It learned something about itself: a parent (it joined a party), its agent, title or task. */
  | ({ kind: "actor.info" } & Who)
  /** A call started: what it is doing now, and where (the intent). */
  | ({ kind: "actor.step" } & Work)
  /**
   * A call finished: a deed, or a failed one (core's `failedDeed`). `stepped` says its start was already
   * an `actor.step`, so its place was counted then.
   */
  | ({
      kind: "actor.deed"
      failed: boolean
      stepped: boolean
      size?: number
      error?: string
      exit?: number
    } & Work)
  /** It sent a quest: a subagent is on its way (its `actor.join` follows when it is seen). */
  | { kind: "actor.quest"; id: string; call: string; text: string }
  /** It waits on a human (a permission, a question). */
  | { kind: "actor.plea"; id: string }
  /** It stopped waiting. */
  | { kind: "actor.answered"; id: string }
  /** It finished (done): the loot comes home. */
  | { kind: "actor.loot"; id: string }
  /** It failed (its own word, or settled when the subagent above it failed). */
  | { kind: "actor.fail"; id: string; error?: string }
  /** A failed session works again. */
  | { kind: "actor.recover"; id: string }
  /** A finished session works again (a new prompt to the guildmaster). */
  | { kind: "actor.resume"; id: string }
  /** It earned a rank (`AGENT_RANK`, by deeds or tokens). */
  | { kind: "actor.rank"; id: string; rank: Rank }
  /** A finished subagent leaves the island, `GONE_MS` after it finished (made by the clock, not a change). */
  | { kind: "actor.leave"; id: string }
  /** New commits on a branch. */
  | { kind: "sea.push"; repo: string; branch: string; commits: number; author: string; sha: string }
  /** A pull request opened, moved (a draft marked ready, a review asked), merged or closed. */
  | {
      kind: "sea.pr"
      repo: string
      n: number
      title: string
      author: string
      branch: string
      state: PrState
      status?: PrStatus
      size?: number
      url?: string
    }
  /**
   * A CI run moved. `moment` is the sea's moment it makes, if any (`seaMomentOf`): red on a failure,
   * green on a pass after one.
   */
  | {
      kind: "sea.ci"
      repo: string
      name: string
      branch: string
      sha: string
      state: CiState
      moment?: "sea-red" | "sea-green"
    }
  /** A release was published. */
  | { kind: "sea.release"; repo: string; tag: string; name?: string }

export type PrState = "opened" | "updated" | "merged" | "closed"

export type WorldKind = WorldHappening["kind"]

/**
 * One world event. `at` is ms on the source's clock (epoch ms live and in chronicles), never
 * decreasing along a log; `seq` grows by one per event a normaliser makes; `src` says what made it:
 * `<guild>#<seq>` for a guild change, `sea:<id>` for a sea event, `clock` for a leave.
 */
export type WorldEvent = { at: number; seq: number; src: string } & WorldHappening

/** How long a finished subagent stays before it leaves (V1's `GONE_MS`). */
export const GONE_MS = 27_000
