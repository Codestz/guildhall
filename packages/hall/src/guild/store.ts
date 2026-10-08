import {
  activityOf,
  apply,
  type Change,
  emptyModel,
  failedDeed,
  type GuildEvent,
  isSeaRecord,
  type Model,
  rootOf,
  type SeaEvent,
  type SeaRecord,
  type Session,
} from "@guildhall/core"
import { type DeedLook, deedLook, interestOf, roleOf } from "@guildhall/roster"
import {
  type Chapter,
  factions,
  Player,
  parties,
  party,
  rush,
  sagaTale,
  seas,
  solo,
  type Tale,
  toEvents,
} from "@guildhall/sim"
import { type Traces, tracesOf } from "../scene/life/traces.ts"
import type { SiteId } from "../world/lands.ts"
import {
  HAND_IN,
  HAND_INS,
  HEARTH,
  HEARTH_SEATS,
  hearthSeat,
  type Post,
  type Seat,
  type Spot,
  STATIONS,
  type StationId,
  TAVERN,
} from "../world/layout.ts"
import { MOODS, type Mood } from "../world/moods.ts"
import { sitesOf } from "../world/siteMap.ts"
import { destinationOf, FATES, type Fates, SITE_DEFS, siteOf } from "../world/sites.ts"
import { Crowd } from "./crowd.ts"
import {
  beatTimes,
  Director,
  type DirectorStyle,
  easeSpeed,
  FF_CALM_BELOW,
  fastForwardGoal,
  MIN_SHOT_MS,
  type Place,
} from "./director.ts"
import {
  DEFAULT_SETTINGS,
  type Environment,
  type EnvironmentSettings,
  environmentOf,
  type StoryHour,
} from "./environment.ts"
import { MODE, SERVED } from "./mode.ts"
import { type Actor, before, happenings, MomentStream } from "./moments.ts"
import { Ordinals } from "./ordinals.ts"
import { byJoin, PARTY_IDLE_MS, type Party, stageOf } from "./parties.ts"
import { RISE_MS, Undead } from "./undead.ts"

export type { Seat }

/**
 * The hall's single source of truth: a Player feeds `GuildEvent`s into cockpit's model, and the
 * store turns the model into what each adventurer should be doing *now* (`AdventurerView`).
 * The scene only reads views; it never looks at raw changes.
 */

/** How many adventurers `rush` sends out (unset: the story's own 12); a deep link's `n` sets it. */
export const RUSH: { count?: number } = {}

/** How long the seas story holds after its release, so the galleon is seen arriving (scene/seas). */
const SEAS_HOLD_MS = 30_000

/** A story as told: its changes alone, or with acts and hours, and the GitHub sea beside it. */
type Told = Change[] | (Tale & { sea?: readonly SeaEvent[] })

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
    // The release is the story's last word: hold the scene a while (one quiet step on the
    // guildmaster) so its galleon sails in and anchors before the replay loops.
    const last = changes.at(-1)
    const master = changes[0]
    const hold: Change[] = last && master ? [{ type: "step", id: master.id, at: last.at + SEAS_HOLD_MS }] : []
    return { changes: [...changes, ...hold], chapters: [], hours: [], sea }
  },
}
export type ScenarioId = keyof typeof SCENARIOS

/** A chapter of the story being played (the Saga's acts), at run time `at` (ms). */
export type StoryChapter = Chapter

/** Something that happened on GitHub to the guild's project (PROTOCOL.md §7), at run time `at` (ms). */
export interface Sighting {
  event: SeaEvent
  at: number
}

/** The hub a hall follows unless told otherwise (ADR 0003). */
export const DEFAULT_HUB = "ws://127.0.0.1:4747/ws"

/** The hub that served this page, when the hall was built to be served by one (mode.ts SERVED). */
export const SERVING_HUB: string | null =
  SERVED && typeof location !== "undefined" ? `ws://${location.host}/ws` : null

/**
 * The hub a page's query asks for: null without `?live`; `?live=<url>` only for a hub on this
 * machine (ws://localhost or ws://127.0.0.1, any port) unless `&anyhub=1` says otherwise — a link
 * must not be able to point the hall at someone else's stream. Anything else is the default hub.
 * A hall served by a hub (`serving`) follows it without being asked, and it is the default; the
 * stories stay a click away in Settings.
 */
export function liveUrlOf(search: string, serving: string | null = SERVING_HUB): string | null {
  const fallback = serving ?? DEFAULT_HUB
  const params = new URLSearchParams(search)
  const asked = params.get("live")
  if (asked === null) return serving
  if (!asked) return fallback
  if (params.get("anyhub") === "1") return asked
  try {
    const url = new URL(asked)
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
    return url.protocol === "ws:" && local ? asked : fallback
  } catch {
    return fallback
  }
}

export type Phase = "working" | "waiting" | "loot" | "resting" | "leaving" | "idle" | "failed"

export interface AdventurerView {
  id: string
  /** OpenCode agent name (`guild-implementer`). */
  agent: string
  /** What the hall calls them: the role, numbered when it repeats (`Implementer II`). */
  title: string
  /** The role's own name, never numbered (`Implementer`): sigils take their letters from it. */
  role: string
  /** 1 for the first of a role in the party, 2 for the second to join, …; stable while the session lasts. */
  ordinal: number
  color: string
  /** Character model key (roster). */
  character: string
  master: boolean
  phase: Phase
  /** Where they should be and which way they face there. The scene walks them to it. */
  target: Post
  /** What they sit or lie on when they get there. */
  seat?: Seat
  /** The station they are working at, when they are at one: lights its lamp. */
  station?: StationId
  /** The island job site they work at (ADR 0006), instead of a station. */
  site?: SiteId
  /** Failed: where they were sent (a key of world/sites.ts `DESTINATIONS`). */
  destination?: string
  /** The deed in progress, if any. */
  look?: DeedLook
  /** Its tool name, as OpenCode spells it. */
  tool?: string
  thinking: boolean
  /** One line under the name: `edit · routes.ts`. */
  doing: string
  /** Speech or thought, when there is something to say. */
  bubble?: string
  /** A deed just failed: stumble + red puff. */
  stung: boolean
  /** Their party: its guildmaster's (root) session id ("" with no root heard of). */
  party: string
  /** Their party's banner colour (guild/parties.ts BANNERS). */
  banner: string
  /**
   * A newcomer who joined as the hall watched (not one rebuilt by a seek or a load): where they
   * appear and how. Read once, when their figure mounts (scene/Adventurer.tsx).
   */
  enter?: Entrance
}

