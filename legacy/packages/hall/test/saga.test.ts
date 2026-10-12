import { describe, expect, test } from "bun:test"
import { sagaTale } from "@guildhall/sim"
import { storyHour } from "../src/guild/environment.ts"
import { RULES } from "../src/guild/events.ts"
import type { Moment } from "../src/guild/moments.ts"
import { GuildStore } from "../src/guild/store.ts"
import { Narrator } from "../src/guild/story.ts"
import { playSaga } from "./support/saga.ts"

/**
 * The Saga (sim/saga.ts) played through the store frame by frame, the way the showcase plays it,
 * with the world events' live scheduler on the same clock. Nothing is forced: each feature must
 * fire through the real rules (guild/events.ts, guild/undead.ts, guild/parties.ts), in its act.
 */
const play = playSaga()
const acts = play.store.chapters.map((c) => c.at)
/** Which act (0 = I) a run time falls in. */
const actOf = (run: number) => acts.findLastIndex((at) => at <= run)
const I = 0
const II = 1
const III = 2
const IV = 3
const V = 4
const main = play.moments.find((m) => !m.parent)?.master as string
const of = (kind: Moment["kind"]) => play.moments.filter((m) => m.kind === kind)
const earned = (kind: string) => play.earned.filter((r) => r.kind === kind)

describe("the Saga: chapters and the story's clock", () => {
  test("five acts, each told once as the story reaches it, in order", () => {
    expect(play.store.chapters.map((c) => `${c.numeral} ${c.title}`)).toEqual([
      "I Dawn",
      "II The forge",
      "III The storm",
      "IV The mending",
      "V Nightfall",
    ])
    expect(play.chapters.map((c) => c.chapter.numeral)).toEqual(["I", "II", "III", "IV", "V"])
    for (const told of play.chapters) expect(told.run - told.chapter.at).toBeLessThan(1000)
  })

  test("the acts are markers on the timeline, named for the tape's ticks", () => {
    const ticks = play.store.markers.filter((m) => m.kind === "chapter")
    expect(ticks.map((m) => m.at)).toEqual(acts)
    expect(ticks[2]?.label).toBe("Act III — The storm")
  })

  test("the story's clock runs from dawn to night, act by act", () => {
    const [dawn, forge, storm, recovery, nightfall] = play.hours
    expect(dawn).toBeLessThan(6.5)
    expect(forge).toBeGreaterThan(8)
    expect(storm).toBeGreaterThan(12)
    expect(recovery).toBeGreaterThan(15)
    expect(nightfall).toBeGreaterThan(20)
    expect(play.hours).toEqual([...play.hours].sort((a, b) => a - b))
  })

  test("watched, it lasts 15 to 20 minutes (the Director skips the quiet stretches)", () => {
    expect(play.real).toBeGreaterThan(15 * 60_000)
    expect(play.real).toBeLessThan(20 * 60_000)
  })

  test("jumping to an act lands on its start and tells its title card", () => {
    const store = new GuildStore()
    store.load("saga")
    const told: string[] = []
    store.onChapter((c) => told.push(c.numeral))
    store.seekChapter(2)
    store.tick(16)
    expect(store.chapter?.numeral).toBe("III")
    expect(told).toEqual(["III"])
    // A seek past a chapter's start tells nothing: only a chapter begun is told.
    store.seek((store.chapters[3]?.at ?? 0) + 5000)
    store.tick(16)
    expect(told).toEqual(["III"])
  })
})

