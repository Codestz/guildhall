import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Change, GuildEvent, SeaEvent, SeaRecord } from "@guildhall/core"
import { party as partyStory, seas as seasStory, toEvents } from "@guildhall/sim"
import { GuildStore, RUSH, type ScenarioId } from "../src/guild/store.ts"

/**
 * The store transcript (architecture review 2026-10-08 §2.1; ADR 0012): `GuildStore` driven headless
 * through every scenario and a scripted live hub, with seeks, pauses, pace changes and the viewer's
 * intents, and everything its readers see written down at fixed steps — views, the log, the moment
 * stream, markers, parties, the environment, the sea, the Legends' inputs, the clocks. It was
 * recorded on the store before it was split into feeds, so a byte-for-byte match is the proof that
 * the split moved nothing. `UPDATE=1` re-records it (say why).
 */
const FIXTURE = join(import.meta.dir, "fixtures/storeTranscript.json")
const STEP = 100
/** Wall clock the whole transcript runs at (environment time "real", live mode's clock). */
const T0 = Date.UTC(2026, 9, 8, 14, 30)

/** Seeded Math.random (the undead's poses): the same draws before and after the split. */
function seed(n: number): void {
  let s = n >>> 0
  Math.random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)
const round = (n: number) => Math.round(n * 1e6) / 1e6
const json = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === "number" ? round(v) : v))

/** Everything a reader of the store sees, one line per field group. */
function snap(store: GuildStore, label: string): string[] {
  const env = store.environment
  return [
    `# ${label}`,
    `clock ${json({
      mode: store.mode,
      scenario: store.scenario,
      time: store.time,
      duration: store.duration,
      now: store.now,
      speed: store.speed,
      fastForward: store.fastForward,
      connected: store.connected,
      guild: store.guild,
      chapter: store.chapter?.numeral ?? null,
      rebuilds: store.rebuilds,
      lastEventAt: store.lastEventAt,
    })}`,
    `stage ${store.selected ?? "-"} ${store.following ?? "-"} ${store.focus?.id ?? "-"} ${store.progress} ${digest(
      json({
        selected: store.selected,
        following: store.following,
        focus: store.focus,
        onCamera: store.onCamera ?? null,
        progress: store.progress,
        traces: store.traces,
        bard: store.bard,
        view: store.view,
        mood: store.mood.id,
        director: store.directorStyle,
        framing: store.framing,
      }),
    )}`,
    `env ${env.weather} ${round(env.hour)} ${digest(json(env))}`,
    // Each view in brief, and every field of every view by digest (a byte-for-byte match).
    ...store.views.map(
      (v) => `view ${v.id} ${v.title} ${v.phase} ${v.station ?? v.site ?? "-"} ${json(v.target)}`,
    ),
    `views ${digest(store.views.map(json).join("\n"))}`,
    `parties ${store.parties.map((p) => `${p.id}:${p.sessions.length}`).join(" ")} ${digest(
      json(
        store.parties.map((p) => ({
          id: p.id,
          color: p.color,
          seat: p.seat,
          newest: p.newest,
          leaving: p.leaving,
          arriving: p.arriving,
          idleSince: p.idleSince ?? null,
          sessions: p.sessions.map((s) => s.id),
        })),
      ),
    )}`,
    `legends ${store.focalParty?.id ?? "-"} ${digest(json(store.party().map((s) => s.id)))}`,
    `log ${store.log.length} ${json(store.log.at(-1) ?? null)} ${digest(json(store.log))}`,
    `markers ${store.markers.length} ${digest(json(store.markers))}`,
    `sea ${store.sea.length} ${digest(json(store.sea.map((s) => [s.event.id, s.at])))}`,
    `moments ${store.moments.history.length}`,
    `undead ${json(store.undead.risers)}`,
    `cut ${json({ scope: store.director.scope ? [...store.director.scope] : null, shot: store.director.shot.kind, excitement: store.director.excitement() })}`,
  ]
}

