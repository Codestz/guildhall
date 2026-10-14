import { describe, expect, test } from "bun:test"
import type { CiState } from "@guildhall/core"
import {
  dismissed,
  type EventLog,
  forcedShow,
  pick,
  SHOW_RULES,
  type Show,
  ShowEngine,
  showHint,
  showLine,
  story,
  worldShows,
} from "../src/index.ts"
import { Feed } from "./events-fixtures.ts"
import { played, unitsOf, v2Hall } from "./stories-fixtures.ts"

/**
 * The world events' engine (story/worldEvents.ts, plan .probe/v1events Task A): shows as a pure function
 * of the log up to `t`; history and seeks earn but never show; one big show per 150 s; per-kind
 * cooldowns; the saga's beats; graves that rise, keep vigil and sink when mended; nothing costs idle.
 *
 *   SHOWS_TABLE=1 bun test packages/sim/test/world-events.test.ts   prints the saga's beat → show table
 */

const MIN = 60_000

/** A failed `bun test`, a failed or passing command, at `at`. */
const red = (f: Feed, id: string, at: number) =>
  f.tool(id, "bash", { command: "bun test packages/world" }, at, {
    state: "failed",
    error: "1 failed",
  } as never)
const failedRun = (f: Feed, id: string, at: number) =>
  f.tool(id, "bash", { command: "make deploy" }, at, { state: "failed", error: "exit 2" } as never)
const ok = (f: Feed, id: string, at: number) =>
  f.tool(id, "read", { filePath: "/r/packages/core/src/a.ts" }, at)
/** A command that passes: a red streak is broken. */
const passed = (f: Feed, id: string, at: number) => f.tool(id, "bash", { command: "ls" }, at)
const fail = (f: Feed, id: string, at: number) => f.change({ type: "status", id, status: "failed", at })
const busy = (f: Feed, id: string, at: number) => f.change({ type: "status", id, status: "busy", at })
const idle = (f: Feed, id: string, at: number) => f.change({ type: "status", id, status: "idle", at })
let ciRun = 0
const ci = (f: Feed, state: CiState, at: number, branch = "main") =>
  f.sea({
    kind: "ci",
    id: `ci:${++ciRun}:${state}`,
    at,
    repo: "o/r",
    state,
    name: "check",
    branch,
    sha: "abc",
  })

/** A hero whose commands fail three times running at `at`…: the dragon. */
function dragonAt(f: Feed, id: string, at: number) {
  failedRun(f, id, at)
  failedRun(f, id, at + 1000)
  failedRun(f, id, at + 2000)
}

/** Fifteen clean deeds and home: the festival. */
function festivalAt(f: Feed, id: string, at: number) {
  for (let k = 0; k < 15; k++) ok(f, id, at + k * 400)
  idle(f, id, at + 15 * 400 + 100)
}

const kinds = (shows: readonly Show[]) => shows.map((s) => s.kind)
const sagaLog = (): { log: EventLog; t0: number; beats: Map<string, number> } => {
  const hall = v2Hall()
  const s = story("saga", { repo: { units: unitsOf(hall) } })
  const log = played(s, hall.binding.placeOf)
  const t0 = log.events[0]?.at ?? 0
  return { log, t0, beats: new Map(s.beats.map((b) => [b.beat, b.at])) }
}

