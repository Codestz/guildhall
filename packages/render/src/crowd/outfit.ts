/**
 * Outfits on the GPU: a crowd body's vertices keep their palette bytes (`_swatch`, `_shade`) and the
 * shader tints them per person, so ten body geometries serve every outfit. Two small textures:
 *   - the tint table: swatch × shade → the colour `tintColours` gives (exactly what `recolour` writes
 *     into a hero's COLOR_0: the same bytes), and
 *   - the outfits: one row per person, swatch → the swatch it wears instead (its `rampMap`).
 */
import { PALETTE, type Palette, rampMapToSwatchMap, tintColours } from "@guildhall/assets"
import { DataTexture, NearestFilter, NoColorSpace, RedFormat, RGBAFormat, UnsignedByteType } from "three"

/** Columns of the outfit table: every swatch id fits. */
export const OUTFIT_WIDTH = 256

function pixels(texture: DataTexture): DataTexture {
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  texture.needsUpdate = true
  return texture
}

/** Linear rgb bytes, 256 shades a row, one row per swatch of `palette`. */
export function tintTable(palette: Palette = PALETTE): DataTexture {
  const rows = palette.swatches.length
  const data = new Uint8Array(256 * rows * 4)
  const shades = Uint8Array.from({ length: 256 }, (_, i) => i)
  for (let s = 0; s < rows; s++) {
    const rgb = tintColours(new Uint8Array(256).fill(s), shades, palette)
    for (let h = 0; h < 256; h++) {
      const at = (s * 256 + h) * 4
      data[at] = Math.round((rgb[h * 3] as number) * 255)
      data[at + 1] = Math.round((rgb[h * 3 + 1] as number) * 255)
      data[at + 2] = Math.round((rgb[h * 3 + 2] as number) * 255)
      data[at + 3] = 255
    }
  }
  return pixels(new DataTexture(data, 256, rows, RGBAFormat, UnsignedByteType))
}

/** One row per outfit: swatch → worn swatch (identity where the outfit leaves it). */
export function outfitTable(rampMaps: readonly Record<string, string>[], palette: Palette = PALETTE): DataTexture {
  const rows = Math.max(1, rampMaps.length)
  const data = new Uint8Array(OUTFIT_WIDTH * rows)
  for (let r = 0; r < rows; r++) {
    const map = rampMapToSwatchMap(palette, rampMaps[r] ?? {})
    for (let s = 0; s < OUTFIT_WIDTH; s++) data[r * OUTFIT_WIDTH + s] = map[s] ?? s
  }
  return pixels(new DataTexture(data, OUTFIT_WIDTH, rows, RedFormat, UnsignedByteType))
}
