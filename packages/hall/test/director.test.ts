import { describe, expect, test } from "bun:test"
import {
  clearFrame,
  Director,
  easeSpeed,
  FF_LEAD_MS,
  FF_MAX,
  fastForwardGoal,
  LONG_HOLD_MS,
  MIN_SHOT_MS,
  MIN_SHOT_URGENT_MS,
  type Point,
  type ShotKind,
  type Stage,
  shotFor,
  TAU_MS,
  WEIGHTS,
} from "../src/guild/director.ts"
import type { Moment } from "../src/guild/moments.ts"
import { GuildStore } from "../src/guild/store.ts"
import { listen, Narrator } from "../src/guild/story.ts"
import { hintCamera } from "../src/scene/events/hint.ts"
import { setActiveWorld } from "../src/world/active.ts"
import type { World } from "../src/world/world.ts"

/** A stage of named adventurers at fixed spots, everyone on screen unless listed off. */
function stageOf(
  cast: Record<string, { x: number; z: number; phase?: string; master?: boolean; walking?: boolean }>,
  off: Set<string> = new Set(),
): Stage {
  return {
    get views() {
      return Object.entries(cast).map(([id, c]) => ({
        id,
        phase: c.phase ?? "working",
        master: c.master ?? false,
      }))
    },
    locate(id: string, out: Point) {
      const c = cast[id]
      if (!c) return false
      out.x = c.x
      out.z = c.z
      return true
    },
    walking: (id) => cast[id]?.walking ?? false,
    onScreen: (x, z) => !Object.entries(cast).some(([id, c]) => off.has(id) && c.x === x && c.z === z),
  }
}

let seq = 0
function moment(kind: Moment["kind"], id: string, extra: Partial<Moment> = {}): Moment {
  return {
    kind,
    id,
    agent: "guild-implementer",
    title: id,
    color: "#fff",
    master: "M",
    at: 0,
    live: true,
    seq: ++seq,
    ...(kind === "quest" ? { tool: "task", call: `c${seq}`, text: "go" } : {}),
    ...(kind === "deed" ? { tool: "edit", call: `c${seq}` } : {}),
    ...extra,
  } as Moment
}

/** Runs the director for `ms` at 8 decisions a second; returns each cut as [time, key, kind]. */
function run(d: Director, stage: Stage, ms: number, cuts: [number, string, ShotKind][] = []) {
  const end = d.now + ms
  let last = d.shot.cut
  while (d.now < end) {
    d.now += 125
    const shot = d.update(stage)
    if (shot.cut !== last) {
      last = shot.cut
      cuts.push([d.now, shot.key, shot.kind])
    }
  }
  return cuts
}

/** A director past its opening: one quest already seen, settled on a shot. */
function settled(stage: Stage): Director {
  const d = new Director()
  d.take(moment("quest", "M", { master: "M" }))
  run(d, stage, 10_000)
  return d
}

