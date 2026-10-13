import { type CameraPose, type FrameStats, log } from "@guildhall/core"
import {
  Color,
  ColorManagement,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three"
import { createGovernor, parseDprPin } from "./governor.ts"
import { createRig, type Rig } from "./rig/index.ts"
import { type FrameCounters, FrameRing, NO_COUNTERS, summarize } from "./stats.ts"
import { createTiming, type Timing } from "./timing.ts"

export interface Stage {
  scene: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
  /** The key light; `createShadows` turns its shadow on. */
  sun: DirectionalLight
  /** The last ~4 s of frames and the last frame's renderer counters. */
  stats(): FrameStats
  /** The frames drawn over the next `ms` milliseconds. */
  sample(ms: number): Promise<FrameStats>
  /** Draws at this device pixel ratio from the next frame on (the governor's lever). */
  setDpr(dpr: number): void
  /** Puts the camera at a pose at once (the rig holds it inside its world, when it has one). */
  setCamera(p: CameraPose): void
  /** The pose being drawn (in free flight: the eye and the point it looks at). */
  getCamera(): CameraPose
  /** The camera rig: orbit and free flight, eased, held inside a world (rig/index.ts). */
  rig: Rig
  /** Where the frame's time goes, per pass (timing.ts): modules scope or tag their draws, hooks add CPU buckets. */
  timing: Timing
  /** Calls `fn(dt seconds)` every frame before drawing; returns the unsubscribe. */
  onFrame(fn: (dt: number) => void): () => void
  /**
   * Draws the frame with `draw` in place of a plain `renderer.render(scene, camera)` (a post pipeline,
   * `post/`); null puts the plain draw back.
   */
  setDraw(draw: (() => void) | null): void
  dispose(): void
}

/** The default DPR range: never below 1.5 (supersamples low-DPR screens), never above 2. */
const DPR: [number, number] = [1.5, 2]
/** The p95 frame cost (ms) the DPR governor holds. */
const BUDGET_MS = 12
const DEFAULT_POSE: CameraPose = { target: [0, 1, 0], azimuth: 35, elevation: 28, distance: 12 }

const logger = log("render:stage")

/** The device pixel ratio clamped into `[min, max]`. */
export function clampDpr(device: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, device || 1))
}

/**
 * A lit scene drawn every animation frame into a canvas that fills `host`, with an orbit camera. A DPR
 * governor keeps the frame cost under budget within `opts.dpr`; `?dpr=` in the page's URL pins it.
 */
