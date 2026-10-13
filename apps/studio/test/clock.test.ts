/**
 * The hall's one clock (hall/clock.ts): seeks clamp and can jump, play runs the history in its seconds at
 * its rate and stops at today, play from today starts again at the first commit, and the same calls give
 * the same `t` however the frames fall.
 */
import { describe, expect, test } from "bun:test"
import { createClock, createHallTime, HISTORY_SECONDS, MAX_DT, nextRate, RATES } from "../src/hall/clock.ts"

describe("Clock", () => {
  test("opens at today, a replay of the history, paused, at 1×", () => {
    const s = createClock().get()
    expect(s).toEqual({ mode: "replay", scale: "history", t: 1, rate: 1, playing: false, jumps: 0 })
    expect(createClock({ t: 0.25 }).get().t).toBe(0.25)
  })

  test("seek clamps to the history and only a jump bumps `jumps`", () => {
    const c = createClock()
    c.seek(0.4)
    expect(c.get()).toMatchObject({ t: 0.4, jumps: 0 })
    c.seek(-3)
    expect(c.get().t).toBe(0)
    c.seek(7, { jump: true })
    expect(c.get()).toMatchObject({ t: 1, jumps: 1 })
    c.seek(Number.NaN)
    expect(c.get().t).toBe(1)
  })

  test("play runs the whole history in HISTORY_SECONDS at 1×, and stops at today", () => {
    const c = createClock({ t: 0 })
    c.play(true)
    for (let k = 0; k < HISTORY_SECONDS * 10 - 1; k++) c.tick(0.1)
    expect(c.get().playing).toBe(true)
    expect(c.get().t).toBeCloseTo(1 - 0.1 / HISTORY_SECONDS, 9)
    c.tick(0.1)
    expect(c.get()).toMatchObject({ t: 1, playing: false })
    // a still clock does not move
    expect(c.tick(0.1)).toBe(false)
  })

  test("the rate scales the pace; a long frame moves at most MAX_DT", () => {
    const c = createClock({ t: 0 })
    c.setRate(4)
    c.play(true)
    c.tick(0.05)
    expect(c.get().t).toBeCloseTo((0.05 * 4) / HISTORY_SECONDS, 12)
    const before = c.get().t
    c.tick(5)
    expect(c.get().t - before).toBeCloseTo((MAX_DT * 4) / HISTORY_SECONDS, 12)
    c.setRate(0)
    c.setRate(-1)
    expect(c.get().rate).toBe(4)
  })

  test("play from today starts again from the first commit, as a jump", () => {
    const c = createClock()
    c.play(true)
    expect(c.get()).toMatchObject({ t: 0, playing: true, jumps: 1 })
    c.play(false)
    expect(c.get().playing).toBe(false)
  })

  test("deterministic: the same calls give the same t, however the frames are cut", () => {
    const run = (dts: number[]) => {
      const c = createClock({ t: 0.1 })
      c.play(true)
      for (const dt of dts) c.tick(dt)
      return c.get().t
    }
    const even = run(Array.from({ length: 60 }, () => 1 / 60))
    const again = run(Array.from({ length: 60 }, () => 1 / 60))
    expect(again).toBe(even)
    // one second in uneven frames lands where one second of even frames does
    const uneven = run([0.1, 0.05, 0.1, 0.1, 0.05, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])
    expect(uneven).toBeCloseTo(even, 12)
  })

  test("live keeps today; a seek makes it a replay", () => {
    const c = createClock({ mode: "live", t: 0.2 })
    expect(c.get().t).toBe(1)
    expect(c.tick(1)).toBe(false)
    c.seek(0.5)
    expect(c.get()).toMatchObject({ mode: "replay", t: 0.5 })
  })

  test("listeners hear every change and can leave", () => {
    const c = createClock()
    let heard = 0
    const off = c.subscribe(() => heard++)
    c.seek(0.5)
    c.play(true)
    c.tick(0.016)
    off()
    c.tick(0.016)
    expect(heard).toBe(3)
  })

  test("the speeds step round", () => {
    expect(RATES).toEqual([0.5, 1, 2, 4])
    expect(nextRate(1)).toBe(2)
    expect(nextRate(4)).toBe(0.5)
    expect(nextRate(3)).toBe(0.5)
  })

  test("the hall's time carries the range once the history is ready", () => {
    const time = createHallTime(createClock())
    let heard = 0
    time.subscribe(() => heard++)
    expect(time.range()).toBeNull()
    time.setRange({ start: 0, end: 10, markers: [] })
    expect(time.range()?.end).toBe(10)
    expect(heard).toBe(1)
  })
})
