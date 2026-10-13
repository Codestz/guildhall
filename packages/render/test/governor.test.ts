import { describe, expect, test } from "bun:test"
import {
  type GovernorState,
  governorStep,
  governWindow,
  initialGovernor,
  MAX_UP_WINDOWS,
  nextDpr,
  parseDprPin,
  QUALITY_DPR,
  qualityDpr,
  qualityOf,
  UP_WINDOWS,
} from "../src/governor.ts"

const RANGE: [number, number] = [1.5, 2]
const BUDGET = 12
const OVER = 14
const BAND = 10 // between 0.7× and 1× the budget: neither moves
const EASY = 5 // under 0.7× the budget

/** The governor after feeding it one p95 per window, in order. */
const run = (p95s: readonly number[], from: GovernorState = initialGovernor(2)) =>
  p95s.reduce((state, p95) => governorStep(state, p95, RANGE, BUDGET), from)

/** Every DPR the governor passed through while fed `p95s`. */
const trace = (p95s: readonly number[], start = 2) => {
  const dprs = [start]
  let state = initialGovernor(start)
  for (const p95 of p95s) {
    state = governorStep(state, p95, RANGE, BUDGET)
    if (state.dpr !== dprs.at(-1)) dprs.push(state.dpr)
  }
  return dprs
}

describe("nextDpr", () => {
  test("steps down by 0.25 after two windows over budget", () => {
    expect(nextDpr([OVER, OVER], 2, RANGE, BUDGET)).toBe(1.75)
  })

  test("one window over budget is not enough", () => {
    expect(nextDpr([OVER], 2, RANGE, BUDGET)).toBe(2)
    expect(nextDpr([OVER, BAND, OVER], 2, RANGE, BUDGET)).toBe(2)
  })

  test("exactly the budget is not over it", () => {
    expect(nextDpr([BUDGET, BUDGET], 2, RANGE, BUDGET)).toBe(2)
  })

  test("never drops below the range", () => {
    expect(nextDpr([OVER, OVER], 1.5, RANGE, BUDGET)).toBe(1.5)
    expect(nextDpr([OVER, OVER], 1.6, RANGE, BUDGET)).toBe(1.5)
  })

  test("steps up after five comfortable windows, not four", () => {
    expect(nextDpr(Array(5).fill(EASY), 1.5, RANGE, BUDGET)).toBe(1.75)
    expect(nextDpr(Array(4).fill(EASY), 1.5, RANGE, BUDGET)).toBe(1.5)
  })

  test("the band between 0.7× and 1× the budget holds still", () => {
    expect(nextDpr(Array(30).fill(BAND), 1.75, RANGE, BUDGET)).toBe(1.75)
    expect(nextDpr(Array(5).fill(BUDGET * 0.7), 1.75, RANGE, BUDGET)).toBe(1.75)
  })

  test("never rises above the range", () => {
    expect(nextDpr(Array(5).fill(EASY), 2, RANGE, BUDGET)).toBe(2)
  })

  test("a longer up window is honoured", () => {
    expect(nextDpr(Array(9).fill(EASY), 1.5, RANGE, BUDGET, 10)).toBe(1.5)
    expect(nextDpr(Array(10).fill(EASY), 1.5, RANGE, BUDGET, 10)).toBe(1.75)
  })
})

