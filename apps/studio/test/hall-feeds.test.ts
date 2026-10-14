/**
 * The hall's feeds (hall/feeds): the live feed against a mock hub (seq dedup, the backlog rule, a hello
 * starting over, backoff), a recording replayed the same twice and scrubbed to what playing showed, the
 * session clock, and the 10 Hz snapshot store.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { Change, GuildEvent, SeaRecord } from "@guildhall/core"
import { EventLog, heroes, type WireInput } from "@guildhall/sim"
import { createSessionClock } from "../src/hall/feeds/clock.ts"
import type { FeedSink, FeedStatus } from "../src/hall/feeds/feed.ts"
import {
  BACKOFF_MAX_MS,
  BACKOFF_MS,
  hubUrlOf,
  LIVE_MS,
  LiveFeed,
  type SocketLike,
} from "../src/hall/feeds/live.ts"
import { ReplayFeed, recordingUrl } from "../src/hall/feeds/replay.ts"
import { createSession } from "../src/hall/feeds/session.ts"
import { throttled } from "../src/hall/feeds/store.ts"
import { actOf, STORY_EPOCH, StoryFeed } from "../src/hall/feeds/story.ts"
import { markersOf, rosterOf, shortPath } from "../src/hall/feeds/view.ts"
import { guildMatcher, hubMessage, readRecording } from "../src/hall/feeds/wire.ts"

const FIXTURES = join(import.meta.dir, "../../../packages/core/test/events/fixtures")

/** Timers that run only when told: `advance(ms)` runs what fell due, in order. */
function fakeTime(start = 0) {
  let now = start
  let id = 0
  const due = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      due.set(++id, { at: now + ms, fn })
      return id
    },
    clearTimer: (t: unknown) => void due.delete(t as number),
    waits: () => [...due.values()].map((d) => d.at - now),
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        due.delete(next[0])
        now = next[1].at
        next[1].fn()
      }
      now = end
    },
  }
}

/** A hub's socket, driven by the test. */
class MockSocket implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  closed = false
  constructor(readonly url: string) {}
  close() {
    this.closed = true
  }
  open() {
    this.onopen?.({})
  }
  send(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  drop() {
    this.onclose?.({})
  }
}

/** A sink that writes down what it is told. */
function recordingSink() {
  const taken: { input: WireInput; news: boolean }[] = []
  const statuses: FeedStatus[] = []
  let resets = 0
  const sink: FeedSink = {
    reset: () => {
      resets++
      taken.length = 0
    },
    take: (input, news) => void taken.push({ input, news }),
    status: (s) => void statuses.push(s),
  }
  return { sink, taken, statuses, resets: () => resets }
}

const change = (id: string, at: number): Change => ({ type: "session", id, agent: "build", at }) as Change
const ev = (guild: string, seq: number, at: number): GuildEvent => ({
  v: 1,
  guild,
  seq,
  change: change(`ses_${guild}`, at),
})
const seqs = (taken: { input: WireInput }[]) => taken.map((t) => (t.input as GuildEvent).seq)

function liveFeed(time = fakeTime(1_000_000)) {
  const sockets: MockSocket[] = []
  const feed = new LiveFeed({
    guild: guildMatcher("Codestz/guildhall"),
    name: "guildhall",
    socket: (url) => {
      const s = new MockSocket(url)
      sockets.push(s)
      return s
    },
    ...time,
  })
  return { feed, sockets, time }
}

