/**
 * Stills of the stage's own world (a hall's era pictures, studio hall/eraShots.ts): the scene as the
 * frame draws it, through the post pipeline (`Post.still`: the bloom, the ink, the mood LUT, the
 * hour's grade), from a camera of the still's own, into a small 8-bit target, read back and encoded as a
 * WebP whose data URL the HUD shows. On the stage's renderer (no second WebGL context) and on its
 * programs: a render target's programs are the scene target's, so a still links nothing.
 *
 * Off the frame's critical path, as the portraits are (portrait.ts): a still waits for a frame to be
 * drawn and runs in the task after it, in slices with a yield between them (the draw, the read-back,
 * the unpack, the encode); `set` lays the world out for the still (the island at a date, its season,
 * the hour) and its undo puts it back inside the same slice, so no frame ever sees it; the air (the
 * haze, the horizon, the fog, set by the frame's own camera) is moved out to the still's eye for it.
 * The read-back is async (a fence), the encode on a CPU canvas, read as a data URL off the thread.
 * Before the first still, every program it may use is read a program to a slice (`ready`): a program
 * the frame never drew costs its first use 20-45 ms on ANGLE/Metal, which a draw would otherwise pay
 * all at once. `stats` keeps the longest slice for the 16 ms budget.
 */
import type { CameraPose } from "@guildhall/core"
import { Fog, PerspectiveCamera, UnsignedByteType, WebGLRenderTarget } from "three"
import { AIR } from "./atmosphere/air.ts"
import { poseToCamera } from "./camera.ts"
import type { Post } from "./post/index.ts"
import type { Stage } from "./stage.ts"

export interface StillShot {
  /** Where the still looks from. */
  pose: CameraPose
  /** The still's pixels (its aspect the camera's). */
  width: number
  height: number
  /** Vertical field of view, degrees (default the stage camera's). */
  fov?: number
  /** Lays the world out for the still; returns its undo (both run inside the draw's slice). */
  set?: () => () => void
}

export interface StillStats {
  /** Stills drawn so far. */
  drawn: number
  /** The longest single main-thread slice any still took, ms. */
  worstSliceMs: number
  /** Every slice of every still, ms. */
  totalMs: number
  /** The longest slice of each step over every still, ms. */
  worst: Record<string, number>
  /** Programs a still had to link (none: it drew on the frame's own). */
  linked: string[]
}

export interface Stills {
  /** Draws a still and resolves with its WebP as a data URL. Stills draw one at a time. */
  shoot(shot: StillShot): Promise<string>
  readonly stats: StillStats
  /** Frees the targets (the post's still target too); a still under way rejects. */
  dispose(): void
}

/** Gives the main thread back: the next task (a message, so no 4 ms timer clamp). */
function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(0)
  })
}

/** Resolves in the task after the stage's next frame (its draw done): a still never shares a frame's task. */
function afterFrame(stage: Pick<Stage, "onFrame">): Promise<void> {
  return new Promise((resolve) => {
    const off = stage.onFrame(() => {
      off()
      void yieldTask().then(resolve)
    })
  })
}

/**
 * The air as the still's eye sees it: the frame sets the haze's clear zone, the horizon's band and
 * three's fog by its own camera's distance to its target (sky.ts, atmosphere/horizon.ts); a still from
 * farther out moves them out by the difference, so its subject is as clear as the frame's. Returns the undo.
 */
