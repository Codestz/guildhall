/**
 * When is a world ready to be shown? The loading screen (shell/viewer.ts `loading`, V1's boot card) covers
 * the stage until this says so, and the island is then revealed once: nothing arrives in view.
 *
 * Ready is more than "the job's stages arrived":
 *   built    every stage has been added to the scene (map, ground, pieces, shore, townsfolk, doors);
 *   compiled every material of that scene has a program (`compileAsync`: parallel, off the render thread);
 *   calm     a run of smooth frames has been drawn with all of it in: the post passes' first draws, the
 *            shadow maps and the first uploads are paid for behind the cover, not in the reveal.
 * `gate` is the pure part of the last two (tested); `settle` runs it against a stage. The result is
 * published for tools: `<html data-world>` goes "loading" → "ready" (the cover is fading) → "revealed"
 * (it is gone), `performance.mark("world:ready")` and `("world:revealed")` stamp the moments, and
 * `?loader=0` skips the cover and the gate (the island streams in as it did before the loader).
 */

/** Smooth frames in a row, drawn with the whole island in, before the cover lifts. */
export const CALM_FRAMES = 4
/** A frame at or under this long (ms) is smooth. The first draws after a build compile shaders. */
export const CALM_MS = 50
/** The cover never stays up longer than this once the island is built (a stalled compile), ms. */
export const MAX_SETTLE_MS = 20_000

export interface GateOptions {
  calmFrames?: number
  calmMs?: number
  maxMs?: number
}

export type GateReason = "calm" | "timeout"

export interface Gate {
  /** The shaders are compiled (or compiling failed: the first draws will pay for them). */
  compiled(): void
  /** A frame took `ms` since the last one. Returns true once the gate has opened (and stays so). */
  frame(ms: number): boolean
  open(): GateReason | null
  /** Smooth frames in a row so far (for the progress bar). */
  calm(): number
}

/** The readiness rule: compiled, then `calmFrames` smooth frames in a row; or `maxMs` waited, whatever the state. */
export function createGate(options: GateOptions = {}): Gate {
  const { calmFrames = CALM_FRAMES, calmMs = CALM_MS, maxMs = MAX_SETTLE_MS } = options
  let isCompiled = false
  let calm = 0
  let waited = 0
  let reason: GateReason | null = null
  return {
    compiled() {
      isCompiled = true
    },
    frame(ms) {
      if (reason) return true
      waited += ms
      // frames drawn while the shaders are still compiling are not the calm ones: count from the compile
      calm = isCompiled && ms <= calmMs ? calm + 1 : 0
      if (calm >= calmFrames) reason = "calm"
      else if (waited >= maxMs) reason = "timeout"
      return reason !== null
    },
    open: () => reason,
    calm: () => calm,
  }
}

/** The slice of a Stage `settle` needs (a fake in the tests). */
export interface Settleable {
  renderer: { compileAsync?: (scene: never, camera: never) => Promise<unknown> }
  scene: unknown
  camera: unknown
  onFrame(fn: (dt: number) => void): () => void
}

export interface Settled {
  reason: GateReason
  /** ms from the call to the gate opening. */
  ms: number
  /** ms until the shaders were compiled. */
  compileMs: number
  frames: number
}

/**
 * Compiles the scene's shaders, then waits for the calm run, drawing frames behind the cover meanwhile.
 * `onCalm` reports the gate's progress (0..1) on every frame; `until` settling ends the wait early (the screen
 * was torn down, so no frame will ever come), with what it has.
 */
export function settle(
  stage: Settleable,
  options: GateOptions & { onCalm?: (share: number) => void; until?: Promise<unknown> } = {},
): Promise<Settled> {
  const gate = createGate(options)
  const calmFrames = options.calmFrames ?? CALM_FRAMES
  const t0 = performance.now()
  let compileMs = 0
  let frames = 0
  return new Promise((done) => {
    let ended = false
    const finish = (reason: GateReason) => {
      if (ended) return
      ended = true
      off()
      done({ reason, ms: Math.round(performance.now() - t0), compileMs, frames })
    }
    const off = stage.onFrame((dt) => {
      frames++
      const open = gate.frame(dt * 1000)
      options.onCalm?.(Math.min(1, gate.calm() / calmFrames))
      const reason = gate.open()
      if (open && reason) finish(reason)
    })
    void options.until?.then(() => finish("timeout"))
    const compile = stage.renderer.compileAsync
    const run = compile
      ? compile.call(stage.renderer, stage.scene as never, stage.camera as never)
      : Promise.resolve()
    run
      .catch(() => undefined)
      .then(() => {
        compileMs = Math.round(performance.now() - t0)
        gate.compiled()
      })
  })
}

export type WorldState = "loading" | "ready" | "revealed"

/** Publishes the world's state for scripts: `<html data-world>` plus a performance mark at each change. */
export function publishWorld(state: WorldState | null): void {
  if (typeof document === "undefined") return
  const html = document.documentElement
  if (state === null) delete html.dataset.world
  else {
    html.dataset.world = state
    if (state !== "loading") performance.mark(`world:${state}`)
  }
}

/** `?loader=0`: no cover and no gate. */
export function loaderOn(query: URLSearchParams): boolean {
  return query.get("loader") !== "0"
}
