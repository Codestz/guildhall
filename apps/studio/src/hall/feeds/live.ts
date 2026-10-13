/**
 * Following the legacy hub (plan §3.6 B, V1 ADR 0003; V1's guild/feeds/live.ts rewritten lean): a
 * WebSocket to 127.0.0.1:4747, a `hello` with everything the hub keeps, then `events` and `sea` as they
 * happen. Wire v1, the hub unchanged; read-only (answering a plea waits for the per-boot token).
 *
 * - **Dedup**: the last seq taken per guild; a repeat (a reconnect's replay, a hub resending) is dropped.
 * - **Backlog**: a change older than `LIVE_MS` when it arrives is history, folded quietly (a herald
 *   flushing its queue after a hub restart must not burst into captions); a hello is all history.
 * - **Backoff**: a lost socket is opened again after 0.5 s, doubling to 10 s, back to 0.5 s once it opens.
 * - **Hello**: everything so far, again: the sink starts over and the seqs are forgotten.
 *
 * Only this repo's guilds are taken (`guildMatcher`). The socket and the timers are injectable, for tests.
 */
import type { GuildEvent } from "@guildhall/core"
import type { Feed, FeedSink, FeedStatus } from "./feed.ts"
import { hubMessage } from "./wire.ts"

/** The hub a hall follows unless the link names another on this machine (ADR 0003). */
export const DEFAULT_HUB = "ws://127.0.0.1:4747/ws"

/** Live: a change older than this when it arrives is backlog, folded as history rather than news. */
export const LIVE_MS = 5000
/** The first retry's wait, and the longest. */
export const BACKOFF_MS = 500
export const BACKOFF_MAX_MS = 10_000

/** The socket the feed needs (the browser's `WebSocket` has it). */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  close(): void
}

export interface LiveFeedOptions {
  url?: string
  /** Which guilds are this repo's. */
  guild: (guild: string) => boolean
  /** The guild's name for the Brand. */
  name: string
  socket?: (url: string) => SocketLike
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * A link's hub (`?hub=`): only a ws:// on this machine (localhost, 127.0.0.1, [::1]), any port, so a link
 * cannot point the hall at someone else's stream; anything else is the default hub.
 */
export function hubUrlOf(asked: string | null): string {
  if (!asked) return DEFAULT_HUB
  try {
    const url = new URL(asked)
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
    return url.protocol === "ws:" && local ? url.href : DEFAULT_HUB
  } catch {
    return DEFAULT_HUB
  }
}

export class LiveFeed implements Feed {
  readonly kind = "live"
  readonly name: string
  readonly url: string
  private sink: FeedSink | null = null
  private socket: SocketLike | null = null
  private timer: unknown = null
  private state: FeedStatus = "offline"
  /** The last seq taken per guild, since the last hello. */
  private readonly seen = new Map<string, number>()
  private delay = BACKOFF_MS
  private readonly opts: Required<Omit<LiveFeedOptions, "url" | "name">>

  constructor(opts: LiveFeedOptions) {
    this.url = opts.url ?? DEFAULT_HUB
    this.name = opts.name
    this.opts = {
      guild: opts.guild,
      socket: opts.socket ?? ((url) => new WebSocket(url) as unknown as SocketLike),
      now: opts.now ?? Date.now,
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)),
    }
  }

  status(): FeedStatus {
    return this.state
  }

  /** The wait before the next retry (for tests and the Brand's "retrying in"). */
  backoff(): number {
    return this.delay
  }

  start(sink: FeedSink): void {
    if (this.sink) return
    this.sink = sink
    this.open()
  }

  stop(): void {
    const socket = this.socket
    this.socket = null
    this.sink = null
    if (this.timer !== null) this.opts.clearTimer(this.timer)
    this.timer = null
    if (socket) {
      socket.onclose = null
      socket.close()
    }
  }

  /** Try now (the Brand's Retry), forgetting the backoff. */
  retry(): void {
    if (!this.sink || this.state === "live") return
    if (this.timer !== null) this.opts.clearTimer(this.timer)
    this.timer = null
    this.delay = BACKOFF_MS
    const old = this.socket
    this.socket = null
    if (old) {
      old.onclose = null
      old.close()
    }
    this.open()
  }

  private set(status: FeedStatus, note?: string): void {
    this.state = status
    this.sink?.status(status, note)
  }

  private open(): void {
    const sink = this.sink
    if (!sink) return
    this.set("connecting")
    let socket: SocketLike
    try {
      socket = this.opts.socket(this.url)
    } catch {
      this.lost()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.delay = BACKOFF_MS
      this.set("live")
    }
    socket.onmessage = (message) => {
      if (this.socket === socket) this.read(message.data)
    }
    socket.onerror = () => {}
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.lost()
    }
  }

  /** The socket went (or never came): offline until the next try, the wait doubling. */
  private lost(): void {
    if (!this.sink) return
    const wait = this.delay
    this.set("offline", `no hub at ${this.url.replace(/^ws:\/\//, "").replace(/\/ws$/, "")}`)
    this.delay = Math.min(this.delay * 2, BACKOFF_MAX_MS)
    this.timer = this.opts.setTimer(() => {
      this.timer = null
      if (this.sink && !this.socket) this.open()
    }, wait)
  }

  private read(raw: unknown): void {
    const sink = this.sink
    if (!sink) return
    const data = hubMessage(raw)
    if (!data) return
    if (data.type === "hello") {
      // everything so far, again (a reconnect, a hub restart): start over, as history
      sink.reset()
      this.seen.clear()
      for (const event of data.events) if (this.fresh(event)) sink.take(event, false)
      for (const record of data.sea) if (this.opts.guild(record.guild)) sink.take(record.event, false)
      return
    }
    if (data.type === "sea") {
      for (const record of data.sea) if (this.opts.guild(record.guild)) sink.take(record.event, true)
      return
    }
    const now = this.opts.now()
    for (const event of data.events) if (this.fresh(event)) sink.take(event, now - event.change.at <= LIVE_MS)
  }

  /** This repo's, and not taken yet: a repeat folded twice would count twice. */
  private fresh(event: GuildEvent): boolean {
    if (!this.opts.guild(event.guild)) return false
    if (event.seq <= (this.seen.get(event.guild) ?? 0)) return false
    this.seen.set(event.guild, event.seq)
    return true
  }
}