function airAt(stage: Pick<Stage, "scene" | "getCamera">, distance: number): () => void {
  const by = distance - stage.getCamera().distance
  const clear = AIR.uHazeClear.value
  const horizon = AIR.uHorizon.value.clone()
  const fog = stage.scene.fog instanceof Fog ? stage.scene.fog : null
  const near = fog?.near ?? 0
  const far = fog?.far ?? 0
  AIR.uHazeClear.value = clear + by
  AIR.uHorizon.value.addScalar(by)
  if (fog) {
    fog.near = near + by
    fog.far = far + by
  }
  return () => {
    AIR.uHazeClear.value = clear
    AIR.uHorizon.value.copy(horizon)
    if (fog) {
      fog.near = near
      fog.far = far
    }
  }
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** GL rows (bottom up) as an image's (top down), opaque. */
export function flipRows(gl: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4)
  const row = width * 4
  for (let y = 0; y < height; y++) {
    out.set(gl.subarray((height - 1 - y) * row, (height - y) * row), y * row)
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255
  return out
}

export function createStills(stage: Stage, post: Pick<Post, "still" | "releaseStill">): Stills {
  const stats: StillStats = { drawn: 0, worstSliceMs: 0, totalMs: 0, worst: {}, linked: [] }
  let target: WebGLRenderTarget | null = null
  let chain: Promise<unknown> = Promise.resolve()
  let disposed = false

  const slice = <T>(step: string, work: () => T): T => {
    const t0 = performance.now()
    const out = work()
    const ms = performance.now() - t0
    stats.totalMs += ms
    stats.worstSliceMs = Math.max(stats.worstSliceMs, ms)
    stats.worst[step] = Math.max(stats.worst[step] ?? 0, ms)
    return out
  }
  const alive = () => {
    if (disposed) throw new Error("stills: disposed")
  }

  const cameraOf = (shot: StillShot) => {
    const cam = new PerspectiveCamera(
      shot.fov ?? stage.camera.fov,
      shot.width / shot.height,
      0.5,
      stage.camera.far,
    )
    cam.position.set(...poseToCamera(shot.pose))
    cam.lookAt(...shot.pose.target)
    cam.updateMatrixWorld(true)
    return cam
  }

  /**
   * The first still's programs, made ready before it draws: what the frame has never drawn (the far
   * view's coarse levels) is linked in the background (KHR_parallel_shader_compile) and the draw only
   * uses it. Keyed by any render target (every one but the canvas shares the programs).
   */
  const ready = async (shot: StillShot) => {
    await afterFrame(stage)
    alive()
    const linking = slice("compile", () => {
      const gl = stage.renderer
      const before = gl.getRenderTarget()
      gl.setRenderTarget(target)
      const out = gl.compileAsync(stage.scene, cameraOf(shot))
      gl.setRenderTarget(before)
      return out
    })
    await linking
    // three reads a program's uniforms on its first use (and its logs: a sync round trip to the GPU
    // process, which on ANGLE/Metal builds the pipeline there and then, 20-45 ms for a program the frame
    // has never drawn); done here a program to a slice, so the draw finds them all read
    for (const program of stage.renderer.info.programs ?? []) {
      await yieldTask()
      alive()
      slice("ready", () => {
        program.getUniforms()
        program.getAttributes()
      })
    }
  }
  let warmed = false

  const draw = async (shot: StillShot): Promise<string> => {
    const { width, height } = shot
    // the composite's output, as the frame's own (an 8-bit target: the same program)
    if (!target) target = new WebGLRenderTarget(width, height, { type: UnsignedByteType, depthBuffer: false })
    else if (target.width !== width || target.height !== height) target.setSize(width, height)
    const into = target
    if (!warmed) {
      await ready(shot)
      warmed = true
    }
    await afterFrame(stage)
    alive()
    const pixels = new Uint8Array(width * height * 4)
    const reading = slice("draw", () => {
      const cam = cameraOf(shot)
      const programs = stage.renderer.info.programs?.length ?? 0
      const undo = shot.set?.() ?? (() => {})
      const unair = airAt(stage, shot.pose.distance)
      try {
        post.still(cam, into, shot.pose.distance)
      } finally {
        unair()
        undo()
      }
      const made = stage.renderer.info.programs?.slice(programs) ?? []
      for (const p of made) stats.linked.push(p.name)
      return stage.renderer.readRenderTargetPixelsAsync(into, 0, 0, width, height, pixels)
    })
    await reading
    alive()
    await yieldTask()
    const image = slice("unpack", () => new ImageData(flipRows(pixels, width, height), width, height))
    await yieldTask()
    const canvas = slice("compose", () => {
      const c = new OffscreenCanvas(width, height)
      // a CPU canvas: an accelerated one would read its pixels back from the GPU to encode them, and wait
      // there behind the frames (and the still) the GPU is still drawing
      c.getContext("2d", { willReadFrequently: true })?.putImageData(image, 0, 0)
      return c
    })
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.86 })
    alive()
    stats.drawn++
    // a data URL, read off the main thread (an object URL is made on it: a sync call to the blob
    // registry, 1-100 ms while the page is busy)
    return dataUrl(blob)
  }

  return {
    shoot(shot) {
      const next = chain.then(() => draw(shot))
      chain = next.catch(() => undefined)
      return next
    },
    stats,
    dispose() {
      disposed = true
      target?.dispose()
      target = null
      post.releaseStill()
    },
  }
}