describe("director: scoring and decay", () => {
  test("impulses decay with TAU_MS; hints hold for their TTL then fade", () => {
    const d = new Director()
    d.take(moment("plea", "A"))
    expect(d.excitement()).toBeCloseTo(WEIGHTS.plea, 5)
    d.now = TAU_MS
    expect(d.excitement()).toBeCloseTo(WEIGHTS.plea / Math.E, 5)
    d.now = TAU_MS * 10
    expect(d.excitement()).toBeLessThan(0.01)

    const e = new Director()
    e.hint({ key: "dragon", x: 0, z: 0 }, 9, 5000)
    expect(e.excitement()).toBe(9)
    e.now += 4999
    expect(e.excitement()).toBe(9)
    e.now += 2000
    expect(e.excitement()).toBe(0)
  })

  test("rebuilt moments are history: they score nothing", () => {
    const d = new Director()
    d.take(moment("plea", "A", { live: false }))
    expect(d.excitement()).toBe(0)
  })

  test("a plea outranks a quest, loot, a join and a deed burst", () => {
    const cast = {
      M: { x: 0, z: 0, master: true },
      A: { x: 20, z: 0 },
      B: { x: -20, z: 0 },
      C: { x: 0, z: 20 },
    }
    const p = { x: 0, z: -20, phase: "working" }
    const stage = stageOf({ ...cast, P: p })
    const d = settled(stage)
    p.phase = "waiting"
    d.take(moment("loot", "A", { parent: "M" }))
    d.take(moment("join", "B", { parent: "M" }))
    for (let i = 0; i < 4; i++) d.take(moment("deed", "C"))
    d.take(moment("plea", "P"))
    run(d, stage, MIN_SHOT_MS + 200)
    expect(d.shot.key).toBe("P")
    expect(d.shot.kind).toBe("close")
    expect(d.scoreOf("P")).toBeGreaterThan(d.scoreOf("A"))
  })

  test("off-screen and not-recently-shown subjects are preferred", () => {
    const stage = stageOf({ A: { x: 10, z: 0 }, B: { x: -10, z: 0 } }, new Set(["B"]))
    const d = settled(stage)
    d.take(moment("loot", "A"))
    d.take(moment("loot", "B"))
    d.now += 125
    d.update(stage)
    expect(d.scoreOf("B")).toBeGreaterThan(d.scoreOf("A"))
  })

  test("a long-held subject gets an establishing shot to clear the palate", () => {
    const stage = stageOf({ A: { x: 10, z: 0 } })
    const d = settled(stage)
    // Keep A busy and alone: nothing else to cut to.
    const cuts: [number, string, ShotKind][] = []
    for (let t = 0; t < LONG_HOLD_MS + 8000; t += 1000) {
      d.take(moment("deed", "A"))
      run(d, stage, 1000, cuts)
    }
    expect(cuts.some(([, , kind]) => kind === "establishing")).toBe(true)
  })

  test("a quiet stage is an establishing wide", () => {
    const stage = stageOf({ A: { x: 10, z: 0, phase: "resting" } })
    const d = new Director()
    run(d, stage, 60_000)
    expect(d.shot.kind).toBe("establishing")
  })

  test("the wide leans to the middle of the island drawn now: south of the keep, or a repo's round it", () => {
    const stage = stageOf({ A: { x: 10, z: 0, phase: "resting" } })
    const wide = () => {
      const d = new Director()
      run(d, stage, 60_000)
      return [d.shot.x, d.shot.z]
    }
    expect(wide()).toEqual([5, 5])
    setActiveWorld({ kind: "repo" } as World)
    try {
      expect(wide()).toEqual([5, 0])
    } finally {
      setActiveWorld(undefined)
    }
  })
})

