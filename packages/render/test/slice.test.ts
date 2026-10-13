import { describe, expect, test } from "bun:test"
import { createSlicer, NO_SLICE, SLICE_MS } from "../src/slice.ts"

describe("slicer", () => {
  test("yields at once while the slice has budget, then waits for a fresh task", async () => {
    let clock = 0
    const s = createSlicer(10, () => clock)
    let settledAtOnce = true
    const check = (p: Promise<void>) => {
      let done = false
      p.then(() => {
        done = true
      })
      return Promise.resolve().then(() => done)
    }
    clock = 5
    settledAtOnce = await check(s.yield())
    expect(settledAtOnce).toBe(true)
    clock = 12
    const late = s.yield()
    expect(await check(late)).toBe(false)
    await late
    // the slice started again when the task ran: more work fits before the next wait
    clock = 20
    expect(await check(s.yield())).toBe(true)
  })

  test("every caller over the budget shares one wait", async () => {
    let clock = 100
    const s = createSlicer(10, () => clock)
    clock = 120
    const a = s.yield()
    const b = s.yield()
    expect(a).toBe(b)
    await a
  })

  test("the no-op slicer never waits", async () => {
    let done = false
    NO_SLICE.yield().then(() => {
      done = true
    })
    await Promise.resolve()
    expect(done).toBe(true)
    expect(SLICE_MS).toBeLessThan(50)
  })
})
