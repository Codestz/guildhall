import {
  activityOf,
  apply,
  type Change,
  emptyModel,
  type GuildEvent,
  type Model,
  rootOf,
  type Session,
} from "@guildhall/core"
import { type DeedLook, deedLook, interestOf, ROLES, roleOf } from "@guildhall/roster"
import { Player, party, rush, solo, toEvents } from "@guildhall/sim"
import { type Traces, tracesOf } from "../scene/life/traces.ts"
import { ROLE_SITE, SITES, type SiteId, siteOf } from "../world/lands.ts"
import {
  GATE,
  HAND_IN,
  hearthSeat,
  INFIRMARY,
  INFIRMARY_MATS,
  type Post,
  STATIONS,
  type StationId,
  TAVERN,
} from "../world/layout.ts"
import { MOODS, type Mood } from "../world/moods.ts"
import { DEFAULT_SETTINGS, type Environment, type EnvironmentSettings, environmentOf } from "./environment.ts"

/**
 * The hall's single source of truth: a Player feeds `GuildEvent`s into cockpit's model, and the
 * store turns the model into what each adventurer should be doing *now* (`AdventurerView`).
 * The scene only reads views; it never looks at raw changes.
 */

export const SCENARIOS = {
  party: () => party(),
  solo: () => solo(),
  rush: () => rush(12),
} as const
export type ScenarioId = keyof typeof SCENARIOS

/** The hub a hall follows unless told otherwise (ADR 0003). */
export const DEFAULT_HUB = "ws://127.0.0.1:4747/ws"

/**
 * The hub a page's query asks for: null without `?live`; `?live=<url>` only for a hub on this
 * machine (ws://localhost or ws://127.0.0.1, any port) unless `&anyhub=1` says otherwise — a link
 * must not be able to point the hall at someone else's stream. Anything else is the default hub.
 */
export function liveUrlOf(search: string): string | null {
  const params = new URLSearchParams(search)
  const asked = params.get("live")
  if (asked === null) return null
  if (!asked) return DEFAULT_HUB
  if (params.get("anyhub") === "1") return asked
  try {
    const url = new URL(asked)
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1"
    return url.protocol === "ws:" && local ? asked : DEFAULT_HUB
  } catch {
    return DEFAULT_HUB
  }
}

export type Phase = "working" | "waiting" | "loot" | "resting" | "leaving" | "idle" | "failed"
export type Seat = "stool" | "floor" | "bed"

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
}

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
}