describe("director: minimum shot length and no ping-pong", () => {
  test("two subjects trading beats every half second: every shot holds, no A-B-A bounce", () => {
    const stage = stageOf({ A: { x: 15, z: 0 }, B: { x: -15, z: 0 }, C: { x: 0, z: 15 } })
    const d = settled(stage)
    const cuts: [number, string, ShotKind][] = []
    const subjects = ["A", "B", "C"]
    for (let i = 0; i < 240; i++) {
      d.take(moment(i % 7 === 0 ? "loot" : "deed", subjects[i % 3] as string))
      run(d, stage, 500, cuts)
    }
    expect(cuts.length).toBeGreaterThan(5)
    for (let i = 1; i < cuts.length; i++) {
      const held = (cuts[i]?.[0] ?? 0) - (cuts[i - 1]?.[0] ?? 0)
      expect(held).toBeGreaterThanOrEqual(MIN_SHOT_URGENT_MS)
    }
    // No straight bounce back to the subject just left, inside the recent window.
    for (let i = 2; i < cuts.length; i++) {
      const [t, key] = cuts[i] as [number, string, ShotKind]
      const [t0, key0] = cuts[i - 2] as [number, string, ShotKind]
      if (key === key0 && key !== "") expect(t - t0).toBeGreaterThanOrEqual(MIN_SHOT_MS * 2)
    }
  })

  test("an ordinary beat waits out the minimum shot; a plea waits at most the urgent minimum", () => {
    const p = { x: 0, z: 20, phase: "working" }
    const stage = stageOf({ A: { x: 15, z: 0 }, B: { x: -15, z: 0 }, P: p })
    const d = settled(stage)
    d.take(moment("loot", "A"))
    p.phase = "waiting"
    run(d, stage, 125)
    const asked = d.now
    d.take(moment("plea", "P"))
    const before = d.shot.since
    const cuts = run(d, stage, 6000)
    const plea = cuts.find(([, key]) => key === "P")
    expect(plea).toBeDefined()
    // The shot it interrupts still ran its (urgent) minimum; the plea waited at most a full one.
    expect((plea?.[0] ?? 0) - before).toBeGreaterThanOrEqual(MIN_SHOT_URGENT_MS)
    expect((plea?.[0] ?? 0) - asked).toBeLessThanOrEqual(MIN_SHOT_MS)
  })

  test("an open plea on camera holds until it is answered", () => {
    const cast = { A: { x: 15, z: 0 }, P: { x: 0, z: 20, phase: "working" } }
    const stage = stageOf(cast, new Set(["A"]))
    const d = settled(stage)
    cast.P.phase = "waiting"
    d.take(moment("plea", "P"))
    run(d, stage, MIN_SHOT_MS + 500)
    expect(d.shot.key).toBe("P")
    for (let i = 0; i < 8; i++) {
      d.take(moment("loot", "A"))
      run(d, stage, 1000)
    }
    expect(d.shot.key).toBe("P")
    cast.P.phase = "working"
    run(d, stage, 2000)
    expect(d.shot.key).toBe("A")
  })

  test("reduced motion: fewer cuts (a longer minimum)", () => {
    const names = ["A", "B", "C", "D", "E", "F"]
    const stage = stageOf(Object.fromEntries(names.map((n, i) => [n, { x: i * 12, z: 0 }])))
    const busy = (calm: boolean) => {
      const d = settled(stage)
      d.calm = calm
      const cuts: [number, string, ShotKind][] = []
      // A fresh fall somewhere new every second: the minimum shot is all that holds.
      for (let i = 0; i < 60; i++) {
        d.take(moment("fail", names[i % names.length] as string))
        run(d, stage, 1000, cuts)
      }
      return cuts.length
    }
    expect(busy(true)).toBeLessThan(busy(false))
  })
})

