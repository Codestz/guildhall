import type { configureLog, logRecords } from "./log.ts"

/**
 * What one stretch of frames cost: rate, frame-time percentiles and the renderer's counters.
 * `fps` and `frameMs` are the gaps between animation frames: vsync-bound in a real browser, unbounded
 * headless. `costMs` is the work itself, and the number the frame budget is held to.
 */
export interface FrameStats {
  fps: number
  frameMs: { p50: number; p95: number }
  /** CPU time spent inside the frame callback (frame hooks plus `renderer.render`), ms. */
  costMs?: { p50: number; p95: number }
  /** Every draw and triangle of the frame: the main pass plus the shadow passes. */
  calls: number
  tris: number
  /** The main (camera) pass alone: what the triangle budget counts. */
  mainCalls?: number
  mainTris?: number
  /** The shadow-map passes alone, reported apart from the budget. */
  shadowCalls?: number
  shadowTris?: number
  geometries: number
  textures: number
  dpr: number
}

/** An orbit camera: the point it looks at and where it sits around it (degrees, metres). */
export interface CameraPose {
  target: [number, number, number]
  azimuth: number
  elevation: number
  distance: number
}

/** A free camera's eye and heading (degrees). */
export interface FreeCamera {
  eye: [number, number, number]
  yaw: number
  pitch: number
}

/** `window.guildhall`: what tools and agents drive an app through. */
export interface GuildhallDebug {
  version: string
  app: string
  ready(): Promise<void>
  log: { records: typeof logRecords; configure: typeof configureLog }
  perf: { now(): FrameStats; sample(ms: number): Promise<FrameStats> }
  camera: {
    get(): CameraPose
    set(p: CameraPose): Promise<void>
    /** `orbit` or `free` flight (an app with a free camera). */
    mode?(): "orbit" | "free"
    /** Enters free flight from the current view, or glides back to orbit; resolves once settled. */
    setMode?(mode: "orbit" | "free"): Promise<void>
    /** Places the free camera: its eye, yaw (as an azimuth) and pitch up from level, degrees. */
    fly?(state: FreeCamera): Promise<void>
  }
  /** Navigate within the app by deep link (a path, or an app's query form); resolves when rendered. */
  open(query: string): Promise<void>
  /** Per-app extensions (studio puts `studio`/`thumbs` here). */
  ext: Record<string, unknown>
}
