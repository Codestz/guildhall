import { describe, expect, test } from "bun:test"
import {
  type DirectorState,
  director,
  type EventLog,
  HOLD_MS,
  LONG_HOLD_MS,
  pick,
  type Reason,
  Script,
  type Shot,
  story,
  toEvents,
  USER_MS,
} from "../src/index.ts"
import { Feed, fileIn, placeOf } from "./events-fixtures.ts"
import { guildhallHall, played, unitsOf } from "./stories-fixtures.ts"

/**
 * The director (director/pick.ts): V1's rank (plea > failed > quest > loot > walk), no shot under 4 s,
 * the user's 10 s, and no thrash under a busy stream.
 */

type Beat = "plea" | "failed" | "quest" | "loot" | "walk"

const T = 30_000

/** A guild at `T` with one hero per beat in `beats`, each beat just happened (a walk: moved 2 s ago). */
function scene(beats: readonly Beat[]): Feed {
  const f = new Feed()
  f.start("gm", 0)
  for (const b of beats) if (b !== "quest") f.start(b, 0, "gm", "guild-implementer")
  if (beats.includes("walk")) f.edit("walk", "world", T - 8000) // leads at T−8 s, moves at T−2 s
  if (beats.includes("failed"))
    f.tool("failed", "bash", { command: "bun test" }, T - 700, { state: "failed", error: "1 failed" })
  if (beats.includes("loot")) f.change({ type: "status", id: "loot", status: "idle", at: T - 500 })
  if (beats.includes("plea")) f.change({ type: "status", id: "plea", status: "waiting", at: T - 500 })
  if (beats.includes("quest")) f.start("quest", T - 500, "gm", "guild-explorer")
  return f
}

const shotAt = (f: Feed, t: number, state: DirectorState = {}) => {
  const world = f.log.stateAt(t)
  return pick(world, world.recent, t, state)
}

describe("ranking: plea > failed > quest > loot > walk", () => {
  const all: Beat[] = ["plea", "failed", "quest", "loot", "walk"]
  for (let i = 0; i < all.length; i++) {
    const beats = all.slice(i)
    test(`${beats.join(", ")} → ${beats[0]}`, () => {
      const shot = shotAt(scene(beats), T)
      expect(shot.reason).toBe(beats[0] as Reason)
      expect(shot.focus).toEqual({ kind: "hero", id: beats[0] as string })
    })
  }

  test("framing: a plea, a failure and loot close; a quest and a walk mid", () => {
    expect(shotAt(scene(["plea"]), T).distance).toBe("close")
    expect(shotAt(scene(["failed"]), T).distance).toBe("close")
    expect(shotAt(scene(["loot"]), T).distance).toBe("close")
    expect(shotAt(scene(["quest"]), T).distance).toBe("mid")
    expect(shotAt(scene(["walk"]), T).distance).toBe("mid")
  })

  test("nothing new: the place where heroes work (mid); nobody working: the overview (map)", () => {
    const f = scene(["walk"])
    const later = T + 15_000
    expect(shotAt(f, later)).toMatchObject({
      focus: { kind: "place", place: 1 },
      reason: "work",
      distance: "mid",
    })
    const quiet = new Feed()
    quiet.start("gm", 0)
    expect(shotAt(quiet, T)).toMatchObject({ focus: { kind: "overview" }, reason: "idle", distance: "map" })
  })

  test("the sea: a PR at the harbour, a red CI over the whole island", () => {
    const f = new Feed()
    f.start("gm", 0)
    const base = { repo: "o/r", branch: "b", sha: "s", name: "CI" }
    f.sea({
      kind: "pr_opened",
      id: "pr",
      at: 1000,
      repo: "o/r",
      number: 1,
      title: "t",
      author: "a",
      branch: "b",
    })
    expect(shotAt(f, 1500)).toMatchObject({ focus: { kind: "harbour" }, reason: "ship", distance: "mid" })
    f.sea({ kind: "ci", id: "c1", at: 2000, state: "failed", ...base })
    expect(shotAt(f, 2500)).toMatchObject({ focus: { kind: "overview" }, reason: "storm", distance: "map" })
  })

  test("a moment fades: a failure counts for its life, then the shot moves on", () => {
    const f = scene(["failed"])
    expect(shotAt(f, T + 5000).reason).toBe("failed")
    expect(shotAt(f, T + 12_000).reason).not.toBe("failed")
  })

  test("the same inputs, the same shot", () => {
    const f = scene(["quest", "walk"])
    expect(shotAt(f, T)).toEqual(shotAt(f, T))
    expect(director.pick).toBe(pick)
  })
})

