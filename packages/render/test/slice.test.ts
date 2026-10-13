import { describe, expect, test } from "bun:test"
import { createSlicer, NO_SLICE, SLICE_MS } from "../src/slice.ts"

/** Runs the chained microtasks (each `await` is one hop) without letting a timer fire. */
const microtasks = async () => {
  for (let i = 0; i < 32; i++) await Promise.resolve()
}
const nextTask = () => new Promise<void>((done) => setTimeout(done, 0))

describe("slicer", () => {
  test("yields at once while the slice has budget, then waits for a fresh task", async () => {
    let clock = 0
    const s = createSlicer(10, () => clock)
    const check = async (p: Promise<void>) => {
      let done = false
      p.then(() => {
        done = true
      })
      await microtasks()
      return done
    }
    clock = 5
    expect(await check(s.yield())).toBe(true)
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
    let settled = 0
    const a = s.yield().then(() => settled++)
    const b = s.yield().then(() => settled++)
    await microtasks()
    expect(settled).toBe(0)
    await Promise.all([a, b])
    expect(settled).toBe(2)
  })

  test("callers that wait together do their work one slice at a time", async () => {
    let clock = 0
    const s = createSlicer(10, () => clock)
    const ran: number[] = []
    // four items resolve in one burst (as pieces loading do) and each costs 6 ms when it runs
    const items = [0, 1, 2, 3].map(async (k) => {
      await s.yield()
      ran.push(k)
      clock += 6
    })
    await microtasks()
    // two fit the 10 ms slice; the third found it spent and waits for the next task
    expect(ran).toEqual([0, 1])
    await nextTask()
    await Promise.all(items)
    expect(ran).toEqual([0, 1, 2, 3])
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
