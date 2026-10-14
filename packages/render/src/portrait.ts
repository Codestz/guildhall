/**
 * Hero portraits (the HUD's avatars, decisions.md "V1 UI parity"): a hero's own KayKit figure, dressed
 * exactly as the island draws it (its body, outfit colours, hidden parts, headgear and props, an
 * NpcLook), shot head and shoulders from a 3/4 view, framed on the face and its headgear so it reads at
 * 30-40 CSS px, over a medallion in its banner's tint, as a small WebP whose object URL the HUD shows.
 * Cached per look + tint (`portraitKey`).
 *
 * Drawn at twice the sprite's size (4× MSAA) and scaled down in the 2D compose, so the edges stay crisp
 * at badge size. Lit as the island is lit, warm: a key from the front-left, a rim from behind, a soft fill.
 *
 * Off the frame's critical path: portraits wait in a queue and are drawn one at a time, each split into
 * short slices (load, pose and frame, compile, draw, read back, unpack, compose) with a yield between them, so no
 * slice holds the main thread for long. With the stage's renderer (no second WebGL context) the draw sets
 * its own target and puts the stage's back, and leaves the frame counters as they were. The shader
 * compile is async (KHR_parallel_shader_compile where the GPU has it) and so is the read-back. `stats`
 * keeps the longest slice for the 16 ms budget.
 */
import type { Catalog, NpcLook } from "@guildhall/assets"
import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  type SkinnedMesh,
  SRGBColorSpace,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { createNpc } from "./character/npc.ts"
import { canvasPixels } from "./thumbnail.ts"

/** What a portrait shows: a dressed figure (the island's look for the hero) and its banner. */
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
  /** Every slice of every portrait summed, ms (`/ drawn` is the main-thread cost of one). */
  totalMs: number
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
  /** Bumps whenever a portrait lands (a `useSyncExternalStore` snapshot). */
  version(): number
  readonly stats: PortraitStats
  /** Frees the URLs, the queue and (when it made one) the renderer. */
  dispose(): void
}

export interface PortraitOpts {
  catalog: Catalog
  /** Maps a library-relative path to where it is served (as for `createNpc`). */
  url: (path: string) => string
  /** Sprite pixels a side (default 128: 2× a 40-64 px badge). */
  size?: number
  /** Draw with this renderer (the stage's); left out, a small offscreen one of its own. */
  renderer?: WebGLRenderer
}

const SAMPLES = 4
/** The figure is drawn at this many times the sprite's size and scaled down in the compose. */
const SUPERSAMPLE = 2
const FOV = 22
/** A 3/4 view, a little from above. */
const AZIMUTH = 30 * (Math.PI / 180)
const ELEVATION = 8 * (Math.PI / 180)

/** A box, min and max corners (metres, world). */
export interface Bounds {
  min: [number, number, number]
  max: [number, number, number]
}

/** The parts that sit on the head: hats, helmets, visors, hoods, masks, horns, crowns. */
export const HEADGEAR = /hat|helm|visor|hood|mask|horn|crown|cap\b|hair/i
/** The head itself (not the headgear). */
const HEAD = /head/i

/** The cache key: the body, the tint, the outfit's colours, the hidden parts and every prop with its slot. */
export function portraitKey(spec: PortraitSpec): string {
  const { look } = spec
  const props = look.mounts.map((m) => `${m.slot}=${m.piece}`).sort()
  const ramps = Object.entries(look.rampMap ?? {})
    .map(([k, v]) => `${k}>${v}`)
    .sort()
  const hide = [...(look.hide ?? [])].sort().map((p) => `-${p}`)
  return [look.body, spec.tint.toLowerCase(), ...ramps, ...hide, ...props].join("|")
}

/**
 * The square a bust is framed in, from the head's box and its headgear's (null: bare-headed): the face
 * and all of the headgear but the tip of a tall hat (no more than half a head above the head), down to
 * the top of the shoulders, centred on the head. `centre` is the frame's middle, `half` its half side
 * (metres). Pure maths.
 */
