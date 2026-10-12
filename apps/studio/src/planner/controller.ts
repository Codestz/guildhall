/**
 * The planner's engine room: owns the canvas, the generation worker, the view and the redraw loop, and
 * publishes a small state the panels render from. Towns come back from the worker as map shapes; the
 * main one draws at once, then the six neighbouring seeds fill the comparison strip.
 *
 * The map has no 3D stage, so it hands the shell a `MapStage`: the same frame stats (`costMs` is the
 * redraw), and a camera whose target is the map's centre and whose distance is the metres in view, so
 * `window.guildhall.ready()`, `perf.sample()` and `bun shots` work on it as on any screen.
 */
import { type CameraPose, type FrameStats, log } from "@guildhall/core"
import type { Stage } from "@guildhall/render"
import type { Tier, Vec2 } from "@guildhall/world"
import { drawMap } from "./draw.ts"
import type { FromWorker, JobLib, JobResult, ToWorker } from "./job.ts"
import { runJob } from "./job.ts"
import { type Layer, type Look, neighbourSeeds, type PlannerQuery, specOf } from "./query.ts"
import { themeOf } from "./theme.ts"
import { fit, panBy, toWorld, type View, zoomAt } from "./view.ts"

const logger = log("studio:planner")

/** What the panels read. */
export interface PlannerState {
  query: PlannerQuery
  result: JobResult | null
  busy: boolean
  /** The last redraw, ms. */
  drawMs: number
  /** Generate-to-drawn for the town on screen, ms (worker time plus the hop). */
  regenMs: number
  strip: { seed: number; result: JobResult | null }[]
  /** What is under the pointer, in plain words. */
  hover: string | null
  error: string | null
  cycling: boolean
}

export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

const key = (q: Pick<PlannerQuery, "seed" | "tier" | "harbour" | "walls">) => JSON.stringify(specOf(q))
const CACHE = 48
const CYCLE_MS = 2200

export interface Planner {
  state(): PlannerState
  subscribe(fn: () => void): () => void
  set(patch: Partial<PlannerQuery>): void
  toggleLayer(layer: Layer): void
  regenerate(): void
  setCycling(on: boolean): void
  fitView(): void
  /** Draws a strip result into a thumbnail canvas. */
  thumb(canvas: HTMLCanvasElement, result: JobResult, look: Look): void
  setInsets(insets: Insets): void
  stage: Stage
  /** Resolves when the current town is generated and drawn. */
  settled(): Promise<void>
  dispose(): void
}

