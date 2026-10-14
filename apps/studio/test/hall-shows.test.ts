import { describe, expect, test } from "bun:test"
import type { EventSites, Show as RenderShow, ShowKind as RenderShowKind, Shows } from "@guildhall/render"
import { forcedShow, type Show } from "@guildhall/sim"
import { createEvents } from "../src/hall/events.ts"
import { createSession, type HallSession } from "../src/hall/feeds/session.ts"
import { StoryFeed } from "../src/hall/feeds/story.ts"
import { driveSkyShows, seaShowsOf, skyPlan, skyShowOf } from "../src/hall/shows.ts"

/**
 * The engine's shows on the island (hall/shows.ts): the mapping to render shows/ (seconds on the
 * session's clock) and render sea/ (ms), the sync's plan, and "World events" played through a fake
 * render: each sky show plays once, at the engine's start, and a seek replays nothing.
 */

const instant = {
  every: 0,
  setTimer: (fn: () => void) => {
    fn()
    return 0
  },
  clearTimer: () => {},
}

describe("engine → render", () => {
  test("a sky show is the engine's, in seconds; the sea's and the graves are not render shows/'", () => {
    const dragon = forcedShow("dragon", 12_000, 1)
    expect(skyShowOf(dragon)).toEqual({
      kind: "dragon",
      start: 12,
      end: Number.POSITIVE_INFINITY,
      params: { id: dragon.id, size: 3 },
    })
    const festival = forcedShow("festival", 60_000, 2)
    expect(skyShowOf(festival)).toMatchObject({ kind: "festival", start: 60, end: 102 })
    for (const kind of ["ghostship", "raid", "undead"] as const)
      expect(skyShowOf(forcedShow(kind, 0, 3))).toBeNull()
  })

  test("the sea sails the ghost ship its own passage (an early end kept) and the raid until told to go", () => {
    const ghost = forcedShow("ghostship", 10_000, 1)
    const raid = forcedShow("raid", 20_000, 2)
    expect(seaShowsOf([ghost, raid, forcedShow("comet", 0, 3)])).toEqual([
      { kind: "ghostship", start: 10_000, params: { key: ghost.id } },
      { kind: "raid", start: 20_000, params: { key: raid.id } },
    ])
    const early: Show = { ...ghost, end: 20_000 }
    const leaving: Show = { ...raid, leave: 50_000, end: 70_000 }
    expect(seaShowsOf([early, leaving])).toEqual([
      { kind: "ghostship", start: 10_000, end: 20_000, params: { key: ghost.id } },
      { kind: "raid", start: 20_000, end: 50_000, params: { key: raid.id } },
    ])
  })

  test("the sync's plan: play the new, re-time only a moved end, stop another show's kind, clear on a seek", () => {
    const dragon = forcedShow("dragon", 0, 1)
    const none = new Map<RenderShowKind, { id: string; end: number }>()
    expect(skyPlan([dragon], none, false)).toEqual({
      clear: false,
      play: [skyShowOf(dragon) as RenderShow],
      stop: [],
    })
    const playing = new Map([["dragon" as RenderShowKind, { id: dragon.id, end: Number.POSITIVE_INFINITY }]])
    expect(skyPlan([dragon], playing, false)).toEqual({ clear: false, play: [], stop: [] })
    const leaving: Show = { ...dragon, leave: 30_000, end: 38_000 }
    expect(skyPlan([leaving], playing, false).play.map((p) => p.end)).toEqual([38])
    expect(skyPlan([], playing, false)).toEqual({ clear: false, play: [], stop: ["dragon"] })
    expect(skyPlan([forcedShow("dragon", 0, 9)], playing, false).stop).toEqual(["dragon"])
    expect(skyPlan([dragon], playing, true)).toEqual({
      clear: true,
      play: [skyShowOf(dragon) as RenderShow],
      stop: [],
    })
  })
})