describe("LiveFeed (a mock hub)", () => {
  test("a hello is history; a repeat seq is dropped; other guilds are not this repo's", () => {
    const { feed, sockets, time } = liveFeed()
    const rec = recordingSink()
    feed.start(rec.sink)
    const s = sockets[0] as MockSocket
    expect(s.url).toBe("ws://127.0.0.1:4747/ws")
    expect(feed.status()).toBe("connecting")
    s.open()
    expect(feed.status()).toBe("live")
    const t = time.now()
    s.send({
      type: "hello",
      version: 1,
      events: [ev("guildhall", 1, t - 9e5), ev("guildhall", 2, t - 8e5), ev("codestz", 7, t)],
    })
    expect(rec.resets()).toBe(1)
    expect(seqs(rec.taken)).toEqual([1, 2])
    expect(rec.taken.every((x) => !x.news)).toBe(true)
    // a resend of 2 with 3 new: only 3, as news (it is fresh)
    s.send({
      type: "events",
      events: [ev("guildhall", 2, t), ev("guildhall", 3, t), ev("guildhall·2", 1, t)],
    })
    expect(seqs(rec.taken)).toEqual([1, 2, 3, 1])
    expect(rec.taken.slice(2).every((x) => x.news)).toBe(true)
    // junk never throws and is never taken
    s.onmessage?.({ data: "not json" })
    s.onmessage?.({ data: JSON.stringify({ type: "events", events: [{ guild: "guildhall", seq: 9 }] }) })
    expect(rec.taken).toHaveLength(4)
  })

  test("the backlog rule: a change older than LIVE_MS when it arrives is history, not news", () => {
    const { feed, sockets, time } = liveFeed()
    const rec = recordingSink()
    feed.start(rec.sink)
    const s = sockets[0] as MockSocket
    s.open()
    s.send({ type: "hello", version: 1, events: [] })
    const t = time.now()
    s.send({
      type: "events",
      events: [ev("guildhall", 1, t - LIVE_MS - 1), ev("guildhall", 2, t - LIVE_MS), ev("guildhall", 3, t)],
    })
    expect(rec.taken.map((x) => x.news)).toEqual([false, true, true])
  })

  test("a fresh hello starts over: the sink resets and old seqs count again", () => {
    const { feed, sockets, time } = liveFeed()
    const rec = recordingSink()
    feed.start(rec.sink)
    const s = sockets[0] as MockSocket
    s.open()
    const t = time.now()
    s.send({ type: "hello", version: 1, events: [ev("guildhall", 1, t), ev("guildhall", 2, t)] })
    s.send({
      type: "hello",
      version: 1,
      events: [ev("guildhall", 1, t), ev("guildhall", 2, t), ev("guildhall", 3, t)],
    })
    expect(rec.resets()).toBe(2)
    expect(seqs(rec.taken)).toEqual([1, 2, 3])
  })

  test("sea records of this repo's guilds come through, news only after the hello", () => {
    const { feed, sockets, time } = liveFeed()
    const rec = recordingSink()
    feed.start(rec.sink)
    const s = sockets[0] as MockSocket
    s.open()
    const sea = (guild: string, id: string): SeaRecord => ({
      v: 1,
      guild,
      event: {
        kind: "push",
        id,
        repo: "Codestz/guildhall",
        at: time.now(),
        branch: "v2",
        commits: 1,
        author: "c",
        sha: "abc",
      } as SeaRecord["event"],
    })
    s.send({ type: "hello", version: 1, events: [], sea: [sea("guildhall", "a"), sea("other", "b")] })
    s.send({ type: "sea", events: [sea("guildhall", "c")] })
    expect(rec.taken.map((x) => [(x.input as { id: string }).id, x.news])).toEqual([
      ["a", false],
      ["c", true],
    ])
  })

  test("backoff: a lost hub is tried again after 0.5 s, doubling to 10 s, and back to 0.5 s once it answers", () => {
    const { feed, sockets, time } = liveFeed()
    const rec = recordingSink()
    feed.start(rec.sink)
    const waits: number[] = []
    for (let k = 0; k < 7; k++) {
      ;(sockets.at(-1) as MockSocket).drop()
      expect(feed.status()).toBe("offline")
      waits.push(time.waits()[0] as number)
      time.advance(waits.at(-1) as number)
      expect(feed.status()).toBe("connecting")
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, BACKOFF_MAX_MS, BACKOFF_MAX_MS])
    expect(sockets).toHaveLength(8)
    ;(sockets.at(-1) as MockSocket).open()
    expect(feed.backoff()).toBe(BACKOFF_MS)
    ;(sockets.at(-1) as MockSocket).drop()
    expect(time.waits()).toEqual([BACKOFF_MS])
  })

  test("stop closes the socket and no retry follows", () => {
    const { feed, sockets, time } = liveFeed()
    feed.start(recordingSink().sink)
    ;(sockets[0] as MockSocket).drop()
    feed.stop()
    time.advance(60_000)
    expect(sockets).toHaveLength(1)
    const live = liveFeed()
    live.feed.start(recordingSink().sink)
    live.feed.stop()
    expect((live.sockets[0] as MockSocket).closed).toBe(true)
  })

  test("a link's hub must be on this machine", () => {
    expect(hubUrlOf(null)).toBe("ws://127.0.0.1:4747/ws")
    expect(hubUrlOf("ws://localhost:4748/ws")).toBe("ws://localhost:4748/ws")
    expect(hubUrlOf("ws://evil.example/ws")).toBe("ws://127.0.0.1:4747/ws")
    expect(hubUrlOf("wss://127.0.0.1:4747/ws")).toBe("ws://127.0.0.1:4747/ws")
    expect(hubUrlOf("nonsense")).toBe("ws://127.0.0.1:4747/ws")
  })
})

