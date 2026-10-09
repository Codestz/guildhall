import { describe, expect, test } from "bun:test"
import { type Around, WALK, Walker } from "../src/scene/life/folkWalk.ts"
import { slotAt, windowLit } from "../src/world/folk/day.ts"
import { type Folk, ROLES, type Role, type Slot, type Stop } from "../src/world/folk/types.ts"
import type { Spot } from "../src/world/layout.ts"

/**
 * The folk's day (world/folk/day.ts) and a walker living it (scene/life/folkWalk.ts): the schedule
 * is a pure function of the hour, and the walker needs nothing but the seconds it is given.
 */

const person = (role: Role, night = false, jitter = 0): Pick<Folk, "role" | "night" | "jitter"> => ({
  role,
  night,
  jitter,
})

describe("the day", () => {
  test("a villager is home through the night, at work by day, out at dusk", () => {
    const at = (hour: number): Slot => slotAt(person("villager"), hour)
    expect([at(3), at(8), at(12), at(18), at(21), at(23.5)]).toEqual([
      "home",
      "work",
      "work",
      "plaza",
      "inn",
      "home",
    ])
  })

  test("the day wraps past midnight: late and early hours are the same night", () => {
    for (const role of ROLES) expect(slotAt(person(role), 0.5)).toBe(slotAt(person(role), 24.5))
  })

  test("the night watch sleeps by day and is on the wall from dusk to dawn", () => {
    const at = (hour: number): Slot => slotAt(person("guard", true), hour)
    expect([at(2), at(5), at(10), at(17), at(20), at(23)]).toEqual([
      "work",
      "work",
      "home",
      "plaza",
      "work",
      "work",
    ])
  })

  test("a day shift guard and a night watch are never both off the wall at noon and midnight", () => {
    expect(slotAt(person("guard"), 12)).toBe("work")
    expect(slotAt(person("guard", true), 0)).toBe("work")
  })

  test("rain sends whoever is out into the inn, but the watch stays on the wall", () => {
    expect(slotAt(person("villager"), 12, true)).toBe("inn")
    expect(slotAt(person("farmer"), 18, true)).toBe("inn")
    expect(slotAt(person("villager"), 3, true)).toBe("home")
    expect(slotAt(person("guard"), 12, true)).toBe("work")
    expect(slotAt(person("guard", true), 23, true)).toBe("work")
  })

  test("a folk's jitter moves the change, so two on one street do not leave together", () => {
    expect(slotAt(person("villager", false, 0), 6.6)).toBe("work")
    expect(slotAt(person("villager", false, 0.5), 6.6)).toBe("home")
  })

  test("every role has all four parts of a day over 24 hours", () => {
    for (const role of ROLES) {
      const seen = new Set<Slot>()
      for (let h = 0; h < 24; h += 0.25) seen.add(slotAt(person(role), h))
      expect([...seen].sort()).toEqual(["home", "inn", "plaza", "work"])
    }
  })

  test("a window glows only of an evening or at dawn, and only for a share of the houses", () => {
    expect(windowLit(0.1, 12)).toBe(false)
    expect(windowLit(0.1, 20)).toBe(true)
    expect(windowLit(0.9, 20)).toBe(false)
    const lit = Array.from({ length: 100 }, (_, n) => windowLit(n / 100, 20)).filter(Boolean).length
    expect(lit).toBeGreaterThan(20)
    expect(lit).toBeLessThan(70)
  })
})

// ---- A walker --------------------------------------------------------------------------------

const door = { step: [10, 0], sill: [10, -1.1], y: 0, inward: Math.PI } as const
const stand = (at: Spot, clip: string, wait: number): Stop => ({ at, face: 0, clip, wait })
const folk = (stops: Partial<Folk["stops"]>, extra: Partial<Folk> = {}): Folk => ({
  id: "folk:t",
  role: "villager",
  model: "rogue",
  tint: "#888888",
  district: "/",
  home: "home:t",
  stops: {
    home: [{ ...stand(door.step, "Idle_A", Number.POSITIVE_INFINITY), door, venue: "home:t" }],
    work: [stand([30, 0], "Hammering", 20), stand([34, 0], "Idle_B", 10)],
    plaza: [stand([20, 6], "Idle_A", 10)],
    inn: [stand([20, 6], "Idle_A", 10)],
    ...stops,
  },
  jitter: 0,
  night: false,
  speed: 2,
  barrow: false,
  ...extra,
})
/** Roads that are straight lines; a door that is never full; flat ground. */
const flat = (crowded = false): Around => ({
  route: (_from, to) => [to],
  crowded: () => crowded,
  ground: () => 0,
})

