import type { Change } from "@guildhall/core"
import type { Chapter } from "@guildhall/sim"
import type { Director, DirectorStyle } from "../director.ts"
import type { StoryHour } from "../environment.ts"
import type { Marker } from "../log.ts"
import type { Sighting } from "../sea.ts"
import type { AdventurerView } from "../views.ts"
import type { ScenarioId } from "./scenarios.ts"

/**
 * Where the hall's changes come from (ADR 0012). A feed owns its source — a told story, the hub's
 * socket, later a chronicle's timelapse or another protocol — and its clock; the store
 * (guild/store.ts) owns everything derived. The store asks the feed the time; the feed hands the
 * store changes through a `FeedSink`.
 */

/** The run's clock as a feed keeps it. */
export interface FeedClock {
  /** The present, in ms since the epoch (the model's clock). */
  now(): number
  /** Run time (ms since the run's start). */
  time(): number
  /** How long the run is (live: as long as it has gone on). */
  duration(): number
  /** Run time 0, in ms since the epoch. */
  origin(): number
  /**
   * Whether something that happened at `when` (ms since the epoch) is news at `now`, or backlog to
   * be applied quietly: a replay's history is always news as it plays; live, only what is recent.
   */
  news(when: number, now: number): boolean
}

export interface Feed extends FeedClock {
  /** "sim": a told story. "live": the hub (real sessions). */
  readonly kind: "sim" | "live"
  /** The story's own hours (environment.ts time mode "story"); empty without them. */
  readonly hours: readonly StoryHour[]
  /** Begin: set the store's story fields and take what is known so far. */
  start(sink: FeedSink): void
  /** End: let go of the source (a socket closes, its reconnects stop). */
  stop(): void
  /** Real ms went by. True when it took changes or started over (the store refreshes then). */
  tick(realMs: number): boolean
  /** Rebuild the run up to run time `time`. Only a feed with a history to replay can. */
  seek?(time: number): void
  /** The viewer's pace changed (Settings → Pace). */
  paced?(): void
}

/** The store's fields a feed sets or reads (`GuildStore` has them all). */
export interface FeedState {
  scenario: ScenarioId
  markers: Marker[]
  chapters: Chapter[]
  sea: Sighting[]
  connected: boolean
  guild: string
  fastForward: number
  selected: string | null
  readonly speed: number
  readonly directorStyle: DirectorStyle
  readonly bard: boolean
  readonly views: readonly AdventurerView[]
  readonly director: Director
}

/** What a feed hands its changes to. */
export interface FeedSink {
  readonly state: FeedState
  /** Apply one change (`live`: news as it happens, else history). Returns whether it is a red check. */
  take(change: Change, live: boolean, guild?: string): boolean
  /** Start the history over (`continued`: the same run goes on, so what was news is not news again). */
  reset(continued?: boolean): void
  /** Derive the views, parties and environment again, and notify. */
  refresh(): void
  /** Notify without deriving. */
  emit(): void
  /** Tell the sea's moments up to run time `to`. */
  tellSea(to: number, live: boolean): void
  /** The replay's clock moved from `from` to `to`: tell the chapters it reached. */
  turn(from: number, to: number): void
}
