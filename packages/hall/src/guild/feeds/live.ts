import { type Change, type GuildEvent, isSeaRecord, type SeaRecord } from "@guildhall/core"
import type { StoryHour } from "../environment.ts"
import { markerOf } from "../log.ts"
import { SERVED } from "../mode.ts"
import { type Sighted, sight } from "../sea.ts"
import type { Feed, FeedSink } from "./feed.ts"

/**
 * Following the hub (ADR 0003): a hello with everything so far, then events and sea records as they
 * happen. Reconnects with backoff, so the hall can be opened before OpenCode or the hub.
 */

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

/** Live: a change older than this when it arrives is backlog, applied quietly rather than as news. */
export const LIVE_MS = 5000

export class LiveFeed implements Feed {
  readonly kind = "live"
  readonly hours: readonly StoryHour[] = []
  private sink!: FeedSink
  private socket: WebSocket | undefined
  /** Run time 0: when the feed began, then the first event a hello holds. */
  private liveStart = 0
  /** The last seq taken per guild, since the last hello. */
  private seen = new Map<string, number>()
  /** Each sea event taken, once, with the time the hall dates it by. */
  private sighted: Sighted[] = []

  constructor(readonly url: string) {}

  now(): number {
    return Date.now()
  }
  time(): number {
    return Date.now() - this.liveStart
  }
  duration(): number {
    return this.time()
  }
  origin(): number {
    return this.liveStart
  }
  news(when: number, now: number): boolean {
    return now - when <= LIVE_MS
  }

  start(sink: FeedSink): void {
    this.sink = sink
    sink.reset()
    sink.state.markers = []
    sink.state.chapters = []
    sink.state.sea = []
    this.liveStart = Date.now()
    this.open(500)
  }

  /** One socket at a time: a feed replaced or stopped closes its own, and stops reconnecting. */
  stop(): void {
    const socket = this.socket
    this.socket = undefined
    socket?.close()
  }

  tick(): boolean {
    this.sink.state.fastForward = 1
    return false
  }

  private open(backoff: number): void {
    let delay = backoff
    const { sink } = this
    const { state } = sink
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.onopen = () => {
      delay = 500
      state.connected = true
      sink.emit()
    }
    socket.onmessage = (message) => {
      if (this.socket !== socket) return
      const data = messageOf(message.data)
      if (!data) return
      if (data.type === "hello") {
        // A fresh hello (a reconnect, a hub restart) is everything so far: start over, markers too.
        // The same run goes on: what was news already (a world event) is not news again.
        sink.reset(true)
        state.markers = []
        this.seen.clear()
        this.liveStart = data.events[0]?.change.at ?? Date.now()
        for (const event of data.events) if (this.fresh(event)) this.take(event.change, false, event.guild)
        // The sea so far is history, dated as GitHub dates it.
        state.sea = sight(this.sighted, data.sea, false, Date.now(), this.liveStart)
        sink.tellSea(Number.POSITIVE_INFINITY, false)
      } else if (data.type === "sea") {
        // News: dated as it arrives, so a push's voyage is seen however late the poll found it.
        state.sea = sight(this.sighted, data.sea, true, Date.now(), this.liveStart)
        sink.tellSea(Number.POSITIVE_INFINITY, true)
        sink.emit()
        return
      } else {
        // A change older than LIVE_MS is backlog (the herald's courier flushing its queue after a
        // hub restart, review-2 #10): applied, but history, not news — no burst of ravens and cues.
        const now = Date.now()
        for (const event of data.events)
          if (this.fresh(event)) this.take(event.change, now - event.change.at <= LIVE_MS, event.guild)
      }
      const last = data.events.at(-1)
      if (last) state.guild = last.guild
      sink.refresh()
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      state.connected = false
      sink.emit()
      // Reconnect unless the feed was stopped or replaced while we waited.
      delay = Math.min(delay * 2, 10_000)
      setTimeout(() => {
        if (this.socket === socket) this.open(delay)
      }, delay)
    }
  }

  /** Taken live, every change marks the timeline as it comes (a told story's are known up front). */
  private take(change: Change, live: boolean, guild: string): void {
    const red = this.sink.take(change, live, guild)
    const kind = red ? "fail" : markerOf(change)
    if (kind) this.sink.state.markers.push({ at: change.at - this.liveStart, kind })
  }

  /** False for an event already taken (a repeat after a reconnect): applied twice, it would count twice. */
  private fresh(event: GuildEvent): boolean {
    if (event.seq <= (this.seen.get(event.guild) ?? 0)) return false
    this.seen.set(event.guild, event.seq)
    return true
  }
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

function isEvent(value: unknown): value is GuildEvent {
  if (typeof value !== "object" || value === null) return false
  const { guild, seq, change } = value as Partial<Record<keyof GuildEvent, unknown>>
  if (typeof guild !== "string" || !Number.isInteger(seq) || typeof change !== "object" || change === null)
    return false
  const { type, id, at } = change as { type?: unknown; id?: unknown; at?: unknown }
  return typeof type === "string" && typeof id === "string" && typeof at === "number" && Number.isFinite(at)
}
