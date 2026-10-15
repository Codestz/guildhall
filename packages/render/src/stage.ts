import { type CameraPose, type FrameStats, log } from "@guildhall/core"
import {
  Color,
  ColorManagement,
  DirectionalLight,
  HemisphereLight,
  type Material,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from "three"
import { stageFlags } from "./flags.ts"
import { createGovernor, deviceProfile, type LeverName, parseDprPin, startTier } from "./governor.ts"
import { type PacePick, vsyncOf } from "./pace.ts"
import { createRig, type Rig } from "./rig/index.ts"
import { type FrameCounters, FrameRing, NO_COUNTERS, summarize } from "./stats.ts"
import { createTiming, type Timing } from "./timing.ts"

/** Something that holds GPU or scene resources until `dispose`. */
export interface Disposable {
  dispose(): void
}

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
  /**
   * The viewer's quality pick: holds the DPR at `dpr`, the governor standing aside (it never overrides
   * an explicit pick); null (Auto) hands the DPR back to the governor, from where the stage started.
   */
  pickDpr(dpr: number | null): void
  /**
   * The viewer's motion pick (pace.ts): Smooth 30 holds the ~30 cadence, Max the display's rate, Auto
   * lets the pacer choose.
   */
  pickPace(pick: PacePick): void
  /** The pacing in force: the vsync divisor drawn on, the display's interval and the pick. */
  pace(): { divisor: number; vsyncMs: number; pick: PacePick }
  /** Draws on every `divisor`-th vsync from now on (the pacer's lever; 1: every vsync). */
  setPace(divisor: number): void
  /**
   * A second divisor, the screen's: while its cover is up nothing drawn is seen, so it draws on every
   * `divisor`-th vsync and leaves the thread to the build; 1 lifts it. The pacer's divisor still counts.
   */
  throttle(divisor: number): void
  /**
   * A quality lever a module registers (governor.ts `TIERS`: "shadowMap", "lodBias", "particles"): the
   * ladder's current value is applied at once, and again at every step. Registering twice replaces.
   */
  lever(name: LeverName, apply: (value: number) => void): void
  /** The ladder's tier now (0: full quality), and the viewer's fixed tier (null: Auto). */
  tier(): { tier: number; pick: number | null }
  /** Holds the ladder at a tier (a quality pick), or hands it back to the governor with null. */
  pickTier(tier: number | null): void
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
   * `post/`); null puts the plain draw back. `target` is the render target `draw` renders the scene
   * into (null: the canvas): programs compiled ahead of a draw are keyed by it (warm.ts).
   */
  setDraw(draw: (() => void) | null, target?: WebGLRenderTarget | null): void
  /** The render target the scene is drawn into (null: the canvas). */
  readonly drawTarget: WebGLRenderTarget | null
  /**
   * Draws nothing (and runs no frame hook) until `until` settles: for a loading screen's cover, while
   * the programs of what was just added link in the background (warm.ts), so no frame pays for a
   * synchronous link. Holds nest; the first frame after the last one is the next drawn.
   */
  hold(until: Promise<unknown>): void
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
 * governor keeps the frame cost under budget within `opts.dpr`; `setStageFlags({ dpr })` pins it.
 */
