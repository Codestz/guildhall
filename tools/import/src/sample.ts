/**
 * Colour sources → linear RGB per triangle corner, then RGB → palette swatch + shade (ADR 003).
 *
 * A primitive's colour is glTF's base colour: material factor × base-colour texture × COLOR_0. The
 * texture term is read one of two ways:
 *   corner   (atlas, colormap) nearest texel at each corner's UV pulled INSET toward the triangle's UV
 *            centroid, so a corner on a swatch edge reads its own face's swatch (plan R2), and gradient
 *            swatches keep their variation (it becomes `_SHADE`)
 *   average  (texture-average, keep-texture) the mean of 7 interior barycentric samples: one colour a face
 * `material` ignores any texture. Results are per corner (the index list, or 0..n-1 without one), because
 * one vertex can read different colours from different faces; the colour stage splits such vertices.
 */
import { Primitive } from "@gltf-transform/core"
import {
  type ColourMode,
  type ColourWeights,
  type Lab,
  labDistance2,
  linearToSrgb,
  nearestSwatch,
  oklabToLinear,
  type Palette,
  SHADE_RANGE,
  type Swatch,
  shadeOf,
  srgbToLinear,
  srgbToOklab,
} from "@guildhall/assets"
import type { Raster } from "./png.ts"

/** How far each corner's UV moves toward the triangle's UV centroid before sampling. */
export const INSET = 0.15
/**
 * Swatch choice weighs chroma and hue above lightness: lightness differences survive as `_SHADE`,
 * a wrong hue does not.
 */
export const BAKE_WEIGHTS: ColourWeights = { l: 1, chroma: 2, hue: 2 }
/**
 * A source colour whose baked colour (swatch + shade) is further than this from it, in plain OKLab ΔE,
 * is a colour miss: the piece is flagged `colour-miss` and `colour.map` can pin the source hex.
 */
export const MISS_THRESHOLD = 0.06

/** Barycentric sample points for `average`: the centroid and six interior points around it. */
const AVERAGE_POINTS: readonly (readonly [number, number, number])[] = [
  [1 / 3, 1 / 3, 1 / 3],
  [2 / 3, 1 / 6, 1 / 6],
  [1 / 6, 2 / 3, 1 / 6],
  [1 / 6, 1 / 6, 2 / 3],
  [1 / 6, 5 / 12, 5 / 12],
  [5 / 12, 1 / 6, 5 / 12],
  [5 / 12, 5 / 12, 1 / 6],
]

const WRAP_CLAMP = 33071
const WRAP_MIRROR = 33648
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255))

type Uv = [u: number, v: number]
type Rgb3 = [r: number, g: number, b: number]

/** The vertex each corner uses: the index list, or 0..n-1 for a non-indexed primitive. */
export function cornerVertices(prim: Primitive): Uint32Array {
  const indices = prim.getIndices()?.getArray()
  if (indices) return Uint32Array.from(indices)
  const count = prim.getAttribute("POSITION")?.getCount() ?? 0
  return Uint32Array.from({ length: count }, (_, i) => i)
}

function wrap(t: number, mode: number): number {
  if (mode === WRAP_CLAMP) return Math.min(1, Math.max(0, t))
  if (mode === WRAP_MIRROR) {
    const f = t - 2 * Math.floor(t / 2)
    return f > 1 ? 2 - f : f
  }
  return t - Math.floor(t)
}

/** Nearest-texel lookup in linear RGB, honouring the sampler's wrap modes (default repeat). */
function texelReader(image: Raster, wrapS: number, wrapT: number) {
  const { width, height, data } = image
  return ([u, v]: Uv, out: Rgb3): Rgb3 => {
    const x = Math.min(width - 1, Math.floor(wrap(u, wrapS) * width))
    const y = Math.min(height - 1, Math.floor(wrap(v, wrapT) * height))
    const at = (y * width + x) * 4
    for (let c = 0; c < 3; c++) out[c] = SRGB_TO_LINEAR[data[at + c] ?? 0] ?? 0
    return out
  }
}

