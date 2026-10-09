import type { Change, GuildEvent } from "@guildhall/core"
import { Player, toEvents } from "@guildhall/sim"
import { beatTimes, FF_CALM_BELOW } from "../director.ts"
import type { StoryHour } from "../environment.ts"
import { chapterLabel, type Marker, markerOf } from "../log.ts"
import { fastForwardAt, pleading } from "../pacing.ts"
import { sightingsOf } from "../sea.ts"
import type { Feed, FeedSink } from "./feed.ts"
import { SCENARIOS, type ScenarioId, type Told } from "./scenarios.ts"

/**
 * A told story (guild/feeds/scenarios.ts) played by the sim's `Player`, looping: its chapters,
 * story hours and sea known from the start, a timeline that can be sought, and the replay's
 * fast-forward through quiet stretches.
 */
export class SimFeed implements Feed {
  readonly kind = "sim"
  readonly hours: StoryHour[]
  private readonly events: GuildEvent[]
  private readonly player: Player
  private readonly tale: Exclude<Told, Change[]>
  /** Run times (ms, sorted) a fast-forward slows down for: quests, pleas, failures, loot, the end. */
  private beats: number[] = []
  private sink!: FeedSink

  constructor(readonly scenario: ScenarioId) {
    const told = SCENARIOS[scenario]()
    this.tale = Array.isArray(told) ? { changes: told, chapters: [], hours: [] } : told
    this.events = toEvents(this.tale.changes, "demo")
    this.player = new Player(this.events, { loop: true })
    const start = this.origin()
    this.hours = this.tale.hours.map((h) => ({ ...h, at: h.at - start }))
  }

  now(): number {
    return (this.events[0]?.change.at ?? 0) + this.player.time
  }
  time(): number {
    return this.player.time
  }
  duration(): number {
    return this.player.duration
  }
  origin(): number {
    return this.events[0]?.change.at ?? 0
  }
  news(): boolean {
    return true
  }

  start(sink: FeedSink): void {
    this.sink = sink
    const { state } = sink
    state.connected = false
    state.scenario = this.scenario
    state.fastForward = 1
    this.player.speed = state.speed
    const start = this.origin()
    state.chapters = this.tale.chapters.map((c) => ({ ...c, at: c.at - start }))
    state.sea = sightingsOf(this.tale.sea ?? [], start)
    state.markers = [
      ...state.chapters.map((c): Marker => ({ at: c.at, kind: "chapter", label: chapterLabel(c) })),
      ...this.events.flatMap(({ change }) => {
        const kind = markerOf(change)
        return kind ? [{ at: change.at - start, kind }] : []
      }),
    ]
    // A fast-forward slows for the sea's news too: every sea event but CI's in-between states.
    const sea = state.sea.filter(
      ({ event }) => event.kind !== "ci" || event.state === "failed" || event.state === "passed",
    )
    this.beats = beatTimes(
      [...state.markers, ...sea.map(({ at }) => ({ at, kind: "sea" }))],
      this.player.duration,
    )
    state.selected = null
    sink.reset()
    sink.emit()
  }

  stop(): void {}

  tick(realMs: number): boolean {
    this.pace(realMs)
    const sink = this.sink
    const was = this.player.time
    const { events, restarted } = this.player.tick(realMs)
    if (restarted) sink.reset()
    for (const event of events) sink.take(event.change, true)
    sink.tellSea(this.player.time, true)
    sink.turn(restarted ? -1 : was, this.player.time)
    return events.length > 0 || restarted
  }

  seek(time: number): void {
    const sink = this.sink
    sink.state.fastForward = 1
    this.player.speed = sink.state.speed
    sink.reset()
    for (const event of this.player.seek(time)) sink.take(event.change, false)
    sink.tellSea(this.player.time, false)
    sink.refresh()
  }

  paced(): void {
    this.player.speed = this.sink.state.speed * this.sink.state.fastForward
  }

  /**
   * Replay fast-forward (roadmap S4, Gource's auto-skip): with the Cinematic director filming, a
   * quiet stretch speeds up smoothly to FF_MAX and is back at 1× before the next beat. Only the
   * Player's clock moves faster: moments are made exactly as at 1× (live, one each), so ravens,
   * sound, sigils and captions see the same stream, just sooner.
   */
  private pace(realMs: number): void {
    const { state } = this.sink
    const was = state.fastForward
    state.fastForward = fastForwardAt({
      was,
      time: this.player.time,
      duration: this.player.duration,
      beats: this.beats,
      enabled: state.directorStyle === "cinematic" && state.bard && !state.selected && state.speed > 0,
      busy: pleading(state.views) || state.director.excitement() >= FF_CALM_BELOW,
      realMs,
    })
    this.player.speed = state.speed * state.fastForward
    // The indicator appears and goes on the store's change, not every eased step.
    if (was > 1.05 !== state.fastForward > 1.05) this.sink.emit()
  }
}
