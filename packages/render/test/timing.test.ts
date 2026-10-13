import { describe, expect, test } from "bun:test"
import { createTiming } from "../src/timing.ts"

/**
 * A WebGL2 context with the timer extension, on paper: each query records how many "nanoseconds" the
 * fake clock advanced while it was open, and results become available after `latency` collect rounds.
 */
function fakeGl(opts: { ext?: boolean; latency?: number; disjoint?: boolean } = {}) {
  const latency = opts.latency ?? 1
  let clock = 0
  let round = 0
  const queries = new Map<object, { start: number; ns: number; closedAt: number }>()
  let open: object | null = null
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    getExtension: (name: string) =>
      opts.ext === false || name !== "EXT_disjoint_timer_query_webgl2"
        ? null
        : { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 },
    createQuery: () => {
      const q = {}
      queries.set(q, { start: 0, ns: 0, closedAt: 0 })
      return q
    },
    deleteQuery: (q: object) => queries.delete(q),
    beginQuery: (_t: number, q: object) => {
      if (open) throw new Error("nested query")
      open = q
      ;(queries.get(q) as { start: number }).start = clock
    },
    endQuery: () => {
      const q = queries.get(open as object) as { start: number; ns: number; closedAt: number }
      q.ns = clock - q.start
      q.closedAt = round
      open = null
    },
    getQueryParameter: (q: object, p: number) => {
      const e = queries.get(q) as { ns: number; closedAt: number }
      return p === 1 ? round - e.closedAt >= latency : e.ns
    },
    getParameter: (p: number) => (p === 11 ? (opts.disjoint ?? false) : 0),
  }
  // the timing module checks `instanceof WebGL2RenderingContext`
  class WebGL2RenderingContext {}
  Object.setPrototypeOf(gl, WebGL2RenderingContext.prototype)
  ;(globalThis as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext = WebGL2RenderingContext
  return {
    gl,
    renderer: { getContext: () => gl as unknown as WebGL2RenderingContext },
    /** The GPU spends `ms` on whatever scope is open. */
    spend: (ms: number) => {
      clock += ms * 1e6
    },
    /** Another frame goes by: pending results get older. */
    tick: () => {
      round++
    },
  }
}

describe("timing", () => {
  test("without the extension nothing is measured and nothing breaks", () => {
    const f = fakeGl({ ext: false })
    const t = createTiming(f.renderer)
    expect(t.gpu.available).toBe(false)
    t.frameStart()
    t.gpu.begin("opaque")
    t.gpu.begin("post")
    t.gpu.end()
    t.gpu.end()
    t.frameEnd(5)
    expect(t.read().passes).toEqual({})
    expect(t.read().cpu).toEqual({ rest: 5 })
  })

  test("a nested scope's time is its own, not its parent's", () => {
    const f = fakeGl()
    const t = createTiming(f.renderer)
    t.frameStart()
    t.gpu.begin("opaque")
    f.spend(3)
    t.gpu.begin("shadows")
    f.spend(2)
    t.gpu.end()
    f.spend(1)
    t.gpu.begin("water")
    f.spend(0.5)
    t.gpu.end()
    t.gpu.end()
    t.gpu.begin("post")
    f.spend(1.5)
    t.gpu.end()
    t.frameEnd(1)
    f.tick()
    t.frameStart()
    const { passes } = t.read()
    expect(passes.opaque).toBeCloseTo(4, 6)
    expect(passes.shadows).toBeCloseTo(2, 6)
    expect(passes.water).toBeCloseTo(0.5, 6)
    expect(passes.post).toBeCloseTo(1.5, 6)
  })

  test("results arrive frames later and a sample sees only frames resolved in its window", () => {
    const f = fakeGl({ latency: 3 })
    const t = createTiming(f.renderer)
    const frame = (ms: number) => {
      t.frameStart()
      t.gpu.begin("opaque")
      f.spend(ms)
      t.gpu.end()
      t.frameEnd(1)
      f.tick()
    }
    frame(4)
    frame(4)
    t.frameStart()
    expect(t.read().passes.opaque).toBeUndefined()
    const s = t.sample()
    frame(10)
    frame(10)
    frame(10)
    const got = s.stop()
    // the first two frames (4 ms) resolve inside the window, the 10 ms ones only after it
    expect(got.passes.opaque).toBeCloseTo(4, 6)
    expect(t.read().passes.opaque).toBeCloseTo(4, 6)
  })

  test("a disjoint GPU drops the frame's numbers", () => {
    const f = fakeGl({ disjoint: true })
    const t = createTiming(f.renderer)
    t.frameStart()
    t.gpu.begin("opaque")
    f.spend(3)
    t.gpu.end()
    t.frameEnd(1)
    f.tick()
    t.frameStart()
    expect(t.read().passes).toEqual({})
  })

  test("the cpu buckets add up, the rest being what no hook claimed", () => {
    const f = fakeGl()
    const t = createTiming(f.renderer)
    t.frameStart()
    t.cpu.add("life", 1)
    t.cpu.add("life", 0.5)
    t.cpu.add("crowd", 2)
    t.frameEnd(6)
    expect(t.read().cpu).toEqual({ life: 1.5, crowd: 2, rest: 2.5 })
    t.frameStart()
    t.cpu.add("life", 2.5)
    t.frameEnd(2)
    // over budget by hooks alone: the rest is never negative
    expect(t.read().cpu.rest).toBe(1.25)
    expect(t.read().cpu.life).toBe(2)
  })

  test("a tagged mesh scopes its draws through its render hooks", () => {
    const f = fakeGl()
    const t = createTiming(f.renderer)
    const mesh = {
      isMesh: true,
      onBeforeRender: () => {},
      onAfterRender: () => {},
      traverse(fn: (o: unknown) => void) {
        fn(this)
      },
    }
    t.gpu.tag(mesh as never, "water")
    t.frameStart()
    t.gpu.begin("opaque")
    f.spend(1)
    mesh.onBeforeRender()
    f.spend(2)
    mesh.onAfterRender()
    f.spend(1)
    t.gpu.end()
    t.frameEnd(1)
    f.tick()
    t.frameStart()
    expect(t.read().passes.opaque).toBeCloseTo(2, 6)
    expect(t.read().passes.water).toBeCloseTo(2, 6)
  })
})
