import { describe, expect, test } from "bun:test"
import {
  EVENTS_SHOW_RULES,
  type EventLog,
  PurseBook,
  SAGA_SHOW_RULES,
  SHOW_LOOK,
  SHOW_RULES,
  type Show,
  ShowEngine,
  type Story,
  showHint,
  showLine,
  story,
  worldShows,
} from "../src/index.ts"
import { played, unitsOf, v2Hall } from "./stories-fixtures.ts"

/**
 * "World events" (stories/events.ts) and the saga's nightfall: told, normalised and reduced, their logs
 * earn the world's shows by the engine's own rules (story/worldEvents.ts), with only the demo's spacing
 * (`Story.showRules`) and the party's purse over time (story/purse.ts) given.
 *
 *   EVENTS_TABLE=1 bun test packages/sim/test/stories-events.test.ts   prints the beat → show table
 */

interface Told {
  s: Story
  log: EventLog
  t0: number
  beats: Map<string, number>
  book: PurseBook
}

const tell = (id: "events" | "saga", seed = 1): Told => {
  const hall = v2Hall()
  const s = story(id, { seed, repo: { units: unitsOf(hall) } })
  const log = played(s, hall.binding.placeOf)
  const book = new PurseBook()
  for (const e of s.events) book.take(e.change)
  return { s, log, t0: log.events[0]?.at ?? 0, beats: new Map(s.beats.map((b) => [b.beat, b.at])), book }
}

/** Every show the story's log earns, with its rules and purse, as the hall's engine reads it. */
const showsOf = ({ s, log, book }: Told, since?: number): Show[] => {
  const engine = new ShowEngine({
    ...(s.showRules ? { gapMs: s.showRules.gapMs } : {}),
    purse: (m, at) => book.at(m, at),
    ...(since !== undefined ? { since } : {}),
  })
  engine.feed(log.events)
  return engine.all()
}

const big = (all: readonly Show[]) => all.filter((x) => x.kind !== "undead")
const actAt = (s: Story, at: number) => [...s.chapters].reverse().find((c) => c.at <= at)?.title