describe("holds", () => {
  test("no cut before the shot has run 4 s, then the higher rank takes it", () => {
    const f = scene(["walk"])
    const first = shotAt(f, T)
    expect(first.reason).toBe("walk")
    expect(first.holdUntil).toBe(T + HOLD_MS)
    f.start("other", T + 500, "gm", "guild-explorer")
    f.change({ type: "status", id: "other", status: "waiting", at: T + 1000 })
    let state: DirectorState = { shot: first }
    for (let t = T + 1000; t < T + HOLD_MS; t += 250) {
      state = { shot: shotAt(f, t, state) }
      expect(state.shot?.key).toBe(first.key)
    }
    const cut = shotAt(f, T + HOLD_MS, state)
    expect(cut).toMatchObject({ reason: "plea", focus: { kind: "hero", id: "other" }, since: T + HOLD_MS })
  })

  test("a subject's own beat rising reframes it without a cut", () => {
    const f = scene(["walk"])
    const first = shotAt(f, T)
    f.change({ type: "status", id: "walk", status: "waiting", at: T + 1000 })
    const next = shotAt(f, T + 1500, { shot: first })
    expect(next).toMatchObject({ key: first.key, reason: "plea", distance: "close", since: first.since })
  })

  test("an open plea on camera holds until it is answered, past the long hold", () => {
    const f = scene(["plea"])
    let state: DirectorState = {}
    for (let t = T; t <= T + LONG_HOLD_MS + 10_000; t += 500) {
      if (t === T + 6000) f.start("x", t, "gm", "guild-explorer") // a quest elsewhere: lower, waits
      state = { shot: shotAt(f, t, state) }
      expect(state.shot?.reason).toBe("plea")
    }
  })

  test("held 20 s on one subject with nothing else: the overview, then back after 4 s", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("h", 0, "gm", "guild-implementer")
    for (let t = 1000; t < 90_000; t += 3000) f.edit("h", "sim", t)
    let state: DirectorState = {}
    const cuts: Shot[] = []
    for (let t = 30_000; t <= 80_000; t += 250) {
      const shot = shotAt(f, t, state)
      if (!state.shot || shot.since !== state.shot.since) cuts.push(shot)
      state = { shot }
    }
    expect(cuts.map((c) => c.focus.kind)).toEqual(["place", "overview", "place", "overview", "place"])
    expect(cuts[1]!.since - cuts[0]!.since).toBe(LONG_HOLD_MS)
    expect(cuts[2]!.since - cuts[1]!.since).toBe(HOLD_MS)
  })
})

describe("the user's override", () => {
  test("the user owns the camera for 10 s, then the director takes it back at once", () => {
    const f = scene(["walk"])
    f.change({ type: "status", id: "walk", status: "waiting", at: T + 1000 })
    const userAt = T + 2000
    const focus = { kind: "place", place: 3 } as const
    let state: DirectorState = { userAt, userFocus: focus }
    for (let t = userAt; t < userAt + USER_MS; t += 500) {
      const shot = shotAt(f, t, state)
      expect(shot).toMatchObject({ reason: "user", focus, since: userAt, holdUntil: userAt + USER_MS })
      state = { ...state, shot }
    }
    const back = shotAt(f, userAt + USER_MS, state)
    expect(back).toMatchObject({
      reason: "plea",
      focus: { kind: "hero", id: "walk" },
      since: userAt + USER_MS,
    })
  })

  test("without a focus of their own, the user keeps what the camera was on", () => {
    const f = scene(["walk"])
    const first = shotAt(f, T)
    const shot = shotAt(f, T + 1000, { shot: first, userAt: T + 500 })
    expect(shot).toMatchObject({ reason: "user", key: first.key, distance: "close" })
  })
})

/** Samples the director every 100 ms over a log: every shot that changed (a cut or a reframe). */
function film(log: EventLog, until: number): (Shot & { at: number })[] {
  let state: DirectorState = {}
  const shots: (Shot & { at: number })[] = []
  for (let t = 0; t <= until; t += 100) {
    const world = log.stateAt(t)
    const shot = pick(world, world.recent, t, state)
    if (!state.shot || shot.since !== state.shot.since || shot.reason !== state.shot.reason)
      shots.push({ ...shot, at: t })
    state = { shot }
  }
  return shots
}