export function createStage(
  host: HTMLElement,
  opts: { dpr?: [number, number]; antialias?: boolean } = {},
): Stage {
  ColorManagement.enabled = true
  // `antialias: false` where a post pipeline draws the scene into its own target and anti-aliases it
  // there (post/index.ts, SMAA): the canvas's 4x MSAA buffer would then only be resolved from a
  // full-screen quad every frame (the same colour in all four samples, nothing gained) and held at
  // four times the memory.
  const renderer = new WebGLRenderer({
    antialias: opts.antialias ?? true,
    powerPreference: "high-performance",
  })
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
    gpu: stageFlags().gpuTimers,
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
  let drawTarget: WebGLRenderTarget | null = null
  let knownPrograms = 0
  let holds = 0
  // pacing (pace.ts): the frame is drawn on every `divisor`-th vsync; `throttle` is a second divisor a
  // screen sets while its cover is up (nothing seen, so fewer frames drawn behind it); the raw gaps say
  // what the display's own rate is
  let divisor = 1
  let throttle = 1
  let vsyncs = 0
  let lastRaw: number | null = null
  const rawGaps = new FrameRing(90)

  const frame = (now: number) => {
    const start = performance.now()
    raf = requestAnimationFrame(frame)
    if (lastRaw !== null) rawGaps.push(now - lastRaw)
    lastRaw = now
    vsyncs++
    // a skipped vsync: nothing drawn, no hook run, no GPU work; the next drawn frame's dt covers it
    const every = Math.max(divisor, throttle)
    if (every > 1 && vsyncs % every !== 0) return
    const ms = last === null ? 0 : now - last
    last = now
    // held: nothing drawn, no hook run, and the frame after the hold is a fresh start (no dt owed)
    if (holds > 0) return
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
    // Programs built in this frame (their link is waited for here unless warmed first, warm.ts): named,
    // so a long frame on load can be laid at the right material's door (tools/shots/trace.ts reads the log).
    const programs = renderer.info.programs
    if (programs && programs.length > knownPrograms) {
      // each new program named by the object and material that hold it (an unnamed ShaderMaterial is
      // told apart by what it is on), from the renderer's own bookkeeping; a program nobody in the
      // scene holds (a post pass's, a warm-up's stand-in) keeps its own name
      const holders = new Map<number, string>()
      scene.traverse((o) => {
        const m = (o as { material?: Material | Material[] }).material
        if (!m) return
        for (const material of Array.isArray(m) ? m : [m]) {
          const held = (renderer.properties.get(material) as { programs?: Map<string, { id: number }> })
            .programs
          if (!held) continue
          for (const p of held.values())
            if (!holders.has(p.id)) holders.set(p.id, `${o.name || o.type}/${material.name || material.type}`)
        }
      })
      logger.info("programs", {
        ms: Math.round(cost),
        made: programs.slice(knownPrograms).map((p) => {
          const key = (p as { cacheKey?: string }).cacheKey ?? ""
          const own = /guildhall-[\w-]+/.exec(key)?.[0]
          const name = holders.get(p.id) ?? p.name
          return own ? `${name}#${own}` : name
        }),
      })
      knownPrograms = programs.length
    }
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
          done({
            ...summarize(s.intervals, s.costs, counters, dpr, split.stop()),
            intervals: s.intervals,
            covered: throttle > 1 || holds > 0,
          })
        }, ms),
      )
    },
    setDpr(next) {
      dpr = next
      renderer.setPixelRatio(dpr)
    },
    pickDpr: (next) => governor.pick(next),
    pickPace: (next) => governor.pickPace(next),
    lever(name, apply) {
      levers.set(name, apply)
      apply(governor.tierValues()[name])
    },
    tier: () => governor.tier(),
    pickTier: (next) => governor.pickTier(next),
    pace: () => ({ divisor, vsyncMs: vsyncOf(rawGaps.values()), pick: governor.pacePick() }),
    setPace(next) {
      if (next !== divisor)
        logger.info("pace", { divisor: next, vsyncMs: Math.round(vsyncOf(rawGaps.values()) * 10) / 10 })
      divisor = Math.max(1, Math.round(next))
    },
    throttle(next) {
      throttle = Math.max(1, Math.round(next))
    },
    setCamera: (p) => rig.set(p),
    getCamera: () => rig.get(),
    rig,
    timing,
    onFrame(fn) {
      frameFns.add(fn)
      return () => frameFns.delete(fn)
    },
    setDraw(next, target = null) {
      draw = next
      drawTarget = next ? target : null
    },
    get drawTarget() {
      return drawTarget
    },
    hold(until) {
      holds++
      const release = () => {
        holds--
      }
      until.then(release, release)
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
  const levers = new Map<LeverName, (value: number) => void>()
  const governor = createGovernor(stage, {
    targetMs: BUDGET_MS,
    dpr: range,
    pin: parseDprPin(stageFlags().dpr),
    // the ladder's levers, as the modules register them (a tier step applies every one it has)
    apply: (values) => {
      for (const [name, fn] of levers) fn(values[name])
    },
    start: startTier(deviceProfile()),
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
