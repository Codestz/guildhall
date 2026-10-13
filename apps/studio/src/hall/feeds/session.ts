/**
 * The hall's session (plan-hud-events H1): one `EventLog` the hall owns, fed by one feed. What the feed
 * reads is normalised (sim `normalize`, the repo's places bound by path) and appended; a Teller hears the
 * same changes for the captions (sim `Narrator`); the session clock says where along the log the hall
 * looks, and the world there is `log.stateAt(at)`, so a scrub shows what playing showed. React reads a
 * snapshot of it at most 10 times a second (`throttled`), never per frame.
 *
 * Who else reads it: the hall HUD (the snapshot), the timeline bar (the clock), and life (L1/L2), which
 * takes `log()` and `clock` to pose the heroes (`hallSession()` hands them over). `log()` is replaced
 * when the feed starts over (a hub's hello): `onReset` says so.
 */
import type { Change, GuildEvent, SeaEvent } from "@guildhall/core"
import {
  type Caption,
  EventLog,
  emptyWorld,
  flush,
  type GuildModel,
  type GuildWorld,
  Narrator,
  type NormalizeContext,
  normalize,
  normalizer,
  type StoryMoment,
  Teller,
  type WireInput,
  type WorldEvent,
} from "@guildhall/sim"
import { createSessionClock, type SessionClock, type SessionClockState } from "./clock.ts"
import type { Feed, FeedChapter, FeedKind, FeedSink, FeedStatus } from "./feed.ts"
import { LiveFeed } from "./live.ts"
import { type ThrottleOptions, throttled } from "./store.ts"

/** What the HUD draws from, at most 10 times a second. */
export interface SessionSnapshot {
  /** Grows with every snapshot. */
  version: number
  kind: FeedKind
  /** What plays: the guild, the file, the story. */
  name: string
  status: FeedStatus
  note?: string
  clock: SessionClockState
  /** The world at `clock.at`. */
  world: GuildWorld
  /** Events in the log. */
  events: number
  /** The line the Narrator told last (a new `key` is a new line). */
  caption?: Caption
  /** A told story's acts, at ms from the session's start; `chapter` is the one playing (−1: none yet). */
  chapters: readonly FeedChapter[]
  chapter: number
}

export interface HallSession {
  readonly feed: Feed
  readonly clock: SessionClock
  /** The log (a new one after the feed starts over). */
  log(): EventLog
  /** The session model behind it (transcripts, purses), at the log's head. */
  model(): GuildModel
  /** The log's first event's time (epoch ms), or null while it is empty. */
  origin(): number | null
  /** Starts the feed; `placeOf` binds a file path to a zone (the hall's places). */
  start(placeOf?: (path: string) => number | undefined): void
  stop(): void
  /** Real time went by (an animation frame): the clock plays, live leaves fall due, captions are heard. */
  frame(dt: number): void
  snapshot(): SessionSnapshot
  subscribe(fn: () => void): () => void
  /** The log was replaced (the feed started over). */
  onReset(fn: () => void): () => void
  /** Live: try the hub again now. */
  retry(): void
}

export interface SessionOptions {
  /** Opens playing from the start (a recording, a story); off with `?play=0` or a `?st=` seek. */
  autoplay?: boolean
  /** Seconds into the session to open at, once it is loaded (`?st=`). */
  openAt?: number
  /** Live time (tests). */
  now?: () => number
  throttle?: ThrottleOptions
}

