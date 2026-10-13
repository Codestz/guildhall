/**
 * Where a frame's time goes, pass by pass (perf2-contract §1): GPU time per pass from
 * `EXT_disjoint_timer_query_webgl2` (shadows, opaque, water, sky, crowd, post), and the CPU side split
 * into what the frame's hooks report (life, crowd, banners) and the rest.
 *
 *   gpu.begin("post") … gpu.end()   a scope round some draws; scopes nest (a parent's time leaves out
 *                                   its children's: the query is closed and reopened round the child)
 *   gpu.tag(mesh, "water")          the mesh's own draws, through its onBeforeRender/onAfterRender
 *                                   (three fires those in the camera pass only, never in the shadow maps)
 *   cpu.add("life", ms)             the frame's CPU buckets; the stage adds "rest"
 *
 * Query results arrive frames later: `frameEnd` files the frame's queries, `frameStart` reads every
 * finished frame into the rings (and into the open samplers) and returns its queries to the pool. A
 * disjoint GPU (a context lost its clock) drops that frame's numbers. Without the extension (Safari,
 * WebGL1), or with `gpu: false`, `passes` stays empty and nothing else changes.
 *
 * Measured on an M1 Pro (ANGLE over Metal, 2026-10): the queries themselves cost ~1.3 ms a frame at the
 * hero view, and what they read is each command buffer's GPU wall time, not the pass's work (a scope
 * that spans the presenting buffer reads tens of ms). So the stage leaves them off unless asked
 * (`?timers=1`); the bench attributes GPU cost by taking parts away instead (tools/shots bench.ts).
 */
import type { Object3D, WebGLRenderer } from "three"
import { FrameRing } from "./stats.ts"

/** Time per pass or bucket, milliseconds, by name. */
export type Split = Record<string, number>

export interface TimingSample {
  /** Mean GPU ms per pass over the frames resolved in the window. */
  passes: Split
  /** Mean CPU ms per bucket over the frames in the window. */
  cpu: Split
}

export interface Timing {
  gpu: {
    /** True when the timer extension is there. */
    readonly available: boolean
    begin(name: string): void
    end(): void
    /** Puts the mesh's draws (every mesh under `object`) in the pass `name`. */
    tag(object: Object3D, name: string): void
  }
  cpu: { add(name: string, ms: number): void }
  /** The stage's frame bracket. */
  frameStart(): void
  frameEnd(frameCostMs: number): void
  /** Means over the last ~2 s of frames. */
  read(): TimingSample
  /** Collects frames from now until `stop()`, which gives their means. */
  sample(): { stop(): TimingSample }
  dispose(): void
}