export function createPlanner(
  canvas: HTMLCanvasElement,
  libReady: Promise<JobLib>,
  initial: PlannerQuery,
  onQuery: (q: PlannerQuery) => void,
): Planner {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  let state: PlannerState = {
    query: initial,
    result: null,
    busy: true,
    drawMs: 0,
    regenMs: 0,
    strip: neighbourSeeds(initial.seed).map((seed) => ({ seed, result: null })),
    hover: null,
    error: null,
    cycling: false,
  }
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<PlannerState>) => {
    state = { ...state, ...patch }
    for (const fn of listeners) fn()
  }

  let view: View = { cx: 0, cz: 0, scale: 1 }
  let fitted = false
  let insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 }
  let dirty = true
  let disposed = false
  let size = { w: 1, h: 1, dpr: 1 }

  // ── generation ────────────────────────────────────────────────────
  const cache = new Map<string, JobResult>()
  const remember = (k: string, r: JobResult) => {
    cache.set(k, r)
    if (cache.size > CACHE) cache.delete(cache.keys().next().value as string)
  }
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  } catch (error) {
    logger.warn("no worker, generating inline", { error: String(error) })
  }
  let lib: JobLib | null = null
  let nextId = 1
  const pending = new Map<number, (r: JobResult | Error) => void>()
  if (worker)
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const done = pending.get(e.data.id)
      pending.delete(e.data.id)
      done?.(e.data.type === "done" ? e.data.result : new Error(e.data.message))
    }

  const run = (q: PlannerQuery): Promise<JobResult> => {
    const k = key(q)
    const hit = cache.get(k)
    if (hit) return Promise.resolve(hit)
    return libReady.then(
      (l) =>
        new Promise<JobResult>((resolve, reject) => {
          if (disposed) return reject(new Error("planner closed"))
          if (!lib) {
            lib = l
            worker?.postMessage({ type: "lib", lib: l } satisfies ToWorker)
          }
          const finish = (r: JobResult | Error) => {
            if (r instanceof Error) return reject(r)
            remember(k, r)
            resolve(r)
          }
          if (!worker) {
            setTimeout(() => {
              try {
                finish(runJob(specOf(q), l))
              } catch (error) {
                finish(error instanceof Error ? error : new Error(String(error)))
              }
            }, 0)
            return
          }
          const id = nextId++
          pending.set(id, finish)
          worker.postMessage({ type: "job", id, spec: specOf(q) } satisfies ToWorker)
        }),
    )
  }

  let generation = 0
  let current: Promise<void> = Promise.resolve()
  const generate = (refit: boolean) => {
    const gen = ++generation
    const q = state.query
    const t0 = performance.now()
    publish({ busy: true, error: null })
    current = run(q)
      .then((result) => {
        if (gen !== generation || disposed) return
        if (refit || !fitted) {
          view = fit(result.map.box, size.w, size.h, 30, insets)
          fitted = true
        }
        publish({ result, busy: false, regenMs: performance.now() - t0 })
        dirty = true
        logger.info("town", { seed: q.seed, tier: q.tier, ms: Math.round(result.stats.totalMs) })
        return frames(2).then(() => strip(gen))
      })
      .catch((error: unknown) => {
        if (gen !== generation || disposed) return
        logger.error("generate failed", { error: String(error) })
        publish({ busy: false, error: String(error instanceof Error ? error.message : error) })
      })
  }

  const strip = (gen: number) => {
    const q = state.query
    const seeds = neighbourSeeds(q.seed)
    publish({ strip: seeds.map((seed) => ({ seed, result: cache.get(key({ ...q, seed })) ?? null })) })
    // One at a time, so a seed change cancels the rest quickly.
    const chain = seeds.reduce<Promise<void>>(
      (p, seed, i) =>
        p.then(async () => {
          if (gen !== generation || disposed) return
          const r = await run({ ...q, seed })
          if (gen !== generation || disposed) return
          const next = [...state.strip]
          next[i] = { seed, result: r }
          publish({ strip: next })
        }),
      Promise.resolve(),
    )
    return chain.catch(() => undefined)
  }

  // ── frames (also the MapStage's clock) ────────────────────────────
  const hooks = new Set<(dt: number) => void>()
  const gaps: number[] = []
  const costs: number[] = []
  let last = performance.now()
  let raf = 0
  const frameWaiters = new Set<{ left: number; done: () => void }>()
  const frames = (n: number) =>
    new Promise<void>((done) => (disposed ? done() : frameWaiters.add({ left: n, done })))

  const resize = () => {
    const r = canvas.getBoundingClientRect()
    const dpr = Math.min(2, Math.max(1, devicePixelRatio || 1))
    const w = Math.max(1, Math.round(r.width))
    const h = Math.max(1, Math.round(r.height))
    if (w !== size.w || h !== size.h || dpr !== size.dpr) {
      size = { w, h, dpr }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      dirty = true
    }
  }

  const draw = () => {
    const result = state.result
    if (!result) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = themeOf(state.query.look).table
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return 0
    }
    return drawMap(ctx, result.map, view, size.w, size.h, {
      theme: themeOf(state.query.look),
      layers: new Set(state.query.layers),
      dpr: size.dpr,
      insets,
    })
  }

  const tick = () => {
    if (disposed) return
    const now = performance.now()
    const dt = now - last
    last = now
    gaps.push(dt)
    if (gaps.length > 240) gaps.shift()
    for (const fn of hooks) fn(dt / 1000)
    resize()
    if (dirty) {
      dirty = false
      const ms = draw()
      costs.push(ms)
      if (costs.length > 240) costs.shift()
      if (Math.abs(ms - state.drawMs) > 0.5) publish({ drawMs: ms })
    }
    for (const w of frameWaiters) {
      w.left -= 1
      if (w.left <= 0) {
        frameWaiters.delete(w)
        setTimeout(w.done, 0)
      }
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  const pct = (list: number[], p: number) => {
    if (list.length === 0) return 0
    const sorted = [...list].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  }
  const statsOf = (g: number[], c: number[]): FrameStats => {
    const p50 = pct(g, 0.5)
    return {
      fps: p50 > 0 ? 1000 / p50 : 0,
      frameMs: { p50, p95: pct(g, 0.95) },
      costMs: { p50: pct(c, 0.5), p95: pct(c, 0.95) },
      calls: 0,
      tris: 0,
      geometries: 0,
      textures: 0,
      dpr: size.dpr,
    }
  }

  const camera = (): CameraPose => ({
    target: [view.cx, 0, view.cz],
    azimuth: 0,
    elevation: 90,
    distance: size.h / view.scale,
  })

  const mapStage = {
    stats: () => statsOf(gaps, costs),
    sample: async (ms: number) => {
      const g: number[] = []
      const c: number[] = []
      const start = performance.now()
      let prev = start
      // Force redraws while sampling, so the cost is the map's, not an idle frame's.
      const hook = () => {
        const now = performance.now()
        g.push(now - prev)
        prev = now
        // CPU time to record the redraw. The GPU's share shows in the frame gaps: every frame redraws
        // while sampling, so \`frameMs\` is the whole redraw (a pixel read-back to time it here would
        // knock the canvas off the GPU for good).
        c.push(draw())
      }
      hooks.add(hook)
      await new Promise((done) => setTimeout(done, ms))
      hooks.delete(hook)
      void start
      return statsOf(g, c)
    },
    setDpr: () => undefined,
    setCamera: (p: CameraPose) => {
      view = { cx: p.target[0], cz: p.target[2], scale: size.h / Math.max(1, p.distance) }
      fitted = true
      dirty = true
    },
    getCamera: camera,
    onFrame: (fn: (dt: number) => void) => {
      hooks.add(fn)
      return () => void hooks.delete(fn)
    },
    dispose: () => undefined,
  }

  // ── input: drag to pan, wheel to zoom, keys when the map has focus ──
  let drag: { x: number; y: number; id: number } | null = null
  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId }
    canvas.setPointerCapture(e.pointerId)
    canvas.style.cursor = "grabbing"
  }
  const onMove = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) {
      view = panBy(view, e.clientX - drag.x, e.clientY - drag.y)
      drag = { ...drag, x: e.clientX, y: e.clientY }
      dirty = true
      return
    }
    describe(toWorld(view, size.w, size.h, local(e)))
  }
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    drag = null
    canvas.releasePointerCapture(e.pointerId)
    canvas.style.cursor = ""
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018))
    view = zoomAt(view, size.w, size.h, local(e), factor)
    dirty = true
  }
  const onKey = (e: KeyboardEvent) => {
    const step = 80
    const centre: Vec2 = [size.w / 2, size.h / 2]
    const moves: Record<string, () => void> = {
      ArrowLeft: () => (view = panBy(view, step, 0)),
      ArrowRight: () => (view = panBy(view, -step, 0)),
      ArrowUp: () => (view = panBy(view, 0, step)),
      ArrowDown: () => (view = panBy(view, 0, -step)),
      "+": () => (view = zoomAt(view, size.w, size.h, centre, 1.25)),
      "=": () => (view = zoomAt(view, size.w, size.h, centre, 1.25)),
      "-": () => (view = zoomAt(view, size.w, size.h, centre, 0.8)),
      "0": () => api.fitView(),
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    move()
    dirty = true
  }
  const onLeave = () => publish({ hover: null })
  canvas.addEventListener("pointerdown", onDown)
  canvas.addEventListener("pointermove", onMove)
  canvas.addEventListener("pointerup", onUp)
  canvas.addEventListener("pointercancel", onUp)
  canvas.addEventListener("pointerleave", onLeave)
  canvas.addEventListener("wheel", onWheel, { passive: false })
  canvas.addEventListener("keydown", onKey)

  let lastHover = 0
  const describe = (p: Vec2) => {
    const now = performance.now()
    if (now - lastHover < 50) return
    lastHover = now
    const map = state.result?.map
    if (!map) return
    const block = map.plan.blocks.find((b) => inside(b.poly, p))
    const where = `${Math.round(p[0])}, ${Math.round(p[1])} m`
    if (!block) return publish({ hover: where })
    const area = Math.abs(ringArea(block.poly))
    const what = block.use === "lots" ? `${block.district} block` : `${block.use} block`
    publish({ hover: `${what} #${block.id} · ${Math.round(area).toLocaleString()} m² · ${where}` })
  }

  // ── cycling seeds ─────────────────────────────────────────────────
  let cycleTimer: ReturnType<typeof setInterval> | null = null

  const api: Planner = {
    state: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    set(patch) {
      const before = state.query
      const query = { ...before, ...patch }
      publish({ query })
      onQuery(query)
      if (key(before) !== key(query)) generate(before.tier !== query.tier || before.harbour !== query.harbour)
      else dirty = true
    },
    toggleLayer(layer) {
      const has = state.query.layers.includes(layer)
      api.set({
        layers: has ? state.query.layers.filter((l) => l !== layer) : [...state.query.layers, layer],
      })
    },
    regenerate() {
      cache.delete(key(state.query))
      generate(false)
    },
    setCycling(on) {
      if (cycleTimer) clearInterval(cycleTimer)
      cycleTimer = on ? setInterval(() => api.set({ seed: state.query.seed + 1 }), CYCLE_MS) : null
      publish({ cycling: on })
    },
    fitView() {
      if (!state.result) return
      view = fit(state.result.map.box, size.w, size.h, 30, insets)
      dirty = true
    },
    thumb(target, result, look) {
      const g = target.getContext("2d")
      if (!g) return
      const r = target.getBoundingClientRect()
      const dpr = Math.min(2, devicePixelRatio || 1)
      const w = Math.max(1, Math.round(r.width))
      const h = Math.max(1, Math.round(r.height))
      target.width = Math.round(w * dpr)
      target.height = Math.round(h * dpr)
      drawMap(g, result.map, fit(result.map.box, w, h, 2), w, h, {
        theme: themeOf(look),
        // The walk graph is a debug overlay: at thumbnail size it would only hide the town.
        layers: new Set(state.query.layers.filter((l) => l !== "walk")),
        dpr,
        thumb: true,
      })
    },
    setInsets(next) {
      const changed = JSON.stringify(next) !== JSON.stringify(insets)
      insets = next
      if (changed && state.result && !drag) {
        view = fit(state.result.map.box, size.w, size.h, 30, insets)
        dirty = true
      }
    },
    stage: mapStage as unknown as Stage,
    settled: async () => {
      let seen: Promise<void> | null = null
      while (seen !== current) {
        seen = current
        await current
      }
      await frames(2)
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      // Nothing draws any more: let anyone waiting on a frame (ready(), settled()) go.
      for (const w of frameWaiters) w.done()
      frameWaiters.clear()
      if (cycleTimer) clearInterval(cycleTimer)
      worker?.terminate()
      // Jobs the worker will never answer now: settle them, so nothing waits on a dead screen.
      for (const done of pending.values()) done(new Error("planner closed"))
      pending.clear()
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointercancel", onUp)
      canvas.removeEventListener("pointerleave", onLeave)
      canvas.removeEventListener("wheel", onWheel)
      canvas.removeEventListener("keydown", onKey)
      listeners.clear()
    },
  }

  resize()
  generate(true)
  return api
}

function inside(ring: readonly Vec2[], p: Vec2): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Vec2
    const b = ring[j] as Vec2
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      hit = !hit
  }
  return hit
}

function ringArea(ring: readonly Vec2[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec2
    const b = ring[(i + 1) % ring.length] as Vec2
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

export type { Tier }
