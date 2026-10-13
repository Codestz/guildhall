/**
 * Hero portraits (avatar variant A, decisions.md "V1 UI parity"): a hero's own KayKit figure (its body,
 * outfit and props, an NpcLook) drawn once, head and shoulders from a 3/4 view, into a round medallion
 * in its banner's tint, as a small WebP whose object URL the HUD shows. Cached per body + tint + props.
 *
 * Off the frame's critical path: portraits wait in a queue and are drawn one at a time, each split into
 * short slices (load, pose and frame, compile, draw, read back, compose) with a yield between them, so no
 * slice holds the main thread for long. The shader compile is async (KHR_parallel_shader_compile where
 * the GPU has it) and the read-back is async. `stats` keeps the longest slice for the 16 ms budget.
 */
import type { Catalog, NpcLook } from "@guildhall/assets"
import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { createNpc } from "./character/npc.ts"
import { canvasPixels } from "./thumbnail.ts"

/** What a portrait shows: a dressed figure (`resolveNpc`'s look, its body set to the hero's) and its banner. */
export interface PortraitSpec {
  look: NpcLook
  /** The banner's colour (CSS `#rrggbb`): the medallion's ground. */
  tint: string
}

export interface PortraitStats {
  /** Portraits drawn so far. */
  drawn: number
  /** The longest single main-thread slice any portrait took, ms. */
  worstSliceMs: number
  /** The slices of the last portrait, ms, by step. */
  last: Record<string, number>
  /** The longest slice of each step over every portrait, ms. */
  worst: Record<string, number>
}

export interface Portraits {
  /** The sprite's URL once drawn; otherwise queues it (once) and returns null. */
  get(spec: PortraitSpec): string | null
  /** Resolves with the sprite's URL when it is drawn. */
  load(spec: PortraitSpec): Promise<string>
  /** Called whenever a portrait lands (for `useSyncExternalStore`). */
  subscribe(listener: () => void): () => void
  readonly stats: PortraitStats
  /** Frees the URLs, the queue and (when it made one) the renderer. */
  dispose(): void
}

export interface PortraitOpts {
  catalog: Catalog
  /** Maps a library-relative path to where it is served (as for `createNpc`). */
  url: (path: string) => string
  /** Sprite pixels a side (default 96). */
  size?: number
  /** Draw with this renderer (the stage's); left out, a small offscreen one of its own. */
  renderer?: WebGLRenderer
}

const SAMPLES = 4
const FOV = 24
/** A 3/4 view, a little from above. */
const AZIMUTH = 32 * (Math.PI / 180)
const ELEVATION = 6 * (Math.PI / 180)

/** The cache key: the body, the tint and every prop with its slot. */
export function portraitKey(spec: PortraitSpec): string {
  const props = spec.look.mounts.map((m) => `${m.slot}=${m.piece}`).sort()
  return [spec.look.body, spec.tint.toLowerCase(), ...props].join("|")
}

/**
 * The camera for a head-and-shoulders shot: aimed a little under the head, back far enough that a
 * `reach`-metre sphere round that point fills the frame. Pure maths.
 */