/**
 * How a newcomer comes on stage. `gate`: from out on the avenue, walking in through the keep's
 * gate (a new conversation's guildmaster, anyone with no guildmaster on stage to send them).
 * `dais`: summoned at their guildmaster's side, where loot is handed in, facing them, as the
 * guildmaster casts the summon (Ranged_Magic_Summon while a task is being sent).
 */
export interface Entrance {
  kind: "gate" | "dais"
  at: Post
}

/**
 * Down the avenue from the keep's gate (the road hex at z 30, one and three-quarter hexes past the
 * wall): newcomers from afar appear here, and leavers walk here and dissolve. On the road graph
 * (world/paths.ts), clear of the stalls, the well and the festival's poles (test/arrivals.test.ts).
 */
export const AVENUE_END: Spot = [0, 30]
/** Two who come or go together don't walk inside each other: each keeps to their own side, ±this. */
export const ROAD_SPREAD = 1
/** Summoned together, each appears up to this far either side of the hand-in spot. */
export const DAIS_SPREAD = 0.6
/** After GONE_MS, a leaver still walks down the avenue this long before the stage lets them go. */
export const EXIT_MS = 7000

/** One line of the guild chronicle, for the HUD's feed. */
export interface LogEntry {
  key: number
  /** Run time, ms. */
  at: number
  id: string
  title: string
  color: string
  kind: "join" | "quest" | "deed" | "fail" | "plea" | "loot" | "thought"
  text: string
  /** Their party (root session id). */
  party: string
}

/** An interesting moment on the timeline (run time, ms), for scrubber ticks. */
export interface Marker {
  at: number
  kind: "quest" | "fail" | "plea" | "loot" | "walk" | "chapter"
  /** A chapter's name: `Act III — The storm`. */
  label?: string
}

/** A chapter as its title card and tick name it: `Act III — The storm`. */
export function chapterLabel(chapter: Pick<Chapter, "numeral" | "title">): string {
  return `Act ${chapter.numeral} — ${chapter.title}`
}

export interface Focus {
  id: string
  score: number
  at: number
}

