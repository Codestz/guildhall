/**
 * The colour stage's miss maths over extracted colours: each source hex goes through `bakePalette`
 * (nearest swatch under BAKE_WEIGHTS, shade clamped to ±0.2, then the plain-OKLab ΔE test against
 * MISS_THRESHOLD), and a missed hex counts its whole area.
 */
import {
  hexToSrgb,
  labDistance2,
  linearToOklab,
  type Palette,
  srgbToLinear,
  srgbToOklab,
} from "@guildhall/assets"
import { bakePalette } from "@guildhall/import/src/sample.ts"
import type { Colours } from "./extract.ts"

export interface MissReport {
  /** m² of all colours. */
  area: number
  /** m² of the colours that miss. */
  missed: number
  /** missed / area, 0 for no area. */
  rate: number
  /** Area-weighted mean OKLab ΔE between each source colour and what it bakes to (misses or not). */
  drift: number
  /** The missed hexes, heaviest first. */
  hexes: { hex: string; area: number }[]
}

export function missReport(colours: Colours, palette: Palette): MissReport {
  const hexes = [...colours.keys()]
  const rgb = new Float32Array(hexes.length * 3)
  for (const [i, hex] of hexes.entries()) rgb.set(hexToSrgb(hex).map(srgbToLinear), i * 3)
  const bake = bakePalette(rgb, palette)
  const missed = new Set(bake.missed)
  let area = 0
  let missArea = 0
  let drift = 0
  const out: { hex: string; area: number }[] = []
  for (const [i, hex] of hexes.entries()) {
    const a = colours.get(hex) ?? 0
    area += a
    const baked = linearToOklab([bake.rgb[i * 3] ?? 0, bake.rgb[i * 3 + 1] ?? 0, bake.rgb[i * 3 + 2] ?? 0])
    drift += a * Math.sqrt(labDistance2(srgbToOklab(hexToSrgb(hex)), baked))
    if (!missed.has(hex)) continue
    missArea += a
    out.push({ hex, area: a })
  }
  out.sort((x, y) => y.area - x.area || (x.hex < y.hex ? -1 : 1))
  return {
    area,
    missed: missArea,
    rate: area > 0 ? missArea / area : 0,
    drift: area > 0 ? drift / area : 0,
    hexes: out,
  }
}