export function bustFrame(
  head: Bounds,
  gear: Bounds | null,
): { centre: [number, number, number]; half: number } {
  const headH = Math.max(0.05, head.max[1] - head.min[1])
  const gearTop = gear ? Math.min(gear.max[1], head.max[1] + headH * 0.5) : head.max[1]
  const top = Math.max(head.max[1], gearTop) + headH * 0.04
  const bottom = head.min[1] - headH * 0.22
  // a wide brim keeps its width: the frame grows to hold it (bounded, so a cape never zooms it out)
  const wide = gear ? Math.min(gear.max[0] - gear.min[0], headH * 2.2) : 0
  const half = Math.max((top - bottom) / 2, wide / 2 + headH * 0.04)
  return {
    centre: [(head.min[0] + head.max[0]) / 2, (top + bottom) / 2, (head.min[2] + head.max[2]) / 2],
    half,
  }
}

/**
 * The camera for a bust framed by `bustFrame`: aimed at the frame's middle from a 3/4 view a little from
 * above, back far enough that the frame's half side fills half the view (the figure's facing side, which
 * is `depth` metres nearer than the middle, kept in). Pure maths.
 */
export function bustCamera(
  centre: [number, number, number],
  half: number,
  depth = 0,
): {
  target: [number, number, number]
  position: [number, number, number]
} {
  const distance = half / Math.tan((FOV / 2) * (Math.PI / 180)) + depth
  const flat = Math.cos(ELEVATION) * distance
  return {
    target: centre,
    position: [
      centre[0] + Math.sin(AZIMUTH) * flat,
      centre[1] + Math.sin(ELEVATION) * distance,
      centre[2] + Math.cos(AZIMUTH) * flat,
    ],
  }
}