const LOOT_MS = 3500
/** Done adventurers rest in the tavern this long (run time) before leaving by the gate. */
const REST_MS = 22_000
const GONE_MS = 27_000
const HOLD_MS = 4000
const FOCUS_TTL_MS = 9000
const LOG_SIZE = 80
/** Live: a change older than this when it arrives is backlog, applied quietly rather than as news. */
export const LIVE_MS = 5000

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
  /** Newest last, at most LOG_SIZE. */
  log: LogEntry[] = []
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
  /** The story's own clock (environment.ts time mode "story"). */
  private hours: StoryHour[] = []
  environment: Environment = environmentOf({
    wallClock: Date.now(),
    runTime: 0,
    runStart: 0,
    model: emptyModel(),
    settings: DEFAULT_SETTINGS,
  })

  private model: Model = emptyModel()
  private player!: Player
  private events: GuildEvent[] = []
  private listeners = new Set<() => void>()
  private version = 0
  private sinceViews = 0

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

  /** Real time the hall has run (ms): the graveyard's animations keep it, paused story or not. */
  private realTime = 0

  /** "sim": playing a scenario. "live": following the hub (real OpenCode sessions). */
  mode: "sim" | "live" = "sim"
  /** Live: whether the hub is connected, and the guild being followed. */
  connected = false
  guild = ""
  private liveStart = 0
  private socket: WebSocket | undefined

  get now(): number {
    return this.mode === "live" ? Date.now() : (this.events[0]?.change.at ?? 0) + this.player.time
  }
  get time(): number {
    return this.mode === "live" ? Date.now() - this.liveStart : this.player.time
  }
  get duration(): number {
    return this.mode === "live" ? this.time : this.player.duration
  }
  /** Run time 0 in ms since the epoch: the first event's `at`. */
  private get start(): number {
    return this.mode === "live" ? this.liveStart : (this.events[0]?.change.at ?? 0)
  }

  /**
   * Follow the hub (ADR 0003): a hello with everything so far, then events as they happen.
   * Reconnects with backoff, so the hall can be opened before OpenCode or the hub.
   */
  live(url = SERVING_HUB ?? DEFAULT_HUB): void {
    // One socket at a time: a second call replaces the first rather than doubling every event.
    const previous = this.socket
    this.socket = undefined
    previous?.close()
    this.mode = "live"
    this.reset()
    this.markers = []
    this.chapters = []
    this.hours = []
    this.sea = []
    this.liveStart = Date.now()
    let delay = 500
    const open = () => {
      const socket = new WebSocket(url)
      this.socket = socket
      socket.onopen = () => {
        delay = 500
        this.connected = true
        this.emit()
      }
      socket.onmessage = (message) => {
        if (this.socket !== socket) return
        const data = messageOf(message.data)
        if (!data) return
        if (data.type === "hello") {
          // A fresh hello (a reconnect, a hub restart) is everything so far: start over, markers too.
          // The same run goes on: what was news already (a world event) is not news again.
          this.reset(true)
          this.markers = []
          this.seen.clear()
          this.liveStart = data.events[0]?.change.at ?? Date.now()
          for (const event of data.events) if (this.fresh(event)) this.take(event.change, false, event.guild)
          this.sight(data.sea)
        } else if (data.type === "sea") {
          this.sight(data.sea)
          this.emit()
          return
        } else {
          // A change older than LIVE_MS is backlog (the herald's courier flushing its queue after a
          // hub restart, review-2 #10): applied, but history, not news — no burst of ravens and cues.
          const now = Date.now()
          for (const event of data.events)
            if (this.fresh(event)) this.take(event.change, now - event.change.at <= LIVE_MS, event.guild)
        }
        const last = data.events.at(-1)
        if (last) this.guild = last.guild
        this.refresh()
      }
      socket.onclose = () => {
        if (this.socket !== socket) return
        this.connected = false
        this.emit()
        // Reconnect unless live() or load() moved on while we waited.
        delay = Math.min(delay * 2, 10_000)
        setTimeout(() => {
          if (this.socket === socket) open()
        }, delay)
      }
    }
    open()
  }

  /**
   * Live: sea records from the hub, each event once (a hello repeats what was already sent). Run time
   * is reckoned from `liveStart`, which a hello may move, so every sighting is re-dated.
   */
  private sight(records: readonly SeaRecord[]): void {
    const known = new Set(this.sea.map((s) => s.event.id))
    const events = [...this.sea.map((s) => s.event)]
    for (const { event } of records)
      if (!known.has(event.id)) {
        known.add(event.id)
        events.push(event)
      }
    this.sea = sightingsOf(events, this.liveStart)
  }

  /** Live: the last seq taken per guild, since the last hello. */
  private seen = new Map<string, number>()

  /** False for an event already taken (a repeat after a reconnect): applied twice, it would count twice. */
  private fresh(event: GuildEvent): boolean {
    if (event.seq <= (this.seen.get(event.guild) ?? 0)) return false
    this.seen.set(event.guild, event.seq)
    return true
  }
  /** The viewer's pace (Settings → Pace): what the replay runs at when not fast-forwarding. */
  get speed(): number {
    return this.pace
  }
  private pace = 1
  /** Run times (ms, sorted) a fast-forward slows down for: quests, pleas, failures, loot, the end. */
  private beats: number[] = []
  /** The graveyard rise last handed to the director as a hint. */
  private glanced = -1

  load(scenario: ScenarioId): void {
    if (this.mode === "live") {
      const socket = this.socket
      this.socket = undefined
      socket?.close()
      this.mode = "sim"
      this.connected = false
    }
    this.scenario = scenario
    const told = SCENARIOS[scenario]()
    const tale: Exclude<Told, Change[]> = Array.isArray(told)
      ? { changes: told, chapters: [], hours: [] }
      : told
    this.events = toEvents(tale.changes, "demo")
    this.player = new Player(this.events, { loop: true })
    this.fastForward = 1
    this.player.speed = this.pace
    const start = this.events[0]?.change.at ?? 0
    this.chapters = tale.chapters.map((c) => ({ ...c, at: c.at - start }))
    this.hours = tale.hours.map((h) => ({ ...h, at: h.at - start }))
    this.sea = sightingsOf(tale.sea ?? [], start)
    this.markers = [
      ...this.chapters.map((c): Marker => ({ at: c.at, kind: "chapter", label: chapterLabel(c) })),
      ...this.events.flatMap(({ change }) => {
        const kind = markerOf(change)
        return kind ? [{ at: change.at - start, kind }] : []
      }),
    ]
    this.beats = beatTimes(this.markers, this.player.duration)
    this.selected = null
    this.reset()
    this.emit()
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
    this.player.speed = speed * this.fastForward
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
  private framings = 0
  frame(place: Place | null): void {
    this.framing = place ? { ...place, n: ++this.framings } : null
    if (place) this.bard = false
    this.emit()
  }

  setBard(on: boolean): void {
    // Handed back: the director takes a fresh look rather than resuming a stale shot.
    if (on && !this.bard) this.director.restart()
    this.bard = on
    this.emit()
  }

  seek(time: number): void {
    this.fastForward = 1
    this.player.speed = this.pace
    this.reset()
    for (const event of this.player.seek(time)) this.take(event.change, false)
    this.refresh()
  }

  /** Called every frame with real elapsed ms. */
  tick(realMs: number): void {
    this.realTime += realMs
    this.director.now = this.realTime
    if (this.mode === "live") {
      this.fastForward = 1
      this.sinceViews += realMs
      if (this.sinceViews > 100) this.refresh()
      return
    }
    this.paceReplay(realMs)
    const was = this.player.time
    const { events, restarted } = this.player.tick(realMs)
    if (restarted) this.reset()
    for (const event of events) this.take(event.change, true)
    this.turn(restarted ? -1 : was, this.player.time)
    this.sinceViews += realMs
    if (events.length > 0 || restarted || this.sinceViews > 100) this.refresh()
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

  private chapterListeners = new Set<(chapter: StoryChapter) => void>()

  /**
   * Called as a chapter begins while the hall watches (played into, or jumped to its start), never
   * for one a seek passes over: the captions' title card between acts. Returns the unsubscribe.
   */
  onChapter(listener: (chapter: StoryChapter) => void): () => void {
    this.chapterListeners.add(listener)
    return () => this.chapterListeners.delete(listener)
  }

  /**
   * The replay's clock moved from `from` to `to` (-1: it looped back to the start): a chapter whose
   * start it reached is told, the one it stood on included (a jump lands exactly on a chapter).
   */
  private turn(from: number, to: number): void {
    if (to <= from) return
    for (const chapter of this.chapters) {
      if (chapter.at < from || chapter.at > to || chapter.at === this.chapterTold) continue
      this.chapterTold = chapter.at
      for (const listener of this.chapterListeners) listener(chapter)
    }
  }
  /** The run time of the chapter last told, so standing on its start tells it once; reset rebuilds forget it. */
  private chapterTold = Number.NaN

  /**
   * Replay fast-forward (roadmap S4, Gource's auto-skip): in a replay, with the Cinematic director
   * filming, a quiet stretch speeds up smoothly to FF_MAX and is back at 1× before the next beat.
   * Only the Player's clock moves faster: moments are made exactly as at 1× (live, one each), so
   * ravens, sound, sigils and captions see the same stream, just sooner. Never live.
   */
  private paceReplay(realMs: number): void {
    const time = this.player.time
    const next = firstAfter(this.beats, time)
    const since = next > 0 ? time - (this.beats[next - 1] ?? 0) : time
    const until = (this.beats[next] ?? this.player.duration) - time
    const goal = fastForwardGoal({
      replay: this.mode === "sim",
      enabled: this.directorStyle === "cinematic" && this.bard && !this.selected && this.pace > 0,
      sinceBeat: since,
      untilBeat: until,
      busy: this.pleading() || this.director.excitement() >= FF_CALM_BELOW,
    })
    const was = this.fastForward
    this.fastForward = easeSpeed(was, goal, realMs)
    this.player.speed = this.pace * this.fastForward
    // The indicator appears and goes on the store's change, not every eased step.
    if (was > 1.05 !== this.fastForward > 1.05) this.emit()
  }

  /** Someone is waiting on a plea (no closure: runs every frame). */
  private pleading(): boolean {
    for (let i = 0; i < this.views.length; i++) if (this.views[i]?.phase === "waiting") return true
    return false
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): number => this.version

  private reset(continued = false): void {
    this.model = emptyModel()
    this.focus = null
    this.lastEventAt = 0
    this.log = []
    this.logged.clear()
    this.progress = 0
    this.left.clear()
    this.arrived.clear()
    this.guilds.clear()
    this.rebuilding = true
    this.rebuilds++
    this.chapterTold = Number.NaN
    this.ordinals.forget()
    this.moments.rebuild(continued)
  }

  private take(change: Change, live: boolean, guild?: string): void {
    if (guild !== undefined && !this.guilds.has(change.id)) this.guilds.set(change.id, guild)
    const was = before(this.model, change)
    const mark = this.ordinals.mark(this.model, change.id)
    apply(this.model, change)
    this.ordinals.took(this.model, change.id, mark)
    this.record(change)
    for (const happening of happenings(this.model, change, was)) {
      const s = this.model.sessions.get(happening.id)
      if (!s) continue
      const actor = this.actorOf(s)
      this.moments.add({ ...actor, ...happening, at: change.at - this.start, live })
      // The fallen keep vigil in the graveyard (guild/undead.ts): the chronicle says so.
      if (happening.kind === "fail" && s.parentID)
        this.write(
          {
            at: change.at - this.start,
            id: s.id,
            title: actor.title,
            color: actor.color,
            party: actor.master,
          },
          {
            kind: "fail",
            text: "☠ rises in the graveyard",
          },
        )
    }
    // A red check (tests, lint, typecheck exiting non-zero) is a failure too, though it completed.
    const red = redCheck(change, this.model)
    if (this.mode === "live") {
      const kind = red ? "fail" : markerOf(change)
      if (kind) this.markers.push({ at: change.at - this.start, kind })
    }
    if (!live) return
    this.lastEventAt = this.time
    const score = red ? 4 : interestOf(change)
    if (score === 0) return
    // Following one party: the calm Bard looks only at it.
    if (this.following !== null && rootOf(this.model, change.id) !== this.following) return
    const held = this.focus && change.at - this.focus.at < HOLD_MS
    if (!this.focus || !held || score > this.focus.score) this.focus = { id: change.id, score, at: change.at }
  }

  /** Each session's number within its role and party, for the log and moments (guild/ordinals.ts). */
  private ordinals = new Ordinals()

  /** Tool calls already written to the log: OpenCode 1 re-sends a running call as its output streams. */
  private logged = new Set<string>()

  private record(change: Change): void {
    const s = this.model.sessions.get(change.id)
    if (!s) return
    if (change.type === "tool" && change.state === "running") {
      if (this.logged.has(change.call)) return
      this.logged.add(change.call)
    }
    const line = lineOf(change, s)
    if (!line) return
    const role = s.parentID ? roleOf(s.agent) : GUILDMASTER
    const title = s.parentID ? numbered(role.title, this.ordinals.of(this.model, s)) : role.title
    this.write(
      { at: change.at - this.start, id: s.id, title, color: role.color, party: rootOf(this.model, s.id) },
      line,
    )
  }

  /** One line onto the chronicle (newest last, at most LOG_SIZE). */
  private write(
    who: Pick<LogEntry, "at" | "id" | "title" | "color" | "party">,
    line: Pick<LogEntry, "kind" | "text">,
  ): void {
    this.log.push({ key: this.log.length ? (this.log.at(-1)?.key ?? 0) + 1 : 1, ...who, ...line })
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE)
  }

  /** Who a moment is about, named as the log names them. */
  private actorOf(s: Session): Actor {
    const role = s.parentID ? roleOf(s.agent) : GUILDMASTER
    return {
      id: s.id,
      agent: s.agent,
      title: s.parentID ? numbered(role.title, this.ordinals.of(this.model, s)) : role.title,
      color: role.color,
      ...(s.parentID ? { parent: s.parentID } : {}),
      master: rootOf(this.model, s.id),
    }
  }

  /** Subagents already gone out of the gate (a `leave` moment made), until they work again. */
  private left = new Set<string>()
  /** Live: the guild (project) each session was heard from: one island shows one project. */
  private guilds = new Map<string, string>()
  /** Parties already on the island (root ids), to notice a new one arriving. */
  private arrived = new Set<string>()

  /** A new party walks in beside the others: the director looks at its guildmaster (live only). */
  private arrivals(parties: readonly Party[]): void {
    for (const party of parties) {
      if (this.arrived.has(party.id)) continue
      this.arrived.add(party.id)
      if (!this.rebuilding && parties.length > 1 && party.root && party.arriving)
        this.director.hint(party.root.id, 6, 6000, { shot: "follow" })
    }
    if (this.arrived.size > parties.length * 4) {
      const here = new Set(parties.map((p) => p.id))
      for (const id of this.arrived) if (!here.has(id)) this.arrived.delete(id)
    }
  }
  /** Ids on stage at the last refresh, and those who came on since as the hall watched. */
  private present = new Set<string>()
  private entering = new Set<string>()

  /**
   * The views, with an entrance for whoever came on stage since the last refresh while the hall
   * watched. Nobody walks in on a rebuild (a seek, a load, a loop, a live hello), nor live for a
   * session last heard of longer ago than LIVE_MS (backlog): they simply stand at their posts.
   */
  private cast(parties: readonly Party[]): AdventurerView[] {
    if (this.rebuilding) this.entering.clear()
    else
      for (const party of parties)
        for (const s of party.sessions)
          if (!this.present.has(s.id) && (this.mode !== "live" || this.now - s.seen <= LIVE_MS))
            this.entering.add(s.id)
    const views = viewsOf(this.model, this.now, FATES, parties, this.entering, this.views)
    this.present.clear()
    for (const view of views) this.present.add(view.id)
    for (const id of this.entering) if (!this.present.has(id)) this.entering.delete(id)
    return views
  }

  /** Set by a reset, cleared by the next refresh: departures found meanwhile are history, not news. */
  private rebuilding = false

  /**
   * `leave` moments: a finished subagent leaves the stage `GONE_MS` after it ended (see `viewsOf`),
   * and a party's guildmaster when the party goes home (guild/parties.ts PARTY_IDLE_MS).
   */
  private departures(parties: readonly Party[]): void {
    const now = this.now
    // News only while it happens: live, a departure found long after its time is backlog (#10).
    const news = (when: number) => !this.rebuilding && (this.mode !== "live" || now - when <= LIVE_MS)
    for (const party of parties) {
      const root = party.root
      if (!root) continue
      if (!party.leaving) this.left.delete(root.id)
      else if (!this.left.has(root.id) && party.idleSince !== undefined) {
        this.left.add(root.id)
        const when = party.idleSince + PARTY_IDLE_MS
        this.moments.add({ ...this.actorOf(root), kind: "leave", at: when - this.start, live: news(when) })
      }
    }
    for (const s of parties.flatMap((p) => p.sessions)) {
      if (!s.parentID) continue
      const gone =
        s.parentID !== undefined && s.status === "done" && s.ended !== undefined && now - s.ended > GONE_MS
      if (!gone) {
        this.left.delete(s.id)
        continue
      }
      if (this.left.has(s.id) || s.ended === undefined) continue
      this.left.add(s.id)
      const when = s.ended + GONE_MS
      this.moments.add({ ...this.actorOf(s), kind: "leave", at: when - this.start, live: news(when) })
    }
  }

  private refresh(): void {
    this.sinceViews = 0
    if (this.focus && this.now - this.focus.at > FOCUS_TTL_MS) this.focus = null
    this.parties = stageOf(this.model, this.now, (id) => this.guilds.get(id))
    if (this.following !== null && !this.parties.some((p) => p.id === this.following)) this.following = null
    this.views = this.cast(this.parties)
    this.undead.sync(
      this.views.filter((view) => view.phase === "failed"),
      this.realTime,
    )
    // A live rise in the graveyard: the director looks (it used to be the Bard's only glance).
    const glance = this.undead.glance
    if (glance && glance.at !== this.glanced) {
      this.glanced = glance.at
      // The fall is told by the rise: the fallen's interest goes with it to the grave.
      const riser = this.undead.risers.find((r) => r.state === "rising" && r.since === glance.at)
      this.director.hint(
        { key: "graveyard", x: glance.x, z: glance.z, radius: 3.5 },
        8,
        RISE_MS + MIN_SHOT_MS,
        {
          shot: "close",
          ...(riser ? { absorbs: riser.id } : {}),
        },
      )
    }
    // The world shows the parties on stage, not every guild the hub has heard from.
    const parties = this.parties
    this.arrivals(parties)
    this.departures(parties)
    this.rebuilding = false
    const all = parties.flatMap((p) => p.sessions)
    // Traces are things on the shared sites (logs on the pile, the yard's building): every party's
    // work leaves them, whoever is followed, so switching parties never empties a pile — nor does a
    // party going home (review-2 #11): they count every session of the island's guild, on stage or not.
    const worked = this.islandSessions(parties)
    this.progress = progressOf(worked)
    this.traces = tracesOf(worked)
    // The weather is the mood of the story being told: all parties together, or the followed one.
    const followed = parties.find((p) => p.id === this.following)
    const told = followed ? followed.sessions : all
    this.environment = environmentOf({
      wallClock: Date.now(),
      runTime: this.time,
      runStart: this.start,
      model: { sessions: new Map(told.map((s) => [s.id, s])) },
      settings: this.environmentSettings,
      ...(this.mode === "sim" && this.hours.length > 0 ? { story: this.hours } : {}),
    })
    // The director films the followed party only; with all, everyone on stage.
    this.director.scope = followed ? new Set(followed.sessions.map((s) => s.id)) : null
    this.emit()
  }

  /** Every session of the island's guild (live: the stage's project; a replay: the whole run). */
  private islandSessions(parties: readonly Party[]): Session[] {
    if (parties.length === 0) return []
    const root = parties.find((p) => p.root)?.root
    const guild = root ? this.guilds.get(root.id) : undefined
    const sessions = [...this.model.sessions.values()]
    return guild === undefined ? sessions : sessions.filter((s) => this.guilds.get(s.id) === guild)
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
  private held = false
  hold(): void {
    this.held = true
  }
  release(): void {
    if (!this.held) return
    this.held = false
    this.emit()
  }
}

/**
 * The newest party (guild/parties.ts): the most recently active root and everyone under it — what
 * the hall showed before several parties shared the island. With no root at all, every session.
 */
export function partyOf(model: Model): Session[] {
  return stageOf(model, Number.POSITIVE_INFINITY).find((p) => p.newest)?.sessions ?? []
}

/**
 * Everyone on stage right now, and where they belong. `fates` says where failures go; `stage` is
 * the parties on the island (guild/parties.ts), each with its guildmaster at its own seat. Posts at
 * the shared sites and stations are handed out across all parties in join order, so a party that
 * arrives later never moves anyone already working.
 *
 * Given the `previous` views, an adventurer whose view is unchanged (every field equal, posts and
 * looks compared by value) gets back the very same object: the scene can memo by reference, and
 * re-renders only those who changed. Views are never mutated after they are made.
 */
export function viewsOf(
  model: Model,
  now: number,
  fates: Fates = FATES,
  stage: readonly Party[] = stageOf(model, now),
  entering: ReadonlySet<string> = NO_ONE,
  previous: readonly AdventurerView[] = [],
): AdventurerView[] {
  const partyOfId = new Map<string, Party>()
  for (const party of stage) for (const s of party.sessions) partyOfId.set(s.id, party)
  const sessions = stage.flatMap((party) => party.sessions).sort(byJoin)
  /** How many of each role have joined each party so far: counted before anyone leaves, so numbers never shift. */
  const joined = new Map<string, number>()
  const taken = new Map<StationId, number>()
  let stools = 0
  let floor = 0
  /** How many have been sent to each failure destination so far. */
  const sent = new Map<string, number>()
  const atSite = new Map<SiteId, number>()
  /** Whoever rests or lies past a place's own seats takes free floor round it (guild/crowd.ts). */
  const crowd = new Crowd()
  const views: AdventurerView[] = []

  for (const s of sessions) {
    const party = partyOfId.get(s.id) as Party
    const isMaster = s === party.root
    // The root session is the guildmaster whatever agent runs it (OpenCode's `build`, a user's own).
    const role = isMaster ? GUILDMASTER : roleOf(s.agent)
    const counted = `${party.id}\u0000${role.title}`
    const ordinal = (joined.get(counted) ?? 0) + 1
    joined.set(counted, ordinal)
    const activity = activityOf(s)
    const since = s.ended !== undefined ? now - s.ended : 0
    // Gone (GONE_MS, the `leave` moment) is through the gate; the walk down the avenue and the
    // dissolve take EXIT_MS more before the stage lets them go.
    if (!isMaster && s.status === "done" && since > GONE_MS + EXIT_MS) continue

    const running = activity.kind === "tool" ? activity.tool : undefined
    const look = running ? deedLook(running) : undefined
    const lastTool = s.entries.findLast((entry) => entry.kind === "tool")
    const stung = lastTool?.kind === "tool" && failedDeed(lastTool) && now - (lastTool.ended ?? 0) < 1400

    let phase: Phase = "working"
    let target: Post
    let station: StationId | undefined
    let site: SiteId | undefined
    let seat: Seat | undefined
    let destination: string | undefined
    const home = isMaster ? undefined : siteOf(s.agent)
    const dais = SEAT_POSTS[party.seat] ?? MASTER_POST
    if (isMaster && party.leaving) {
      // The party goes home: its guildmaster walks out through the gate and down the avenue.
      phase = "leaving"
      target = exitOf(s.id)
    } else if (isMaster) {
      station = "quest-board"
      target = dais
      phase = s.status === "done" ? "idle" : s.status === "waiting" ? "waiting" : "working"
    } else if (s.status === "done") {
      if (since < LOOT_MS) {
        phase = "loot"
        target = HAND_INS[party.seat] ?? HAND_INS[0] ?? dais
      } else if (since < REST_MS) {
        phase = "resting"
        const stool = TAVERN[stools++]
        seat = stool ? "stool" : "floor"
        target = stool ?? (floor < HEARTH_SEATS ? hearthSeat(floor++) : crowd.near(HEARTH))
      } else {
        phase = "leaving"
        target = exitOf(s.id)
      }
    } else if (s.status === "failed") {
      phase = "failed"
      // The destination says where (the infirmary: beds first, then bedrolls on the floor).
      const sessionOf = (id: string) => model.sessions.get(id)
      const to = destinationOf({ session: s, now, sessionOf }, fates)
      const place = fates.destinations[to]
      const n = sent.get(to) ?? 0
      sent.set(to, n + 1)
      const berth = place?.berth(n)
      destination = to
      seat = berth?.seat
      target = berth?.target ?? (place?.crowd ? crowd.near(place.crowd) : MASTER_POST)
    } else if (home) {
      // Island workers stay at their site for the whole quest: no jogging back on every deed.
      site = home
      phase = s.status === "waiting" ? "waiting" : "working"
      const n = atSite.get(home) ?? 0
      atSite.set(home, n + 1)
      // The site's posts on the island drawn now (world/siteMap.ts: a repo's districts, or the hand map's).
      const posts = sitesOf()[home].posts
      // Past the posts they share them: the scene sets each extra worker beside the post's first
      // (scene/activity.ts reserve, world/behaviours.ts shifted), routine and all.
      target = posts[n % posts.length] ?? MASTER_POST
    } else if (look?.goTo === "quest-board") {
      // A quest of their own: sent from their party's place at the board.
      station = look.goTo
      target = dais
    } else if (look?.goTo) {
      station = look.goTo
      const posts = STATIONS[look.goTo].posts
      target = posts[posts.length - 1] ?? MASTER_POST
    } else {
      phase = s.status === "waiting" ? "waiting" : "working"
      station = role.station
      target = postAt(role.station, taken)
    }

    views.push({
      id: s.id,
      agent: s.agent,
      title: numbered(role.title, ordinal),
      role: role.title,
      ordinal,
      color: role.color,
      character: role.character,
      master: isMaster,
      phase,
      target,
      ...(station ? { station } : {}),
      ...(site ? { site } : {}),
      ...(destination ? { destination } : {}),
      ...(seat ? { seat } : {}),
      ...(look ? { look } : {}),
      ...(running ? { tool: running } : {}),
      thinking: activity.kind === "thinking",
      doing: doingOf(s, activity.kind, activity.tool, activity.text),
      ...bubbleOf(s, activity.kind, now),
      stung,
      party: party.id,
      banner: party.color,
      ...(entering.has(s.id) ? { enter: entranceOf(s.id, party, isMaster) } : {}),
    })
  }
  return previous.length > 0 ? kept(previous, views) : views
}

const NO_ONE: ReadonlySet<string> = new Set()

/** `views`, with each one equal to its previous view swapped for that (see `viewsOf`). */
function kept(previous: readonly AdventurerView[], views: AdventurerView[]): AdventurerView[] {
  const before = new Map(previous.map((view) => [view.id, view]))
  for (let i = 0; i < views.length; i++) {
    const view = views[i] as AdventurerView
    const was = before.get(view.id)
    if (was && same(was, view)) views[i] = was
  }
  return views
}

/** Equal by value: views are plain data (strings, numbers, booleans, posts, looks, entrances). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys)
    if (!same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  return true
}

/** -1…1, stable per id: which side of the road (or of the hand-in spot) someone keeps to. */
function sideOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) / 4294967295) * 2 - 1
}

