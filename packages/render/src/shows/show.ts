/**
 * What the shows share (shows/): the `Show` the world-events engine hands over, how long each kind
 * plays, the timings' easing, and the lit material their solid parts draw with (the palette material's
 * light, so a dragon or a pennant sits in the island's sun, sky, haze and night grade like any piece).
 */
import {
  BufferAttribute,
  type BufferGeometry,
  type Camera,
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { patchCloudShade } from "../atmosphere/shade.ts"
import type { EventSites } from "../events/sites.ts"
import { patchGlow } from "../night/glow.ts"
import type { Stage } from "../stage.ts"
import { patchCascades } from "../sun/patch.ts"

export type ShowKind = "dragon" | "comet" | "rainbow" | "festival"
export const SHOW_KINDS: readonly ShowKind[] = ["dragon", "comet", "rainbow", "festival"]

/**
 * A show as the world-events engine schedules it: its kind, when it starts and when it is over
 * (seconds on the shows' clock), and its own knobs. A dragon is gone by `end` (it leaves over the last
 * `DRAGON_LEAVE_S`); `end` may be Infinity for a dragon that stays until `stop`.
 */
export interface Show {
  kind: ShowKind
  start: number
  end: number
  params?: Record<string, unknown>
}

/** How long each kind plays when nothing says otherwise, seconds (V1 events/common.ts DURATION_S). */
export const SHOW_S: Record<ShowKind, number> = {
  // arrives (7 s), two laps of the peaks (2 × 15 s), leaves (8 s)
  dragon: 45,
  comet: 15,
  rainbow: 32,
  festival: 42,
}

/** Night (the sky's `light().night`) past which a show plays its night version, read when it starts. */
export const NIGHT_AT = 0.45

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
export const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** 0 → 1 over the first `inS` seconds, 1 → 0 over the last `outS` of `total`. */
export function envelope(age: number, total: number, inS: number, outS: number): number {
  return smooth(0, inS, age) * (1 - smooth(total - outS, total, age))
}

/** Integer → [0, 1), well mixed: the layouts are the same every time. */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** What a show is built from: the stage, where things happen, and the light when it starts. */
export interface ShowCtx {
  stage: Stage
  sites: EventSites
  /** The island's half extent, metres (the rainbow's size). */
  span: number
  /** The night version (the sky past `NIGHT_AT` when the show starts). */
  night: boolean
  /** Reduced motion: wings glide, sparks hold still. */
  still: boolean
  /** The sky's night now, 0 by day … 1 deep night (a dragon's hide glows a little in the dark). */
  nightLevel: () => number
}

/** One playing show's scene part: built when it starts, freed when it is over. */
export interface ShowPiece {
  /** Added to the scene hidden; shown once its programs are linked. */
  object: Object3D
  /** Draws calls while visible (for the stats). */
  draws(): number
  /** Poses it at `t` seconds into the show (`total` long: Infinity for a dragon still circling). */
  update(t: number, total: number, camera: Camera): void
  /** Where a camera should look to film it now (a moving subject's, as of its last update); none: its site. */
  subject?(): [number, number, number] | null
  dispose(): void
}

/**
 * The shows' lit material: vertex colours in the palette material's light (the cascades' shadows, the
 * clouds' shade, the sky's light and haze, the night grade, and `_glow` vertices lit with the town's
 * lamps), plus a show's own patch (`extra`, after those). `key` names its program.
 */
export function litMaterial(
  key: string,
  extra: (shader: WebGLProgramParametersWithUniforms) => void,
  opts: { flat?: boolean; doubleSided?: boolean } = {},
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: opts.flat === true,
    side: opts.doubleSided ? DoubleSide : FrontSide,
  })
  material.onBeforeCompile = (shader) => {
    patchCascades(shader)
    patchCloudShade(shader)
    patchGlow(shader)
    extra(shader)
  }
  material.customProgramCacheKey = () => `guildhall-show-${key}`
  return material
}

/** A per-vertex float attribute filled with `value`. */
export function fill(geometry: BufferGeometry, name: string, value: number): BufferGeometry {
  const count = geometry.getAttribute("position").count
  geometry.setAttribute(name, new BufferAttribute(new Float32Array(count).fill(value), 1))
  return geometry
}