/** A store with its moment stream, chapter cards and notifications written into `out`. */
function watched(out: string[]): GuildStore {
  const store = new GuildStore()
  store.moments.on((m) => {
    const { seq, kind, id, at, live, master, title } = m
    out.push(`moment ${json({ seq, kind, id, at, live, master, title })}`)
  })
  store.moments.onRebuild((epoch, continued) => out.push(`rebuild ${epoch} ${continued}`))
  store.onChapter((c) => out.push(`chapter ${c.numeral} ${c.at}`))
  store.subscribe(() => heard.set(out, (heard.get(out) ?? 0) + 1))
  return store
}

/** Notifications each transcript's store sent its subscribers. */
const heard = new WeakMap<string[], number>()

/** Tick `steps` × STEP, snapshotting every `every` steps. */
function play(store: GuildStore, out: string[], steps: number, every: number, label: string): void {
  for (let i = 1; i <= steps; i++) {
    store.tick(STEP)
    if (i % every === 0) out.push(...snap(store, `${label} +${i}`))
  }
}

function sim(scenario: ScenarioId): string[] {
  seed(7)
  const out: string[] = []
  const store = watched(out)
  store.load(scenario)
  out.push(...snap(store, "load"))
  play(store, out, 300, 25, "play")
  store.setSpeed(2)
  play(store, out, 150, 25, "pace 2")
  store.setSpeed(0)
  play(store, out, 20, 10, "paused")
  store.setSpeed(1)
  const someone = store.views.find((v) => !v.master)?.id ?? store.views[0]?.id ?? null
  store.select(someone)
  play(store, out, 60, 20, `selected ${someone}`)
  store.select(null)
  store.seek(store.duration / 2)
  out.push(...snap(store, "seek half"))
  play(store, out, 100, 25, "after seek")
  store.follow(store.parties.at(-1)?.id ?? null)
  play(store, out, 40, 20, "following")
  store.follow(null)
  store.setBard(false)
  store.setNames("source")
  out.push(...snap(store, "names source, no bard"))
  play(store, out, 40, 20, "no bard")
  store.setBard(true)
  store.setDirector("calm")
  play(store, out, 40, 20, "calm")
  store.setDirector("cinematic")
  store.seek(store.duration - 1500)
  play(store, out, 40, 10, "loop")
  out.push(`heard ${heard.get(out) ?? 0}`)
  return out
}

function saga(): string[] {
  seed(11)
  const out: string[] = []
  const store = watched(out)
  store.load("saga")
  store.setEnvironment({ time: "story" })
  out.push(...snap(store, "load"))
  play(store, out, 200, 40, "opening")
  for (let i = 0; i < store.chapters.length; i++) {
    store.seekChapter(i)
    out.push(...snap(store, `act ${i}`))
    play(store, out, 300, 50, `act ${i}`)
  }
  store.seek(store.chapters[2]?.at ?? 0)
  store.setSpeed(4)
  play(store, out, 200, 50, "pace 4")
  out.push(`heard ${heard.get(out) ?? 0}`)
  return out
}

/** A stand-in for the browser's WebSocket: the test is the hub, and calls its handlers itself. */
class FakeSocket {
  static opened: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((message: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
  }
  close(): void {
    this.closed = true
  }
  send(message: unknown): void {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) })
  }
}