/** Where a leaver walks to, down the avenue (facing on, away from the keep), and dissolves. */
export function exitOf(id: string): Post {
  return [AVENUE_END[0] + sideOf(id) * ROAD_SPREAD, AVENUE_END[1], 0]
}

/**
 * Where a newcomer appears (see `Entrance`). A subagent whose guildmaster is on stage (and not
 * going home) is summoned beside them; everyone else walks in from the avenue, facing the keep.
 */
export function entranceOf(id: string, party: Party, master: boolean): Entrance {
  const side = sideOf(id)
  if (!master && party.root && !party.leaving) {
    const [x, z, facing] = HAND_INS[party.seat] ?? HAND_IN
    // Across their facing: side by side in front of the guildmaster, never in a line through them.
    return {
      kind: "dais",
      at: [x + Math.cos(facing) * side * DAIS_SPREAD, z - Math.sin(facing) * side * DAIS_SPREAD, facing],
    }
  }
  return { kind: "gate", at: [AVENUE_END[0] + side * ROAD_SPREAD, AVENUE_END[1], Math.PI] }
}

/**
 * Which of its role `s` is in its party, by join order (1-based) — the same number `viewsOf` gives
 * it, for lines written as events arrive.
 */
export function ordinalOf(model: Model, s: Session): number {
  const root = rootOf(model, s.id)
  const title = (s.parentID ? roleOf(s.agent) : GUILDMASTER).title
  let n = 1
  for (const other of model.sessions.values()) {
    if (other === s || rootOf(model, other.id) !== root) continue
    const otherTitle = (other.parentID ? roleOf(other.agent) : GUILDMASTER).title
    if (otherTitle === title && byJoin(other, s) < 0) n++
  }
  return n
}