/** An interesting moment on the timeline (run time, ms), for scrubber ticks. */
export interface Marker {
  at: number
  kind: "quest" | "fail" | "plea" | "loot" | "walk"
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

export class GuildStore {
  scenario: ScenarioId = "party"
  mood: Mood = MOODS.keep
  bard = true
  /** Diorama: the orthographic tabletop. Explore: a perspective camera that can go low and close. */
  view: "diorama" | "explore" = "diorama"
  views: AdventurerView[] = []
  focus: Focus | null = null
  /** Run time of the newest event: lets the Bard tell a quiet guild from a busy one. */
  lastEventAt = 0
  /** The adventurer the viewer picked (side panel open, camera follows). */
  selected: string | null = null
  /** Newest last, at most LOG_SIZE. */
  log: LogEntry[] = []
  markers: Marker[] = []
  /** Completed edits/writes this run: the yard's building grows with it. */
  progress = 0
  /** What finished work has left at each job site (logs, stone, fish, books, arrows). */
  traces: Traces = tracesOf([])
  /** The world's conditions: time of day, weather, temperature (ADR 0007). */
  environmentSettings: EnvironmentSettings = { ...DEFAULT_SETTINGS }
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
    this.load("party")
  }

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
  live(url = DEFAULT_HUB): void {
    // One socket at a time: a second call replaces the first rather than doubling every event.
    const previous = this.socket
    this.socket = undefined
    previous?.close()
    this.mode = "live"
    this.reset()
    this.markers = []
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
          this.reset()
          this.markers = []
          this.seen.clear()
          this.liveStart = data.events[0]?.change.at ?? Date.now()
          for (const event of data.events) if (this.fresh(event)) this.take(event.change, false)
        } else {
          for (const event of data.events) if (this.fresh(event)) this.take(event.change, true)
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

  /** Live: the last seq taken per guild, since the last hello. */
  private seen = new Map<string, number>()

  /** False for an event already taken (a repeat after a reconnect): applied twice, it would count twice. */
  private fresh(event: GuildEvent): boolean {
    if (event.seq <= (this.seen.get(event.guild) ?? 0)) return false
    this.seen.set(event.guild, event.seq)
    return true
  }
  get speed(): number {
    return this.player.speed
  }

  load(scenario: ScenarioId): void {
    if (this.mode === "live") {
      const socket = this.socket
      this.socket = undefined
      socket?.close()
      this.mode = "sim"
      this.connected = false
    }
    const speed = this.player?.speed ?? 1
    this.scenario = scenario
    this.events = toEvents(SCENARIOS[scenario](), "demo")
    this.player = new Player(this.events, { loop: true })
    this.player.speed = speed
    const start = this.events[0]?.change.at ?? 0
    this.markers = this.events.flatMap(({ change }) => {
      const kind = markerOf(change)
      return kind ? [{ at: change.at - start, kind }] : []
    })
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

  setSpeed(speed: number): void {
    this.player.speed = speed
    this.emit()
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

  setBard(on: boolean): void {
    this.bard = on
    this.emit()
  }

  seek(time: number): void {
    this.reset()
    for (const event of this.player.seek(time)) this.take(event.change, false)
    this.refresh()
  }

  /** Called every frame with real elapsed ms. */
  tick(realMs: number): void {
    if (this.mode === "live") {
      this.sinceViews += realMs
      if (this.sinceViews > 100) this.refresh()
      return
    }
    const { events, restarted } = this.player.tick(realMs)
    if (restarted) this.reset()
    for (const event of events) this.take(event.change, true)
    this.sinceViews += realMs
    if (events.length > 0 || restarted || this.sinceViews > 100) this.refresh()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): number => this.version

  private reset(): void {
    this.model = emptyModel()
    this.focus = null
    this.lastEventAt = 0
    this.log = []
    this.logged.clear()
    this.progress = 0
  }

  private take(change: Change, live: boolean): void {
    apply(this.model, change)
    this.record(change)
    if (this.mode === "live") {
      const kind = markerOf(change)
      if (kind) this.markers.push({ at: change.at - this.start, kind })
    }
    if (!live) return
    this.lastEventAt = this.time
    const score = interestOf(change)
    if (score === 0) return
    const held = this.focus && change.at - this.focus.at < HOLD_MS
    if (!this.focus || !held || score > this.focus.score) this.focus = { id: change.id, score, at: change.at }
  }

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
    const start = this.start
    this.log.push({
      key: this.log.length ? (this.log.at(-1)?.key ?? 0) + 1 : 1,
      at: change.at - start,
      id: s.id,
      title: s.parentID ? numbered(role.title, ordinalOf(this.model, s)) : role.title,
      color: role.color,
      ...line,
    })
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE)
  }

  private refresh(): void {
    this.sinceViews = 0
    if (this.focus && this.now - this.focus.at > FOCUS_TTL_MS) this.focus = null
    this.views = viewsOf(this.model, this.now)
    // The world shows the party on stage, not every guild the hub has heard from.
    const party = partyOf(this.model)
    this.progress = progressOf(party)
    this.traces = tracesOf(party)
    this.environment = environmentOf({
      wallClock: Date.now(),
      runTime: this.time,
      runStart: this.start,
      model: { sessions: new Map(party.map((s) => [s.id, s])) },
      settings: this.environmentSettings,
    })
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
 * The party the hall follows: several OpenCode sessions (or windows, or guilds) at once, it shows the
 * most recently active root and everyone under it. With no root at all, every session.
 */
export function partyOf(model: Model): Session[] {
  const roots = [...model.sessions.values()].filter((s) => !s.parentID)
  const followed = roots.reduce<Session | undefined>(
    (best, s) => (!best || s.seen > best.seen ? s : best),
    undefined,
  )
  return [...model.sessions.values()].filter((s) => !followed || rootOf(model, s.id) === followed.id)
}

/** Everyone on stage right now, and where they belong. */
export function viewsOf(model: Model, now: number): AdventurerView[] {
  const sessions = partyOf(model).sort(byJoin)
  const master = sessions.find((s) => !s.parentID)
  /** How many of each role have joined so far: counted before anyone leaves, so numbers never shift. */
  const joined = new Map<string, number>()
  const taken = new Map<StationId, number>()
  let stools = 0
  let floor = 0
  let beds = 0
  const atSite = new Map<SiteId, number>()
  const views: AdventurerView[] = []

  for (const s of sessions) {
    const isMaster = s === master
    // The root session is the guildmaster whatever agent runs it (OpenCode's `build`, a user's own).
    const role = isMaster ? GUILDMASTER : roleOf(s.agent)
    const ordinal = (joined.get(role.title) ?? 0) + 1
    joined.set(role.title, ordinal)
    const activity = activityOf(s)
    const since = s.ended !== undefined ? now - s.ended : 0
    if (!isMaster && s.status === "done" && since > GONE_MS) continue

    const running = activity.kind === "tool" ? activity.tool : undefined
    const look = running ? deedLook(running) : undefined
    const lastTool = s.entries.findLast((entry) => entry.kind === "tool")
    const stung =
      lastTool?.kind === "tool" && lastTool.state === "failed" && now - (lastTool.ended ?? 0) < 1400

    let phase: Phase = "working"
    let target: Post
    let station: StationId | undefined
    let site: SiteId | undefined
    let seat: Seat | undefined
    const home = isMaster
      ? undefined
      : siteOf(
          s.agent,
          ROLES.some((r) => r.id === s.agent),
        )
    if (isMaster) {
      station = "quest-board"
      target = MASTER_POST
      phase = s.status === "done" ? "idle" : s.status === "waiting" ? "waiting" : "working"
    } else if (s.status === "done") {
      if (since < LOOT_MS) {
        phase = "loot"
        target = HAND_IN
      } else if (since < REST_MS) {
        phase = "resting"
        const stool = TAVERN[stools++]
        seat = stool ? "stool" : "floor"
        target = stool ?? hearthSeat(floor++)
      } else {
        phase = "leaving"
        target = [GATE[0], GATE[1], 0]
      }
    } else if (s.status === "failed") {
      phase = "failed"
      // Beds first, then bedrolls on the floor; past that they share (rare: 7+ failed at once).
      const n = beds++
      seat = n < INFIRMARY.length ? "bed" : "floor"
      target =
        n < INFIRMARY.length
          ? (INFIRMARY[n] ?? MASTER_POST)
          : (INFIRMARY_MATS[(n - INFIRMARY.length) % INFIRMARY_MATS.length] ?? MASTER_POST)
    } else if (home) {
      // Island workers stay at their site for the whole quest: no jogging back on every deed.
      site = home
      phase = s.status === "waiting" ? "waiting" : "working"
      const n = atSite.get(home) ?? 0
      atSite.set(home, n + 1)
      const posts = SITES[home].posts
      target = posts[n % posts.length] ?? MASTER_POST
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
      ...(seat ? { seat } : {}),
      ...(look ? { look } : {}),
      ...(running ? { tool: running } : {}),
      thinking: activity.kind === "thinking",
      doing: doingOf(s, activity.kind, activity.tool, activity.text),
      ...bubbleOf(s, activity.kind, now),
      stung,
    })
  }
  return views
}

/** Join order: start time, then id, so two sessions started in the same millisecond keep one order. */
function byJoin(a: Session, b: Session): number {
  return a.started - b.started || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
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

function progressOf(sessions: Iterable<Session>): number {
  let done = 0
  for (const s of sessions) {
    if (ROLE_SITE[s.agent] !== "yard") continue
    for (const entry of s.entries) {
      if (
        entry.kind === "tool" &&
        entry.state === "completed" &&
        (entry.name === "edit" || entry.name === "write")
      )
        done++
    }
  }
  return done
}

const GUILDMASTER = roleOf("guild-master")

const MASTER_POST: Post = STATIONS["quest-board"].posts[0] ?? [0, -7.4, 0]

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
 * in the hall). Undefined for anything that isn't a hello or events; events not shaped like a
 * `GuildEvent` are left out.
 */
function messageOf(raw: unknown): { type: "hello" | "events"; events: GuildEvent[] } | undefined {
  let data: unknown
  try {
    data = JSON.parse(String(raw))
  } catch {
    return undefined
  }
  if (typeof data !== "object" || data === null) return undefined
  const { type, events } = data as { type?: unknown; events?: unknown }
  if ((type !== "hello" && type !== "events") || !Array.isArray(events)) return undefined
  return { type, events: events.filter(isEvent) }
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
