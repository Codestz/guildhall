import { type Change, emptyModel, type Session } from "@guildhall/core"
import { MOODS, type Mood } from "../world/moods.ts"
import type { Names } from "./casting.ts"
import { Director, type DirectorStyle, type Place } from "./director.ts"
import { DEFAULT_SETTINGS, type Environment, type EnvironmentSettings, environmentOf } from "./environment.ts"
import type { Feed, FeedSink } from "./feeds/feed.ts"
import { DEFAULT_HUB, LiveFeed, SERVING_HUB } from "./feeds/live.ts"
import type { ScenarioId, StoryChapter } from "./feeds/scenarios.ts"
import { SimFeed } from "./feeds/sim.ts"
import { FOCUS_TTL_MS, type Focus, focusAfter, Intake } from "./intake.ts"
import type { LogEntry, Marker } from "./log.ts"
import { MODE } from "./mode.ts"
import { MomentStream } from "./moments.ts"
import { ChapterCards } from "./pacing.ts"
import { type Party, stageOf } from "./parties.ts"
import { SeaTeller, type Sighting } from "./sea.ts"
import { islandSessions, Stage } from "./stage.ts"
import { type Traces, tracesOf } from "./traces.ts"
import { Undead } from "./undead.ts"
import { type AdventurerView, partyOf, progressOf } from "./views.ts"

export {
  AVENUE_END,
  DAIS_SPREAD,
  type Entrance,
  EXIT_MS,
  entranceOf,
  exitOf,
  ROAD_SPREAD,
} from "./entrances.ts"
export { DEFAULT_HUB, LIVE_MS, liveUrlOf, SERVING_HUB } from "./feeds/live.ts"
export { RUSH, SCENARIOS, type ScenarioId, type StoryChapter } from "./feeds/scenarios.ts"
export type { Focus } from "./intake.ts"
export { chapterLabel, type LogEntry, type Marker } from "./log.ts"
export { numbered, ordinalOf, roman } from "./ordinals.ts"
export type { Sighting } from "./sea.ts"
export { type AdventurerView, type Phase, partyOf, type Seat, viewsOf } from "./views.ts"

/**
 * The hall's single source of truth: a feed (guild/feeds, ADR 0012) — a told story or the hub —
 * hands changes to the intake (guild/intake.ts), and the store turns the model into what each
 * adventurer should be doing *now* (`AdventurerView`, guild/views.ts). The scene and the HUD only
 * read the store's fields; `refresh` is the one place they are derived.
 */