/** `Implementer`, `Implementer II`, `Implementer III`: the first of a role keeps its plain name. */
export function numbered(title: string, ordinal: number): string {
  return ordinal > 1 ? `${title} ${roman(ordinal)}` : title
}

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
]

export function roman(n: number): string {
  let rest = Math.max(1, Math.floor(n))
  let out = ""
  for (const [value, letters] of ROMAN) {
    while (rest >= value) {
      out += letters
      rest -= value
    }
  }
  return out
}

/** Completed deeds that grow a site's building (the yard's: edits and writes). */
function progressOf(sessions: Iterable<Session>): number {
  let done = 0
  for (const s of sessions) {
    const site = siteOf(s.agent)
    const builds = site && SITE_DEFS[site].builds
    if (!builds) continue
    for (const entry of s.entries)
      if (entry.kind === "tool" && entry.state === "completed" && builds.has(entry.name)) done++
  }
  return done
}

const GUILDMASTER = roleOf("guild-master")

const MASTER_POST: Post = STATIONS["quest-board"].posts[0] ?? [0, -7.4, 0]
/** Each party's guildmaster's place: the dais, then the seats beside it (guild/parties.ts). */
const SEAT_POSTS: readonly Post[] = STATIONS["quest-board"].posts

/**
 * A station's next free post, then the overflow bench's; past those they share the bench's posts,
 * and the scene sets each beside the post's first (as at a site).
 */