/** The posed (skinned) box of the visible meshes under `root` whose names match `name`, or null. */
function posedBounds(root: Object3D, name: RegExp, not?: RegExp): Bounds | null {
  const box = new Box3()
  const part = new Box3()
  root.traverse((o) => {
    if (!(o as SkinnedMesh).isMesh || !o.visible || !name.test(o.name) || not?.test(o.name)) return
    let shown = true
    for (let p = o.parent; p; p = p.parent) if (!p.visible) shown = false
    if (!shown) return
    ;(o as SkinnedMesh).skeleton?.update()
    part.setFromObject(o, true)
    box.union(part)
  })
  return box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() }
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
  const size = opts.size ?? 128
  const drawn = size * SUPERSAMPLE
  const own = !opts.renderer
  let renderer: WebGLRenderer | null = opts.renderer ?? null
  const scene = new Scene()
  // the island's warm light: a sky/ground wash, a key from the front-left, a rim from behind, a cool fill
  scene.add(new HemisphereLight("#ffeccf", "#5b4733", 1.5))
  const key = new DirectionalLight("#ffe0b5", 2.6)
  key.position.set(-3, 5, 6)
  scene.add(key)
  const rim = new DirectionalLight("#fff1d6", 3.4)
  rim.position.set(4, 5, -6)
  scene.add(rim)
  const fill = new DirectionalLight("#cddcff", 0.55)
  fill.position.set(6, 1, 3)
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
  const stats: PortraitStats = { drawn: 0, worstSliceMs: 0, totalMs: 0, last: {}, worst: {} }
  let running = false
  let disposed = false
  let version = 0

  const slice = <T>(step: string, work: () => T): T => {
    const t0 = performance.now()
    const out = work()
    const ms = performance.now() - t0
    stats.last[step] = (stats.last[step] ?? 0) + ms
    stats.totalMs += ms
    stats.worstSliceMs = Math.max(stats.worstSliceMs, ms)
    stats.worst[step] = Math.max(stats.worst[step] ?? 0, ms)
    return out
  }

  const draw = async (spec: PortraitSpec): Promise<string> => {
    stats.last = {}
    // the GLB loads and parses inside the piece cache (shared with the world's figures)
    const npc = await createNpc({ ...spec.look, scale: 1 }, opts.catalog, opts.url)
    await yieldTask()
    const camera = slice("pose", () => {
      npc.play("idle", { t: 0.25 })
      npc.root.position.set(0, 0, 0)
      npc.root.rotation.set(0, 0, 0)
      npc.root.updateMatrixWorld(true)
      const head =
        posedBounds(npc.root, HEAD) ??
        (() => {
          const box = new Box3().setFromObject(npc.root)
          const h = box.max.y - box.min.y
          return { min: [box.min.x, box.max.y - h * 0.4, box.min.z], max: box.max.toArray() } as Bounds
        })()
      const gear = posedBounds(npc.root, HEADGEAR, HEAD)
      const frame = bustFrame(head, gear)
      const shot = bustCamera(frame.centre, frame.half, (head.max[2] - head.min[2]) / 2)
      const cam = new PerspectiveCamera(FOV, 1, 0.05, frame.half * 40)
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
    const target = new WebGLRenderTarget(drawn, drawn, { samples: SAMPLES, colorSpace: SRGBColorSpace })
    // compile for the target it will draw to (its colour space picks the program's output variant), so
    // the draw itself only draws; the canvas's own target is put back straight away
    const compiled = slice("compile", () => {
      const before = gl.getRenderTarget()
      gl.setRenderTarget(target)
      const ready = gl.compileAsync(npc.root, camera, scene)
      gl.setRenderTarget(before)
      return ready
    })
    await compiled
    await yieldTask()
    const pixels = new Uint8Array(drawn * drawn * 4)
    const read = slice("draw", () => {
      const before = {
        target: gl.getRenderTarget(),
        colour: gl.getClearColor(new Color()),
        alpha: gl.getClearAlpha(),
      }
      const info = { ...gl.info.render }
      gl.setRenderTarget(target)
      gl.setClearColor(0x000000, 0)
      gl.clear()
      gl.render(scene, camera)
      const reading = gl.readRenderTargetPixelsAsync(target, 0, 0, drawn, drawn, pixels)
      gl.setRenderTarget(before.target)
      gl.setClearColor(before.colour, before.alpha)
      // the stage's frame counters (autoReset off) count its own frame only
      Object.assign(gl.info.render, info)
      return reading
    })
    try {
      await read
    } finally {
      target.dispose()
      npc.root.removeFromParent()
      npc.dispose()
    }
    await yieldTask()
    const figure = slice("unpack", () => canvasPixels(pixels, drawn))
    await yieldTask()
    const canvas = slice("compose", () => compose(figure, drawn, size, spec.tint))
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.92 })
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
        version++
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
    version: () => version,
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

/**
 * The medallion, `size` px: a disc in the banner's tint, lit from above and darker at the edge, the
 * figure (drawn at `from` px) scaled down over it with a soft dark outline so it stands off any banner,
 * all clipped round. The rim is the HUD's (it follows the hero's state).
 */
function compose(
  figure: Uint8ClampedArray<ArrayBuffer>,
  from: number,
  size: number,
  tint: string,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("portrait: no 2d context")
  const r = size / 2
  const ground = ctx.createRadialGradient(r * 0.86, r * 0.62, r * 0.08, r, r, r)
  ground.addColorStop(0, mix(tint, "#ffffff", 0.3))
  ground.addColorStop(0.55, tint)
  ground.addColorStop(1, mix(tint, "#000000", 0.55))
  ctx.beginPath()
  ctx.arc(r, r, r, 0, Math.PI * 2)
  ctx.fillStyle = ground
  ctx.fill()
  const layer = new OffscreenCanvas(from, from)
  layer.getContext("2d")?.putImageData(new ImageData(figure, from, from), 0, 0)
  ctx.save()
  ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.filter = `drop-shadow(0 0 ${Math.max(1, size / 64)}px rgba(14, 9, 5, 0.85)) saturate(1.12) contrast(1.06)`
  ctx.drawImage(layer, 0, 0, size, size)
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