export class GuildStore {
  scenario: ScenarioId = "party"
  mood: Mood = MOODS.keep
  bard = true
  /** Diorama: the orthographic tabletop. Explore: a perspective camera that can go low and close. */
  view: "diorama" | "explore" = "diorama"
  /** Who is on stage. A new array every refresh, but an unchanged adventurer keeps its object (`viewsOf`). */
  views: AdventurerView[] = []
  /** Counts history rebuilds (a seek, a restart, a load): the stage forgets who was leaving. */
  rebuilds = 0
  /**
   * The parties on the island (guild/parties.ts), the dais's first: one per conversation, at most
   * MAX_PARTIES. One party is the hall as it always was.
   */
  parties: Party[] = []
  /**
   * The party the viewer follows (its root session id), or null for all of them. Following one, the
   * others still live on the island, but the camera, captions, roster and weather are about this one.
   */
  following: string | null = null
  focus: Focus | null = null
  /** Run time of the newest event: lets the Bard tell a quiet guild from a busy one. */
  lastEventAt = 0
  /** The adventurer the viewer picked (side panel open, camera follows). */
  selected: string | null = null
  /** Typed joins, quests, deeds, failures, loot, pleas and departures (guild/moments.ts, ADR 0008). */
  readonly moments = new MomentStream()
  markers: Marker[] = []
  /**
   * The graveyard's undead (guild/undead.ts): fed live moments as they are made and the fallen on
   * every refresh, so a seek re-stands them without a single rise.
   */
  readonly undead = new Undead()
  /**
   * The Bard's director (guild/director.ts, roadmap S4): scores live moments and hints, picks shots.
   * Anything can ask it to look: `store.director.hint(subject, weight, ttlMs)`.
   */
  readonly director = new Director()
  /** Calm: the original gentle Bard. Cinematic: Director v2 (and replay fast-forward). */
  directorStyle: DirectorStyle = "cinematic"
  /**
   * Replay fast-forward: the multiple on top of the viewer's pace, 1 unless a quiet stretch of a
   * replay is being skipped (eased up to FF_MAX and back before the next beat).
   */
  fastForward = 1
  /** Completed edits/writes this run: the yard's building grows with it. */
  progress = 0
  /** What finished work has left at each job site (logs, stone, fish, books, arrows). */
  traces: Traces = tracesOf([])
  /** The world's conditions: time of day, weather, temperature (ADR 0007). */
  /** The showcase plays a story's own hours (the Saga's dawn to night); the app the viewer's clock. */
  environmentSettings: EnvironmentSettings = {
    ...DEFAULT_SETTINGS,
    ...(MODE === "showcase" ? { time: "story" as const } : {}),
  }
  /** The chapters of the story being played (run time), empty for a story without acts or live. */
  chapters: StoryChapter[] = []
  /**
   * The sea (scene/seas): what happened on GitHub to the guild's project, oldest first, each event
   * once. A told story's whole sea is known from its start, and the scene shows what `time` has
   * reached; live, it is what the hub has sent since the page opened (hellos included).
   */
  sea: Sighting[] = []
  environment: Environment = environmentOf({
    wallClock: Date.now(),
    runTime: 0,
    runStart: 0,
    model: emptyModel(),
    settings: DEFAULT_SETTINGS,
  })
  /** Live: whether the hub is connected, and the guild being followed. */
  connected = false
  guild = ""
  /**
   * A framing asked for (a deep link's `look`, guild/deeplink.ts): scene/CameraRig.tsx puts the
   * camera on it once, the next frame, then it is the viewer's again. `n` tells a new ask from the
   * last one. The Bard lets go: it would fly straight off again.
   */
  framing: (Place & { n: number }) | null = null
  /**
   * Run time the story starts from when the showcase's reveal begins (scene/OpeningCue.tsx): 0, or
   * a deep link's `t` / `act`, so a shared moment survives the opening.
   */
  startAt = 0

  private readonly intake = new Intake(this.moments)
  private readonly stage = new Stage(this.director, this.moments, this.undead)
  /** The sea's moments, told for the party the hall is about. */
  private readonly told = new SeaTeller(
    this.moments,
    () => this.focalParty?.id ?? partyOf(this.model)[0]?.id ?? "",
  )
  private readonly cards = new ChapterCards()
  private feed!: Feed
  private readonly sink: FeedSink = {
    state: this,
    take: (change, live, guild) => this.take(change, live, guild),
    reset: (continued) => this.reset(continued),
    refresh: () => this.refresh(),
    emit: () => this.emit(),
    tellSea: (to, live) => this.told.tell(this.sea, to, live),
    turn: (from, to) => this.cards.turn(this.chapters, from, to),
  }
  private listeners = new Set<() => void>()
  private version = 0
  private sinceViews = 0
  /** Real time the hall has run (ms): the graveyard's animations keep it, paused story or not. */
  private realTime = 0
  /** The viewer's pace (Settings → Pace). */
  private pace = 1
  private framings = 0
  private held = false

  constructor() {
    this.moments.on((moment) => {
      this.undead.take(moment)
      this.director.take(moment)
    })
    this.moments.onRebuild(() => {
      this.undead.rebuild()
      this.director.rebuild()
    })
    this.load("party")
  }

  /** "sim": playing a scenario. "live": following the hub (real OpenCode sessions). */
  get mode(): Feed["kind"] {
    return this.feed.kind
  }
  get now(): number {
    return this.feed.now()
  }
  get time(): number {
    return this.feed.time()
  }
  get duration(): number {
    return this.feed.duration()
  }
  /** The viewer's pace: what the replay runs at when not fast-forwarding. */
  get speed(): number {
    return this.pace
  }
  /** Newest last, at most LOG_SIZE (guild/log.ts). */
  get log(): LogEntry[] {
    return this.intake.log
  }
  /**
   * How the cast is named (guild/casting.ts; Settings → Names). A told story is rebuilt where it
   * stands, so the log, captions and Legends say the new names too; live, the views take them at
   * once and lines written from now on.
   */
  get names(): Names {
    return this.intake.names
  }
  private get model() {
    return this.intake.model
  }