function postAt(id: StationId, taken: Map<StationId, number>): Post {
  const n = taken.get(id) ?? 0
  const posts = STATIONS[id].posts
  const post = posts[n]
  if (post) {
    taken.set(id, n + 1)
    return post
  }
  const overflow = taken.get("overflow") ?? 0
  taken.set("overflow", overflow + 1)
  const extra = STATIONS.overflow.posts
  return extra[overflow % extra.length] ?? MASTER_POST
}

function doingOf(s: Session, kind: string, tool: string | undefined, text: string): string {
  if (kind === "tool" && tool) return text ? `${tool} · ${shorten(text, 28)}` : tool
  if (kind === "done") return s.parentID ? "quest done" : "resting"
  return text
}

function bubbleOf(s: Session, kind: string, now: number): { bubble?: string } {
  if (kind === "thinking") {
    const thought = s.entries.findLast((entry) => entry.kind === "thinking")
    return { bubble: thought?.kind === "thinking" && thought.text ? shorten(thought.text, 70) : "…" }
  }
  const reply = s.entries.findLast((entry) => entry.kind === "reply")
  if (reply?.kind === "reply" && reply.done && now - reply.at < 3500)
    return { bubble: shorten(reply.text, 80) }
  return {}
}

function shorten(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim()
  const base = line.split("/").at(-1) ?? line
  const picked = line.includes("/") && !line.includes(" ") ? base : line
  return picked.length > max ? `${picked.slice(0, max - 1)}…` : picked
}