describe("a pure function of the log up to t", () => {
  test("the same log and t give the same shows, and the engine fed it all agrees at every t", () => {
    const { log } = sagaLog()
    const engine = new ShowEngine()
    engine.feed(log.events)
    const end = (log.events.at(-1)?.at ?? 0) + 60_000
    let seen = 0
    for (let t = log.events[0]?.at ?? 0; t <= end; t += 500) {
      const a = worldShows(log, t)
      expect(worldShows(log, t)).toEqual(a)
      // what later events will say (a mending, a leave) is not known at t
      expect(engine.at(t)).toEqual(a)
      seen += a.length
    }
    expect(seen).toBeGreaterThan(0)
  })

  test("a show's end that a later event decides is Infinity until then", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("hero", 0, "gm", "guild-implementer")
    fail(f, "hero", 10_000)
    busy(f, "hero", 30_000)
    const before = worldShows(f.log, 20_000)
    expect(kinds(before)).toEqual(["undead"])
    expect(before[0]?.end).toBe(Number.POSITIVE_INFINITY)
    expect(before[0]?.params.grave?.fixed).toBeUndefined()
    const after = worldShows(f.log, 31_000)
    expect(after[0]?.params.grave?.fixed).toBe(30_000)
  })
})

describe("history and seeks earn but never show", () => {
  test("an earning before `since` never shows; one after does", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("a", 0, "gm", "guild-implementer")
    dragonAt(f, "a", 10_000)
    const at = 12_500
    expect(kinds(worldShows(f.log, at))).toContain("dragon")
    // its third failure ends at 12.2 s: earned then
    expect(kinds(worldShows(f.log, at, { since: 12_300 }))).not.toContain("dragon")
    expect(kinds(worldShows(f.log, at, { since: 12_100 }))).toContain("dragon")
  })

  test("what history earned still counts: its cooldown keeps a fresh streak from showing", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("a", 0, "gm", "guild-implementer")
    dragonAt(f, "a", 10_000)
    passed(f, "a", 20_000) // the streak breaks: the dragon goes
    dragonAt(f, "a", 5 * MIN) // within 8 min of the first
    expect(kinds(worldShows(f.log, 5 * MIN + 3000, { since: 60_000 }))).not.toContain("dragon")
    // a fresh run with no history would have shown it
    const fresh = new Feed()
    fresh.start("gm", 0)
    fresh.start("a", 0, "gm", "guild-implementer")
    dragonAt(fresh, "a", 5 * MIN)
    expect(kinds(worldShows(fresh.log, 5 * MIN + 3000))).toContain("dragon")
  })

  test("a seek into the saga's rainbow replays nothing; seeking before it plays it", () => {
    const { log, beats } = sagaLog()
    const green = beats.get("ci-green") as number
    expect(kinds(worldShows(log, green + 5000))).toContain("rainbow")
    expect(kinds(worldShows(log, green + 5000, { since: green + 2000 }))).not.toContain("rainbow")
    expect(kinds(worldShows(log, green + 5000, { since: green - 2000 }))).toContain("rainbow")
  })

  test("a grave standing when watching began is simply there: quiet, never told", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("hero", 0, "gm", "guild-implementer")
    fail(f, "hero", 10_000)
    const [grave] = worldShows(f.log, 30_000, { since: 20_000 })
    expect(grave?.kind).toBe("undead")
    expect(grave?.quiet).toBe(true)
    expect(showLine(grave as Show)).toBeUndefined()
    expect(worldShows(f.log, 30_000)[0]?.quiet).toBe(false)
  })
})