describe("the Saga: every world event, earned through the rules, in its act", () => {
  test("Act II: the treasury passes two million tokens, and pirates anchor", () => {
    const [raid] = earned("raid")
    expect(raid?.facts.spent).toBe("tokens")
    expect(actOf(raid?.at ?? -1)).toBe(II)
  })

  test("Act III: three failed commands in a row from one Implementer wake the dragon", () => {
    const [dragon] = earned("dragon")
    expect(dragon?.hero?.title).toStartWith("Artisan")
    expect(dragon?.facts).toMatchObject({ streak: RULES.dragonRun, tool: "bash" })
    expect(actOf(dragon?.at ?? -1)).toBe(III)
  })

  test("Act III: two fall a minute apart; both rise as skeletons and the ghost ship passes", () => {
    const falls = of("fail").filter((m) => m.master === main)
    expect(falls).toHaveLength(2)
    expect(falls.map((f) => actOf(f.at))).toEqual([III, III])
    expect((falls[1]?.at ?? 0) - (falls[0]?.at ?? 0)).toBeLessThan(RULES.ghostWindowMs)
    const [ghost] = earned("ghost-ship")
    expect(ghost?.facts.fallen).toBe(2)
    expect(ghost?.at).toBe(falls[1]?.at)
    // Each rises from a grave as it falls (within the frame that heard it).
    for (const fall of falls) {
      const rise = play.graves.find((g) => g.id === fall.id && g.state === "rising")
      expect((rise?.run ?? Number.POSITIVE_INFINITY) - fall.at).toBeLessThan(1000)
    }
  })

  test("Act III: a plea for a risky command waits on the user, then is answered", () => {
    const pleas = of("plea").filter((m) => actOf(m.at) === III)
    expect(pleas).toHaveLength(1)
    const answered = of("plea-answered").find((m) => m.id === pleas[0]?.id && m.at > (pleas[0]?.at ?? 0))
    expect(answered).toBeDefined()
    // The plan's approval in Act I is a plea too.
    expect(of("plea").filter((m) => actOf(m.at) === I)).toHaveLength(1)
  })

  test("Act IV: the fallen are called back and sink into their graves", () => {
    const rises = of("recover").filter((m) => m.master === main)
    expect(rises).toHaveLength(2)
    for (const rise of rises) {
      expect(actOf(rise.at)).toBe(IV)
      const sink = play.graves.find((g) => g.id === rise.id && g.state === "sinking")
      expect((sink?.run ?? Number.POSITIVE_INFINITY) - rise.at).toBeLessThan(1000)
    }
  })

  test("Act IV: the storm clears and a rainbow stands over the island", () => {
    const [rainbow] = earned("rainbow")
    expect(actOf(rainbow?.at ?? -1)).toBe(IV)
    const weathers = play.weather.map((w) => w.weather)
    expect(weathers.indexOf("storm")).toBeGreaterThan(weathers.indexOf("rain"))
    expect(play.weather.findLast((w) => w.run <= (rainbow?.at ?? 0))?.weather).toBe("clear")
  })

  test("Act IV: the hundredth deed, by night, brings the comet", () => {
    const [comet] = earned("comet")
    expect(comet?.facts.deeds).toBe(100)
    expect(actOf(comet?.at ?? -1)).toBe(IV)
    expect(storyHour(sagaTale().hours, comet?.at ?? 0)).toBeGreaterThan(19)
  })

  test("Act V: the final verification comes home clean, by night: the festival", () => {
    const [festival] = earned("festival")
    expect(festival?.hero?.title).toBe("Warden")
    expect(festival?.facts.deeds).toBeGreaterThanOrEqual(RULES.festivalDeeds)
    expect(actOf(festival?.at ?? -1)).toBe(V)
    expect(storyHour(sagaTale().hours, festival?.at ?? 0)).toBeGreaterThan(21)
  })

  test("each event is earned once, and every one starts on the live scheduler, in act order", () => {
    const kinds = ["raid", "dragon", "ghost-ship", "rainbow", "comet", "festival"]
    expect(play.earned.map((r) => r.kind)).toEqual(kinds)
    expect(play.started.map((s) => s.kind)).toEqual(kinds)
    // The last show has time to play before the story ends and loops.
    expect(play.real - (play.started.at(-1)?.real ?? play.real)).toBeGreaterThan(45_000)
  })
})

describe("the Saga: two parties", () => {
  test("a second conversation opens in the forge and shares the island", () => {
    const roots = [...new Set(play.moments.map((m) => m.master))]
    expect(roots).toHaveLength(2)
    expect(play.mostParties).toBe(2)
    const second = play.moments.find((m) => m.master !== main)
    expect(actOf(second?.at ?? -1)).toBe(II)
  })

  test("its work done, the second party goes home through the gate in the last act", () => {
    const second = roots().find((id) => id !== main)
    const home = of("leave").find((m) => m.id === second)
    expect(home).toBeDefined()
    expect(actOf(home?.at ?? -1)).toBe(V)
  })
})

describe("the Saga: told the same every time", () => {
  test("the same seed gives the same film", () => {
    expect(sagaTale()).toEqual(sagaTale())
  })

  test("the story clock eases between its keyframes and holds past the ends", () => {
    const hours = [
      { at: 0, hour: 6 },
      { at: 1000, hour: 8 },
      { at: 2000, hour: 25 },
    ]
    expect(storyHour(hours, -5)).toBe(6)
    expect(storyHour(hours, 500)).toBe(7)
    expect(storyHour(hours, 2000)).toBe(1)
    expect(storyHour(hours, 9000)).toBe(1)
  })

  test("a chapter's title card goes first, alone; a newer one replaces one not yet told", () => {
    const narrator = new Narrator({ session: () => undefined })
    narrator.announce({ numeral: "I", title: "Dawn", tagline: "A quest is given" }, 0)
    narrator.announce({ numeral: "II", title: "The forge", tagline: "Many hands at work" }, 10)
    const card = narrator.next(5000)
    expect(card?.kind).toBe("chapter")
    expect(card?.text).toBe("Act II — The forge. Many hands at work")
    expect(narrator.next(60_000)).toBeUndefined()
  })
})

function roots(): string[] {
  return [...new Set(play.moments.map((m) => m.master))]
}