/**
 * A hub message, checked: the socket is a trust boundary too (a stray or broken peer must not throw
 * in the hall). Undefined for anything that isn't a hello, events or sea; events not shaped like a
 * `GuildEvent`, and sea records not shaped like a `SeaRecord`, are left out.
 */
function messageOf(
  raw: unknown,
):
  | { type: "hello"; events: GuildEvent[]; sea: SeaRecord[] }
  | { type: "events"; events: GuildEvent[] }
  | { type: "sea"; sea: SeaRecord[] }
  | undefined {
  let data: unknown
  try {
    data = JSON.parse(String(raw))
  } catch {
    return undefined
  }
  if (typeof data !== "object" || data === null) return undefined
  const { type, events, sea } = data as { type?: unknown; events?: unknown; sea?: unknown }
  if (!Array.isArray(events)) return undefined
  if (type === "sea") return { type, sea: events.filter(isSeaRecord) }
  if (type === "events") return { type, events: events.filter(isEvent) }
  if (type !== "hello") return undefined
  return { type, events: events.filter(isEvent), sea: Array.isArray(sea) ? sea.filter(isSeaRecord) : [] }
}

/** Sea events at run time from `start`, oldest first (ties keep their order). */
function sightingsOf(events: readonly SeaEvent[], start: number): Sighting[] {
  return events.map((event) => ({ event, at: event.at - start })).sort((a, b) => a.at - b.at)
}