describe("one big show per 150 s, and each kind's cooldown", () => {
  test("a second big show waits for the gap; a timed one that waits too long is dropped", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("a", 0, "gm", "guild-implementer")
    f.start("b", 0, "gm", "guild-implementer")
    dragonAt(f, "a", 10_000) // the dragon at 12 s
    festivalAt(f, "b", 20_000) // earned at ~26 s: its slot (162 s) is past its 45 s stale
    const engine = new ShowEngine()
    engine.feed(f.log.events)
    const all = engine.all().filter((s) => s.kind !== "undead")
    expect(kinds(all)).toEqual(["dragon"])
  })

  test("a lasting show earned inside the gap starts when it opens", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("a", 0, "gm", "guild-implementer")
    f.start("b", 0, "gm", "guild-implementer")
    festivalAt(f, "b", 10_000) // the festival, ~16 s
    dragonAt(f, "a", 30_000) // the dragon, earned at 32 s: waits
    const engine = new ShowEngine()
    engine.feed(f.log.events)
    const big = (shows: readonly Show[]) => shows.filter((s) => s.kind !== "undead")
    const [festival, dragon] = big(engine.all())
    expect(festival?.kind).toBe("festival")
    expect(dragon?.kind).toBe("dragon")
    expect((dragon?.start ?? 0) - (festival?.start ?? 0)).toBe(SHOW_RULES.gapMs)
    // before its slot it is not on stage
    expect(kinds(big(engine.at(40_000)))).toEqual(["festival"])
    expect(kinds(big(engine.at((dragon?.start ?? 0) + 1)))).toEqual(["dragon"])
  })

  test("the dragon comes at most once per 8 min, whoever's streak it is", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("gm2", 0)
    f.start("a", 0, "gm", "guild-implementer")
    f.start("b", 0, "gm2", "guild-implementer")
    dragonAt(f, "a", 10_000)
    passed(f, "a", 20_000)
    dragonAt(f, "b", 4 * MIN) // another party, past the gap, inside the dragon's cooldown
    passed(f, "b", 4 * MIN + 10_000)
    dragonAt(f, "a", 9 * MIN) // past it
    const engine = new ShowEngine()
    engine.feed(f.log.events)
    const dragons = engine.all().filter((s) => s.kind === "dragon")
    expect(dragons.map((d) => Math.round(d.start / 1000))).toEqual([12, 542])
  })

  test("a dragon leaves when its streak breaks, and its leaving runs 8 s", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("a", 0, "gm", "guild-implementer")
    dragonAt(f, "a", 10_000)
    f.tool("a", "bash", { command: "ls" }, 40_000)
    const [dragon] = worldShows(f.log, 41_000)
    expect(dragon?.leave).toBe(40_200)
    expect(dragon?.end).toBe(40_200 + 8000)
    expect(worldShows(f.log, 48_300)).toEqual([])
  })
})

describe("the saga fires the plan's beats", () => {
  test("red CI and the failing tests raise graves, the fix and green CI sink them, the clear sky a rainbow", () => {
    const { log, t0, beats } = sagaLog()
    const engine = new ShowEngine()
    engine.feed(log.events)
    const all = engine.all()
    const s = (ms: number) => Math.round((ms - t0) / 100) / 10
    const table = all.map((sh) => ({
      kind: sh.kind,
      cause: sh.params.grave?.cause,
      who: sh.params.who?.name,
      fixer: sh.params.grave?.fixer?.name,
      start: s(sh.start),
      fixed: sh.params.grave?.fixed !== undefined ? s(sh.params.grave.fixed) : undefined,
      end: s(sh.end),
    }))
    if (process.env.SHOWS_TABLE) console.table(table)
    const at = (beat: string) => beats.get(beat) as number
    expect(all.map((sh) => `${sh.kind}:${sh.params.grave?.cause ?? ""}`)).toEqual([
      "undead:ci",
      "undead:test",
      "rainbow:",
    ])
    const [ciGrave, testGrave, rainbow] = all as [Show, Show, Show]
    // CI turns red: a skeleton rises; CI green again: the fixer strikes it and it sinks
    expect(ciGrave.start).toBe(at("ci-red"))
    expect(ciGrave.params.grave?.fixed).toBe(at("ci-green"))
    expect(ciGrave.params.grave?.fixer?.id).toBe(testGrave.params.who?.id)
    // the Implementer's tests fail in packages/world (before the plea), the fix passes them
    expect(testGrave.start).toBeGreaterThan(at("ci-red"))
    expect(testGrave.start).toBeLessThan(at("plea"))
    expect(testGrave.params.where?.package).toBe("packages/world")
    expect(testGrave.params.grave?.fixed).toBe(at("fix"))
    expect(testGrave.params.grave?.fixer?.id).toBe(testGrave.params.who?.id)
    expect(testGrave.params.grave?.slot).not.toBe(ciGrave.params.grave?.slot)
    // the storm breaks: a rainbow for 32 s
    expect(rainbow.start).toBe(at("ci-green"))
    expect(rainbow.end - rainbow.start).toBe(32_000)
    // every show is told, and hinted to the director
    for (const sh of all) {
      expect(showLine(sh)?.length).toBeGreaterThan(0)
      expect(showHint(sh).start).toBe(sh.start)
    }
  })
})

