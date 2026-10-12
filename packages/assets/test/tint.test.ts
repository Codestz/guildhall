import { describe, expect, test } from "bun:test"
import { linearToSrgb, oklabToLinear, SHADE_RANGE } from "../src/colour.ts"
import data from "../src/palette.json"
import { loadPalette } from "../src/palette.ts"
import { decodeShade, rampMapToSwatchMap, tintColours } from "../src/tint.ts"

const palette = loadPalette(data)

/**
 * The import's colour stage, restated (tools/import/src/sample.ts): `_SHADE` = 128 + 127·shade/0.2,
 * COLOR_0 = the swatch's OKLab with that shade, linear, clamped, then stored as normalized uint8.
 */
const encodeShade = (shade: number): number =>
  Math.min(255, Math.max(0, Math.round(128 + (127 * shade) / SHADE_RANGE)))
function bake(swatches: number[], shades: number[]) {
  const shade = Uint8Array.from(shades, encodeShade)
  const colour = new Uint8Array(swatches.length * 3)
  swatches.forEach((id, v) => {
    const lab = palette.swatches[id]!.lab
    const rgb = oklabToLinear([lab[0] + decodeShade(shade[v]!), lab[1], lab[2]])
    rgb.forEach((c, k) => {
      colour[v * 3 + k] = Math.round(Math.min(1, Math.max(0, c)) * 255)
    })
  })
  return { swatch: Uint8Array.from(swatches), shade, colour }
}

/** A fixture: every swatch at five shades, including both clamp ends. */
const SHADES = [-0.25, -0.1, 0, 0.07, 0.2]
const ids = palette.swatches.flatMap((s) => SHADES.map(() => s.id))
const fixture = bake(
  ids,
  ids.map((_, i) => SHADES[i % SHADES.length]!),
)

describe("tintColours", () => {
  test("the identity map reproduces the baked COLOR_0 within 1/255", () => {
    const out = tintColours(fixture.swatch, fixture.shade, palette)
    expect(out.length).toBe(fixture.colour.length)
    let worst = 0
    out.forEach((c, i) => {
      worst = Math.max(worst, Math.abs(c - fixture.colour[i]! / 255))
    })
    expect(worst).toBeLessThanOrEqual(1 / 255)
  })

  test("an empty map is the identity", () => {
    expect(tintColours(fixture.swatch, fixture.shade, palette, {})).toEqual(
      tintColours(fixture.swatch, fixture.shade, palette),
    )
  })

  test("a neutral shade gives exactly the swatch colour", () => {
    const [r, g, b] = tintColours(Uint8Array.of(1), Uint8Array.of(128), palette)
    const srgb = palette.swatches[1]!.srgb
    expect(linearToSrgb(r!)).toBeCloseTo(srgb[0], 6)
    expect(linearToSrgb(g!)).toBeCloseTo(srgb[1], 6)
    expect(linearToSrgb(b!)).toBeCloseTo(srgb[2], 6)
  })

  test("a swatch map swaps only the mapped swatches, keeping each vertex's shade", () => {
    const swatch = Uint8Array.of(1, 2, 1)
    const shade = Uint8Array.of(100, 128, 160)
    const out = tintColours(swatch, shade, palette, { 1: 4 })
    const expected = tintColours(Uint8Array.of(4, 2, 4), shade, palette)
    expect(out).toEqual(expected)
    expect(out.slice(0, 3)).not.toEqual(tintColours(swatch, shade, palette).slice(0, 3))
  })

  test("clamps to [0, 1] and handles no vertices", () => {
    const light = palette.swatches.reduce((a, b) => (b.lab[0] > a.lab[0] ? b : a))
    const out = tintColours(Uint8Array.of(light.id), Uint8Array.of(255), palette)
    for (const c of out) expect(c).toBeLessThanOrEqual(1)
    expect(tintColours(new Uint8Array(0), new Uint8Array(0), palette).length).toBe(0)
  })

  test("throws on mismatched lengths and on a swatch outside the palette", () => {
    expect(() => tintColours(Uint8Array.of(1, 2), Uint8Array.of(128), palette)).toThrow("1 shades")
    expect(() => tintColours(Uint8Array.of(250), Uint8Array.of(128), palette)).toThrow("swatch 250")
    expect(() => tintColours(Uint8Array.of(1), Uint8Array.of(128), palette, { 1: 250 })).toThrow("swatch 250")
  })
})

describe("decodeShade", () => {
  test("inverts the import's encoding within one byte step", () => {
    for (const s of [-0.2, -0.05, 0, 0.13, 0.2])
      expect(Math.abs(decodeShade(encodeShade(s)) - s)).toBeLessThanOrEqual(SHADE_RANGE / 127 / 2 + 1e-12)
    expect(decodeShade(128)).toBe(0)
  })
})

describe("rampMapToSwatchMap", () => {
  const [a, b] = [palette.ramps[0]!, palette.ramps[1]!]

  test("maps a ramp onto another tone for tone", () => {
    expect(rampMapToSwatchMap(palette, { [a.name]: b.name })).toEqual({
      [a.tones.dark]: b.tones.dark,
      [a.tones.base]: b.tones.base,
      [a.tones.light]: b.tones.light,
    })
  })

  test("combines several ramps and leaves identity pairs out", () => {
    const c = palette.ramps[2]!
    const map = rampMapToSwatchMap(palette, { [a.name]: a.name, [c.name]: b.name })
    expect(map).toEqual(rampMapToSwatchMap(palette, { [c.name]: b.name }))
    expect(rampMapToSwatchMap(palette, {})).toEqual({})
  })

  test("feeds tintColours: a re-tinted ramp vertex takes the target ramp's same tone", () => {
    const map = rampMapToSwatchMap(palette, { [a.name]: b.name })
    const out = tintColours(Uint8Array.of(a.tones.light), Uint8Array.of(128), palette, map)
    expect(out).toEqual(tintColours(Uint8Array.of(b.tones.light), Uint8Array.of(128), palette))
  })

  test("throws on a ramp the palette does not have", () => {
    expect(() => rampMapToSwatchMap(palette, { [a.name]: "no-such-ramp" })).toThrow('"no-such-ramp"')
    expect(() => rampMapToSwatchMap(palette, { nope: a.name })).toThrow('"nope"')
  })
})