/** Lives from `from` to `to` o'clock in frames of a tenth of a second. */
function live(walker: Walker, from: number, to: number, each?: (hour: number) => void): void {
  const step = 0.1
  for (let t = 0; from + t / 15 < to; t += step) {
    // The world clock at 15 s an hour (the demo day: 6 minutes).
    const hour = from + t / 15
    walker.update(step, hour)
    each?.(hour)
  }
}

describe("a walker", () => {
  test("is indoors at night with their window counted, and out in the morning", () => {
    const walker = new Walker(folk({}), flat())
    walker.snap(3)
    expect(walker.visible).toBe(false)
    expect(walker.venue).toBe("home:t")
    live(walker, 3, 8)
    expect(walker.visible).toBe(true)
    expect(walker.venue).toBeUndefined()
    expect(walker.slot).toBe("work")
  })

  test("reaches their work and plays its clip", () => {
    const walker = new Walker(folk({}), flat())
    walker.snap(3)
    live(walker, 3, 9)
    expect(Math.hypot(walker.x - 30, walker.z) < 6 || Math.hypot(walker.x - 34, walker.z) < 6).toBe(true)
    expect(["Hammering", "Idle_B", WALK]).toContain(walker.clip)
  })

  test("walks at the folk's pace: a short step in a frame, never a jump", () => {
    const walker = new Walker(folk({}), flat())
    walker.snap(3)
    let far = 0
    let last: Spot = [walker.x, walker.z]
    live(walker, 3, 10, () => {
      if (walker.visible) far = Math.max(far, Math.hypot(walker.x - last[0], walker.z - last[1]))
      last = [walker.x, walker.z]
    })
    // 2 units a second over 0.1 s: 0.2 (a door or a stair may hide them and bring them out a pace away).
    expect(far).toBeLessThan(1.3)
  })

  test("a day lived twice is the same day: no clock, no chance", () => {
    const run = (): string => {
      const walker = new Walker(folk({}), flat())
      walker.snap(5)
      const trail: string[] = []
      live(walker, 5, 20, (hour) => {
        if (Math.round(hour * 10) % 5 === 0)
          trail.push(`${walker.x.toFixed(2)},${walker.z.toFixed(2)},${walker.clip}`)
      })
      return trail.join("|")
    }
    expect(run()).toBe(run())
  })

  test("goes home when the day turns, in through their door", () => {
    const walker = new Walker(folk({}), flat())
    walker.snap(12)
    live(walker, 12, 24)
    expect(walker.slot).toBe("home")
    expect(walker.visible).toBe(false)
    expect(walker.venue).toBe("home:t")
  })

  test("a full inn keeps them at its step, and the loop goes on", () => {
    const inn = { step: [20, 6], sill: [20, 5], y: 0, inward: 0 } as const
    const stops = {
      inn: [
        { ...stand(inn.step, "Idle_A", 30), door: inn, venue: "inn", cap: 2 },
        stand([22, 8], "Cheering", 10),
      ],
    }
    const walker = new Walker(folk(stops), flat(true))
    walker.snap(12)
    live(walker, 12, 20)
    expect(walker.venue).toBeUndefined()
    expect(walker.visible).toBe(true)
  })

  test("a wall's watch goes up the stair, walks the wall and comes down at the end of the shift", () => {
    const lift = { step: [0, 4], sill: [0, 2.8], top: [0, 0], up: 5.45 }
    const wall = [
      { ...stand([0, 0], "Idle_B", 5), up: 5.45 },
      { ...stand([6.8, 0], "Idle_B", 5), up: 5.45 },
    ]
    const watch = folk({ work: wall }, { role: "guard", lift })
    const walker = new Walker(watch, flat())
    walker.snap(3)
    let up = 0
    live(walker, 3, 8, () => {
      up = Math.max(up, walker.level)
    })
    expect(up).toBe(5.45)
    live(walker, 8, 22)
    expect(walker.level).toBe(0)
    expect(walker.slot).toBe("home")
  })
})
