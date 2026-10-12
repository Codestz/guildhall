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
import { attachOrbitInput, poseToCamera } from "./camera.ts"
import { type FrameCounters, FrameRing, summarize } from "./stats.ts"

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
  setCamera(p: CameraPose): void
  getCamera(): CameraPose
  /** Calls `fn(dt seconds)` every frame before drawing; returns the unsubscribe. */
  onFrame(fn: (dt: number) => void): () => void
  dispose(): void
}

/** The default DPR range: never below 1.5 (supersamples low-DPR screens), never above 2. */
const DPR: [number, number] = [1.5, 2]
const DEFAULT_POSE: CameraPose = { target: [0, 1, 0], azimuth: 35, elevation: 28, distance: 12 }

const logger = log("render:stage")

/** The device pixel ratio clamped into `[min, max]`. */
export function clampDpr(device: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, device || 1))
}

/** A lit scene drawn every animation frame into a canvas that fills `host`, with an orbit camera. */
export function createStage(host: HTMLElement, opts: { dpr?: [number, number] } = {}): Stage {
  ColorManagement.enabled = true
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.info.autoReset = false
  const dpr = clampDpr(globalThis.devicePixelRatio, opts.dpr ?? DPR)
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
  let pose: CameraPose = DEFAULT_POSE
  const setCamera = (p: CameraPose) => {
    pose = { ...p, target: [...p.target] }
    camera.position.set(...poseToCamera(pose))
    camera.lookAt(...pose.target)
  }
  setCamera(pose)
  const detachInput = attachOrbitInput(renderer.domElement, { get: () => pose, set: setCamera })

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

  const ring = new FrameRing()
  const samplers = new Set<number[]>()
  const frameFns = new Set<(dt: number) => void>()
  let counters: FrameCounters = { calls: 0, tris: 0, geometries: 0, textures: 0 }
  let last: number | null = null
  let raf = 0

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const ms = last === null ? 0 : now - last
    last = now
    if (ms > 0) {
      ring.push(ms)
      for (const times of samplers) times.push(ms)
    }
    renderer.info.reset()
    for (const fn of frameFns) fn(ms / 1000)
    renderer.render(scene, camera)
    const { render, memory } = renderer.info
    counters = {
      calls: render.calls,
      tris: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
    }
  }
  raf = requestAnimationFrame(frame)
  logger.info("created", { dpr, size: [host.clientWidth, host.clientHeight] })

  return {
    scene,
    camera,
    renderer,
    sun,
    stats: () => summarize(ring.values(), counters, dpr),
    sample(ms) {
      const times: number[] = []
      samplers.add(times)
      return new Promise((done) =>
        setTimeout(() => {
          samplers.delete(times)
          done(summarize(times, counters, dpr))
        }, ms),
      )
    },
    setCamera,
    getCamera: () => ({ ...pose, target: [...pose.target] }),
    onFrame(fn) {
      frameFns.add(fn)
      return () => frameFns.delete(fn)
    },
    dispose() {
      cancelAnimationFrame(raf)
      observer.disconnect()
      detachInput()
      renderer.dispose()
      renderer.domElement.remove()
      logger.info("disposed")
    },
  }
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