/** a·p + b·q + c·r */
const blend = (p: Uv, q: Uv, r: Uv, a: number, b: number, c: number): Uv => [
  a * p[0] + b * q[0] + c * r[0],
  a * p[1] + b * q[1] + c * r[1],
]

/** The texture term per corner (3 floats each); all ones where there is nothing to sample. */
function textureTerm(
  prim: Primitive,
  corners: Uint32Array,
  mode: ColourMode,
  image: Raster | undefined,
): Float32Array {
  const out = new Float32Array(corners.length * 3).fill(1)
  const info = prim.getMaterial()?.getBaseColorTextureInfo()
  const uv = info && image && mode !== "material" ? prim.getAttribute(`TEXCOORD_${info.getTexCoord()}`) : null
  if (!info || !image || !uv) return out
  const texel = texelReader(image, info.getWrapS(), info.getWrapT())
  const uvOf = (corner: number): Uv => uv.getElement(corners[corner] ?? 0, [0, 0]) as Uv
  const rgb: Rgb3 = [0, 0, 0]
  if (prim.getMode() !== Primitive.Mode.TRIANGLES || corners.length % 3 !== 0) {
    for (let i = 0; i < corners.length; i++) out.set(texel(uvOf(i), rgb), i * 3)
    return out
  }
  const average = mode === "texture-average" || mode === "keep-texture"
  // Pulling a corner INSET of the way to the centroid weighs it 1 − 2·INSET/3 and the other two INSET/3.
  const own = 1 - (2 * INSET) / 3
  const other = INSET / 3
  for (let t = 0; t < corners.length; t += 3) {
    const p = uvOf(t)
    const q = uvOf(t + 1)
    const r = uvOf(t + 2)
    if (average) {
      const sum: Rgb3 = [0, 0, 0]
      for (const [a, b, c] of AVERAGE_POINTS) {
        texel(blend(p, q, r, a, b, c), rgb)
        for (let k = 0; k < 3; k++) sum[k as 0] += (rgb[k as 0] ?? 0) / AVERAGE_POINTS.length
      }
      for (let k = 0; k < 3; k++) out.set(sum, (t + k) * 3)
    } else {
      out.set(texel(blend(p, q, r, own, other, other), rgb), t * 3)
      out.set(texel(blend(p, q, r, other, own, other), rgb), (t + 1) * 3)
      out.set(texel(blend(p, q, r, other, other, own), rgb), (t + 2) * 3)
    }
  }
  return out
}

/**
 * Linear RGB per corner (3 floats each, in `cornerVertices` order). `image` is the decoded base-colour
 * texture; without it, or with `mode: "material"`, the texture term is 1.
 */
export function sampleVertexColours(prim: Primitive, mode: ColourMode, image?: Raster): Float32Array {
  const corners = cornerVertices(prim)
  const out = textureTerm(prim, corners, mode, image)
  const [fr = 1, fg = 1, fb = 1] = prim.getMaterial()?.getBaseColorFactor() ?? []
  const colour = prim.getAttribute("COLOR_0")
  const vc = [1, 1, 1, 1]
  for (let i = 0; i < corners.length; i++) {
    if (colour) colour.getElement(corners[i] ?? 0, vc)
    out[i * 3] = (out[i * 3] ?? 1) * fr * (vc[0] ?? 1)
    out[i * 3 + 1] = (out[i * 3 + 1] ?? 1) * fg * (vc[1] ?? 1)
    out[i * 3 + 2] = (out[i * 3 + 2] ?? 1) * fb * (vc[2] ?? 1)
  }
  return out
}

/** The `_SHADE` byte for "the swatch's own lightness" (normalized uint8, the AO stage multiplies it). */
export const SHADE_NEUTRAL = 128
/** OKLab lightness offset (±SHADE_RANGE) → `_SHADE` byte: 128 + 127 · shade / SHADE_RANGE, clamped. */
export const encodeShade = (shade: number): number =>
  Math.min(255, Math.max(0, Math.round(SHADE_NEUTRAL + (127 * shade) / SHADE_RANGE)))