describe("the wire, read", () => {
  test("a repo's guilds: its name and its numbered clones, nothing that merely starts with it", () => {
    const mine = guildMatcher("Codestz/guildhall")
    expect(["guildhall", "Guildhall", "guildhall·2", "guildhall·12"].map(mine)).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(["guildhall-site", "guildhall·x", "codestz", "guild"].map(mine)).toEqual([
      false,
      false,
      false,
      false,
    ])
    expect(guildMatcher("guildhall·2", true)("guildhall")).toBe(false)
  })

  test("hub messages are checked; a recording reads chronicle lines, sea records and V1's raw runs", async () => {
    expect(hubMessage("{")).toBeUndefined()
    expect(hubMessage(JSON.stringify({ type: "nope", events: [] }))).toBeUndefined()
    expect(hubMessage(JSON.stringify({ type: "hello", events: [ev("g", 1, 5)] }))).toMatchObject({ sea: [] })
    const chronicle = [ev("guildhall", 1, 10), ev("guildhall", 2, 11)]
      .map((e) => JSON.stringify(e))
      .join("\n")
    expect(readRecording(`${chronicle}\nbroken\n`)).toMatchObject({ guilds: ["guildhall"], skipped: 1 })
    for (const v of [1, 2]) {
      const raw = await Bun.file(join(FIXTURES, `v${v}.jsonl`)).text()
      const read = readRecording(raw)
      expect(read.guilds).toEqual(["recorded"])
      expect(read.inputs.length).toBeGreaterThan(50)
      expect(seqs(read.inputs.map((input) => ({ input })))).toEqual(read.inputs.map((_, i) => i + 1))
    }
  })

  test("a link's recording stays on this origin", () => {
    expect(recordingUrl("guildhall", null)).toBe("/chronicles/guildhall/latest.jsonl")
    expect(recordingUrl("guildhall·2", "2026-10-06T05-13-43-981Z")).toBe(
      "/chronicles/guildhall%C2%B72/2026-10-06T05-13-43-981Z.jsonl",
    )
    expect(recordingUrl("g", "../../etc/passwd")).toBe("/chronicles/g/....etcpasswd.jsonl")
    expect(recordingUrl("g", "//evil.example/x.jsonl")).toBe("/chronicles/g/evil.examplex.jsonl")
    expect(recordingUrl("g", "/lab/x.jsonl")).toBe("/lab/x.jsonl")
  })

  test("a path read from the repo's folder on, worktrees too", () => {
    expect(shortPath("/u/me/guildhall/packages/world/src/a.ts", "guildhall")).toBe("packages/world/src/a.ts")
    expect(shortPath("/u/me/guildhall/.claude/worktrees/agent-1/packages/ui/x.ts", "guildhall")).toBe(
      "packages/ui/x.ts",
    )
    expect(shortPath("/work/src/a/b.ts", "guildhall")).toBe("src/a/b.ts")
  })
})

/** A session on a recording, every snapshot at once (no throttle). */
const instant = {
  every: 0,
  setTimer: (fn: () => void) => {
    fn()
    return 0
  },
  clearTimer: () => {},
}

