import type { configureLog, logRecords } from "./log.ts"

/** What one stretch of frames cost: rate, frame-time percentiles and the renderer's counters. */
export interface FrameStats {
  fps: number
  frameMs: { p50: number; p95: number }
  calls: number
  tris: number
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

/** `window.guildhall`: what tools and agents drive an app through. */
export interface GuildhallDebug {
  version: string
  app: string
  ready(): Promise<void>
  log: { records: typeof logRecords; configure: typeof configureLog }
  perf: { now(): FrameStats; sample(ms: number): Promise<FrameStats> }
  camera: { get(): CameraPose; set(p: CameraPose): Promise<void> }
  /** Navigate within the app by deep-link query; resolves when rendered. */
  open(query: string): Promise<void>
  /** Per-app extensions (studio puts `studio`/`thumbs` here). */
  ext: Record<string, unknown>
}