export function bustCamera(
  head: [number, number, number],
  height: number,
): {
  target: [number, number, number]
  position: [number, number, number]
} {
  const target: [number, number, number] = [head[0], head[1] + height * 0.06, head[2]]
  const reach = height * 0.27
  const distance = reach / Math.sin((FOV / 2) * (Math.PI / 180))
  const flat = Math.cos(ELEVATION) * distance
  return {
    target,
    position: [
      target[0] + Math.sin(AZIMUTH) * flat,
      target[1] + Math.sin(ELEVATION) * distance,
      target[2] + Math.cos(AZIMUTH) * flat,
    ],
  }
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

export function createPortraits(opts: PortraitOpts): Portraits {
  const size = opts.size ?? 96
  const own = !opts.renderer
  let renderer: WebGLRenderer | null = opts.renderer ?? null
  const scene = new Scene()
  scene.add(new HemisphereLight("#fff6e6", "#6f6252", 1.9))
  const sun = new DirectionalLight("#fff4e0", 2.4)
  sun.position.set(4, 7, 6)
  scene.add(sun)
  const fill = new DirectionalLight("#cfe0ff", 0.7)
  fill.position.set(-5, 3, -2)
  scene.add(fill)

  const done = new Map<string, string>()
  const pending = new Map<string, Promise<string>>()
  const queue: {
    key: string
    spec: PortraitSpec
    resolve: (u: string) => void
    reject: (e: unknown) => void
  }[] = []
  const listeners = new Set<() => void>()
  const stats: PortraitStats = { drawn: 0, worstSliceMs: 0, last: {}, worst: {} }
  let running = false
  let disposed = false

  const slice = <T>(step: string, work: () => T): T => {
    const t0 = performance.now()
    const out = work()
    const ms = performance.now() - t0
    stats.last[step] = (stats.last[step] ?? 0) + ms
    stats.worstSliceMs = Math.max(stats.worstSliceMs, ms)
    stats.worst[step] = Math.max(stats.worst[step] ?? 0, ms)
    return out
  }

  const draw = async (spec: PortraitSpec): Promise<string> => {
    stats.last = {}
    // the GLB loads and parses inside the piece cache (shared with the world's figures)
    const npc = await createNpc(spec.look, opts.catalog, opts.url)
    await yieldTask()
    const camera = slice("pose", () => {
      npc.play("idle", { t: 0.25 })
      npc.root.position.set(0, 0, 0)
      npc.root.rotation.set(0, 0, 0)
      npc.root.updateMatrixWorld(true)
      const box = new Box3().setFromObject(npc.root, true)
      const height = Math.max(0.5, box.max.y - box.min.y)
      const head = npc.character.bone("head")
      const at = head ? head.getWorldPosition(new Vector3()) : new Vector3(0, box.max.y - height * 0.15, 0)
      const shot = bustCamera([at.x, at.y, at.z], height)
      const cam = new PerspectiveCamera(FOV, 1, 0.05, height * 8)
      cam.position.set(...shot.position)
      cam.lookAt(...shot.target)
      scene.add(npc.root)
      return cam
    })
    renderer ??= slice("renderer", () => {
      const r = new WebGLRenderer({ canvas: document.createElement("canvas"), alpha: true, antialias: false })
      r.setPixelRatio(1)
      r.setSize(1, 1, false)
      return r
    })
    const gl = renderer
    const target = new WebGLRenderTarget(size, size, { samples: SAMPLES, colorSpace: SRGBColorSpace })
    // compile for the target it will draw to (its colour space picks the program's output variant), so
    // the draw itself only draws; the canvas's own target is put back straight away
    const compiled = slice("compile", () => {
      const before = gl.getRenderTarget()
      gl.setRenderTarget(target)
      const done = gl.compileAsync(npc.root, camera, scene)
      gl.setRenderTarget(before)
      return done
    })
    await compiled
    await yieldTask()
    const pixels = new Uint8Array(size * size * 4)
    const read = slice("draw", () => {
      const before = { target: gl.getRenderTarget(), alpha: gl.getClearAlpha() }
      gl.setRenderTarget(target)
      gl.setClearColor(0x000000, 0)
      gl.clear()
      gl.render(scene, camera)
      const reading = gl.readRenderTargetPixelsAsync(target, 0, 0, size, size, pixels)
      gl.setRenderTarget(before.target)
      gl.setClearAlpha(before.alpha)
      return reading
    })
    try {
      await read
    } finally {
      target.dispose()
      npc.dispose()
    }
    await yieldTask()
    const canvas = slice("compose", () => compose(canvasPixels(pixels, size), size, spec.tint))
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 })
    return URL.createObjectURL(blob)
  }

  const pump = async () => {
    if (running) return
    running = true
    while (queue.length > 0 && !disposed) {
      const job = queue.shift() as (typeof queue)[number]
      try {
        const url = await draw(job.spec)
        if (disposed) {
          URL.revokeObjectURL(url)
          break
        }
        done.set(job.key, url)
        pending.delete(job.key)
        stats.drawn++
        job.resolve(url)
        for (const fn of listeners) fn()
      } catch (error) {
        pending.delete(job.key)
        job.reject(error)
      }
      await yieldTask()
    }
    running = false
  }

  const load = (spec: PortraitSpec): Promise<string> => {
    const key = portraitKey(spec)
    const ready = done.get(key)
    if (ready) return Promise.resolve(ready)
    let waiting = pending.get(key)
    if (!waiting) {
      waiting = new Promise<string>((resolve, reject) => queue.push({ key, spec, resolve, reject }))
      // a failed portrait leaves the face standing in; nothing to report beyond the rejection
      waiting.catch(() => undefined)
      pending.set(key, waiting)
      void pump()
    }
    return waiting
  }

  return {
    get(spec) {
      const url = done.get(portraitKey(spec))
      if (url) return url
      void load(spec)
      return null
    },
    load,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stats,
    dispose() {
      disposed = true
      queue.length = 0
      for (const url of done.values()) URL.revokeObjectURL(url)
      done.clear()
      listeners.clear()
      if (own) renderer?.dispose()
    },
  }
}

/** The medallion: a disc in the banner's tint, lit from above, the figure over it, all clipped round. */
function compose(figure: Uint8ClampedArray<ArrayBuffer>, size: number, tint: string): OffscreenCanvas {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("portrait: no 2d context")
  const r = size / 2
  const ground = ctx.createRadialGradient(r, r * 0.72, r * 0.1, r, r, r)
  ground.addColorStop(0, mix(tint, "#ffffff", 0.22))
  ground.addColorStop(0.8, mix(tint, "#000000", 0.5))
  ground.addColorStop(1, mix(tint, "#000000", 0.62))
  ctx.beginPath()
  ctx.arc(r, r, r, 0, Math.PI * 2)
  ctx.fillStyle = ground
  ctx.fill()
  const layer = new OffscreenCanvas(size, size)
  layer.getContext("2d")?.putImageData(new ImageData(figure, size, size), 0, 0)
  ctx.save()
  ctx.clip()
  ctx.drawImage(layer, 0, 0)
  ctx.restore()
  return canvas
}

/** `a` mixed `k` of the way toward `b` (both `#rrggbb`); anything else comes back as `a`. */
function mix(a: string, b: string, k: number): string {
  const p = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? Number.parseInt(c.slice(1), 16) : null)
  const x = p(a)
  const y = p(b)
  if (x === null || y === null) return a
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k)
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}