describe("governorStep", () => {
  test("sustained overload walks down a step at a time to the floor", () => {
    expect(trace(Array(10).fill(OVER))).toEqual([2, 1.75, 1.5])
  })

  test("a move clears the history, so the next one needs a full window at the new DPR", () => {
    const state = run([OVER, OVER])
    expect(state).toMatchObject({ dpr: 1.75, history: [], lastMove: "down" })
    expect(run([OVER], state).dpr).toBe(1.75)
  })

  test("recovers to the top once the load goes away", () => {
    expect(trace([...Array(4).fill(OVER), ...Array(20).fill(EASY)])).toEqual([2, 1.75, 1.5, 1.75, 2])
  })

  test("a steady reading in the band never moves", () => {
    expect(trace(Array(300).fill(BAND))).toEqual([2])
  })

  test("a raise that does not hold doubles the wait before the next raise", () => {
    // Easy at 1.75, over budget at 2: the classic thrash setup.
    let state = run([OVER, OVER])
    let dpr = state.dpr
    let changes = 0
    for (let t = 0; t < 300; t++) {
      state = governorStep(state, state.dpr === 2 ? OVER : EASY, RANGE, BUDGET)
      if (state.dpr !== dpr) changes++
      dpr = state.dpr
    }
    // Waits of 5, 10, 20, 40, then 60 s: seven tries in five minutes, not one every 7 s (~85 moves).
    expect(changes).toBeLessThanOrEqual(14)
    expect(state.upWindows).toBe(MAX_UP_WINDOWS)
  })

  test("a drop long after a raise held resets the wait", () => {
    let state = run([...Array(2).fill(OVER), ...Array(UP_WINDOWS).fill(EASY)])
    expect(state).toMatchObject({ dpr: 2, lastMove: "up" })
    state = run([...Array(MAX_UP_WINDOWS).fill(BAND), OVER, OVER], state)
    expect(state).toMatchObject({ dpr: 1.75, upWindows: UP_WINDOWS })
  })

  test("a range of one value never moves", () => {
    let state = initialGovernor(1)
    for (const p95 of [...Array(10).fill(OVER), ...Array(10).fill(EASY)])
      state = governorStep(state, p95, [1, 1], BUDGET)
    expect(state.dpr).toBe(1)
  })
})

describe("parseDprPin", () => {
  test.each([
    ["?dpr=1", 1],
    ["?screen=lineup&dpr=1.75", 1.75],
    ["dpr=2", 2],
  ])("%p pins %p", (search, dpr) => {
    expect(parseDprPin(search)).toBe(dpr)
  })

  test.each([[""], ["?screen=m0"], ["?dpr="], ["?dpr=two"], ["?dpr=0"], ["?dpr=-1"], ["?dpr=Infinity"]])(
    "%p pins nothing",
    (search) => {
      expect(parseDprPin(search)).toBeUndefined()
    },
  )
})

describe("the viewer's quality pick", () => {
  test("a pick holds the DPR however far over budget the frames run (the governor never overrides it)", () => {
    let state = initialGovernor(2)
    for (let i = 0; i < 30; i++) {
      state = governWindow(state, OVER * 3, RANGE, BUDGET, 2)
      expect(state.dpr).toBe(2)
      expect(state.history).toEqual([])
    }
    // nor does it raise a low pick when the frames are easy
    let low = initialGovernor(1)
    for (let i = 0; i < 90; i++) low = governWindow(low, EASY, RANGE, BUDGET, 1)
    expect(low.dpr).toBe(1)
  })

  test("Auto (no pick) is the governor's own step, and after a pick it starts afresh", () => {
    const fed = [OVER, OVER, BAND, OVER, OVER]
    let auto = initialGovernor(2)
    let plain = initialGovernor(2)
    for (const p95 of fed) {
      auto = governWindow(auto, p95, RANGE, BUDGET, null)
      plain = governorStep(plain, p95, RANGE, BUDGET)
    }
    expect(auto).toEqual(plain)
    // over budget while pinned: none of it counts once Auto is back
    let state = initialGovernor(2)
    state = governWindow(state, OVER, RANGE, BUDGET, 2)
    state = governWindow(state, OVER, RANGE, BUDGET, null)
    expect(state.dpr).toBe(2)
    state = governWindow(state, OVER, RANGE, BUDGET, null)
    expect(state.dpr).toBe(1.75)
  })

  test("a pick keeps how long a raise must wait (a pinned stretch does not reset the anti-oscillation)", () => {
    const waited: GovernorState = { ...initialGovernor(2), upWindows: 20 }
    expect(governWindow(waited, EASY, RANGE, BUDGET, 1.5).upWindows).toBe(20)
  })

  test("the tiers' DPRs, never sharper than the screen; Auto pins none; unknown or missing reads Auto", () => {
    expect(qualityDpr("auto", 2)).toBeNull()
    expect(qualityDpr("low", 2)).toBe(1)
    expect(qualityDpr("medium", 2)).toBe(1.5)
    expect(qualityDpr("high", 2)).toBe(2)
    expect(qualityDpr("high", 1)).toBe(1)
    expect(qualityDpr("medium", 0)).toBe(1)
    expect(Object.keys(QUALITY_DPR)).toEqual(["auto", "low", "medium", "high"])
    expect(qualityOf("high")).toBe("high")
    expect(qualityOf(null)).toBe("auto")
    expect(qualityOf("ultra")).toBe("auto")
    expect(qualityOf("toString")).toBe("auto")
  })
})
