import { describe, expect, test } from "bun:test"
import {
  type EventLog,
  type GuildWorld,
  heroes,
  pleas,
  SAGA_UNITS,
  type Story,
  story,
  type WorldEvent,
  weatherOf,
} from "../src/index.ts"
import { guildhallHall, type Hall, played, unitsOf, v2Hall } from "./stories-fixtures.ts"

/**
 * The saga's acceptance (plan-hud-events.md D1): told on Guildhall's island, normalised and reduced (E4),
 * it plays unattended through every beat, in order: the dispatch, three heroes at three places, a pull
 * request, CI red and the storm, a plea, the fix, CI green and the sky clear, the merge, the loot home
 * and a release. The beats are read off the world events and the folded world, not the authored marks.
 *
 *   SAGA_TABLE=1 bun test packages/sim/test/stories-saga.test.ts   prints the beat table
 */

type Beat =
  | "dispatch"
  | "3 places"
  | "pr opened"
  | "ci red"
  | "storm"
  | "plea"
  | "fix"
  | "ci green"
  | "clear"
  | "merged"
  | "loot"
  | "release"

const ORDER: readonly Beat[] = [
  "dispatch",
  "3 places",
  "pr opened",
  "ci red",
  "storm",
  "plea",
  "fix",
  "ci green",
  "clear",
  "merged",
  "loot",
  "release",
]

interface Seen {
  at: number
  what: string
}

/** Every beat's first time, read off the log (and the world folded to it), with what it was. */
function beatsOf(log: EventLog, hall: Hall): { beats: Map<Beat, Seen>; smith: string; places: string[] } {
  const beats = new Map<Beat, Seen>()
  const first = (beat: Beat, at: number, what: string) => {
    if (!beats.has(beat)) beats.set(beat, { at, what })
  }
  const evs = log.events
  const sent = evs.filter(
    (e): e is Extract<WorldEvent, { kind: "actor.join" }> => e.kind === "actor.join" && !!e.parent,
  )
  const quests = evs.filter((e) => e.kind === "actor.quest").slice(0, 3)
  if (sent.length >= 3 && quests.length === 3)
    first("dispatch", sent[2]?.at ?? 0, `${quests.length} quests; ${sent.map((e) => e.name).join(", ")} sent`)
  // the three at three places: scan the folded world
  const end = evs.at(-1)?.at ?? 0
  let places: string[] = []
  for (let t = 0; t <= end; t += 250) {
    const world = log.stateAt(t)
    const out = heroes(world, t).filter((h) => !h.root && h.place !== undefined)
    const distinct = new Set(out.map((h) => h.place))
    if (out.length >= 3 && distinct.size >= 3) {
      places = out.map((h) => `${h.name} → ${hall.unitOf(h.place)}`)
      first("3 places", t, places.join("; "))
      break
    }
  }
  // the hero called back to fix the storm
  const resumed = evs.find((e) => e.kind === "actor.resume")
  const smith = resumed && "id" in resumed ? resumed.id : ""
  for (const ev of evs) {
    const world = (): GuildWorld => log.stateAt(ev.at)
    switch (ev.kind) {
      case "sea.pr":
        if (ev.state === "opened") first("pr opened", ev.at, `#${ev.n} ${ev.title}`)
        if (ev.state === "merged") first("merged", ev.at, `#${ev.n} merged`)
        break
      case "sea.ci":
        if (ev.moment === "sea-red") {
          first("ci red", ev.at, `${ev.name} on ${ev.branch} failed`)
          if (weatherOf(world()) === "storm") first("storm", ev.at, "weather: storm")
        }
        if (ev.moment === "sea-green") {
          first("ci green", ev.at, `${ev.name} on ${ev.branch} passed`)
          if (weatherOf(world()) === "clear") first("clear", ev.at, "weather: clear")
        }
        break
      case "actor.plea":
        if (beats.has("storm")) first("plea", ev.at, `${pleas(world())[0]?.name} waits on a human`)
        break
      case "actor.deed":
        if (
          beats.has("plea") &&
          ev.id === smith &&
          !ev.failed &&
          ev.craft === "test" &&
          ev.target.includes("test")
        )
          first("fix", ev.at, `${ev.target} passes`)
        break
      case "actor.loot":
        if (beats.has("merged") && ev.id === smith)
          first("loot", ev.at, `${world().actors.get(ev.id)?.name} home with the loot`)
        break
      case "sea.release":
        first("release", ev.at, `${ev.tag} released`)
        break
    }
  }
  return { beats, smith, places }
}

const table = (s: Story, beats: Map<Beat, Seen>) =>
  [
    `| t (s) | beat | what | act |`,
    `| ---: | --- | --- | --- |`,
    ...ORDER.map((b) => {
      const seen = beats.get(b)
      const act = [...s.chapters].reverse().find((c) => c.at <= (seen?.at ?? 0))
      return `| ${seen ? (seen.at / 1000).toFixed(1) : "–"} | ${b} | ${seen?.what ?? "MISSING"} | ${act ? `${act.numeral} ${act.title}` : ""} |`
    }),
  ].join("\n")