describe("World events: every show in turn", () => {
  const told = tell("events")
  const all = showsOf(told)
  const at = (beat: string) => told.beats.get(beat) as number
  if (process.env.EVENTS_TABLE) {
    const s = (ms: number) => (Number.isFinite(ms) ? ((ms - told.t0) / 1000).toFixed(1) : "∞")
    console.log(
      [
        `\nWorld events, ${(told.s.duration / 1000).toFixed(1)} s`,
        "| start (s) | show | cause | act |",
        "| ---: | --- | --- | --- |",
        ...all
          .filter((x) => !x.params.grave?.minion)
          .map(
            (x) =>
              `| ${s(x.start)} | ${x.kind} | ${x.params.grave ? `grave (${x.params.grave.cause}), fixer ${x.params.grave.fixer?.name ?? "–"}` : (x.renown?.key ?? "")} | ${actAt(told.s, x.start)} |`,
          ),
      ].join("\n"),
    )
  }

  test("runs about four minutes in five acts, with the demo's spacing", () => {
    expect(told.s.duration).toBeGreaterThan(180_000)
    expect(told.s.duration).toBeLessThan(270_000)
    expect(told.s.chapters.map((c) => c.title)).toEqual([
      "Dawn",
      "Red skies",
      "The hundredth deed",
      "The deep",
      "Nightfall",
    ])
    expect(told.s.showRules).toEqual(EVENTS_SHOW_RULES)
    expect(EVENTS_SHOW_RULES.gapMs).toBeLessThan(SHOW_RULES.gapMs)
  })

  test("the big shows come in order, one each, each in its act and each with room", () => {
    const shows = big(all)
    expect(shows.map((x) => x.kind)).toEqual(["dragon", "rainbow", "comet", "ghostship", "raid", "festival"])
    const act = (kind: string) => actAt(told.s, shows.find((x) => x.kind === kind)?.start ?? 0)
    expect(act("dragon")).toBe("Red skies")
    expect(act("rainbow")).toBe("Red skies")
    expect(act("comet")).toBe("The hundredth deed")
    expect(act("raid")).toBe("The deep")
    expect(act("festival")).toBe("Nightfall")
    // never two starting closer than the demo's gap; the timed ones never overlap
    for (let i = 1; i < shows.length; i++)
      expect((shows[i] as Show).start - (shows[i - 1] as Show).start).toBeGreaterThanOrEqual(
        EVENTS_SHOW_RULES.gapMs,
      )
    const timed = shows.filter((x) => Number.isFinite(SHOW_RULES.durationMs[x.kind] ?? Number.NaN))
    for (let i = 1; i < timed.length; i++)
      expect((timed[i] as Show).start).toBeGreaterThanOrEqual((timed[i - 1] as Show).end)
    // every one told and hinted
    for (const x of shows) {
      expect(showLine(x)?.length).toBeGreaterThan(0)
      expect(showHint(x).start).toBe(x.start + (SHOW_LOOK[x.kind].delay ?? 0))
    }
  })

  test("each show answers its cause", () => {
    const shows = big(all)
    const of = (kind: string) => shows.find((x) => x.kind === kind) as Show
    // red CI raises a grave; green CI's fixer is the Guildmaster, who watched it turn (by the graveyard)
    const ci = all.find((x) => x.params.grave?.cause === "ci") as Show
    const master = told.s.events.find((e) => e.change.type === "session")?.change.id
    expect(ci.start).toBe(at("ci-red"))
    expect(ci.params.grave?.fixed).toBe(at("ci-green"))
    expect(ci.params.grave?.fixer?.id).toBe(master)
    // the third failed build in a row brings the dragon; the build that passes sends it home
    expect(of("dragon").start).toBe(at("dragon"))
    expect(of("dragon").leave).toBe(at("built"))
    // the storm clears: the rainbow
    expect(of("rainbow").start).toBe(at("ci-green"))
    // the 100th deed: the comet
    expect(of("comet").start).toBe(at("hundredth"))
    expect(of("comet").params.size).toBe(100)
    // the Oracle's purse passes $10: the raid, which leaves when the quest ends
    expect(of("raid").start).toBeGreaterThanOrEqual(at("dear"))
    expect(of("raid").leave).toBe(at("end"))
    // two Scouts fall within two minutes: the ghost ship, and a grave for each
    expect(of("ghostship").start).toBeGreaterThanOrEqual(at("fall-2"))
    expect(of("ghostship").params.size).toBe(2)
    expect(all.filter((x) => x.params.grave?.cause === "fail").map((x) => x.start)).toEqual([
      at("fall"),
      at("fall-2"),
    ])
    // the Chronicler's fifteen clean deeds: the festival, by night (act V), played whole before the end
    expect(of("festival").start).toBeGreaterThanOrEqual(at("chronicled"))
    expect(of("festival").params.size).toBeGreaterThanOrEqual(15)
    expect(of("festival").end).toBeLessThanOrEqual((told.log.events.at(-1)?.at ?? 0) + 1000)
    // the raid's leaving is on the clock too (the story's coda)
    expect(told.log.events.at(-1)?.at ?? 0).toBeGreaterThanOrEqual(of("raid").end)
  })

  test("the sea answers too: a release for the galleon, the lighthouse amber, red, amber, warm", () => {
    const sea = told.s.seas
    expect(sea.some((e) => e.kind === "release")).toBe(true)
    const lamp = sea
      .filter((e) => e.kind === "ci" && e.branch === "world-events")
      .map((e) => (e.kind === "ci" ? e.state : ""))
    expect(lamp).toEqual(["queued", "running", "failed", "queued", "running", "passed"])
  })

  test("without its purse a replay earns no raid; with a live hall's 150 s it cannot fit the tour", () => {
    const engine = new ShowEngine({ gapMs: EVENTS_SHOW_RULES.gapMs })
    engine.feed(told.log.events)
    expect(big(engine.all()).map((x) => x.kind)).not.toContain("raid")
    const strict = new ShowEngine({ purse: (m, t) => told.book.at(m, t) })
    strict.feed(told.log.events)
    expect(big(strict.all()).length).toBeLessThan(6)
  })

  test("a seek replays nothing: landing after a show's start, it is never on stage", () => {
    for (const x of big(all)) {
      const t = x.start + 3000
      const landed = showsOf(told, x.start + 1000)
      expect([x.kind, landed.filter((y) => y.start <= t && y.end > t).some((y) => y.id === x.id)]).toEqual([
        x.kind,
        false,
      ])
      // landing before it was earned, it plays
      const before = showsOf(told, (x.renown?.at ?? x.start) - 1000)
      expect([x.kind, before.some((y) => y.id === x.id)]).toEqual([x.kind, true])
    }
  })

  test("every seed tells every show in order", () => {
    for (const seed of [2, 3, 4, 5]) {
      const kinds = big(showsOf(tell("events", seed))).map((x) => x.kind)
      expect([seed, kinds]).toEqual([seed, ["dragon", "rainbow", "comet", "ghostship", "raid", "festival"]])
    }
  })
})

