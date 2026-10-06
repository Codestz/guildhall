import { describe, expect, test } from "bun:test"
import { applyAll, type Change, emptyModel } from "@guildhall/core"
import { party, rush, Script, solo } from "@guildhall/sim"
import {
  DEFAULT_SETTINGS,
  type Environment,
  type EnvironmentSettings,
  environmentOf,
  type Weather,
} from "../src/guild/environment.ts"

const MINUTE = 60_000

/** The world at run time `t`, having seen every change up to then (sim runs start at 0). */
function at(changes: readonly Change[], t: number, settings: Partial<EnvironmentSettings> = {}): Environment {
  const model = applyAll(
    emptyModel(),
    changes.filter((change) => change.at <= t),
  )
  return environmentOf({
    wallClock: 0,
    runTime: t,
    runStart: 0,
    model,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  })
}

/** Weather sampled every `step` ms over [from, to]. */
function weathers(changes: readonly Change[], from: number, to: number, step = 1000): Weather[] {
  const out: Weather[] = []
  for (let t = from; t <= to; t += step) out.push(at(changes, t).weather)
  return out
}

const end = (changes: readonly Change[]) => changes.at(-1)?.at ?? 0

/** A guildmaster that sends one adventurer out to fail, at about `delay` ms into the run. */
function failedQuest(delay = 0): { changes: Change[]; failedAt: number } {
  const script = new Script(3)
  const master = script.guildmaster("Ship it")
  master.wait(delay + 1)
  master.deed("read", { filePath: "a.ts" }, 800)
  let failedAt = 0
  master.quest("guild-implementer", "Build it", (child) => {
    child.deed("edit", { filePath: "a.ts" }, 1000)
    child.fail("model refused")
    failedAt = child.clock
  })
  master.finish("It broke.")
  return { changes: script.done(), failedAt }
}