export function createStage(host: HTMLElement, opts: { dpr?: [number, number] } = {}): Stage {
  ColorManagement.enabled = true
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.info.autoReset = false
  const range = opts.dpr ?? DPR
  let dpr = clampDpr(globalThis.devicePixelRatio, range)
  renderer.setPixelRatio(dpr)
  renderer.domElement.style.display = "block"
  host.append(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color("#d9d3c6")
  scene.add(new HemisphereLight("#ffffff", "#8a7f6c", 1.6))
  const sun = new DirectionalLight("#fff4e0", 2.2)
  sun.position.set(6, 10, 4)
  scene.add(sun)

  const camera = new PerspectiveCamera(40, 1, 0.05, 2000)
  const rig = createRig(camera, renderer.domElement, DEFAULT_POSE)

  const resize = () => {
    const w = Math.max(1, host.clientWidth)
    const h = Math.max(1, host.clientHeight)
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(host)

  // GPU timer queries on `?timers=1` only: on ANGLE/Metal they cost ~1.3 ms a frame (they split the
  // command buffers) and read command-buffer wall time rather than pass cost. The CPU buckets always run.
  const timing = createTiming(renderer, {
    gpu: new URLSearchParams(globalThis.location?.search ?? "").get("timers") === "1",
  })

  // three counts shadow-map draws into the same `info.render` as the main pass; tally them apart, and
  // time them as their own GPU pass (they run inside `renderer.render`, so the scene's scope pauses).
  let shadowCalls = 0
  let shadowTris = 0
  const shadowMap = renderer.shadowMap
  const renderShadows = shadowMap.render.bind(shadowMap)
  shadowMap.render = (...args) => {
    const { calls, triangles } = renderer.info.render
    timing.gpu.begin("shadows")
    renderShadows(...args)
    timing.gpu.end()
    shadowCalls += renderer.info.render.calls - calls
    shadowTris += renderer.info.render.triangles - triangles
  }

  const intervals = new FrameRing()
  const costs = new FrameRing()
  const samplers = new Set<{ intervals: number[]; costs: number[] }>()
  const frameFns = new Set<(dt: number) => void>()
  let counters: FrameCounters = NO_COUNTERS
  let last: number | null = null
  let raf = 0
  let draw: (() => void) | null = null

  const frame = (now: number) => {
    const start = performance.now()
    raf = requestAnimationFrame(frame)
    const ms = last === null ? 0 : now - last
    last = now
    renderer.info.reset()
    shadowCalls = 0
    shadowTris = 0
    timing.frameStart()
    // The camera moves first: every hook (the sky's dome, the cascades, the haze) reads where it is now.
    rig.update(ms / 1000)
    for (const fn of frameFns) fn(ms / 1000)
    // The scene's draws are "opaque" unless a module tags or scopes them (water, sky, crowd, post).
    timing.gpu.begin("opaque")
    if (draw) draw()
    else renderer.render(scene, camera)
    timing.gpu.end()
    // The CPU side of the frame: hooks plus render. Headless Chrome has no vsync, so this, not the
    // rAF gap, is what the budget holds.
    const cost = performance.now() - start
    timing.frameEnd(cost)
    costs.push(cost)
    if (ms > 0) intervals.push(ms)
    for (const s of samplers) {
      s.costs.push(cost)
      if (ms > 0) s.intervals.push(ms)
    }
    const { render, memory } = renderer.info
    counters = {
      calls: render.calls,
      tris: render.triangles,
      shadowCalls,
      shadowTris,
      geometries: memory.geometries,
      textures: memory.textures,
    }
  }
  raf = requestAnimationFrame(frame)
  logger.info("created", { dpr, size: [host.clientWidth, host.clientHeight] })

  const stage: Stage = {
    scene,
    camera,
    renderer,
    sun,
    stats: () => summarize(intervals.values(), costs.values(), counters, dpr, timing.read()),
    sample(ms) {
      const s = { intervals: [] as number[], costs: [] as number[] }
      samplers.add(s)
      const split = timing.sample()
      return new Promise((done) =>
        setTimeout(() => {
          samplers.delete(s)
          done(summarize(s.intervals, s.costs, counters, dpr, split.stop()))
        }, ms),
      )
    },
    setDpr(next) {
      dpr = next
      renderer.setPixelRatio(dpr)
    },
    setCamera: (p) => rig.set(p),
    getCamera: () => rig.get(),
    rig,
    timing,
    onFrame(fn) {
      frameFns.add(fn)
      return () => frameFns.delete(fn)
    },
    setDraw(next) {
      draw = next
    },
    dispose() {
      governor.dispose()
      cancelAnimationFrame(raf)
      observer.disconnect()
      rig.dispose()
      timing.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      logger.info("disposed")
    },
  }
  const governor = createGovernor(stage, {
    targetMs: BUDGET_MS,
    dpr: range,
    pin: parseDprPin(globalThis.location?.search ?? ""),
  })
  return stage
}

/**
 * Where the world `point` lands on the stage's canvas, in CSS pixels from its top left; null when it
 * is behind the camera. For DOM labels that follow the scene.
 */
export function toScreen(stage: Stage, point: [number, number, number]): [number, number] | null {
  const ndc = new Vector3(...point).project(stage.camera)
  if (ndc.z > 1) return null
  const canvas = stage.renderer.domElement
  return [((ndc.x + 1) / 2) * canvas.clientWidth, ((1 - ndc.y) / 2) * canvas.clientHeight]
}