describe("the saga ends with a festival at nightfall", () => {
  test("the Chronicler's clean notes earn it in act V, after the release, played whole", () => {
    const told = tell("saga")
    expect(told.s.showRules).toEqual(SAGA_SHOW_RULES)
    const all = showsOf(told)
    expect(all.map((x) => `${x.kind}:${x.params.grave?.cause ?? ""}`)).toEqual([
      "undead:ci",
      "undead:test",
      "rainbow:",
      "festival:",
    ])
    const festival = all.at(-1) as Show
    expect(actAt(told.s, festival.start)).toBe("Nightfall")
    expect(festival.start).toBeGreaterThan(told.beats.get("release") as number)
    expect(festival.end).toBeLessThanOrEqual(told.log.events.at(-1)?.at ?? 0)
    for (const seed of [2, 3, 4]) {
      const kinds = showsOf(tell("saga", seed)).map((x) => x.kind)
      expect([seed, kinds.at(-1)]).toEqual([seed, "festival"])
    }
  })
})

describe("a party's purse over time", () => {
  test("reads what the party had spent by t: its subagents' totals summed, nothing from later", () => {
    const book = new PurseBook()
    book.take({ type: "session", id: "gm", agent: "a", title: "t", at: 0 })
    book.take({ type: "session", id: "k", agent: "a", title: "t", parentID: "gm", at: 0 })
    book.take({ type: "usage", id: "gm", tokens: 100, cost: 1, at: 1000 })
    book.take({ type: "usage", id: "k", tokens: 50, cost: 4, at: 2000 })
    book.take({ type: "usage", id: "k", tokens: 90, cost: 9.5, at: 3000 })
    expect(book.at("gm", 500)).toBeUndefined()
    expect(book.at("gm", 1500)).toEqual({ tokens: 100, cost: 1 })
    expect(book.at("gm", 2500)).toEqual({ tokens: 150, cost: 5 })
    expect(book.at("gm", 9000)).toEqual({ tokens: 190, cost: 10.5 })
    expect(book.at("k", 9000)).toBeUndefined()
  })

  test("a raid earned by the purse shows only once it is spent, and a seek before it still plays it", () => {
    const told = tell("events")
    const raid = big(showsOf(told)).find((x) => x.kind === "raid") as Show
    const opts = { gapMs: EVENTS_SHOW_RULES.gapMs, purse: (m: string, t: number) => told.book.at(m, t) }
    expect(worldShows(told.log, raid.start - 500, opts).some((x) => x.kind === "raid")).toBe(false)
    expect(worldShows(told.log, raid.start + 500, opts).some((x) => x.kind === "raid")).toBe(true)
  })
})