/** A render shows/ that keeps the calls: plays on the session's clock, gone at its end. */
function fakeShows(session: HallSession) {
  const now = () => session.clock.get().at / 1000
  const on = new Map<RenderShowKind, RenderShow>()
  const calls: string[] = []
  const firsts: RenderShow[] = []
  const shows = {
    play(input: RenderShow | RenderShowKind) {
      const show = typeof input === "string" ? { kind: input, start: now(), end: now() + 30 } : { ...input }
      const current = on.get(show.kind)
      if (current) current.end = show.end
      else {
        on.set(show.kind, show)
        firsts.push(show)
      }
      calls.push(`play ${show.kind}`)
      return show
    },
    stop(kind?: RenderShowKind) {
      calls.push(`stop ${kind}`)
      if (kind) on.delete(kind)
    },
    clear() {
      calls.push("clear")
      on.clear()
    },
    playing() {
      for (const [k, s] of on) if (now() >= s.end) on.delete(k)
      return [...on.values()]
    },
  } as unknown as Shows
  return { shows, calls, firsts }
}

const sites: EventSites = {
  castle: [0, 9, 0],
  harbours: [],
  places: [],
  peak: { at: [10, 30, -5], reach: 20 },
  square: { at: [4, 2, 6], poles: [], cords: [] },
}

async function events(): Promise<HallSession> {
  const session = createSession(new StoryFeed("events"), { throttle: instant })
  session.start()
  await Bun.sleep(0)
  return session
}

describe("World events on the island", () => {
  test("each sky show plays once, at the engine's start, on the session's clock; the camera has its site", async () => {
    const session = await events()
    const hall = createEvents(session)
    const { shows, firsts } = fakeShows(session)
    const stop = driveSkyShows(shows, hall, { jumps: () => session.clock.get().jumps }, sites)
    const engine = new Map<string, Show>()
    const points = new Map<string, unknown>()
    for (let k = 0; k < 300 * 4 && session.clock.get().playing; k++) {
      session.frame(0.25)
      hall.read()
      for (const s of hall.shows()) {
        if (!engine.has(s.id)) engine.set(s.id, s)
        if (!points.has(s.kind)) points.set(s.kind, hall.pointOf({ id: s.id, show: s.kind }))
      }
    }
    stop()
    const sky = [...engine.values()].filter((s) => skyShowOf(s))
    expect(firsts.map((f) => f.kind)).toEqual(["dragon", "rainbow", "comet", "festival"])
    for (const f of firsts) {
      const s = sky.find((x) => x.id === f.params?.id) as Show
      expect([f.kind, f.start]).toEqual([s.kind, s.start / 1000])
    }
    // the director frames each: the dragon over the peaks, the festival over the square, the sky the middle
    expect(points.get("dragon")).toEqual([10, 30, -5])
    expect(points.get("festival")).toEqual([4, 6, 6])
    expect(points.get("comet")).toEqual([0, 0, 0])
    expect(points.get("undead")).toBeNull() // no graveyard mounted here: the camera falls back
  })

  test("a seek into the dragon replays nothing: render is cleared and the dragon never plays", async () => {
    const session = await events()
    const hall = createEvents(session)
    const { shows, calls, firsts } = fakeShows(session)
    const stop = driveSkyShows(shows, hall, { jumps: () => session.clock.get().jumps }, sites)
    const start = session.clock.get().start
    for (let k = 0; k < 50 * 4; k++) {
      session.frame(0.25)
      hall.read()
    }
    expect(firsts.map((f) => f.kind)).toEqual(["dragon"])
    // into the rainbow's first seconds' wake: past its start, nothing replays
    session.clock.seek(start + 82_000, { jump: true })
    session.clock.play(true)
    for (let k = 0; k < 8; k++) {
      session.frame(0.25)
      hall.read()
    }
    stop()
    expect(calls).toContain("clear")
    expect(firsts.map((f) => f.kind)).toEqual(["dragon"])
  })
})