function isEvent(value: unknown): value is GuildEvent {
  if (typeof value !== "object" || value === null) return false
  const { guild, seq, change } = value as Partial<Record<keyof GuildEvent, unknown>>
  if (typeof guild !== "string" || !Number.isInteger(seq) || typeof change !== "object" || change === null)
    return false
  const { type, id, at } = change as { type?: unknown; id?: unknown; at?: unknown }
  return typeof type === "string" && typeof id === "string" && typeof at === "number" && Number.isFinite(at)
}

function markerOf(change: Change): Marker["kind"] | undefined {
  if (change.type === "status" && change.status === "waiting") return "plea"
  if (change.type === "tool" && change.state === "failed") return "fail"
  if (
    change.type === "tool" &&
    change.state === "running" &&
    (change.name === "task" || change.name === "subagent")
  )
    return "quest"
  if (change.type === "tool" && change.state === "running" && change.name === "webfetch") return "walk"
  if (change.type === "status" && change.status === "idle") return "loot"
  return undefined
}

function lineOf(change: Change, s: Session): Pick<LogEntry, "kind" | "text"> | undefined {
  switch (change.type) {
    case "session":
      return change.parentID
        ? { kind: "join", text: `joins: ${s.title.replace(/ \(@.*\)$/, "")}` }
        : undefined
    case "status":
      if (change.status === "waiting") return { kind: "plea", text: "asks for permission" }
      if (change.status === "failed") return { kind: "fail", text: change.error ?? "failed" }
      if (change.status === "idle") return { kind: "loot", text: s.parentID ? "quest complete" : "all done" }
      return undefined
    case "tool": {
      if (change.state === "failed")
        return { kind: "fail", text: `${toolName(s, change.call)} failed: ${change.error ?? ""}` }
      if (change.state === "completed" && change.exit !== undefined && change.exit !== 0) {
        const entry = s.entries.find((e) => e.kind === "tool" && e.call === change.call)
        if (entry?.kind === "tool" && failedDeed(entry))
          return {
            kind: "fail",
            text: `${entry.name} exited ${change.exit}: ${shorten(String(entry.input.command ?? ""), 60)}`,
          }
      }
      if (change.state !== "running") return undefined
      const name = change.name ?? "tool"
      if (name === "task" || name === "subagent") {
        const what = typeof change.input?.description === "string" ? change.input.description : "a quest"
        return { kind: "quest", text: `sends a quest: ${what}` }
      }
      return { kind: "deed", text: `${name} ${shorten(targetOf(change.input), 40)}`.trim() }
    }
    case "prompt": {
      const prompts = s.entries.filter((entry) => entry.kind === "prompt").length
      return prompts > 1 ? { kind: "quest", text: `called back: ${shorten(change.text, 70)}` } : undefined
    }
    case "thinking":
      return change.done || !change.text ? undefined : { kind: "thought", text: shorten(change.text, 90) }
    default:
      return undefined
  }
}

/** A completed call that is red work: a check (tests, lint, typecheck) that exited non-zero (core's `failedDeed`). */
function redCheck(change: Change, model: Model): boolean {
  if (change.type !== "tool" || change.state !== "completed" || !change.exit) return false
  const entry = model.sessions
    .get(change.id)
    ?.entries.find((e) => e.kind === "tool" && e.call === change.call)
  return entry?.kind === "tool" && failedDeed(entry)
}

function toolName(s: Session, call: string): string {
  const entry = s.entries.find((e) => e.kind === "tool" && e.call === call)
  return entry?.kind === "tool" ? entry.name : "tool"
}

function targetOf(input: Record<string, unknown> | undefined): string {
  if (!input) return ""
  for (const key of ["filePath", "pattern", "command", "url", "query", "path"]) {
    const value = input[key]
    if (typeof value === "string") return value.split("/").at(-1) ?? value
  }
  return ""
}

/** Index of the first value in sorted `times` greater than `t` (times.length if none). */
function firstAfter(times: readonly number[], t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((times[mid] ?? 0) <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}