describe("director: shot language", () => {
  test("each beat has its shot", () => {
    expect(shotFor("plea")).toBe("close")
    expect(shotFor("fail")).toBe("close")
    expect(shotFor("rise")).toBe("close")
    expect(shotFor("recover")).toBe("close")
    expect(shotFor("loot")).toBe("close")
    expect(shotFor("reaction")).toBe("reaction")
    expect(shotFor("quest", { partner: true })).toBe("two-shot")
    expect(shotFor("quest")).toBe("medium")
    expect(shotFor("join")).toBe("follow")
    expect(shotFor("burst")).toBe("medium")
    expect(shotFor("work", { walking: true })).toBe("follow")
    expect(shotFor("establishing")).toBe("establishing")
  })

  test("the run's first quest opens wide; a dispatch is a two-shot, then follows the dispatched", () => {
    const stage = stageOf({ M: { x: 0, z: 0, master: true }, K: { x: 3, z: 1, walking: true } })
    const d = new Director()
    run(d, stage, 500)
    d.take(moment("quest", "M"))
    const opening = run(d, stage, MIN_SHOT_MS + 200)
    expect(opening.at(-1)?.[2]).toBe("establishing")

    d.take(moment("quest", "M"))
    d.take(moment("join", "K", { parent: "M" }))
    const cuts = run(d, stage, MIN_SHOT_MS * 2 + 500)
    expect(cuts.map(([, key, kind]) => [key, kind])).toEqual([
      ["M", "two-shot"],
      ["K", "follow"],
    ])
  })

  test("loot coming home: a close-up on the bearer, then a reaction cut to whoever sent them", () => {
    const cast = { M: { x: 0, z: 0, master: true }, K: { x: 20, z: 5, phase: "loot" } }
    const stage = stageOf(cast)
    const d = settled(stage)
    d.take(moment("loot", "K", { parent: "M" }))
    // Track what is on screen (a reframe on the same subject is not a cut).
    const seen: string[] = []
    for (let t = 0; t < MIN_SHOT_MS * 3; t += 125) {
      // As in viewsOf: the bearer hands in the loot (LOOT_MS) and goes to rest.
      if (t >= 3500) cast.K.phase = "resting"
      d.now += 125
      const { key, kind } = d.update(stage)
      if (seen.at(-1) !== `${key} ${kind}`) seen.push(`${key} ${kind}`)
    }
    const close = seen.indexOf("K close")
    expect(close).toBeGreaterThanOrEqual(0)
    expect(seen[close + 1]).toBe("M reaction")
    // …and no bounce straight back to the loot just shown.
    expect(seen.slice(close + 2)).not.toContain("K close")
  })

  test("a rise absorbs the fall: one close-up in the graveyard, not two shots", () => {
    const stage = stageOf({ A: { x: 15, z: 0 }, F: { x: -10, z: 4, phase: "failed" } })
    const d = settled(stage)
    d.take(moment("deed-failed", "F"))
    d.take(moment("fail", "F"))
    d.hint({ key: "graveyard", x: 30, z: 30, radius: 3 }, 8, 6000, { shot: "close", absorbs: "F" })
    const cuts = run(d, stage, 6000)
    expect(cuts[0]?.[1]).toBe("graveyard")
    expect(cuts[0]?.[2]).toBe("close")
    expect(cuts.some(([, key]) => key === "F")).toBe(false)
  })

  test("hint(): another module's subject gets the camera, in the shot it asks for", () => {
    const stage = stageOf({ A: { x: 15, z: 0 } })
    const d = settled(stage)
    d.hint({ key: "event:dragon", x: -40, z: 10, radius: 12 }, 9, 8000, { shot: "establishing" })
    run(d, stage, MIN_SHOT_MS + 200)
    expect(d.shot.key).toBe("event:dragon")
    expect(d.shot.kind).toBe("establishing")
    expect(d.shot.x).toBe(-40)
  })
})

describe("director: the hint interface other modules use", () => {
  test("scene/events' shape works as is: { x, y, z, label } keyed by its label", () => {
    const stage = stageOf({ A: { x: 15, z: 0 } })
    const d = settled(stage)
    d.hint({ x: -30, y: 4, z: 12, label: "dragon" }, 9, 8000)
    run(d, stage, MIN_SHOT_MS + 200)
    expect(d.shot.key).toBe("dragon")
    expect(d.shot.kind).toBe("close")
    expect([d.shot.x, d.shot.z]).toEqual([-30, 12])
    // The same label again refreshes the one record; a rebuild forgets it.
    d.hint({ x: -30, y: 4, z: 12, label: "dragon" }, 9, 8000)
    expect(d.scoreOf("dragon")).toBeGreaterThan(0)
    d.rebuild()
    expect(d.excitement()).toBe(0)
  })
})

describe("director: sky events aim up, then come back down", () => {
  test("a lifted place's shot aims at its height; ground subjects stay on the ground", () => {
    const stage = stageOf({ A: { x: 15, z: 0 } })
    const d = settled(stage)
    expect(d.shot.y).toBe(0)
    d.hint({ key: "event:dragon", x: 2, y: 30, z: -58, radius: 34 }, 9, 8000, { shot: "establishing" })
    run(d, stage, MIN_SHOT_MS + 200)
    expect(d.shot.key).toBe("event:dragon")
    expect(d.shot.y).toBe(30)
  })

  test("once the hint has faded on an empty stage, the wide returns to the ground", () => {
    const stage = stageOf({})
    const d = new Director()
    run(d, stage, 10_000)
    d.hint({ key: "event:rainbow", x: 0, y: 40, z: 0, radius: 60 }, 6, 8000, { shot: "establishing" })
    run(d, stage, 2000)
    expect(d.shot.y).toBe(40)
    run(d, stage, 12_000)
    expect(d.shot.kind).toBe("establishing")
    expect(d.shot.key).toBe("")
    expect(d.shot.y).toBe(0)
  })

  test("scene/events' hintCamera passes the aim height through", () => {
    const stage = stageOf({ A: { x: 15, z: 0 } })
    const d = settled(stage)
    hintCamera(
      { director: d },
      { x: 0, y: 45, z: 0, radius: 60, weight: 9, ttl: 8000, shot: "establishing" },
      "comet",
    )
    run(d, stage, MIN_SHOT_MS + 200)
    expect(d.shot.key).toBe("event:comet")
    expect(d.shot.y).toBe(45)
  })
})

