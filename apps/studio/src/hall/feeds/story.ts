/**
 * A told story as a feed (`?feed=story`): a session's changes, its sea and its acts, played on the
 * session clock like a recording. Today the story is one of V1's (the Saga, from /lab/story); D1's
 * `saga()` for this repo's real places plugs in as another `StorySource` (the seam is `loadStory`).
 */
import type { Change, SeaEvent } from "@guildhall/core"
import type { Feed, FeedChapter, FeedSink, FeedStatus } from "./feed.ts"

/** What a story is: V1's `<name>.input.json` (changes and sea at ms from the story's start, its acts). */
export interface StorySource {
  name: string
  changes: readonly Change[]
  sea?: readonly SeaEvent[]
  chapters?: readonly (FeedChapter & { hour?: number })[]
}

/**
 * A story's clock starts here: a fixed morning (13 Oct 2026, 09:00 UTC), so a story told twice is the
 * same events at the same times, and its dates read as a day rather than 1970.
 */
export const STORY_EPOCH = Date.UTC(2026, 9, 13, 9)

/** V1's told stories, shipped with the Studio for /lab/story. */
export const STORIES = ["saga", "seas", "party", "rush", "solo"] as const
export type StoryName = (typeof STORIES)[number]

const TITLES: Record<StoryName, string> = {
  saga: "The Saga",
  seas: "The Seas",
  party: "A Party",
  rush: "The Rush",
  solo: "Alone",
}

/** A story's title, for the Brand. */
export const storyTitle = (name: StoryName): string => TITLES[name]

/** The story a link names (`?story=`), the Saga by default. */
export const storyOf = (asked: string | null): StoryName =>
  (STORIES as readonly string[]).includes(asked ?? "") ? (asked as StoryName) : "saga"

/** Reads one of V1's stories (the seam: D1's saga comes in here). */
export async function loadStory(name: StoryName): Promise<StorySource> {
  const res = await fetch(`/lab/story/${name}.input.json`)
  if (!res.ok) throw new Error(`story ${name}: ${res.status}`)
  const input = (await res.json()) as Omit<StorySource, "name">
  return { name: TITLES[name], ...input }
}

/** A change moved `by` ms: its time, and a call's start and end. */
function shifted(change: Change, by: number): Change {
  const out = { ...change, at: change.at + by } as Change & { started?: number; ended?: number }
  if (out.type === "tool") {
    if (out.started !== undefined) out.started += by
    if (out.ended !== undefined) out.ended += by
  }
  return out
}

export class StoryFeed implements Feed {
  readonly kind = "story"
  private state: FeedStatus = "offline"
  private live = false

  constructor(
    readonly name: string,
    private readonly load: () => Promise<StorySource>,
  ) {}

  status(): FeedStatus {
    return this.state
  }

  start(sink: FeedSink): void {
    if (this.live) return
    this.live = true
    this.state = "connecting"
    sink.status("connecting")
    this.load().then(
      (story) => {
        if (!this.live) return
        sink.reset()
        const start = story.changes[0]?.at ?? 0
        const shift = STORY_EPOCH - start
        const sea = [...(story.sea ?? [])]
          .map((e) => ({ ...e, at: e.at + shift }))
          .sort((a, b) => a.at - b.at)
        let s = 0
        story.changes.forEach((change, i) => {
          const at = change.at + shift
          while (s < sea.length && (sea[s] as SeaEvent).at <= at) sink.take(sea[s++] as SeaEvent, false)
          sink.take({ v: 1, guild: "story", seq: i + 1, change: shifted(change, shift) }, false)
        })
        while (s < sea.length) sink.take(sea[s++] as SeaEvent, false)
        sink.chapters?.(
          (story.chapters ?? []).map(({ at, numeral, title, tagline }) => ({ at, numeral, title, tagline })),
        )
        sink.loaded?.()
        this.state = "replay"
        sink.status("replay")
      },
      (error: unknown) => {
        if (!this.live) return
        this.state = "offline"
        sink.status("offline", String(error))
      },
    )
  }

  stop(): void {
    this.live = false
  }
}
