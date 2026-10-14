/**
 * Where a hall's session comes from (plan-hud-events §1 "Feeds", V1 ADR 0012, rewritten lean): a feed
 * owns its source (the hub's socket, a recorded `.jsonl`, a told story) and hands what it reads to one
 * sink, the hall's session (session.ts), which owns everything derived: the log, the world, the clock.
 * A feed never folds, never narrates, never keeps time for the HUD.
 */
import type { StoryShowRules, WireInput } from "@guildhall/sim"

/**
 * How a feed is doing. `connecting`: the hub is being reached (or reached again, with backoff); `live`:
 * the hub answers and news is flowing; `offline`: no source (the hub is down between retries, or a
 * recording could not be read); `replay`: a recording or a story is loaded whole and plays on the clock.
 */
export type FeedStatus = "connecting" | "live" | "offline" | "replay"

/** `live` the hub, `replay` a recorded chronicle, `story` a told story (V1's stories; D1's saga later). */
export type FeedKind = "live" | "replay" | "story"

/** A told story's act, at ms from the story's start (the ChapterChip's acts). */
export interface FeedChapter {
  at: number
  numeral: string
  title: string
  tagline: string
}

/** What a feed hands its reading to. */
export interface FeedSink {
  /** Everything so far is about to come again (a hub's hello after a reconnect): start the log over. */
  reset(): void
  /**
   * One thing the source said, in its order. `news`: it happened as the hall watched (live, under
   * `LIVE_MS` old), so it may be captioned and toasted; else it is history, folded quietly.
   */
  take(input: WireInput, news: boolean): void
  /** A recording or story is read whole: the session's range is known and the clock may play it. `act`: a story's act the link asked to open at (`?act=`, 1-based). */
  loaded?(open?: { act?: number }): void
  /** The feed's status moved; `note` says why, in a few words (`no hub on 127.0.0.1:4747`). */
  status(status: FeedStatus, note?: string): void
  /** A told story's acts. */
  chapters?(chapters: readonly FeedChapter[]): void
}

export interface Feed {
  readonly kind: FeedKind
  /** What it plays, for the Brand's status line: `guildhall`, `2026-10-06T05-13.jsonl`, `The Saga`. */
  readonly name: string
  /** Begin: read the source into `sink`. A feed is started once. */
  start(sink: FeedSink): void
  /** End: let go of the source (a socket closes, reconnects stop, a fetch is ignored). */
  stop(): void
  status(): FeedStatus
  /**
   * The heroes as this story draws them, by join order (the site's demo guild: Claude the mage, Warden
   * the knight, Scout the ranger): their names and colours in the world, the captions and the chips, and
   * their bodies on the island. None: the hall's own names (Guildmaster, Wanderer II…).
   */
  readonly cast?: readonly FeedHero[] | undefined
  /**
   * A told story's own pacing for the world events (sim `Story.showRules`, the demos' override of the
   * 150 s between big shows): the hall's events engine honours it (hall/events.ts). None: a live hall's.
   */
  readonly showRules?: StoryShowRules | undefined
}

/** A story's hero: its name, banner colour, KayKit body (a catalog id) and NPC recipe. */
export interface FeedHero {
  name: string
  colour: string
  hero: string
  recipe: string
}