describe("the saga on Guildhall's island", async () => {
  const hall = await guildhallHall()
  const told = story("saga", { repo: { name: hall.name, units: unitsOf(hall) } })
  const log = played(told, hall.binding.placeOf)
  const { beats, smith } = beatsOf(log, hall)
  if (process.env.SAGA_TABLE)
    console.log(`\n${hall.name}, ${(told.duration / 1000).toFixed(1)} s\n${table(told, beats)}\n`)

  test("it normalises and reduces whole, and runs about three minutes", () => {
    expect(log.length).toBeGreaterThan(100)
    expect(told.duration).toBeGreaterThan(150_000)
    expect(told.duration).toBeLessThan(200_000)
    expect(told.chapters.map((c) => c.title)).toEqual([
      "Dawn",
      "The forge",
      "The storm",
      "The mending",
      "Nightfall",
    ])
  })

  test("every beat, in order", () => {
    expect(ORDER.filter((b) => !beats.has(b))).toEqual([])
    const times = ORDER.map((b) => beats.get(b)?.at ?? Number.NaN)
    for (let i = 1; i < times.length; i++)
      expect([ORDER[i], times[i]! >= times[i - 1]!]).toEqual([ORDER[i], true])
    // each beat falls in its act
    const actOf = (b: Beat) =>
      [...told.chapters].reverse().find((c) => c.at <= (beats.get(b)?.at ?? 0))?.title
    expect(actOf("3 places")).toBe("The forge")
    expect(actOf("storm")).toBe("The storm")
    expect(actOf("fix")).toBe("The mending")
    expect(actOf("release")).toBe("Nightfall")
  })

  test("the three heroes stand at three of the island's places, none the hall; the storm's fix is at the world's", () => {
    const at = beats.get("3 places")?.at ?? 0
    const world = log.stateAt(at)
    const sent = heroes(world, at).filter((h) => !h.root)
    expect(sent).toHaveLength(3)
    expect(new Set(sent.map((h) => h.place)).size).toBe(3)
    expect(sent.every((h) => h.place !== undefined)).toBe(true)
    // the hero called back is the one sent to packages/world (rehomed to the capital), and fixes it there
    const fix = log.events.find((e) => e.kind === "actor.deed" && e.id === smith && e.target.includes("test"))
    const where = heroes(log.stateAt(fix?.at ?? 0), fix?.at).find((h) => h.id === smith)?.place
    expect(where).toBe(hall.binding.capital)
    // the guildmaster never leaves the hall
    const root = heroes(log.head, end(log), { gone: true }).find((h) => h.root)
    expect(root?.place).toBeUndefined()
  })

  test("the hero called back is still on the island: no leave between its loot and its call back", () => {
    const leave = log.events.find((e) => e.kind === "actor.leave" && e.id === smith)
    const resume = log.events.find((e) => e.kind === "actor.resume" && e.id === smith)
    expect(resume).toBeDefined()
    expect(leave === undefined || leave.at > (resume?.at ?? 0)).toBe(true)
  })

  test("the sky follows CI: clear, cloudy while it runs, a storm on red, clear on green", () => {
    const sky = (t: number) => weatherOf(log.stateAt(t))
    const red = beats.get("ci red")?.at ?? 0
    const green = beats.get("ci green")?.at ?? 0
    expect(sky((beats.get("dispatch")?.at ?? 0) + 1000)).toBe("clear")
    expect(sky(red - 1000)).toBe("cloudy")
    expect(sky(red + 5000)).toBe("storm")
    expect(sky(green + 100)).toBe("clear")
    expect(sky(end(log))).toBe("clear")
  })

  test("the heroes rest at the end: everyone done, the sent ones gone home", () => {
    const final = heroes(log.head, end(log), { gone: true })
    expect(final.every((h) => h.status === "done")).toBe(true)
    expect(heroes(log.head, end(log)).map((h) => h.root)).toEqual([true])
  })

  test("every seed tells every beat, in order", () => {
    for (const seed of [2, 3, 4, 5, 6, 7]) {
      const s = story("saga", { seed, repo: { name: hall.name, units: unitsOf(hall) } })
      const { beats: b } = beatsOf(played(s, hall.binding.placeOf), hall)
      const times = ORDER.map((x) => b.get(x)?.at ?? Number.NaN)
      expect([seed, ORDER.filter((x) => !b.has(x))]).toEqual([seed, []])
      expect([seed, times.every((t, i) => i === 0 || t >= (times[i - 1] ?? 0))]).toEqual([seed, true])
    }
  })
})

describe("the saga in its own layout (this repo's V2 units)", () => {
  test("the heroes go to packages/world, packages/render and apps/studio, by their own paths", () => {
    const hall = v2Hall()
    const told = story("saga")
    const log = played(told, hall.binding.placeOf)
    const { beats, places } = beatsOf(log, hall)
    expect(ORDER.filter((b) => !beats.has(b))).toEqual([])
    expect(places.map((p) => p.split(" → ")[1]).sort()).toEqual(
      [SAGA_UNITS.render, SAGA_UNITS.world, SAGA_UNITS.studio].sort(),
    )
    // rehoming onto the units it already names changes nothing
    expect(story("saga", { repo: { units: hall.units } }).events).toEqual(told.events)
  })
})

const end = (log: EventLog) => log.events.at(-1)?.at ?? 0