describe("weather from repo health", () => {
  test("no data: healthy and clear", () => {
    const world = at([], 0)
    expect(world.health).toBe(1)
    expect(world.weather).toBe("clear")
    expect(world.precipitation).toBe(0)
    expect(world.lightningAt).toBe(-1)
  })

  test("a healthy run stays clear", () => {
    const run = rush()
    expect(new Set(weathers(run, 0, end(run) + MINUTE))).toEqual(new Set(["clear"]))
  })

  test("repeated failures bring rain, without a storm", () => {
    const script = new Script(5)
    const master = script.guildmaster("Make the tests pass")
    for (let i = 0; i < 6; i++) {
      master.deed("edit", { filePath: "a.ts" }, 2000)
      master.deed("bash", { command: "bun test" }, 3000, { fail: "1 failed" })
      master.wait(5000)
    }
    const run = script.done()
    const seen = weathers(run, 0, end(run))
    expect(seen).toContain("rain")
    expect(seen).not.toContain("storm")
    const wet = at(run, end(run))
    expect(wet.health).toBeLessThan(0.7)
    expect(wet.precipitation).toBeGreaterThan(0)
  })

  test("a failed test darkens the party's sky, then it clears", () => {
    const run = party()
    const seen = weathers(run, 0, end(run) + 2 * MINUTE)
    expect(seen[0]).toBe("clear")
    expect(seen).toContain("cloudy")
    expect(seen.at(-1)).toBe("clear")
  })

  test("a failed session brings a storm that clears later", () => {
    const { changes, failedAt } = failedQuest()
    expect(at(changes, failedAt - 1).weather).not.toBe("storm")
    const storm = at(changes, failedAt + 5000)
    expect(storm.weather).toBe("storm")
    expect(storm.wind).toBeGreaterThanOrEqual(0.7)
    expect(storm.cloudCover).toBeGreaterThanOrEqual(0.9)
    expect(at(changes, failedAt + 40_000).weather).toBe("storm")
    expect(at(changes, failedAt + 3 * MINUTE).weather).toBe("clear")
  })

  test("a burst of failures is a storm too", () => {
    const script = new Script(7)
    const master = script.guildmaster("Fix CI")
    for (let i = 0; i < 4; i++) master.deed("bash", { command: "bun test" }, 1500, { fail: "exit 1" })
    const run = script.done()
    expect(at(run, end(run) + 1000).weather).toBe("storm")
  })

  test("one success does not flip the weather back and forth", () => {
    for (const run of [solo(), party()]) {
      const seen = weathers(run, 0, end(run) + 2 * MINUTE, 250)
      const changes = seen.filter((weather, i) => i > 0 && weather !== seen[i - 1]).length
      expect(changes).toBeLessThanOrEqual(2)
    }
  })

  test("continuous values ease: no big jump between frames outside a change of weather", () => {
    const { changes, failedAt } = failedQuest()
    let last = at(changes, failedAt + 1000)
    for (let t = failedAt + 1100; t < failedAt + 3 * MINUTE; t += 100) {
      const now = at(changes, t)
      if (now.weather === last.weather) {
        expect(Math.abs(now.cloudCover - last.cloudCover)).toBeLessThan(0.05)
        expect(Math.abs(now.precipitation - last.precipitation)).toBeLessThan(0.05)
        expect(Math.abs(now.wind - last.wind)).toBeLessThan(0.05)
      }
      last = now
    }
  })

  test("lightning strikes only in a storm, at or before now", () => {
    const { changes, failedAt } = failedQuest()
    const strikes = new Set<number>()
    for (let t = failedAt + 1000; t < failedAt + 30_000; t += 200) {
      const world = at(changes, t)
      expect(world.weather).toBe("storm")
      expect(world.lightningAt).toBeLessThanOrEqual(t)
      if (world.lightningAt >= 0) strikes.add(world.lightningAt)
    }
    expect(strikes.size).toBeGreaterThan(3)
    expect(at(rush(), 10_000).lightningAt).toBe(-1)
  })

  test("pinned weather wins", () => {
    const { changes, failedAt } = failedQuest()
    expect(at(changes, failedAt + 5000, { weather: "clear" }).weather).toBe("clear")
    expect(at(changes, failedAt + 5000, { weather: "clear" }).precipitation).toBe(0)
    const run = rush()
    const snow = at(run, 10_000, { weather: "snow" })
    expect(snow.weather).toBe("snow")
    expect(snow.temperature).toBeLessThan(1)
    const strikes = [10_000, 12_000, 14_000, 16_000].map((t) => at(run, t, { weather: "storm" }).lightningAt)
    expect(strikes.some((strike) => strike >= 0)).toBe(true)
    expect(at(run, 10_000, { weather: "rain" }).precipitation).toBeGreaterThan(0)
  })

  test("same input, same output", () => {
    const { changes, failedAt } = failedQuest()
    for (const t of [0, failedAt, failedAt + 7_300, failedAt + 2 * MINUTE])
      expect(at(changes, t)).toEqual(at(changes, t))
    expect(at(failedQuest().changes, failedAt + 9_000)).toEqual(at(changes, failedAt + 9_000))
  })
})

describe("temperature from activity", () => {
  test("a busy guild warms towards summer", () => {
    const run = rush()
    expect(at(run, 0).temperature).toBeCloseTo(14, 0)
    expect(at(run, end(run)).temperature).toBeGreaterThan(22)
    expect(at(run, end(run)).activity).toBeGreaterThan(0.9)
  })

  test("a long idle stretch gets cold: autumn, then below freezing", () => {
    const run = party()
    const busy = at(run, end(run))
    const autumn = at(run, end(run) + 20 * MINUTE)
    const winter = at(run, end(run) + 45 * MINUTE)
    expect(busy.temperature).toBeGreaterThan(20)
    expect(autumn.temperature).toBeLessThan(14)
    expect(autumn.temperature).toBeGreaterThan(1)
    expect(winter.temperature).toBeLessThan(0)
    expect(winter.activity).toBe(0)
  })

  test("a storm after a long idle stretch falls as snow", () => {
    const { changes, failedAt } = failedQuest(45 * MINUTE)
    const world = at(changes, failedAt + 5000)
    expect(world.weather).toBe("snow")
    expect(world.temperature).toBeLessThan(1)
    expect(world.precipitation).toBeGreaterThan(0)
    expect(world.lightningAt).toBe(-1)
  })

  test("snow only below freezing", () => {
    const { changes, failedAt } = failedQuest()
    expect(at(changes, failedAt + 5000).weather).toBe("storm")
    for (const run of [changes, failedQuest(45 * MINUTE).changes, party()]) {
      for (let t = 0; t <= end(run) + MINUTE; t += 2000) {
        const world = at(run, t)
        if (world.weather === "snow") expect(world.temperature).toBeLessThan(1)
      }
    }
  })
})