describe("replay fast-forward", () => {
  const quiet = { replay: true, enabled: true, sinceBeat: 10_000, untilBeat: 20_000, busy: false }

  test("only in a replay, only when enabled, only when quiet, never when busy", () => {
    expect(fastForwardGoal(quiet)).toBe(FF_MAX)
    expect(fastForwardGoal({ ...quiet, replay: false })).toBe(1)
    expect(fastForwardGoal({ ...quiet, enabled: false })).toBe(1)
    expect(fastForwardGoal({ ...quiet, busy: true })).toBe(1)
    expect(fastForwardGoal({ ...quiet, sinceBeat: 1000 })).toBe(1)
  })

  test("back to 1× ahead of the next beat, eased in between", () => {
    expect(fastForwardGoal({ ...quiet, untilBeat: FF_LEAD_MS })).toBe(1)
    const mid = fastForwardGoal({ ...quiet, untilBeat: FF_LEAD_MS + 1500 })
    expect(mid).toBeGreaterThan(1)
    expect(mid).toBeLessThan(FF_MAX)
    let speed = 1
    const steps: number[] = []
    for (let i = 0; i < 300; i++) {
      speed = easeSpeed(speed, FF_MAX, 16)
      steps.push(speed)
    }
    for (let i = 1; i < steps.length; i++) expect((steps[i] ?? 0) - (steps[i - 1] ?? 0)).toBeLessThan(0.1)
    expect(speed).toBeCloseTo(FF_MAX, 1)
  })

  /** Plays a store through `ms` of real time in 16 ms frames; reports the fast-forward seen. */
  function play(store: GuildStore, ms: number) {
    const beats = new Set(store.markers.filter((m) => m.kind !== "walk").map((m) => m.at))
    let top = 1
    let atBeat = 1
    let time = store.time
    for (let t = 0; t < ms; t += 16) {
      store.tick(16)
      top = Math.max(top, store.fastForward)
      // A beat crossed this frame: how fast were we going?
      for (const at of beats) if (at > time && at <= store.time) atBeat = Math.max(atBeat, store.fastForward)
      time = store.time
    }
    return { top, atBeat }
  }

  test("a party replay with the Cinematic director skips its quiet stretches, and slows for every beat", () => {
    const store = new GuildStore()
    store.setDirector("cinematic")
    store.load("party")
    const { top, atBeat } = play(store, 60_000)
    expect(top).toBeGreaterThan(1.5)
    expect(atBeat).toBeLessThan(1.35)
  })

  test("Cinematic by default; never live, never Calm, never once the viewer has the camera", () => {
    expect(new GuildStore().directorStyle).toBe("cinematic")
    const calm = new GuildStore()
    calm.setDirector("calm")
    calm.load("party")
    expect(play(calm, 40_000).top).toBe(1)

    const yours = new GuildStore()
    yours.load("party")
    yours.setBard(false)
    expect(play(yours, 40_000).top).toBe(1)

    const live = new GuildStore()
    live.setDirector("cinematic")
    // Following a hub (guild/feeds/live.ts) that never answers: a socket that does nothing.
    const socket = globalThis.WebSocket
    globalThis.WebSocket = class {
      close() {}
    } as unknown as typeof WebSocket
    live.live("ws://127.0.0.1:1/ws")
    globalThis.WebSocket = socket
    expect(live.mode).toBe("live")
    for (let t = 0; t < 20_000; t += 16) live.tick(16)
    expect(live.fastForward).toBe(1)
  })

  test("the pace stays the viewer's: Settings reads the base speed, not the fast-forwarded one", () => {
    const store = new GuildStore()
    store.setDirector("cinematic")
    store.load("party")
    store.setSpeed(2)
    play(store, 30_000)
    expect(store.speed).toBe(2)
  })
})