function live(): string[] {
  seed(13)
  const out: string[] = []
  let clock = T0
  const at = (ms: number) => {
    clock = ms
    setSystemTime(new Date(ms))
  }
  const tick = (store: GuildStore, steps: number, every: number, label: string) => {
    for (let i = 1; i <= steps; i++) {
      at(clock + STEP)
      store.tick(STEP)
      if (i % every === 0) out.push(...snap(store, `${label} +${i}`))
    }
  }
  // The party story, rebased so its first half is history a minute old and the rest arrives live.
  const changes: Change[] = partyStory()
  const first = changes[0]?.at ?? 0
  const rebased = changes.map((c) => ({ ...c, at: c.at - first + T0 - 60_000 }))
  const events: GuildEvent[] = toEvents(rebased, "g")
  const half = Math.floor(events.length / 2)
  const { sea } = seasStory()
  const seaFirst = sea[0]?.at ?? 0
  const records: SeaRecord[] = sea.map((event: SeaEvent) => ({
    v: 1,
    guild: "g",
    event: { ...event, at: event.at - seaFirst + T0 - 120_000 },
  }))

  at(T0)
  const store = watched(out)
  store.live("ws://127.0.0.1:4747/ws")
  const socket = FakeSocket.opened.at(-1) as FakeSocket
  out.push(`socket ${socket.url}`)
  out.push(...snap(store, "live, unopened"))
  socket.onopen?.()
  out.push(...snap(store, "open"))
  socket.send({ type: "hello", version: 1, events: events.slice(0, half), sea: records.slice(0, 5) })
  out.push(...snap(store, "hello"))
  tick(store, 30, 10, "after hello")
  // Live events, each arriving as it happens; a repeat of the last seq is ignored.
  for (let i = half; i < events.length; i++) {
    const event = events[i] as GuildEvent
    at(Math.max(clock, event.change.at - 60_000 + 30_000))
    socket.send({ type: "events", events: [{ ...event, change: { ...event.change, at: clock } }] })
    if (i === half + 2) socket.send({ type: "events", events: [event] })
    if (i % 4 === 0) out.push(...snap(store, `event ${i}`))
    tick(store, 3, 3, `event ${i} tick`)
  }
  // Backlog from another guild: older than LIVE_MS, history rather than news.
  socket.send({
    type: "events",
    events: [
      {
        v: 1,
        guild: "h",
        seq: 1,
        change: { type: "session", id: "h1", agent: "guild-master", title: "old", at: clock - 20_000 },
      },
    ],
  })
  out.push(...snap(store, "backlog"))
  socket.send({ type: "sea", events: records.slice(3, 9) })
  out.push(...snap(store, "sea news"))
  socket.send("not json")
  socket.send({ type: "mystery", events: [] })
  socket.send({ type: "events", events: [{ bad: true }] })
  out.push(...snap(store, "junk"))
  tick(store, 80, 20, "quiet")
  store.setNames("source")
  out.push(...snap(store, "names source"))
  store.follow(store.parties[0]?.id ?? null)
  out.push(...snap(store, "follow"))
  // The hub restarts: a fresh hello with everything so far and the whole sea.
  socket.send({
    type: "hello",
    version: 1,
    events: events.map((e) => ({ ...e, change: { ...e.change, at: Math.min(e.change.at, clock) } })),
    sea: records,
  })
  out.push(...snap(store, "second hello"))
  tick(store, 60, 20, "after second hello")
  socket.onclose?.()
  out.push(...snap(store, "closed"))
  store.load("party")
  out.push(`socket closed ${socket.closed}`)
  out.push(...snap(store, "back to party"))
  out.push(`heard ${heard.get(out) ?? 0}`)
  return out
}

function transcript(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const scenario of ["party", "solo", "rush", "parties", "factions", "seas"] as const) {
    if (scenario === "rush") RUSH.count = 12
    out[scenario] = sim(scenario)
    delete RUSH.count
  }
  out.saga = saga()
  out.live = live()
  return out
}

describe("store transcript", () => {
  const random = Math.random
  const socket = globalThis.WebSocket
  beforeAll(() => {
    setSystemTime(new Date(T0))
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  })
  afterAll(() => {
    setSystemTime()
    Math.random = random
    globalThis.WebSocket = socket
  })

  test("every scenario and a live hub read the same as when recorded", () => {
    const now = transcript()
    if (process.env.UPDATE === "1" || !existsSync(FIXTURE))
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`)
    const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string[]>
    expect(Object.keys(now)).toEqual(Object.keys(recorded))
    for (const [name, lines] of Object.entries(recorded)) expect(now[name], name).toEqual(lines)
  })
})
