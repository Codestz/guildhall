/**
 * A told story as a feed (`?feed=story&story=<id>`): sim's demo stories (plan D1, `story(id, {repo, seed})`:
 * the saga re-authored for this repo, and V1's solo, party, parties, rush, seas, factions), told on the
 * hall's own repo so its paths land on the hall's places, and played on the session clock like a recording.
 */
import type { SeaEvent } from "@guildhall/core"
import { STORY_IDS, type StoryId, type StoryUnit, story } from "@guildhall/sim"
import type { Feed, FeedChapter, FeedSink, FeedStatus } from "./feed.ts"

/**
 * A story's clock starts here: a fixed morning (13 Oct 2026, 09:00 UTC), so a story told twice is the
 * same events at the same times, and its dates read as a day rather than 1970.
 */
export const STORY_EPOCH = Date.UTC(2026, 9, 13, 9)

const TITLES: Record<StoryId, string> = {
  saga: "The Saga",
  solo: "Alone",
  party: "A Party",
  parties: "Two Parties",
  rush: "The Rush",
  seas: "The Seas",
  factions: "The Factions",
}

/** A story's title, for the Brand. */
export const storyTitle = (id: StoryId): string => TITLES[id]

/** The story a link names (`?story=`), the Saga by default. */
export const storyOf = (asked: string | null): StoryId =>
  (STORY_IDS as readonly string[]).includes(asked ?? "") ? (asked as StoryId) : "saga"

/** The act a link opens a story at (`?act=`, 1 – 5), or undefined. */
export function actOf(query: Pick<URLSearchParams, "get">): number | undefined {
  const n = Number(query.get("act"))
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined
}

/** Where a story is told: the hall's repo (its name, its units), and the jitter's seed. */
export interface StoryStage {
  /** The act to open at (`actOf`): the session opens there, playing. */
  act?: number
  name?: string
  units?: readonly StoryUnit[]
  seed?: number
}

export class StoryFeed implements Feed {
  readonly kind = "story"
  readonly name: string
  private state: FeedStatus = "offline"
  private live = false

  constructor(
    readonly id: StoryId,
    private readonly stage: StoryStage = {},
  ) {
    this.name = storyTitle(id)
  }

  status(): FeedStatus {
    return this.state
  }

  start(sink: FeedSink): void {
    if (this.live) return
    this.live = true
    const { name, units, seed } = this.stage
    const told = story(this.id, {
      ...(name || units ? { repo: { ...(name ? { name } : {}), ...(units ? { units } : {}) } } : {}),
      seed: seed ?? 1,
      start: STORY_EPOCH,
    })
    sink.reset()
    // the guild's changes and the sea, merged by time (the guild's first on a tie)
    const sea = [...told.seas].sort((a, b) => a.at - b.at)
    let s = 0
    for (const event of told.events) {
      while (s < sea.length && (sea[s] as SeaEvent).at < event.change.at)
        sink.take(sea[s++] as SeaEvent, false)
      sink.take(event, false)
    }
    while (s < sea.length) sink.take(sea[s++] as SeaEvent, false)
    sink.chapters?.(
      told.chapters.map(
        ({ at, numeral, title, tagline }): FeedChapter => ({ at: at - STORY_EPOCH, numeral, title, tagline }),
      ),
    )
    sink.loaded?.(this.stage.act ? { act: this.stage.act } : undefined)
    this.state = "replay"
    sink.status("replay")
  }

  stop(): void {
    this.live = false
  }
}
