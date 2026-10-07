import { type EventKind, type Renown, WorldEvents } from "../../src/guild/events.ts"
import type { Moment } from "../../src/guild/moments.ts"
import { GuildStore, type StoryChapter } from "../../src/guild/store.ts"
import { DURATION_S } from "../../src/scene/events/common.ts"

/** A show the scheduler started, with when: real ms since play began, and the story's run time. */
export interface Started {
  kind: EventKind
  real: number
  run: number
  renown: Renown
}

/** Everything a played-through Saga did, each with its run time (ms). */
export interface SagaPlay {
  store: GuildStore
  duration: number
  /** Real ms the whole play took (fast-forward makes it shorter than `duration`). */
  real: number
  chapters: { chapter: StoryChapter; run: number }[]
  earned: Renown[]
  started: Started[]
  /** Every live moment, as the hall heard it. */
  moments: Moment[]
  /** The weather each time it changed. */
  weather: { run: number; weather: string }[]
  /** Hour of the story clock at each chapter's start. */
  hours: number[]
  /** Most parties on the island at once, and when the second party set out for the gate. */
  mostParties: number
  /** Graveyard: each skeleton's state changes (rising, vigil, sinking). */
  graves: { run: number; id: string; state: string }[]
  /** Most adventurers on stage at once, and when. */
  peak: { count: number; run: number }
  /** Real ms at which the story's clock reached run time `run` (fast-forward makes them differ). */
  realAt(run: number): number
  /** The main party's totals at the end. */
  tokens: number
  cost: number
}

/**
 * Play the Saga through the store as the hall does, frame by frame (`step` real ms), with the
 * Cinematic director's fast-forward on, and the world-event scheduler on the same real clock the
 * scene would give it: each timed show ends after its scene's length, a lasting one soon after it
 * is told to leave. Nothing is forced.
 */
export function playSaga(step = 50): SagaPlay {
  const store = new GuildStore()
  store.load("saga")
  store.setEnvironment({ time: "story" })
  let real = 0
  const events = new WorldEvents(
    { session: (id) => store.sessionOf(id), party: () => store.party() },
    () => real,
  )
  events.attach(store.moments)
  const play: SagaPlay = {
    store,
    duration: store.duration,
    real: 0,
    chapters: [],
    earned: events.ledger.earned,
    started: [],
    moments: [],
    weather: [],
    hours: [],
    mostParties: 0,
    graves: [],
    peak: { count: 0, run: 0 },
    tokens: 0,
    cost: 0,
    realAt: (run) => trace.find(([at]) => at >= run)?.[1] ?? real,
  }
  /** [run, real] each frame: the fast-forward's map. */
  const trace: [number, number][] = []
  const ends = new Map<number, number>()
  events.onStart((show) => {
    play.started.push({ kind: show.kind, real, run: store.time, renown: show.renown })
    const length = DURATION_S[show.kind]
    if (Number.isFinite(length)) ends.set(show.id, real + length * 1000)
  })
  store.onChapter((chapter) => {
    play.chapters.push({ chapter, run: store.time })
  })
  store.moments.on((m) => play.moments.push(m))

  let sinceEvents = 0
  let last = -1
  const seen = new Map<string, string>()
  while (store.time >= last && store.time < store.duration) {
    last = store.time
    store.tick(step)
    real += step
    trace.push([store.time, real])
    sinceEvents += step
    if (sinceEvents >= 250) {
      sinceEvents = 0
      events.tick(store.moments)
      for (const show of events.shows) {
        if (show.leaving && !ends.has(show.id)) ends.set(show.id, real + 6000)
        if ((ends.get(show.id) ?? Number.POSITIVE_INFINITY) <= real) events.done(show.id)
      }
    }
    const weather = store.environment.weather
    if (play.weather.at(-1)?.weather !== weather) play.weather.push({ run: store.time, weather })
    play.mostParties = Math.max(play.mostParties, store.parties.length)
    if (store.views.length > play.peak.count) play.peak = { count: store.views.length, run: store.time }
    for (const riser of store.undead.risers)
      if (seen.get(riser.key) !== riser.state) {
        seen.set(riser.key, riser.state)
        play.graves.push({ run: store.time, id: riser.id, state: riser.state })
      }
  }
  play.earned = [...events.ledger.earned]
  play.tokens = store.party().reduce((sum, s) => sum + s.tokens, 0)
  play.cost = store.party().reduce((sum, s) => sum + s.cost, 0)
  for (const chapter of store.chapters) {
    store.seek(chapter.at)
    play.hours.push(store.environment.hour)
  }
  play.real = real
  return play
}