interface TimerExt {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

/**
 * Frames whose queries may still be in flight; beyond this the oldest is dropped. Without vsync the
 * queue runs deep and a result takes 20–30 frames to come back (measured on ANGLE/Metal).
 */
const MAX_PENDING = 64
const RING = 240

interface PendingFrame {
  scopes: { name: string; query: WebGLQuery }[]
}

interface Collector {
  gpu: Map<string, number[]>
  cpu: Map<string, number[]>
}

const means = (m: Map<string, number[]>): Split => {
  const out: Split = {}
  for (const [name, values] of m) {
    if (values.length === 0) continue
    out[name] = values.reduce((a, b) => a + b, 0) / values.length
  }
  return out
}

const push = (m: Map<string, number[]>, split: Split) => {
  for (const [name, ms] of Object.entries(split)) {
    const list = m.get(name)
    if (list) list.push(ms)
    else m.set(name, [ms])
  }
}

export interface TimingOpts {
  /** False (the default) leaves the GPU timer queries out; the CPU buckets stay. The stage's `?timers=1` turns them on. */
  gpu?: boolean
}

/** Timing on a renderer; `gl` is its context (a WebGL2 context has the extension, WebGL1 does not). */
export function createTiming(renderer: Pick<WebGLRenderer, "getContext">, opts: TimingOpts = {}): Timing {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const isGl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext
  const ext =
    isGl2 && opts.gpu === true
      ? (gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null)
      : null

  const pool: WebGLQuery[] = []
  const take = (): WebGLQuery | null => pool.pop() ?? gl.createQuery()
  const pending: PendingFrame[] = []
  let frame: PendingFrame = { scopes: [] }
  /** The open scope's name, and the names of its parents (innermost last). */
  let open: { name: string; query: WebGLQuery } | null = null
  const parents: string[] = []
  let cpuNow: Split = {}

  const gpuRings = new Map<string, FrameRing>()
  const cpuRings = new Map<string, FrameRing>()
  const samplers = new Set<Collector>()

  const startQuery = (name: string) => {
    if (!ext) return
    const query = take()
    if (!query) return
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
    open = { name, query }
  }
  const closeQuery = () => {
    if (!ext || !open) return
    gl.endQuery(ext.TIME_ELAPSED_EXT)
    frame.scopes.push(open)
    open = null
  }

  const begin = (name: string) => {
    if (!ext) return
    if (open) {
      parents.push(open.name)
      closeQuery()
    }
    startQuery(name)
  }
  const end = () => {
    if (!ext) return
    closeQuery()
    const parent = parents.pop()
    if (parent !== undefined) startQuery(parent)
  }

  const ring = (rings: Map<string, FrameRing>, name: string) => {
    let r = rings.get(name)
    if (!r) {
      r = new FrameRing(RING)
      rings.set(name, r)
    }
    return r
  }

  /** Reads every finished frame, oldest first, stopping at the first still in flight. */
  const collect = () => {
    if (!ext) return
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean
    while (pending.length > 0) {
      const f = pending[0] as PendingFrame
      const ready = f.scopes.every((s) => gl.getQueryParameter(s.query, gl.QUERY_RESULT_AVAILABLE) === true)
      if (!ready) break
      pending.shift()
      if (!disjoint) {
        const split: Split = {}
        for (const s of f.scopes) {
          const ns = gl.getQueryParameter(s.query, gl.QUERY_RESULT) as number
          split[s.name] = (split[s.name] ?? 0) + ns / 1e6
        }
        for (const [name, ms] of Object.entries(split)) ring(gpuRings, name).push(ms)
        for (const c of samplers) push(c.gpu, split)
      }
      for (const s of f.scopes) pool.push(s.query)
    }
  }

  const ringMeans = (rings: Map<string, FrameRing>): Split => {
    const out: Split = {}
    for (const [name, r] of rings) {
      const values = r.values()
      if (values.length > 0) out[name] = values.reduce((a, b) => a + b, 0) / values.length
    }
    return out
  }

  return {
    gpu: {
      available: ext !== null,
      begin,
      end,
      tag(object, name) {
        if (!ext) return
        object.traverse((node) => {
          const n = node as Object3D & {
            isMesh?: boolean
            isSprite?: boolean
            isLine?: boolean
            isPoints?: boolean
          }
          if (!(n.isMesh || n.isSprite || n.isLine || n.isPoints)) return
          n.onBeforeRender = () => begin(name)
          n.onAfterRender = () => end()
        })
      },
    },
    cpu: {
      add(name, ms) {
        cpuNow[name] = (cpuNow[name] ?? 0) + ms
      },
    },
    frameStart() {
      collect()
      cpuNow = {}
    },
    frameEnd(frameCostMs) {
      // a scope left open (an exception mid-draw) closes here, so the next frame starts clean
      while (open || parents.length > 0) {
        closeQuery()
        parents.pop()
      }
      if (ext && frame.scopes.length > 0) {
        pending.push(frame)
        if (pending.length > MAX_PENDING) {
          const dropped = pending.shift() as PendingFrame
          for (const s of dropped.scopes) pool.push(s.query)
        }
      }
      frame = { scopes: [] }
      let spent = 0
      for (const ms of Object.values(cpuNow)) spent += ms
      cpuNow.rest = Math.max(0, frameCostMs - spent)
      for (const [name, ms] of Object.entries(cpuNow)) ring(cpuRings, name).push(ms)
      for (const c of samplers) push(c.cpu, cpuNow)
    },
    read: () => ({ passes: ringMeans(gpuRings), cpu: ringMeans(cpuRings) }),
    sample() {
      const c: Collector = { gpu: new Map(), cpu: new Map() }
      samplers.add(c)
      return {
        stop() {
          samplers.delete(c)
          return { passes: means(c.gpu), cpu: means(c.cpu) }
        },
      }
    },
    dispose() {
      for (const f of pending) for (const s of f.scopes) gl.deleteQuery(s.query)
      for (const q of pool) gl.deleteQuery(q)
      pending.length = 0
      pool.length = 0
    },
  }
}
