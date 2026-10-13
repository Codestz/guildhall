import { describe, expect, test } from "bun:test"
import { LINES, loadPlan, STEPS } from "../src/hexworld/loading.ts"
import { CALM_FRAMES, createGate, loaderOn, type Settleable, settle } from "../src/hexworld/ready.ts"

describe("the readiness gate", () => {
  test("is shut until the shaders are compiled, however calm the frames", () => {
    const gate = createGate()
    for (let i = 0; i < 50; i++) expect(gate.frame(8)).toBe(false)
    expect(gate.open()).toBeNull()
  })

  test("opens after a calm run counted from the compile", () => {
    const gate = createGate()
    gate.compiled()
    for (let i = 0; i < CALM_FRAMES - 1; i++) expect(gate.frame(16)).toBe(false)
    expect(gate.frame(16)).toBe(true)
    expect(gate.open()).toBe("calm")
    // and stays open
    expect(gate.frame(400)).toBe(true)
  })

  test("a slow frame (a shader compiling, a piece uploading) starts the run again", () => {
    const gate = createGate()
    gate.compiled()
    gate.frame(16)
    gate.frame(16)
    gate.frame(16)
    expect(gate.calm()).toBe(3)
    expect(gate.frame(180)).toBe(false)
    expect(gate.calm()).toBe(0)
    for (let i = 0; i < CALM_FRAMES - 1; i++) expect(gate.frame(16)).toBe(false)
    expect(gate.frame(16)).toBe(true)
  })

  test("a stalled compile does not hold the cover forever", () => {
    const gate = createGate({ maxMs: 1000 })
    for (let i = 0; i < 9; i++) expect(gate.frame(100)).toBe(false)
    expect(gate.frame(100)).toBe(true)
    expect(gate.open()).toBe("timeout")
  })
})

/** A stage that draws the frames it is told to, once the test steps it. */
function fakeStage(compile: () => Promise<unknown>) {
  const listeners = new Set<(dt: number) => void>()
  const stage: Settleable = {
    renderer: { compileAsync: compile },
    scene: {},
    camera: {},
    onFrame(fn) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
  }
  const draw = (seconds: number) => {
    for (const fn of [...listeners]) fn(seconds)
  }
  return { stage, draw, listening: () => listeners.size }
}

describe("settle", () => {
  test("resolves only after the compile and a calm run, and stops listening", async () => {
    let compiled = () => {}
    const { stage, draw, listening } = fakeStage(
      () =>
        new Promise<void>((done) => {
          compiled = done
        }),
    )
    const seen: number[] = []
    let settled = false
    const result = settle(stage, { onCalm: (share) => seen.push(share) }).then((r) => {
      settled = true
      return r
    })
    for (let i = 0; i < 10; i++) draw(0.016)
    await Promise.resolve()
    expect(settled).toBe(false)
    compiled()
    await new Promise((r) => setTimeout(r, 0))
    draw(0.5) // the first draws after the compile are slow: not calm
    for (let i = 0; i < CALM_FRAMES - 1; i++) draw(0.016)
    await Promise.resolve()
    expect(settled).toBe(false)
    draw(0.016)
    const r = await result
    expect(r.reason).toBe("calm")
    expect(r.frames).toBe(10 + 1 + CALM_FRAMES)
    expect(listening()).toBe(0)
    // the bar's share only ever rose within a run and reached 1
    expect(seen.at(-1)).toBe(1)
  })

  test("a failed compile still settles (the first draws pay for the shaders)", async () => {
    const { stage, draw } = fakeStage(() => Promise.reject(new Error("no")))
    const result = settle(stage)
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < CALM_FRAMES; i++) draw(0.016)
    expect((await result).reason).toBe("calm")
  })

  test("a renderer without compileAsync settles on the calm run alone", async () => {
    const { stage, draw } = fakeStage(() => Promise.resolve())
    ;(stage.renderer as { compileAsync?: unknown }).compileAsync = undefined
    const result = settle(stage)
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < CALM_FRAMES; i++) draw(0.016)
    expect((await result).reason).toBe("calm")
  })

  test("a screen torn down ends the wait", async () => {
    const { stage, listening } = fakeStage(() => new Promise(() => {}))
    let down = () => {}
    const until = new Promise<void>((done) => {
      down = done
    })
    const result = settle(stage, { until })
    down()
    expect((await result).reason).toBe("timeout")
    expect(listening()).toBe(0)
  })
})

describe("the loading screen's content", () => {
  test("every step has a line, and the plan grows with the island", () => {
    for (const step of STEPS) expect(LINES[step].length).toBeGreaterThan(0)
    const small = loadPlan(4_000)
    const big = loadPlan(12_000)
    for (const step of STEPS) expect(big[step]).toBeGreaterThanOrEqual(small[step])
    expect(big.Pieces).toBeGreaterThan(small.Pieces)
  })

  test("?loader=0 turns the cover off, nothing else does", () => {
    expect(loaderOn(new URLSearchParams(""))).toBe(true)
    expect(loaderOn(new URLSearchParams("loader=1"))).toBe(true)
    expect(loaderOn(new URLSearchParams("loader=0"))).toBe(false)
  })
})