export function createSession(feed: Feed, opts: SessionOptions = {}): HallSession {
  const now = opts.now ?? Date.now
  const live = feed.kind === "live"
  const clock = createSessionClock({ live })
  let placeOf: ((path: string) => number | undefined) | undefined
  let log = new EventLog()
  let ctx: NormalizeContext = normalizer()
  let teller: Teller | null = null
  let narrator: Narrator | null = null
  /** The next told moment the narrator has not passed. */
  let cursor = 0
  let lastAt = Number.NEGATIVE_INFINITY
  let jumps = 0
  let caption: Caption | undefined
  let chapters: readonly FeedChapter[] = []
  let status: FeedStatus = feed.status()
  let note: string | undefined
  let version = 0
  let started = false
  let loaded = false
  const resets = new Set<() => void>()

  const snapshot = (): SessionSnapshot => {
    const c = clock.get()
    const origin = log.events[0]?.at ?? null
    const rel = origin === null ? -1 : c.at - origin
    let chapter = -1
    chapters.forEach((ch, k) => {
      if (ch.at <= rel) chapter = k
    })
    return {
      version: version++,
      kind: feed.kind,
      name: feed.name,
      status,
      ...(note ? { note } : {}),
      clock: c,
      world: log.length ? log.stateAt(c.at) : emptyWorld(),
      events: log.length,
      ...(caption ? { caption } : {}),
      chapters,
      chapter,
    }
  }
  const store = throttled(snapshot, opts.throttle)
  clock.subscribe(() => store.invalidate())

  const append = (events: WorldEvent[]) => {
    if (events.length === 0) return
    try {
      log.append(...events)
    } catch {
      // out of order (a source's clock went back): the normaliser stamps in order, so this is a bug
      return
    }
    range()
  }
  const range = () => {
    const first = log.events[0]?.at
    if (first === undefined) return
    const last = (log.events.at(-1) as WorldEvent).at
    clock.setRange(first, live ? Math.max(last, now()) : last)
  }
  const narrate = () => {
    const start = teller?.start ?? 0
    narrator = new Narrator({ session: (id) => teller?.session(id) })
    return start
  }

  const sink: FeedSink = {
    reset() {
      log = new EventLog()
      ctx = normalizer(placeOf ? { placeOf } : {})
      teller = null
      narrator = null
      cursor = 0
      caption = undefined
      lastAt = Number.NEGATIVE_INFINITY
      for (const fn of [...resets]) fn()
      store.invalidate()
    },
    take(input: WireInput, news: boolean) {
      const isChange = "change" in input
      const at = isChange ? (input as GuildEvent).change.at : (input as SeaEvent).at
      if (!teller) {
        teller = new Teller(at)
        narrate()
      }
      if (isChange) teller.take((input as GuildEvent).change as Change, news)
      else teller.sight({ event: input as SeaEvent, at: at - teller.start }, news)
      append(normalize(input, ctx))
      store.invalidate()
    },
    loaded() {
      // a recording's subagents leave after their time, as they would have
      const last = log.events.at(-1)?.at
      if (last !== undefined) append(flush(ctx, last + ctx.goneMs))
      loaded = true
      const c = clock.get()
      if (opts.openAt !== undefined) clock.seek(c.start + opts.openAt * 1000, { jump: true })
      else if (opts.autoplay !== false) {
        clock.seek(c.start, { jump: true })
        clock.play(true)
      } else clock.seek(c.end, { jump: true })
      store.flush()
    },
    status(next, why) {
      status = next
      note = why
      store.invalidate()
    },
    chapters(list) {
      chapters = list
      store.invalidate()
    },
  }

  /** The narrator hears what the clock passed: news live, every moment while a replay plays forward. */
  const hearTo = (at: number, playing: boolean, mode: SessionClockState["mode"]) => {
    const history: readonly StoryMoment[] = teller?.history ?? []
    const start = teller?.start ?? 0
    if (!narrator || at < lastAt) {
      narrate()
      cursor = 0
      while (cursor < history.length && start + (history[cursor] as StoryMoment).at <= at) cursor++
      lastAt = at
      return
    }
    while (cursor < history.length && start + (history[cursor] as StoryMoment).at <= at) {
      const m = history[cursor++] as StoryMoment
      if (m.live || (mode === "replay" && playing)) narrator.hear({ ...m, live: true }, m.at)
    }
    lastAt = at
    const told = narrator.next(at - start)
    if (told) {
      caption = told
      store.invalidate()
    }
  }

  return {
    feed,
    clock,
    log: () => log,
    model: () => ctx.model,
    origin: () => log.events[0]?.at ?? null,
    start(bind) {
      if (started) return
      started = true
      placeOf = bind
      ctx = normalizer(placeOf ? { placeOf } : {})
      feed.start(sink)
    },
    stop() {
      feed.stop()
      store.dispose()
      resets.clear()
    },
    frame(dt) {
      if (live && log.length) {
        append(flush(ctx, now()))
        range()
      }
      const before = clock.get()
      if (loaded || live) clock.tick(dt)
      const c = clock.get()
      if (c.jumps !== jumps) {
        jumps = c.jumps
        narrator = null
      }
      hearTo(c.at, before.playing || c.playing, c.mode)
    },
    snapshot: () => store.get(),
    subscribe: (fn) => store.subscribe(fn),
    onReset(fn) {
      resets.add(fn)
      return () => resets.delete(fn)
    },
    retry() {
      if (feed instanceof LiveFeed) feed.retry()
    },
  }
}