async function replayed(text: string, opts: { autoplay?: boolean } = {}) {
  const session = createSession(new ReplayFeed({ name: "test", load: async () => text }), {
    ...opts,
    throttle: instant,
  })
  session.start()
  await Bun.sleep(0)
  return session
}

describe("replay", () => {
  test("a recording replays to the same log every time, and opens playing from its start", async () => {
    const text = await Bun.file(join(FIXTURES, "v2.jsonl")).text()
    const a = await replayed(text)
    const b = await replayed(text)
    expect(a.log().events.length).toBeGreaterThan(10)
    expect(a.log().events).toEqual(b.log().events)
    const c = a.clock.get()
    expect(c).toMatchObject({ mode: "replay", playing: true, at: c.start })
    expect(a.snapshot().status).toBe("replay")
    expect(heroes(a.log().head)).toHaveLength(1) // the explorer has left; the guildmaster keeps its seat
  })

  test("scrub = play: the world playing reaches at t is the world a seek to t shows", async () => {
    const text = await Bun.file(join(FIXTURES, "v1.jsonl")).text()
    const played = await replayed(text)
    const sought = await replayed(text, { autoplay: false })
    const { start, end } = played.clock.get()
    const fold = (log: EventLog, t: number) => {
      const fresh = new EventLog(1e9)
      for (const e of log.events) if (e.at <= t) fresh.append(e)
      return fresh.head
    }
    played.clock.setRate(8)
    let frames = 0
    while (played.clock.get().playing && frames < 100_000) {
      played.frame(1 / 60 + (frames % 7) * 0.003)
      frames++
      if (frames % 97 === 0) {
        const t = played.clock.get().at
        sought.clock.seek(t)
        sought.frame(0)
        expect(sought.snapshot().world).toEqual(played.snapshot().world)
        expect(played.snapshot().world).toEqual(fold(played.log(), t))
      }
    }
    expect(played.clock.get().at).toBe(end)
    expect(end).toBeGreaterThan(start)
  })

  test("a told story plays from a fixed morning, with its acts", async () => {
    const session = createSession(new StoryFeed("saga"), {
      autoplay: false,
      throttle: instant,
    })
    session.start()
    await Bun.sleep(0)
    expect(session.origin()).toBe(STORY_EPOCH)
    const snap = session.snapshot()
    expect(snap.chapters.map((c) => c.numeral)).toEqual(["I", "II", "III", "IV", "V"])
    expect(snap.chapter).toBe(4)
    // midway the guild is busy: the guildmaster and the three heroes it sent at once
    let most = 0
    for (let s = 0; s <= 170; s += 5) {
      session.clock.seek(STORY_EPOCH + s * 1000)
      session.frame(0)
      const at = session.snapshot()
      most = Math.max(most, rosterOf(at.world, at.clock.at, () => "the town").length)
    }
    expect(most).toBeGreaterThanOrEqual(4)
    session.clock.seek(STORY_EPOCH + 90_000)
    session.frame(0)
    const mid = session.snapshot()
    const roster = rosterOf(mid.world, mid.clock.at, () => "the town")
    expect(roster.filter((h) => h.master).length).toBeGreaterThanOrEqual(1)
    expect(mid.chapter).toBeGreaterThanOrEqual(1)
    const marks = markersOf(session.log().events, STORY_EPOCH)
    expect(marks.some((m) => m.kind === "quest")).toBe(true)
    expect(marks.every((m) => m.at >= 0)).toBe(true)
  })

  test("?act=N opens a story at that act, playing; a bad act or ?play=0 or ?st= is honoured", async () => {
    expect(actOf(new URLSearchParams("act=3"))).toBe(3)
    expect(actOf(new URLSearchParams("act=0"))).toBeUndefined()
    expect(actOf(new URLSearchParams("act=9"))).toBeUndefined()
    expect(actOf(new URLSearchParams("act=x"))).toBeUndefined()
    expect(actOf(new URLSearchParams(""))).toBeUndefined()
    const open = async (act: number | undefined, o: { autoplay?: boolean; openAt?: number } = {}) => {
      const session = createSession(new StoryFeed("saga", act ? { act } : {}), { throttle: instant, ...o })
      session.start()
      await Bun.sleep(0)
      return session
    }
    const three = await open(3)
    const snap = three.snapshot()
    expect(snap.chapter).toBe(2)
    expect(snap.clock.playing).toBe(true)
    expect(snap.clock.at - three.origin()).toBe(snap.chapters[2]?.at as number)
    expect((await open(undefined)).snapshot().chapter).toBe(0)
    const paused = (await open(2, { autoplay: false })).snapshot()
    expect(paused.chapter).toBe(1)
    expect(paused.clock.playing).toBe(false)
    // a ?st= seek wins over the act
    const st = (await open(4, { openAt: 5 })).snapshot()
    expect(st.clock.at - STORY_EPOCH).toBe(5000)
  })

  test("captions are told as a replay plays, not across a seek", async () => {
    const session = createSession(new StoryFeed("party"), {
      throttle: instant,
    })
    session.start()
    await Bun.sleep(0)
    const keys = new Set<number>()
    for (let k = 0; k < 60 * 120 && session.clock.get().playing; k++) {
      session.frame(1 / 60)
      const c = session.snapshot().caption
      if (c) keys.add(c.key)
    }
    expect(keys.size).toBeGreaterThan(3)
    // a jump back tells nothing of what lies between
    const told = session.snapshot().caption?.key
    session.clock.seek(session.clock.get().start, { jump: true })
    session.frame(1 / 60)
    expect(session.snapshot().caption?.key).toBe(told)
  })
})

