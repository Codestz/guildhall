import type { Material, Mesh, Object3D, ShaderMaterial, WebGLProgramParametersWithUniforms } from "three"

/**
 * Arrivals and departures without popping or shrinking: a character dissolves in or out with a
 * screen-door dither (a 4×4 Bayer pattern, `discard` per pixel), shared by adventurers, townsfolk
 * and the undead. Dither, not blending: every pixel drawn is opaque and writes depth, so nothing
 * needs sorting and a half-there character still hides what is behind it correctly.
 *
 *   Fade       pure: how present a character is (0 gone, 1 whole), easing linearly to its goal.
 *   Dissolver  while a character is partly there, its meshes wear dithered copies of their
 *              materials (one per material, made once, kept for the mount); whole again, they get
 *              their own materials back. A whole character costs nothing: no copy, no patch, no
 *              extra uniform, the same programs as before. Gear in the hands, a lantern, the ring
 *              under their feet: everything under the root dissolves with them.
 *
 * Reduced motion keeps the fade, just quick (DISSOLVE_QUICK_S); nothing is ever scaled.
 * No allocation per frame: copies are made the first frame a character starts to fade.
 */

/** A quick fade for prefers-reduced-motion: still a fade, never a pop or a scale. */
export const DISSOLVE_QUICK_S = 0.15

export type FadeState = "shown" | "appearing" | "vanishing" | "gone"

/** How present a character is, easing linearly to where it is going. Pure: no three, no clock. */
export class Fade {
  value: number
  private goal: number

  constructor(value = 1) {
    this.value = clamp(value)
    this.goal = this.value
  }

  /** Moves towards `to` (0 gone, 1 whole); a full fade takes `seconds`. Returns the new value. */
  step(to: number, dt: number, seconds: number): number {
    this.goal = clamp(to)
    const rate = seconds > 0 ? dt / seconds : 1
    this.value =
      this.value < this.goal ? Math.min(this.goal, this.value + rate) : Math.max(this.goal, this.value - rate)
    return this.value
  }

  get state(): FadeState {
    if (this.value >= 1) return "shown"
    if (this.value <= 0 && this.goal <= 0) return "gone"
    return this.goal > this.value ? "appearing" : "vanishing"
  }
}

/** `seconds`, or the quick fade when the viewer asks for reduced motion (kept current, no polling). */
export function fadeSeconds(seconds: number): number {
  return reduced() ? Math.min(seconds, DISSOLVE_QUICK_S) : seconds
}

/** prefers-reduced-motion, read once and then kept by its change event (never queried per frame). */
let motion: boolean | null = null
function reduced(): boolean {
  if (motion !== null) return motion
  motion = false
  if (typeof window === "undefined" || !window.matchMedia) return motion
  const query = window.matchMedia("(prefers-reduced-motion: reduce)")
  motion = query.matches
  query.addEventListener?.("change", (event) => {
    motion = event.matches
  })
  return motion
}

/** The dither, GLSL: a 4×4 Bayer threshold in [0, 1) from the pixel's screen position. */
export const DITHER_GLSL = /* glsl */ `
uniform float uDissolve;
float guildBayer2( vec2 a ) { a = floor( a ); return fract( a.x / 2.0 + a.y * a.y * 0.75 ); }
float guildDither( vec2 p ) { return guildBayer2( 0.5 * p ) * 0.25 + guildBayer2( p ); }
`
/** First thing in main(): a pixel whose threshold is at or over the presence is not drawn. */
export const DISCARD_GLSL =
  /* glsl */ "if ( uDissolve < 1.0 && guildDither( gl_FragCoord.xy ) >= uDissolve ) discard;"

/** The dither threshold of pixel (x, y), as the shader computes it (for tests and the Lab). */
export function ditherAt(x: number, y: number): number {
  const bayer2 = (ax: number, ay: number) => {
    const fx = Math.floor(ax)
    const fy = Math.floor(ay)
    const v = fx / 2 + fy * fy * 0.75
    return v - Math.floor(v)
  }
  return bayer2(0.5 * x, 0.5 * y) * 0.25 + bayer2(x, y)
}

/** Puts the dither into a fragment shader's source, its presence read from `uDissolve`. */
export function ditherShader(fragment: string): string {
  return fragment.replace("void main() {", `${DITHER_GLSL}\nvoid main() {\n\t${DISCARD_GLSL}`)
}

type Dither = (material: Material, amount: { value: number }) => Material

/**
 * WebGPU never runs onBeforeCompile: there the dither is a node material's mask instead
 * (castNodes.ts `ditheredNode`), set by render/webgpu.ts once its renderer has started. Unset (the
 * default, WebGL), `dithered` patches the GLSL.
 */
let nodeDither: Dither | null = null
export function setNodeDither(dither: Dither | null): void {
  nodeDither = dither
}

/**
 * A dithered copy of `material` whose presence is `amount` (a uniform shared by one character's
 * copies). Any patch the original had runs first; the program is shared by every copy of the same
 * kind of material (one compile per kind, not per character).
 */
export function dithered(material: Material, amount: { value: number }): Material {
  if (nodeDither) return nodeDither(material, amount)
  const copy = material.clone()
  const base = material.onBeforeCompile
  const key = material.customProgramCacheKey()
  copy.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    base.call(material, shader, renderer)
    shader.uniforms.uDissolve = amount
    shader.fragmentShader = ditherShader(shader.fragmentShader)
  }
  copy.customProgramCacheKey = () => `${key}|dissolve`
  return copy
}

/** Shader materials keep their own uniforms (a clone would freeze them): they are left as they are. */
const ditherable = (material: Material): boolean => !(material as ShaderMaterial).isShaderMaterial

/**
 * One character's dissolve. `set(root, amount)` once a frame after its Fade: partly there, every
 * mesh under `root` draws with a dithered copy of its material; whole, the originals come back and
 * nothing more happens until the next fade. `dispose()` on unmount puts the originals back and
 * frees the copies (call it before anything else restores or frees the character's materials).
 */
export class Dissolver {
  readonly amount = { value: 1 }
  private readonly copies = new Map<Material, Material>()
  private readonly originals = new Map<Material, Material>()
  private on = false

  set(root: Object3D, amount: number): void {
    this.amount.value = amount
    if (amount >= 1) {
      if (!this.on) return
      this.on = false
      root.traverse(this.restore)
      return
    }
    this.on = true
    // Every frame of a fade: gear picked up or a lantern lit meanwhile dissolves too.
    root.traverse(this.wear)
  }

  /** Is it wearing the dithered copies now? */
  get active(): boolean {
    return this.on
  }

  dispose(root: Object3D | null): void {
    if (root && this.on) root.traverse(this.restore)
    this.on = false
    for (const copy of this.copies.values()) copy.dispose()
    this.copies.clear()
    this.originals.clear()
  }

  private readonly wear = (child: Object3D): void => {
    const mesh = child as Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const material = mesh.material
    if (this.originals.has(material) || !ditherable(material)) return
    let copy = this.copies.get(material)
    if (!copy) {
      copy = dithered(material, this.amount)
      this.copies.set(material, copy)
      this.originals.set(copy, material)
    }
    mesh.material = copy
  }

  private readonly restore = (child: Object3D): void => {
    const mesh = child as Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const original = this.originals.get(mesh.material)
    if (original) mesh.material = original
  }
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