describe("replay fast-forward: no bursts", () => {
  /** Every moment a store makes over a whole run, and the most made in one frame. */
  function stream(cinematic: boolean, pace = 1) {
    const store = new GuildStore()
    if (cinematic) store.setDirector("cinematic")
    store.load("party")
    store.setSpeed(pace)
    const epoch = store.moments.epoch
    const made: Moment[] = []
    let frame = 0
    let worst = 0
    store.moments.on((m) => {
      made.push(m)
      frame++
    })
    let fast = 1
    while (store.time < store.duration - 50) {
      frame = 0
      store.tick(16)
      worst = Math.max(worst, frame)
      fast = Math.max(fast, store.fastForward)
    }
    return { made, worst, fast, rebuilt: store.moments.epoch !== epoch }
  }
  const gist = (m: Moment) => `${m.kind}:${m.id}:${m.at}`

  test("the same moments, once each, all live, no rebuild, as at 1×", () => {
    const plain = stream(false)
    const fast = stream(true)
    expect(fast.fast).toBeGreaterThan(1.5)
    expect(fast.rebuilt).toBe(false)
    expect(fast.made.every((m) => m.live)).toBe(true)
    expect(fast.made.map(gist)).toEqual(plain.made.map(gist))
  })

  test("never more moments in one frame than a steady 4× pace makes", () => {
    expect(stream(true).worst).toBeLessThanOrEqual(stream(false, FF_MAX).worst)
  })

  test("captions: every quest, plea, fall and loot is still told, for every adventurer", () => {
    // Bursts may merge differently (two loots one line, or two lines) and routine deed lines may be
    // skipped in a fast stretch; what must not happen is a beat or an adventurer going untold.
    const told = (cinematic: boolean) => {
      const store = new GuildStore()
      if (cinematic) store.setDirector("cinematic")
      store.load("party")
      let clock = 0
      const narrator = new Narrator({ session: (id) => store.sessionOf(id) })
      listen(store.moments, narrator, () => clock)
      const pairs = new Set<string>()
      const look = () => {
        const caption = narrator.next(clock)
        if (caption && caption.priority >= 2) for (const id of caption.ids) pairs.add(`${caption.kind}:${id}`)
      }
      while (store.time < store.duration - 50) {
        store.tick(16)
        clock += 16
        look()
      }
      for (let i = 0; i < 600; i++) {
        clock += 16
        look()
      }
      return [...pairs].sort()
    }
    const fast = told(true)
    expect(fast.length).toBeGreaterThan(10)
    expect(fast).toEqual(told(false))
  })
})

describe("HUD-aware framing", () => {
  const out = { x: 0, y: 0, w: 1, h: 1 }

  test("no panels: the subject sits in the middle", () => {
    clearFrame(1440, 860, { left: 0, right: 0, top: 0, bottom: 0 }, out)
    expect(out).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  test("the dossier open on the right moves the subject left, into what stays clear", () => {
    clearFrame(1440, 860, { left: 0, right: 372, top: 0, bottom: 84 }, out)
    expect(out.x).toBeLessThan(0)
    expect(out.y).toBeGreaterThan(0)
    expect(out.w).toBeCloseTo((1440 - 372) / 1440, 5)
    // The clear area's centre, in px: halfway between the left edge and the dossier.
    expect(((out.x + 1) / 2) * 1440).toBeCloseTo((1440 - 372) / 2, 5)
  })

  test("insets are capped: a huge panel never pushes the subject off screen", () => {
    clearFrame(400, 800, { left: 0, right: 2000, top: 0, bottom: 2000 }, out)
    expect(Math.abs(out.x)).toBeLessThan(1)
    expect(Math.abs(out.y)).toBeLessThan(1)
  })
})
