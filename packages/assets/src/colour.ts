/**
 * Colour maths for the palette bake (ADR 003): sRGB ↔ OKLab, nearest swatch, shade offset.
 * Powers go through DMath so the same source colour bakes to the same swatch on every machine.
 */
import { DMath } from "@guildhall/core"
import type { Palette, Swatch } from "./palette.ts"

/** Three channels in [0, 1]. */
export type Rgb = readonly [r: number, g: number, b: number]
/** OKLab: L in [0, 1], a and b roughly in [-0.4, 0.4]. */
export type Lab = readonly [L: number, a: number, b: number]

/** |shade| never exceeds this (OKLab lightness), ADR 003. */
export const SHADE_RANGE = 0.2

/** sRGB-encoded channel → linear. */
export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : DMath.pow((c + 0.055) / 1.055, 2.4)

/** Linear channel → sRGB-encoded. */
export const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * DMath.pow(c, 1 / 2.4) - 0.055

const cbrt = (x: number): number => (x === 0 ? 0 : x < 0 ? -DMath.pow(-x, 1 / 3) : DMath.pow(x, 1 / 3))
const cube = (x: number): number => x * x * x

/** "#rrggbb" → sRGB in [0, 1]. */
export function hexToSrgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Linear sRGB → OKLab (Björn Ottosson's matrices). */
export function linearToOklab([r, g, b]: Rgb): Lab {
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab → linear sRGB (unclamped: out-of-gamut colours fall outside [0, 1]). */
export function oklabToLinear([L, a, b]: Lab): Rgb {
  const l = cube(L + 0.3963377774 * a + 0.2158037573 * b)
  const m = cube(L - 0.1055613458 * a - 0.0638541728 * b)
  const s = cube(L - 0.0894841775 * a - 1.291485548 * b)
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** sRGB-encoded → OKLab. */
export const srgbToOklab = (rgb: Rgb): Lab =>
  linearToOklab([srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])])

/** OKLab → sRGB-encoded, clamped to [0, 1]. */
export function oklabToSrgb(lab: Lab): Rgb {
  const [r, g, b] = oklabToLinear(lab)
  const enc = (c: number): number => linearToSrgb(Math.min(1, Math.max(0, c)))
  return [enc(r), enc(g), enc(b)]
}

/**
 * Per-term weights of the OKLab distance, split into lightness, chroma and hue. Raising `chroma` stops
 * a desaturated brown from landing on a grey (plan R9); all ones is plain Euclidean OKLab.
 */
export interface ColourWeights {
  l: number
  chroma: number
  hue: number
}

export const EUCLIDEAN: ColourWeights = { l: 1, chroma: 1, hue: 1 }

/** Squared weighted distance: ΔL², ΔC² and ΔH² (= Δa² + Δb² − ΔC²) each scaled by its weight. */
export function labDistance2(p: Lab, q: Lab, w: ColourWeights = EUCLIDEAN): number {
  const dL = p[0] - q[0]
  const da = p[1] - q[1]
  const db = p[2] - q[2]
  const dC = Math.sqrt(p[1] * p[1] + p[2] * p[2]) - Math.sqrt(q[1] * q[1] + q[2] * q[2])
  const dH2 = Math.max(0, da * da + db * db - dC * dC)
  return w.l * dL * dL + w.chroma * dC * dC + w.hue * dH2
}

/** The closest swatch and its distance (not squared). On an exact tie the lower id wins. */
export function nearestSwatch(
  lab: Lab,
  palette: Palette,
  weights: ColourWeights = EUCLIDEAN,
): { swatch: Swatch; distance: number } {
  let best: Swatch | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const swatch of palette.swatches) {
    const d = labDistance2(lab, swatch.lab, weights)
    if (d < bestD) {
      best = swatch
      bestD = d
    }
  }
  if (!best) throw new Error("nearestSwatch: the palette has no swatches")
  return { swatch: best, distance: Math.sqrt(bestD) }
}

/** The lightness offset of `lab` from the swatch, clamped to ±SHADE_RANGE (what `_SHADE` encodes). */
export function shadeOf(lab: Lab, swatch: Swatch): number {
  return Math.min(SHADE_RANGE, Math.max(-SHADE_RANGE, lab[0] - swatch.lab[0]))
}