describe("undead: a state", () => {
  test("a fall rises, keeps vigil, and the recovered hero strikes its grave before it sinks", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("hero", 0, "gm", "guild-implementer")
    fail(f, "hero", 10_000)
    busy(f, "hero", 25_000) // before a failed subagent leaves (27 s)
    const [rising] = worldShows(f.log, 11_000)
    const g = rising?.params.grave
    expect(g?.rise).toBe(10_000)
    expect(g?.vigil).toBe(10_000 + SHOW_RULES.riseMs)
    expect(rising?.params.who?.id).toBe("hero")
    const [mended] = worldShows(f.log, 26_000)
    const m = mended?.params.grave
    expect(m?.fixer?.id).toBe("hero")
    expect(m?.strike).toBe(25_000 + SHOW_RULES.strikeMs)
    expect(m?.sink).toBe(25_000 + SHOW_RULES.strikeMs + SHOW_RULES.strikeHoldMs)
    expect(mended?.end).toBe((m?.sink ?? 0) + SHOW_RULES.sinkMs)
    expect(worldShows(f.log, mended?.end ?? 0)).toEqual([])
  })

  test("a hero who leaves sinks with no blow; a failed deed's minion stands 5 s unless the session falls", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("a", 0, "gm", "guild-implementer")
    f.start("b", 0, "gm", "guild-implementer")
    failedRun(f, "a", 10_000) // a minion at 12.2 s
    failedRun(f, "b", 20_000)
    fail(f, "b", 21_000) // its fall tells it: a grave, no minion
    const at15 = worldShows(f.log, 15_000)
    expect(at15.map((s) => s.params.grave?.minion)).toEqual([true])
    expect(at15[0]?.end).toBe(10_200 + SHOW_RULES.minionGraceMs + SHOW_RULES.minionMs + SHOW_RULES.sinkMs)
    const at25 = worldShows(f.log, 25_000)
    expect(at25.map((s) => `${s.params.grave?.cause}:${s.params.who?.id}`)).toEqual(["fail:b"])
  })

  test("graves never share a slot, and at most eight stand", () => {
    const f = new Feed()
    f.start("gm", 0)
    for (let k = 0; k < 10; k++) f.start(`h${k}`, 0, "gm", "guild-implementer")
    for (let k = 0; k < 10; k++) fail(f, `h${k}`, 10_000 + k * 100)
    const shows = worldShows(f.log, 20_000).filter((s) => s.kind === "undead")
    const slots = shows.map((s) => s.params.grave?.slot)
    expect(shows.length).toBe(SHOW_RULES.graves)
    expect(new Set(slots).size).toBe(SHOW_RULES.graves)
  })

  test("a package's failing tests raise the hero's grave; its tests passing mend it, and a fall keeps it", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("a", 0, "gm", "guild-implementer")
    f.start("b", 0, "gm", "guild-implementer")
    red(f, "a", 10_000)
    f.tool("a", "bash", { command: "bun test packages/world" }, 20_000)
    red(f, "b", 30_000)
    fail(f, "b", 31_000)
    const [a] = worldShows(f.log, 12_000)
    expect(a?.params.grave?.cause).toBe("test")
    expect(a?.params.where?.package).toBe("packages/world")
    expect(worldShows(f.log, 21_000)[0]?.params.grave?.fixer?.id).toBe("a")
    const b = worldShows(f.log, 32_000).filter((s) => s.params.who?.id === "b")
    expect(b.map((s) => s.params.grave?.cause)).toEqual(["fail"])
  })

  test("CI red raises a nameless grave, green sinks it; the storm's clearing is a rainbow", () => {
    const f = new Feed()
    f.start("gm", 0)
    ci(f, "failed", 10_000)
    ok(f, "gm", 20_000)
    ci(f, "running", 25_000)
    ci(f, "passed", 40_000)
    const shows = worldShows(f.log, 41_000)
    expect(kinds(shows)).toEqual(["undead", "rainbow"])
    expect(shows[0]?.params.grave?.fixer?.id).toBe("gm")
    expect(shows[0]?.params.where?.branch).toBe("main")
  })
})

