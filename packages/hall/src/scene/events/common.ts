import {
  type BufferAttribute,
  type BufferGeometry,
  Float32BufferAttribute,
  type Material,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { EventKind } from "../../guild/events.ts"

/**
 * What the world events' scene pieces share (scene/events/*.tsx): timings, easing, a one-draw-call
 * bake of a Kenney ship, and the small shader injections that animate on the GPU so nothing moves
 * vertices on the CPU. No module here allocates per frame.
 */

/** How long each timed show plays, seconds (lasting ones — raid, dragon — end when told). */
export const DURATION_S: Record<EventKind, number> = {
  festival: 42,
  "ghost-ship": 36,
  rainbow: 32,
  raid: Number.POSITIVE_INFINITY,
  comet: 15,
  dragon: Number.POSITIVE_INFINITY,
}

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

/** A float copy of an attribute (glTF's are often quantized and normalized: transforms would clamp). */
function toFloat(attribute: BufferAttribute, itemSize: number): Float32BufferAttribute {
  const out = new Float32Array(attribute.count * itemSize)
  for (let i = 0; i < attribute.count; i++)
    for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = attribute.getComponent(i, k)
  return new Float32BufferAttribute(out, itemSize)
}

export interface Baked {
  geometry: BufferGeometry
  /** The source's own material (shared, borrowed): its `map` is the pack's palette texture. */
  material: MeshStandardMaterial
  /** Height of the model, its units. */
  height: number
}

/**
 * A Kenney ship (or any glTF node) baked into one geometry in the node's own space — hull, sails
 * and flags in one draw call (they share the palette material). Each vertex gets `aFlag` (1 for a
 * flag, 0.4 for a sail, 0 for the hull), the weight a vertex shader flutters it by, and `aLift`, its
 * height above the deck, for the flutter's fall-off.
 */
export function bakeNode(node: Object3D): Baked | null {
  node.updateWorldMatrix(true, true)
  const inverse = new Matrix4().copy(node.matrixWorld).invert()
  const parts: BufferGeometry[] = []
  let material: MeshStandardMaterial | null = null
  node.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    material ??= mesh.material as MeshStandardMaterial
    const source = mesh.geometry
    const geometry = source.index ? source.toNonIndexed() : source.clone()
    for (const name of Object.keys(geometry.attributes))
      if (name !== "position" && name !== "normal" && name !== "uv") geometry.deleteAttribute(name)
    geometry.setAttribute("position", toFloat(geometry.getAttribute("position") as BufferAttribute, 3))
    geometry.setAttribute("normal", toFloat(geometry.getAttribute("normal") as BufferAttribute, 3))
    const uv = geometry.getAttribute("uv") as BufferAttribute | undefined
    if (uv) geometry.setAttribute("uv", toFloat(uv, 2))
    geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
    const name = `${mesh.name} ${mesh.parent?.name ?? ""}`
    const weight = /flag/.test(name) ? 1 : /sail/.test(name) ? 0.35 : 0
    geometry.setAttribute(
      "aFlag",
      new Float32BufferAttribute(new Float32Array(geometry.attributes.position?.count ?? 0).fill(weight), 1),
    )
    parts.push(geometry)
  })
  if (!material || parts.length === 0) return null
  const geometry = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  if (!geometry) return null
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  return { geometry, material, height: box ? box.max.y - box.min.y : 1 }
}

/** The palette texture of a baked node's material (borrowed: never freed by an event). */
export function paletteOf(baked: Baked): Texture | null {
  return baked.material.map
}

/**
 * Flutter for flags and sails (attribute `aFlag`): a travelling wave across the cloth, stronger
 * further from the mast. Injected into a standard material; `uTime` drives it.
 */
export function flutter(material: Material, uniforms: { uTime: { value: number } }, amount = 0.22): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFlag;\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        if (aFlag > 0.0) {
          float wave = sin(uTime * 7.0 + position.z * 2.6 + position.y * 1.3);
          transformed.x += wave * ${amount.toFixed(3)} * aFlag * (0.35 + abs(position.z) * 0.25);
        }`,
      )
  }
  material.customProgramCacheKey = () => `flutter-${amount}`
}

/** Night 0–1 from the sky (atmosphere/state.ts `sky.night`), read once when a show begins. */
export const NIGHT_AT = 0.45

/** Integer → [0, 1), well mixed: deterministic layouts. */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}
