/**
 * What the home's session plays (the site's `/`): the demo guild (Claude, Warden and Scout on their errands,
 * the same wire the island's life always told), or a told story (`?story=`, sim `story(id)`). One feed for
 * both, switchable in place: a story picked from the demos replaces what plays without rebuilding the
 * island (the session starts the log over, and the heroes' desk with it).
 */
import { STORY_IDS, type StoryId } from "@guildhall/sim"
import type { Feed, FeedChapter, FeedHero, FeedKind, FeedSink, FeedStatus } from "../hall/feeds/feed.ts"
import { STORY_EPOCH, StoryFeed } from "../hall/feeds/story.ts"
import { DEMO_AGENTS, demoStory } from "../hexworld/lifeAgents.ts"

/** The site's own picks: the demo guild, or one of sim's stories. */
export type HomeStory = "demo" | StoryId

/** The story a `?story=` names on the home: a told one by its id, else the demo guild. */
export function homeStoryOf(asked: string | null): HomeStory {
  const id = (STORY_IDS as readonly string[]).find((s) => s === asked)
  return id ? (id as StoryId) : "demo"
}

export class HomeFeed implements Feed {
  readonly kind: FeedKind = "story"
  private sink: FeedSink | null = null
  private state: FeedStatus = "offline"
  private told: StoryFeed | null = null
  /** The playing story's acts, at ms from its start (none for the demo guild). */
  chapters: readonly FeedChapter[] = []

  constructor(private pick: HomeStory) {}

  get name(): string {
    return this.told?.name ?? "The guild"
  }

  /** The demo guild names its heroes: Claude the mage, Warden the knight, Scout the ranger. */
  get cast(): readonly FeedHero[] | undefined {
    return this.pick === "demo" ? DEMO_AGENTS : undefined
  }

  status(): FeedStatus {
    return this.state
  }

  start(sink: FeedSink): void {
    this.sink = sink
    this.tell()
  }

  /** Plays another story from its start. */
  switchTo(pick: HomeStory): void {
    this.pick = pick
    if (this.sink) this.tell()
  }

  private tell(): void {
    const sink = this.sink
    if (!sink) return
    this.told?.stop()
    this.told = null
    if (this.pick !== "demo") {
      this.told = new StoryFeed(this.pick, {})
      this.told.start({
        reset: () => sink.reset(),
        take: (input, news) => sink.take(input, news),
        loaded: () => sink.loaded?.(),
        status: (status, why) => sink.status(status, why),
        chapters: (list) => {
          this.chapters = list
          sink.chapters?.(list)
        },
      })
      this.state = "replay"
      return
    }
    sink.reset()
    for (const event of demoStory())
      sink.take({ ...event, change: { ...event.change, at: event.change.at + STORY_EPOCH } }, false)
    this.chapters = []
    sink.chapters?.([])
    sink.loaded?.()
    this.state = "replay"
    sink.status("replay")
  }

  stop(): void {
    this.told?.stop()
    this.sink = null
  }
}