/** `_SHADE` byte → OKLab lightness offset (the inverse of `encodeShade`, up to rounding). */
export const decodeShade = (byte: number): number => ((byte - SHADE_NEUTRAL) * SHADE_RANGE) / 127

/** Linear RGB of a swatch with a shade applied (OKLab lightness offset), clamped to [0, 1]. */
export function shadedRgb(swatch: Swatch, shade: number): Rgb3 {
  const [r, g, b] = oklabToLinear([swatch.lab[0] + shade, swatch.lab[1], swatch.lab[2]])
  const c = (x: number): number => Math.min(1, Math.max(0, x))
  return [c(r), c(g), c(b)]
}

export interface Bake {
  /** Palette id per entry. */
  swatch: Uint8Array
  /** `_SHADE` bytes: the OKLab lightness offset from the swatch, `encodeShade`d (128 = the swatch itself). */
  shade: Uint8Array
  /** The baked colour (swatch + shade), linear RGB, 3 floats per entry. */
  rgb: Float32Array
  /** Entries whose baked colour is more than MISS_THRESHOLD from the source. */
  misses: number
  /** The distinct source hexes behind those misses, sorted: the keys `colour.map` takes. */
  missed: string[]
}

const toByte = (linear: number): number => Math.round(linearToSrgb(Math.min(1, Math.max(0, linear))) * 255)

/**
 * Linear RGB (3 floats per entry) → swatch, shade and baked colour. Each source colour is rounded to its
 * sRGB hex first; `map` (source hex → swatch name) wins over the nearest swatch and never counts as a miss.
 */
export function bakePalette(rgb: Float32Array, palette: Palette, map: Record<string, string> = {}): Bake {
  if (palette.swatches.length > 256)
    throw new Error("bakePalette: _SWATCH is one byte, but the palette has more than 256 swatches")
  const pinned = new Map<string, Swatch>()
  for (const [hex, name] of Object.entries(map)) {
    const swatch = palette.swatches.find((s) => s.name === name)
    if (!swatch) throw new Error(`colour.map: "${hex}" names unknown swatch "${name}"`)
    pinned.set(hex.toLowerCase(), swatch)
  }
  const n = Math.floor(rgb.length / 3)
  const out: Bake = {
    swatch: new Uint8Array(n),
    shade: new Uint8Array(n),
    rgb: new Float32Array(n * 3),
    misses: 0,
    missed: [],
  }
  const seen = new Map<number, { id: number; shade: number; rgb: Rgb3; miss: boolean }>()
  const missed = new Set<string>()
  for (let i = 0; i < n; i++) {
    const key =
      (toByte(rgb[i * 3] ?? 0) << 16) | (toByte(rgb[i * 3 + 1] ?? 0) << 8) | toByte(rgb[i * 3 + 2] ?? 0)
    let hit = seen.get(key)
    if (!hit) {
      const lab: Lab = srgbToOklab([(key >> 16) / 255, ((key >> 8) & 255) / 255, (key & 255) / 255])
      const hex = `#${key.toString(16).padStart(6, "0")}`
      const mapped = pinned.get(hex)
      const swatch = mapped ?? nearestSwatch(lab, palette, BAKE_WEIGHTS).swatch
      const shade = shadeOf(lab, swatch)
      const baked: Lab = [swatch.lab[0] + shade, swatch.lab[1], swatch.lab[2]]
      const miss = !mapped && Math.sqrt(labDistance2(lab, baked)) > MISS_THRESHOLD
      if (miss) missed.add(hex)
      // COLOR_0 is built from the stored byte, so it says exactly what _SHADE says.
      const byte = encodeShade(shade)
      hit = { id: swatch.id, shade: byte, rgb: shadedRgb(swatch, decodeShade(byte)), miss }
      seen.set(key, hit)
    }
    out.swatch[i] = hit.id
    out.shade[i] = hit.shade
    out.rgb.set(hit.rgb, i * 3)
    if (hit.miss) out.misses++
  }
  out.missed = [...missed].sort()
  return out
}