describe("the session clock", () => {
  test("live follows the end; a pause holds it; playing on catches up and goes live again", () => {
    const c = createSessionClock({ live: true })
    c.setRange(1000, 5000)
    expect(c.get()).toMatchObject({ mode: "live", at: 5000 })
    c.setRange(1000, 6000)
    expect(c.get().at).toBe(6000)
    c.play(false)
    c.setRange(1000, 7000)
    expect(c.get()).toMatchObject({ mode: "replay", at: 6000 })
    c.play(true)
    c.tick(0.25)
    expect(c.get().at).toBe(6250)
    for (let k = 0; k < 10; k++) c.tick(0.25)
    expect(c.get()).toMatchObject({ mode: "live", at: 7000 })
    c.seek(2000)
    c.goLive()
    expect(c.get()).toMatchObject({ mode: "live", at: 7000 })
  })

  test("a recording plays at its rate, stops at its end, and plays again from its start", () => {
    const c = createSessionClock()
    c.setRange(0, 10_000)
    c.seek(0)
    c.setRate(4)
    c.play(true)
    c.tick(1) // capped at 0.25 s
    expect(c.get().at).toBe(1000)
    while (c.tick(0.25));
    expect(c.get()).toMatchObject({ at: 10_000, playing: false, mode: "replay" })
    c.play(true)
    expect(c.get()).toMatchObject({ at: 0, playing: true, jumps: 1 })
    c.goLive()
    expect(c.get().mode).toBe("replay")
  })
})

describe("the snapshot store", () => {
  test("at most one snapshot per 100 ms however often it is told, and the same object between", () => {
    const time = fakeTime()
    let computed = 0
    const store = throttled(() => ({ n: ++computed }), time)
    let heard = 0
    store.subscribe(() => heard++)
    const first = store.get()
    expect(store.get()).toBe(first)
    // 1,000 changes over a second (one a millisecond)
    for (let ms = 0; ms < 1000; ms++) {
      store.invalidate()
      time.advance(1)
    }
    time.advance(100)
    expect(computed - 1).toBeGreaterThanOrEqual(9)
    expect(computed - 1).toBeLessThanOrEqual(11)
    expect(heard).toBe(computed - 1)
    // quiet: nothing more
    const was = computed
    time.advance(1000)
    expect(computed).toBe(was)
    // a change after a quiet spell is seen at once (the interval has run out)
    store.invalidate()
    time.advance(0)
    expect(computed).toBe(was + 1)
    // flush: now, and the next waits a whole interval again
    store.flush()
    store.invalidate()
    expect(time.waits()).toEqual([100])
    store.dispose()
    time.advance(500)
    expect(computed).toBe(was + 2)
  })
})