  /** Follow the hub (ADR 0003, guild/feeds/live.ts). */
  live(url = SERVING_HUB ?? DEFAULT_HUB): void {
    this.use(new LiveFeed(url))
  }

  /** Play a told story (guild/feeds/sim.ts). */
  load(scenario: ScenarioId): void {
    this.use(new SimFeed(scenario))
  }

  /** One feed at a time: the one before is stopped (a socket closed) before the next starts. */
  private use(feed: Feed): void {
    this.feed?.stop()
    this.feed = feed
    feed.start(this.sink)
  }

  select(id: string | null): void {
    this.selected = id
    this.emit()
  }

  /** The full session behind an adventurer: its task, entries (transcript), tokens. */
  sessionOf(id: string): Session | undefined {
    return this.model.sessions.get(id)
  }

  /**
   * A party's sessions (guildmaster first by join), for the Legends book (guild/legends.ts) and the
   * world events: the one asked for, else the followed one, else the newest (the hall's focus).
   */
  party(id?: string): Session[] {
    const wanted = id ?? this.following
    const found =
      wanted !== null && wanted !== undefined ? this.parties.find((p) => p.id === wanted) : undefined
    if (found) return found.sessions
    return this.parties.find((p) => p.newest)?.sessions ?? partyOf(this.model)
  }

  /** The party the hall is about: the followed one, else the newest. */
  get focalParty(): Party | undefined {
    return this.parties.find((p) => p.id === this.following) ?? this.parties.find((p) => p.newest)
  }

  /** Follow one party (its root session id), or null for all (the HUD's party switcher). */
  follow(id: string | null): void {
    this.following = id !== null && this.parties.some((p) => p.id === id) ? id : null
    // Someone picked in another party is let go: the camera is about the followed party now.
    if (
      this.following &&
      this.selected &&
      this.views.find((v) => v.id === this.selected)?.party !== this.following
    )
      this.selected = null
    this.director.restart()
    this.refresh()
  }

  /** Is this session in the party being followed (always, when following all)? */
  inFocus(id: string): boolean {
    if (this.following === null) return true
    return this.views.find((v) => v.id === id)?.party === this.following
  }

  setSpeed(speed: number): void {
    this.pace = speed
    this.feed.paced?.()
    this.emit()
  }

  /** Calm or Cinematic (Settings → Director). */
  setDirector(style: DirectorStyle): void {
    this.directorStyle = style
    this.director.restart()
    this.emit()
  }

  /** Who the Bard is filming now, for the roster's "on camera" mark. */
  get onCamera(): string | undefined {
    if (!this.bard || this.selected) return undefined
    return this.directorStyle === "cinematic" ? this.director.shot.id : this.focus?.id
  }

  setMood(id: Mood["id"]): void {
    this.mood = MOODS[id]
    this.emit()
  }

  /** Change how time and weather are chosen (HUD levers). */
  setEnvironment(settings: Partial<EnvironmentSettings>): void {
    this.environmentSettings = { ...this.environmentSettings, ...settings }
    this.refresh()
  }

  setView(view: "diorama" | "explore"): void {
    this.view = view
    this.emit()
  }

  frame(place: Place | null): void {
    this.framing = place ? { ...place, n: ++this.framings } : null
    if (place) this.bard = false
    this.emit()
  }

  setNames(names: Names): void {
    if (names === this.names) return
    this.intake.rename(names)
    if (this.feed.seek) this.feed.seek(this.time)
    else this.refresh()
  }

  setBard(on: boolean): void {
    // Handed back: the director takes a fresh look rather than resuming a stale shot.
    if (on && !this.bard) this.director.restart()
    this.bard = on
    this.emit()
  }

