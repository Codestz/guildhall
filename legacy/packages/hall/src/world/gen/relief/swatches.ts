/**
 * The hex pack's palette (hexagons_medieval.png, 1024², an 8 × 4 grid of vertical gradients), as the
 * kit's own pieces use it: every KayKit tile is UV-mapped onto one of these swatches, so a generated
 * face that points at the same u, v is pixel-identical in material and joins the lands batch.
 * Measured from the shipped `lands.glb` (glTF v counts down from the top: light at the small end):
 *
 *   grass   column 0, row 2: yellow-olive. `hex_grass` top is v 0.643, its column side 0.701
 *   rock    column 2, row 2: grey. The `mountain_*` bands run v 0.58 (light) – 0.725 (dark)
 *   dark    column 3, row 0: dark stone
 *   snow    column 1, row 0: white to pale blue-grey
 *   path    columns 3–4, row 2: sand. The `hex_road_*` track is v 0.59–0.62
 */
export interface Swatch {
  /** The column's centre (clear of its neighbours at any mip). */
  u: number
  /** The gradient's light end and its dark end. */
  light: number
  dark: number
}

export const SWATCH = {
  grass: { u: 0.052, light: 0.615, dark: 0.705 },
  rock: { u: 0.31, light: 0.585, dark: 0.72 },
  dark: { u: 0.44, light: 0.06, dark: 0.19 },
  snow: { u: 0.19, light: 0.04, dark: 0.17 },
  /** Bright meadow green to deep green (column 4, row 1): the lower flanks. */
  meadow: { u: 0.56, light: 0.28, dark: 0.48 },
  /** Emerald to dark teal (column 1, row 2): the shaded, wooded flanks. */
  conifer: { u: 0.19, light: 0.53, dark: 0.73 },
  /** Light blue-grey stone (column 2, row 0): sunlit rock. */
  slate: { u: 0.31, light: 0.02, dark: 0.2 },
  /** Warm grey-brown (column 6, row 1): weathered rock and scree. */
  warm: { u: 0.81, light: 0.28, dark: 0.48 },
  path: { u: 0.43, light: 0.59, dark: 0.62 },
} as const satisfies Record<string, Swatch>

/** The swatch's v, `t` 0 at its light end to 1 at its dark end. */
export const swatchV = (swatch: Swatch, t: number): number =>
  swatch.light + (swatch.dark - swatch.light) * Math.min(1, Math.max(0, t))
