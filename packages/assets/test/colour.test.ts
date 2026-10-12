import { describe, expect, test } from "bun:test"
import {
  hexToSrgb,
  type Lab,
  labDistance2,
  nearestSwatch,
  oklabToSrgb,
  type Rgb,
  SHADE_RANGE,
  shadeOf,
  srgbToOklab,
} from "../src/colour.ts"
import data from "../src/palette.json"
import { loadPalette, type PaletteJson } from "../src/palette.ts"

const palette = loadPalette(data)
const byName = (name: string) => palette.swatches.find((s) => s.name === name)!

describe("srgbToOklab", () => {
  test("matches Ottosson's reference values", () => {
    const white = srgbToOklab([1, 1, 1])
    expect(white[0]).toBeCloseTo(1, 4)
    expect(white[1]).toBeCloseTo(0, 4)
    expect(white[2]).toBeCloseTo(0, 4)
    const red = srgbToOklab([1, 0, 0])
    expect(red[0]).toBeCloseTo(0.62796, 4)
    expect(red[1]).toBeCloseTo(0.22486, 4)
    expect(red[2]).toBeCloseTo(0.12585, 4)
    expect(srgbToOklab([0, 0, 0])).toEqual([0, 0, 0])
  })

  test("greys have no chroma", () => {
    const [, a, b] = srgbToOklab([0.5, 0.5, 0.5])
    expect(Math.abs(a)).toBeLessThan(1e-6)
    expect(Math.abs(b)).toBeLessThan(1e-6)
  })
})

describe("oklabToSrgb", () => {
  test("round-trips every byte colour on a 16-step grid to under half a byte", () => {
    let worst = 0
    for (let r = 0; r <= 255; r += 17)
      for (let g = 0; g <= 255; g += 17)
        for (let b = 0; b <= 255; b += 17) {
          const rgb: Rgb = [r / 255, g / 255, b / 255]
          const back = oklabToSrgb(srgbToOklab(rgb))
          for (let i = 0; i < 3; i++)
            worst = Math.max(worst, Math.abs((back[i] as number) - (rgb[i] as number)))
        }
    expect(worst * 255).toBeLessThan(0.5)
  })

  test("clamps an out-of-gamut colour into [0, 1]", () => {
    const rgb = oklabToSrgb([0.7, 0.4, 0.4])
    for (const c of rgb) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    }
  })
})

describe("hexToSrgb", () => {
  test("parses #rrggbb", () => {
    expect(hexToSrgb("#ff8000")).toEqual([1, 128 / 255, 0])
  })
})

describe("nearestSwatch", () => {
  test("every swatch's own colour finds itself at distance 0", () => {
    for (const s of palette.swatches) {
      const hit = nearestSwatch(s.lab, palette)
      expect(hit.swatch.id).toBe(s.id)
      expect(hit.distance).toBe(0)
    }
  })

  test("a slightly-off known colour lands on its swatch", () => {
    expect(nearestSwatch(srgbToOklab(hexToSrgb("#6c9b44")), palette).swatch.name).toBe("grass")
    expect(nearestSwatch(srgbToOklab(hexToSrgb("#b4583a")), palette).swatch.name).toBe("terracotta")
    expect(nearestSwatch(srgbToOklab(hexToSrgb("#2d5d88")), palette).swatch.name).toBe("water-deep")
  })

  test("pure white goes to the lightest snow, pure black to the darkest timber", () => {
    expect(nearestSwatch(srgbToOklab([1, 1, 1]), palette).swatch.name).toBe("snow-light")
    expect(nearestSwatch(srgbToOklab([0, 0, 0]), palette).swatch.name).toBe("timber-dark")
  })

  test("on an exact tie the lower id wins", () => {
    const twins = structuredClone(data) as PaletteJson
    twins.swatches[5]!.hex = twins.swatches[2]!.hex
    const p = loadPalette(twins)
    expect(nearestSwatch(p.swatches[2]!.lab, p).swatch.id).toBe(2)
  })

  test("a heavy chroma weight keeps a saturated brown off a grey of nearly its lightness", () => {
    const grey: Lab = [0.6, 0, 0]
    const brown: Lab = [0.45, 0.04, 0.06]
    const sample: Lab = [0.58, 0.035, 0.05]
    const flat = { l: 1, chroma: 1, hue: 1 }
    const chromaHeavy = { l: 1, chroma: 40, hue: 1 }
    expect(labDistance2(sample, grey, flat)).toBeLessThan(labDistance2(sample, brown, flat))
    expect(labDistance2(sample, grey, chromaHeavy)).toBeGreaterThan(labDistance2(sample, brown, chromaHeavy))
  })

  test("weights change the pick on the real palette", () => {
    const muted = srgbToOklab(hexToSrgb("#8a7a6a"))
    const flat = nearestSwatch(muted, palette).swatch
    const lightnessOnly = nearestSwatch(muted, palette, { l: 1, chroma: 0, hue: 0 }).swatch
    expect(Math.abs(lightnessOnly.lab[0] - muted[0])).toBeLessThanOrEqual(Math.abs(flat.lab[0] - muted[0]))
  })
})

describe("shadeOf", () => {
  const grass = byName("grass")

  test("is the OKLab lightness offset from the swatch", () => {
    expect(shadeOf(grass.lab, grass)).toBe(0)
    expect(shadeOf([grass.lab[0] - 0.05, grass.lab[1], grass.lab[2]], grass)).toBeCloseTo(-0.05, 12)
  })

  test("clamps to ±SHADE_RANGE", () => {
    expect(shadeOf([1, 0, 0], grass)).toBe(SHADE_RANGE)
    expect(shadeOf([0, 0, 0], grass)).toBe(-SHADE_RANGE)
  })
})