/** The cuts of a film: its shots with a new start. */
const cutsOf = (shots: readonly Shot[]) => shots.filter((s, i) => i === 0 || s.since !== shots[i - 1]?.since)

/** A busy guild: 16 heroes in four packages, failing, pleading and finishing at random, 2 min long. */
function chaos(seed: number): EventLog {
  const s = new Script(seed)
  const gm = s.guildmaster("Chaos")
  const pkgs = ["core", "world", "sim", "render"] as const
  for (let i = 0; i < 16; i++)
    gm.quest(
      "guild-implementer",
      `Quest ${i}`,
      (k) => {
        k.wait(i * 900)
        while (k.clock < 110_000) {
          const r = s.jitter(1000)
          const pkg = s.pick(pkgs)
          if (r > 1150) k.plea(3000)
          else if (r > 1100) k.deed("bash", { command: "bun test" }, 1200, { fail: "1 failed" })
          else k.deed(s.pick(["edit", "read", "grep"]), { filePath: fileIn(pkg) }, 900)
        }
        k.finish("done", 500)
      },
      { wait: false },
    )
  const f = new Feed()
  for (const e of toEvents(s.done(), "g")) f.change(e.change)
  return f.log
}

describe("no thrash under a busy stream", () => {
  const streams: [string, () => Promise<{ log: EventLog; until: number }>][] = [
    ["chaos (16 heroes, random pleas and failures)", async () => ({ log: chaos(3), until: 120_000 })],
    [
      "rush of 60",
      async () => {
        const s = story("rush", { count: 60 })
        return { log: played(s, placeOf), until: s.duration }
      },
    ],
    [
      "the saga on Guildhall's island",
      async () => {
        const hall = await guildhallHall()
        const s = story("saga", { repo: { name: hall.name, units: unitsOf(hall) } })
        return { log: played(s, hall.binding.placeOf), until: s.duration }
      },
    ],
  ]
  for (const [name, make] of streams)
    test(`${name}: every cut at least 4 s after the one before; a plea on camera within 4 s`, async () => {
      const { log, until } = await make()
      const shots = film(log, until)
      const cuts = cutsOf(shots)
      expect(cuts.length).toBeGreaterThan(3)
      for (let i = 1; i < cuts.length; i++)
        expect(cuts[i]!.since - cuts[i - 1]!.since).toBeGreaterThanOrEqual(HOLD_MS)
      expect(cuts.length).toBeLessThanOrEqual(Math.ceil(until / HOLD_MS) + 1)
      // no ping-pong: A → B → A inside 8 s
      for (let i = 2; i < cuts.length; i++)
        if (cuts[i]!.key === cuts[i - 2]!.key && cuts[i]!.key !== "overview")
          expect(cuts[i]!.since - cuts[i - 2]!.since).toBeGreaterThanOrEqual(2 * HOLD_MS)
      // every plea that stays open past a hold is filmed while it is open
      for (const ev of log.events) {
        if (ev.kind !== "actor.plea") continue
        const answered = log.events.find(
          (e) => e.kind === "actor.answered" && e.id === ev.id && e.at >= ev.at,
        )
        const close = answered?.at ?? until
        if (close - ev.at < HOLD_MS + 200) continue
        // while it is open, the camera is on a plea (this one, or another that came first)
        const filmed = shots.some(
          (c, i) => c.reason === "plea" && c.at <= close && (shots[i + 1]?.at ?? until) > ev.at,
        )
        expect([ev.id, ev.at, filmed]).toEqual([ev.id, ev.at, true])
      }
    })

  test("the saga's film: its beats are on camera", async () => {
    const hall = await guildhallHall()
    const s = story("saga", { repo: { name: hall.name, units: unitsOf(hall) } })
    const cuts = film(played(s, hall.binding.placeOf), s.duration)
    const reasons = new Set(cuts.map((c) => c.reason))
    for (const r of ["quest", "walk", "ship", "storm", "failed", "plea", "clear"] as const)
      expect([r, reasons.has(r)]).toEqual([r, true])
  })
})