describe("the other renown shows", () => {
  test("a clean quest's festival, a long run's fall's ghost ship, a long session's raid", () => {
    const f = new Feed()
    f.start("gm", 0)
    f.start("a", 0, "gm", "guild-implementer")
    festivalAt(f, "a", 10_000)
    f.start("b", 0, "gm", "guild-implementer")
    ok(f, "b", 1000)
    fail(f, "b", 7 * MIN) // after 7 min: the ghost ship
    ok(f, "gm", 46 * MIN) // 46 min in: the raid
    const engine = new ShowEngine()
    engine.feed(f.log.events)
    expect(kinds(engine.all().filter((s) => s.kind !== "undead"))).toEqual(["festival", "ghostship", "raid"])
    const raid = engine.all().find((s) => s.kind === "raid")
    // it stays while its quest goes on, and leaves at its 12 min cap
    expect(worldShows(f.log, 47 * MIN).find((s) => s.kind === "raid")?.end).toBe(Number.POSITIVE_INFINITY)
    expect(raid?.leave).toBe((raid?.start ?? 0) + 12 * MIN)
  })

  test("forced shows and dismissals", () => {
    const comet = forcedShow("comet", 1000, 1)
    expect(comet.end).toBe(1000 + 15_000)
    const dragon = forcedShow("dragon", 1000, 2, { id: "a", name: "Scout", color: "#fff" })
    expect(dragon.end).toBe(Number.POSITIVE_INFINITY)
    expect(dismissed(dragon, 5000).end).toBe(5000 + 8000)
    const grave = forcedShow("undead", 1000, 3)
    expect(dismissed(grave, 9000).end).toBe(9000 + SHOW_RULES.sinkMs)
    expect(showLine(dragon)?.some((p) => p.text.includes("Scout"))).toBe(true)
  })
})

describe("the director films a show's start", () => {
  test("a dragon's hint takes the camera from routine work, then lets go after its ttl", () => {
    const { log, beats } = sagaLog()
    const t = (beats.get("dispatch") as number) + 20_000
    const world = log.stateAt(t)
    const dragon = forcedShow("dragon", t, 1)
    const hint = showHint(dragon)
    const before = pick(world, world.recent, t, {})
    const shot = pick(world, world.recent, t + 4100, { shot: before }, [hint])
    expect(shot.focus.kind).toBe("show")
    expect(shot.distance).toBe("map")
    expect(shot.reason).toBe("show")
    const later = pick(world, world.recent, t + hint.ttl + 100, { shot }, [hint])
    expect(later.focus.kind).not.toBe("show")
  })
})

describe("idle costs nothing", () => {
  test("reading the shows at t, the log already fed, is under 0.05 ms", () => {
    const { log } = sagaLog()
    const engine = new ShowEngine()
    engine.feed(log.events)
    const t = (log.events.at(-1)?.at ?? 0) - 30_000
    const n = 2000
    const begin = performance.now()
    for (let k = 0; k < n; k++) {
      engine.feed(log.events) // nothing new
      engine.at(t + k)
    }
    const per = (performance.now() - begin) / n
    expect(per).toBeLessThan(0.05)
  })
})