  /** Rebuild the story up to run time `time` (a told story; live has no history to seek). */
  seek(time: number): void {
    this.feed.seek?.(time)
  }

  /** Called every frame with real elapsed ms. */
  tick(realMs: number): void {
    this.realTime += realMs
    this.director.now = this.realTime
    const moved = this.feed.tick(realMs)
    this.sinceViews += realMs
    if (moved || this.sinceViews > 100) this.refresh()
  }

  /** The chapter playing now (the last begun), or undefined before the first or without chapters. */
  get chapter(): StoryChapter | undefined {
    return this.chapters.findLast((c) => c.at <= this.time)
  }

  /** Jump to a chapter's start: its title card is told as it begins (`onChapter`). */
  seekChapter(index: number): void {
    const chapter = this.chapters[index]
    if (chapter) this.seek(chapter.at)
  }

  /**
   * Called as a chapter begins while the hall watches (played into, or jumped to its start), never
   * for one a seek passes over: the captions' title card between acts. Returns the unsubscribe.
   */
  onChapter(listener: (chapter: StoryChapter) => void): () => void {
    return this.cards.on(listener)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): number => this.version

  private reset(continued = false): void {
    this.intake.reset()
    this.focus = null
    this.lastEventAt = 0
    this.progress = 0
    this.stage.forget()
    this.rebuilds++
    this.cards.forget()
    this.told.forget()
    this.moments.rebuild(continued)
  }

  private take(change: Change, live: boolean, guild?: string): boolean {
    const red = this.intake.take(change, live, this.feed.origin(), guild)
    if (!live) return red
    this.lastEventAt = this.time
    this.focus = focusAfter(this.focus, change, red, this.model, this.following)
    return red
  }

  private refresh(): void {
    this.sinceViews = 0
    if (this.focus && this.now - this.focus.at > FOCUS_TTL_MS) this.focus = null
    const guilds = this.intake.guilds
    this.parties = stageOf(this.model, this.now, (id) => guilds.get(id))
    if (this.following !== null && !this.parties.some((p) => p.id === this.following)) this.following = null
    // The world shows the parties on stage, not every guild the hub has heard from.
    const parties = this.parties
    this.views = this.stage.refresh(parties, {
      model: this.model,
      now: this.now,
      origin: this.feed.origin(),
      news: (when, now) => this.feed.news(when, now),
      previous: this.views,
      names: this.names,
      realTime: this.realTime,
      actorOf: (s) => this.intake.actorOf(s),
    })
    const all = parties.flatMap((p) => p.sessions)
    // Traces are things on the shared sites (logs on the pile, the yard's building): every party's
    // work leaves them, whoever is followed, so switching parties never empties a pile — nor does a
    // party going home (review-2 #11): they count every session of the island's guild, on stage or not.
    const worked = islandSessions(this.model, parties, this.intake.guilds)
    this.progress = progressOf(worked)
    this.traces = tracesOf(worked)
    // The weather is the mood of the story being told: all parties together, or the followed one.
    const followed = parties.find((p) => p.id === this.following)
    const told = followed ? followed.sessions : all
    this.environment = environmentOf({
      wallClock: Date.now(),
      runTime: this.time,
      runStart: this.feed.origin(),
      model: { sessions: new Map(told.map((s) => [s.id, s])) },
      settings: this.environmentSettings,
      ...(this.feed.hours.length > 0 ? { story: this.feed.hours } : {}),
    })
    // The director films the followed party only; with all, everyone on stage.
    this.director.scope = followed ? new Set(followed.sessions.map((s) => s.id)) : null
    this.emit()
  }

  private emit(): void {
    this.version++
    if (this.held) return
    for (const listener of this.listeners) listener()
  }

  /**
   * Hold notifications while the world is first built (scene/Scene.tsx releases them once it has
   * mounted). Mounting the world is one long, interruptible render, and every notification is an
   * urgent update that restarts it: at ~10 a second, on a slow phone or a busy machine the island
   * never finished mounting — an empty sky, forever (measured: 15 completed loads, 0 mounts).
   */
  hold(): void {
    this.held = true
  }
  release(): void {
    if (!this.held) return
    this.held = false
    this.emit()
  }
}
