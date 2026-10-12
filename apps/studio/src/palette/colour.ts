/**
 * The palette screen's maths, pure: an edited palette (one hex per swatch id) → the linear colour every
 * (`_SWATCH`, `_SHADE`) pair stands for, with a biome's ramp swaps applied (ADR 003).
 *
 * A vertex is drawn the way the re-tint shader will draw it: its swatch's OKLab colour with the
 * lightness moved by the `_SHADE` byte decoded as the colour stage encodes it (128 = the swatch itself,
 * ±127 = ±SHADE_RANGE), then times the vertex's baked `_AO` (byte / 255), so AO survives the recolour.
 */
import {
  hexToSrgb,
  oklabToLinear,
  type Palette,
  type PaletteJson,
  SHADE_RANGE,
  srgbToOklab,
} from "@guildhall/assets"

/** The `_SHADE` byte for "the swatch's own lightness" (tools/import's colour stage writes the same). */
export const SHADE_NEUTRAL = 128
/** Shades per swatch: one per `_SHADE` byte. */
const SHADES = 256

/** `_SHADE` byte → OKLab lightness offset, the inverse of the colour stage's encode. */
export const decodeShade = (byte: number): number => ((byte - SHADE_NEUTRAL) * SHADE_RANGE) / 127

const HEX = /^#[0-9a-f]{6}$/

/** "#RGB", "rgb", "#RRGGBB" in any case → "#rrggbb"; null when it is not a colour. */
export function normalizeHex(text: string): string | null {
  let t = text.trim().toLowerCase()
  if (!t.startsWith("#")) t = `#${t}`
  if (/^#[0-9a-f]{3}$/.test(t)) t = `#${[...t.slice(1)].map((c) => c + c).join("")}`
  return HEX.test(t) ? t : null
}

/**
 * Swatch id → the id a biome draws it with: a swatch in a swapped ramp takes the same tone of the
 * replacement ramp. Unknown biomes (and "temperate", which swaps nothing) are the identity.
 */
export function biomeIds(palette: Palette, biome: string): number[] {
  const swaps = palette.biomes[biome] ?? {}
  const ramps = new Map(palette.ramps.map((r) => [r.name, r]))
  return palette.swatches.map((s) => {
    const to = swaps[s.ramp]
    return to ? (ramps.get(to)?.tones[s.tone] ?? s.id) : s.id
  })
}

/**
 * Linear RGB for every (swatch id, shade byte): `out[(id · 256 + byte) · 3 …]`. `hexes` is the edited
 * palette, one per id; `ids` maps each id to the id it is drawn as (`biomeIds`).
 */
export function shadeTable(hexes: readonly string[], ids: readonly number[]): Float32Array {
  const out = new Float32Array(hexes.length * SHADES * 3)
  const clamp = (c: number): number => Math.min(1, Math.max(0, c))
  for (let id = 0; id < hexes.length; id++) {
    const [L, a, b] = srgbToOklab(hexToSrgb(hexes[ids[id] ?? id] ?? "#000000"))
    for (let byte = 0; byte < SHADES; byte++) {
      const [r, g, bl] = oklabToLinear([L + decodeShade(byte), a, b])
      out.set([clamp(r), clamp(g), clamp(bl)], (id * SHADES + byte) * 3)
    }
  }
  return out
}

/** The `_AO` byte for "unoccluded" (what a piece without `_AO`, a character, is drawn with). */
export const AO_OPEN = 255

/**
 * The colour a vertex is drawn with, written into `out` (3 floats) from a `shadeTable`: the table's
 * colour for (swatch, shade) times `ao` / 255.
 */
export function vertexColour(
  table: Float32Array,
  swatch: number,
  shade: number,
  out: number[],
  ao = AO_OPEN,
): number[] {
  const at = (swatch * SHADES + Math.min(SHADES - 1, Math.max(0, Math.round(shade)))) * 3
  const occlusion = ao / AO_OPEN
  out[0] = (table[at] ?? 0) * occlusion
  out[1] = (table[at + 1] ?? 0) * occlusion
  out[2] = (table[at + 2] ?? 0) * occlusion
  return out
}

/** The palette as `palette.json` spells it, with `hexes` in place of its own (Export). */
export function exportJson(palette: Palette, hexes: readonly string[]): string {
  const json: PaletteJson = {
    version: palette.version,
    status: palette.status,
    groups: [...palette.groups],
    swatches: palette.swatches.map((s) => ({
      id: s.id,
      name: s.name,
      hex: hexes[s.id] ?? s.hex,
      group: s.group,
      ramp: s.ramp,
      tone: s.tone,
    })),
    biomes: Object.fromEntries(Object.entries(palette.biomes).map(([b, swaps]) => [b, { ...swaps }])),
  }
  return `${JSON.stringify(json, null, 2)}\n`
}
