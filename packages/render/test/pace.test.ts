import { describe, expect, test } from "bun:test"
import { pacedBudget } from "../src/governor.ts"
import {
  CALM_RATIO,
  DOWN_WINDOWS,
  divisorFor,
  initialPace,
  MAX_UP_WINDOWS,
  missShare,
  paceOf,
  paceStep,
  paceWindow,
  UP_WINDOWS,
  vsyncOf,
} from "../src/pace.ts"

const HZ60 = 1000 / 60
const HZ120 = 1000 / 120

/** A second of frames, `misses` of them a vsync late. */
const second = (vsyncMs: number, misses: number, costP95 = vsyncMs * 0.5) => {
  const n = Math.round(1000 / vsyncMs)
  const intervals = Array.from({ length: n }, (_, i) => (i < misses ? vsyncMs * 2 : vsyncMs))
  return { vsyncMs, intervals, costP95 }
}

describe("the pace divisor", () => {
  test("is every 2nd vsync on 60 Hz, every 4th on 120, every 5th on 144, and 1 on a display paced already", () => {
    expect(divisorFor(HZ60)).toBe(2)
    expect(divisorFor(HZ120)).toBe(4)
    expect(divisorFor(1000 / 144)).toBe(5)
    expect(divisorFor(1000 / 30)).toBe(1)
    expect(divisorFor(0)).toBe(1)
  })

  test("the display's interval is the median of the raw gaps, a stall or a drop aside", () => {
    const gaps = Array.from({ length: 30 }, () => HZ60)
    gaps[3] = 150
    gaps[9] = 0.5
    expect(vsyncOf(gaps)).toBeCloseTo(HZ60, 5)
    expect(vsyncOf([HZ60, HZ60])).toBeCloseTo(HZ60, 5)
  })
})

describe("the pacer in Auto", () => {
  test("holds the display's rate while the frames hold it", () => {
    let s = initialPace()
    for (let k = 0; k < 20; k++) s = paceStep(s, second(HZ60, 0))
    expect(s.divisor).toBe(1)
  })

  test("steps to the 30 cadence after two bad seconds running, not after one", () => {
    let s = paceStep(initialPace(), second(HZ60, 12))
    expect(s.divisor).toBe(1)
    s = paceStep(s, second(HZ60, 0))
    s = paceStep(s, second(HZ60, 12))
    expect(s.divisor).toBe(1)
    for (let k = 0; k < DOWN_WINDOWS; k++) s = paceStep(s, second(HZ60, 12))
    expect(s.divisor).toBe(2)
    expect(s.lastMove).toBe("down")
  })

  test("on 120 Hz it steps to every 4th vsync", () => {
    let s = initialPace()
    for (let k = 0; k < DOWN_WINDOWS; k++) s = paceStep(s, second(HZ120, 30))
    expect(s.divisor).toBe(4)
  })

  test("steps back up only after the calm stretch, and a raise that does not hold doubles the next wait", () => {
    let s = initialPace()
    for (let k = 0; k < DOWN_WINDOWS; k++) s = paceStep(s, second(HZ60, 12))
    expect(s.divisor).toBe(2)
    // calm, but not yet long enough
    for (let k = 0; k < UP_WINDOWS - 1; k++) s = paceStep(s, second(HZ60, 0, HZ60 * 0.4))
    expect(s.divisor).toBe(2)
    // one busy second starts the count over
    s = paceStep(s, second(HZ60, 0, HZ60 * CALM_RATIO + 1))
    for (let k = 0; k < UP_WINDOWS - 1; k++) s = paceStep(s, second(HZ60, 0, HZ60 * 0.4))
    expect(s.divisor).toBe(2)
    s = paceStep(s, second(HZ60, 0, HZ60 * 0.4))
    expect(s.divisor).toBe(1)
    expect(s.lastMove).toBe("up")
    // the raise does not hold: down again, and the next raise needs twice the calm
    for (let k = 0; k < DOWN_WINDOWS; k++) s = paceStep(s, second(HZ60, 12))
    expect(s.divisor).toBe(2)
    expect(s.upWindows).toBe(UP_WINDOWS * 2)
    for (let k = 0; k < UP_WINDOWS; k++) s = paceStep(s, second(HZ60, 0, HZ60 * 0.4))
    expect(s.divisor).toBe(2)
    for (let k = 0; k < UP_WINDOWS; k++) s = paceStep(s, second(HZ60, 0, HZ60 * 0.4))
    expect(s.divisor).toBe(1)
    expect(s.upWindows).toBeLessThanOrEqual(MAX_UP_WINDOWS)
  })

  test("the miss share is the share of frames over 1.5 of their due interval", () => {
    expect(missShare([16, 17, 34, 16], HZ60)).toBe(0.25)
    expect(missShare([], HZ60)).toBe(0)
  })
})

describe("the viewer's motion pick", () => {
  test("Smooth 30 holds the paced cadence whatever the frames, Max the display's rate, Auto the pacer's", () => {
    const busy = second(HZ60, 20)
    expect(paceWindow(initialPace(), busy, "smooth").divisor).toBe(2)
    expect(paceWindow(initialPace(), second(HZ60, 0), "smooth").divisor).toBe(2)
    expect(paceWindow({ ...initialPace(), divisor: 2 }, busy, "max").divisor).toBe(1)
    expect(paceWindow(initialPace(), busy, "auto").divisor).toBe(1)
  })

  test("a stored pick is read back, anything else is Auto", () => {
    expect(paceOf("smooth")).toBe("smooth")
    expect(paceOf("max")).toBe("max")
    expect(paceOf("fast")).toBe("auto")
    expect(paceOf(null)).toBe("auto")
  })
})

describe("the quality ladder's budget under pacing", () => {
  test("is the paced frame less a margin once paced, the usual target at the display's rate", () => {
    expect(pacedBudget(12, 1, HZ60)).toBe(12)
    expect(pacedBudget(12, 2, HZ60)).toBeCloseTo(HZ60 * 2 * 0.85, 5)
    expect(pacedBudget(12, 4, HZ120)).toBeCloseTo(HZ120 * 4 * 0.85, 5)
  })
})
