/**
 * Palette variants (ADR 008): vertex colours recomputed from `_SWATCH`, `_SHADE` and `_AO` with some
 * swatches swapped, so a re-tinted piece is a baked geometry variant, not a material change.
 */
import { oklabToLinear, SHADE_RANGE } from "./colour.ts"
import type { Palette } from "./palette.ts"
import { TONES } from "./palette.ts"

/** The `_SHADE` byte that means "the swatch's own lightness" (the import's encoding, ADR 003). */
const SHADE_NEUTRAL = 128

/** `_SHADE` byte → OKLab lightness offset; the inverse of the import's encoder. */
export const decodeShade = (byte: number): number => ((byte - SHADE_NEUTRAL) * SHADE_RANGE) / 127

/**
 * Linear RGB, 3 floats per vertex: `palette[map(swatch)]` with its lightness moved by the decoded
 * shade and clamped to [0, 1], then times the `_AO` byte / 255 — the import's formula, so with the
 * piece's `_AO` the identity map gives back its baked COLOR_0. Without `ao` every vertex is unoccluded
 * (characters have no AO). Swatch ids the map does not name are kept.
 */
export function tintColours(
  swatch: Uint8Array,
  shade: Uint8Array,
  p: Palette,
  map?: Record<number, number>,
  ao?: Uint8Array,
): Float32Array {
  if (shade.length !== swatch.length)
    throw new Error(`tintColours: ${swatch.length} swatches but ${shade.length} shades`)
  if (ao && ao.length !== swatch.length)
    throw new Error(`tintColours: ${swatch.length} swatches but ${ao.length} AO values`)
  const out = new Float32Array(swatch.length * 3)
  const clamp = (x: number): number => Math.min(1, Math.max(0, x))
  for (let v = 0; v < swatch.length; v++) {
    const from = swatch[v] as number
    const id = map?.[from] ?? from
    const s = p.swatches[id]
    if (!s) throw new Error(`tintColours: swatch ${id} is not in the palette`)
    const [r, g, b] = oklabToLinear([s.lab[0] + decodeShade(shade[v] as number), s.lab[1], s.lab[2]])
    const occlusion = ao ? (ao[v] as number) / 255 : 1
    out[v * 3] = clamp(r) * occlusion
    out[v * 3 + 1] = clamp(g) * occlusion
    out[v * 3 + 2] = clamp(b) * occlusion
  }
  return out
}

/**
 * Ramp → ramp (tone for tone) as swatch id → swatch id. Identity pairs are left out, so equal looks
 * give equal maps. Throws on a ramp the palette does not have.
 */
export function rampMapToSwatchMap(p: Palette, rampMap: Record<string, string>): Record<number, number> {
  const ramp = (name: string) => {
    const found = p.ramps.find((r) => r.name === name)
    if (!found) throw new Error(`rampMapToSwatchMap: unknown ramp "${name}"`)
    return found
  }
  const out: Record<number, number> = {}
  for (const [from, to] of Object.entries(rampMap)) {
    const a = ramp(from)
    const b = ramp(to)
    for (const tone of TONES) if (a.tones[tone] !== b.tones[tone]) out[a.tones[tone]] = b.tones[tone]
  }
  return out
}
