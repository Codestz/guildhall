import { describe, expect, test } from "bun:test"
import { cloudNoise, deckFocus, deckGapFade, deckHeight } from "../src/atmosphere/deck.ts"
import {
  cloudField,
  focusWeight,
  presence,
  swell,
  VIEW_REACH,
  viewFade,
  wrap,
} from "../src/atmosphere/field.ts"
import { horizonBand } from "../src/atmosphere/horizon.ts"
import { trueSun } from "../src/atmosphere/index.ts"
import { cloudLook } from "../src/atmosphere/look.ts"
import { lightAt } from "../src/light.ts"

const FIELD = { seed: 1, count: 60, span: 400, height: [60, 95] as [number, number] }

describe("cloudField", () => {
  test("is the same sky for the same seed", () => {
    expect(cloudField(FIELD)).toEqual(cloudField(FIELD))
  })

  test("spreads clouds over the square: x and z are not tied together (FNV trailing-salt regression)", () => {
    const clouds = cloudField(FIELD)
    const near = clouds.filter((c) => Math.abs(c.x - c.z) < 40).length
    // Independent x and z land within 40 m of the diagonal about 10% of the time; the bug put all of them there.
    expect(near).toBeLessThan(clouds.length * 0.25)
    for (const c of clouds) {
      expect(Math.abs(c.x)).toBeLessThanOrEqual(FIELD.span)
      expect(Math.abs(c.z)).toBeLessThanOrEqual(FIELD.span)
      expect(c.base).toBeGreaterThanOrEqual(60)
      expect(c.base).toBeLessThanOrEqual(95)
    }
  })

  test("thresholds are stratified, so each coverage step adds about as many clouds", () => {
    const clouds = cloudField(FIELD)
    const out = (coverage: number) => clouds.filter((c) => c.threshold < coverage).length
    expect(out(0.25)).toBeGreaterThan(10)
    expect(out(0.25)).toBeLessThan(20)
    expect(out(0.75)).toBeGreaterThan(40)
  })

  test("every cloud has several puffs of different sizes, one of them the full size", () => {
    for (const c of cloudField(FIELD)) {
      expect(c.puffs.length).toBeGreaterThanOrEqual(5)
      expect(Math.max(...c.puffs.map((p) => p.r))).toBe(1)
      expect(new Set(c.puffs.map((p) => p.r.toFixed(2))).size).toBeGreaterThan(2)
    }
  })
})

describe("field maths", () => {
  test("wrap folds any drift into [-span, span)", () => {
    expect(wrap(0, 100)).toBe(0)
    expect(wrap(150, 100)).toBe(-50)
    expect(wrap(-150, 100)).toBe(50)
    expect(wrap(100, 100)).toBe(-100)
  })

  test("a cloud is absent below its threshold and fully out a little above it", () => {
    expect(presence(0.5, 0.4)).toBe(0)
    expect(presence(0.5, 0.65)).toBe(1)
    expect(presence(0.5, 0.52)).toBeGreaterThan(0)
  })

  test("overcast clouds are bigger than fair-weather ones", () => {
    expect(swell(1)).toBeGreaterThan(swell(0))
  })

  test("the hero view is kept clear: no cloud near the eye or over the target", () => {
    const d = 264
    expect(viewFade(0.3 * d, 2 * d, d)).toBe(0)
    expect(viewFade(2 * d, 0.1 * d, d)).toBe(0)
    expect(viewFade(2 * d, 2 * d, d)).toBe(1)
  })

  test("a wide view keeps the clouds over the island and in front of it", () => {
    const d = 680
    expect(focusWeight(d)).toBe(0)
    expect(viewFade(1.2 * VIEW_REACH, 0, d)).toBe(1)
  })
})

describe("cloudLook", () => {
  test("by day the clouds are near white and cast shadows", () => {
    const look = cloudLook(lightAt(12), 0.4)
    expect(Math.min(look.lit.r, look.lit.g, look.lit.b)).toBeGreaterThan(0.9)
    expect(look.shadow).toBeGreaterThan(0.4)
  })

  test("at golden hour they are warm: more red than blue", () => {
    const { lit } = cloudLook(lightAt(17.5), 0.4)
    expect(lit.r).toBeGreaterThan(lit.b)
  })

  test("at night they cast no shadow and are dark and blue", () => {
    const look = cloudLook(lightAt(23), 0.4)
    expect(look.shadow).toBe(0)
    expect(look.lit.b).toBeGreaterThan(look.lit.r)
    expect(look.lit.b).toBeLessThan(0.5)
  })

  test("overcast greys them and darkens their shadows", () => {
    const fair = cloudLook(lightAt(12), 0.2)
    const grey = cloudLook(lightAt(12), 1)
    expect(grey.lit.r).toBeLessThan(fair.lit.r)
    expect(grey.shadow).toBeGreaterThan(fair.shadow)
  })
})

test("trueSun points where the sun really is, below the shadow clamp at dusk", () => {
  const dusk = lightAt(19.5)
  const sun = trueSun(dusk)
  expect(sun.length()).toBeCloseTo(1, 6)
  expect(sun.y).toBeLessThan(0)
  expect(dusk.sunDir[1]).toBeGreaterThan(0)
})

describe("the horizon", () => {
  const base = { sea: 1900, offset: 300, focus: 380, far: 2000, span: 184, haze: 1 }

  test("starts past what the camera looks at and is whole before the sea's rim and the far plane", () => {
    const band = horizonBand(base)
    expect(band.max).toBe(1)
    expect(band.start).toBeGreaterThan(base.focus)
    expect(band.whole).toBeGreaterThan(band.start)
    expect(band.whole).toBeLessThan(base.sea - base.offset)
    expect(band.whole).toBeLessThan(base.far)
  })

  test("an eye at the edge of free flight still sees the haze whole before the rim", () => {
    const offset = 184 * 1.6 * Math.SQRT2
    const band = horizonBand({ ...base, offset, focus: 1200 })
    expect(band.whole).toBeLessThan(base.sea - offset)
    expect(band.start).toBeLessThan(band.whole)
  })

  test("thicker haze closes in; none leaves only the far plane's fade", () => {
    expect(horizonBand({ ...base, haze: 2 }).whole).toBeLessThan(horizonBand(base).whole)
    expect(horizonBand({ ...base, haze: 0 }).max).toBe(0)
  })
})

describe("the cloud deck", () => {
  test("stands over the tallest building, and halfway up to the farthest eye", () => {
    expect(deckHeight(240, 40)).toBe(120)
    expect(deckHeight(100, 40)).toBe(80)
  })

  test("is gone level with the eye and whole well above or below it", () => {
    expect(deckGapFade(0)).toBe(0)
    expect(deckGapFade(-5)).toBe(0)
    expect(deckGapFade(100)).toBe(1)
    expect(deckGapFade(-100)).toBe(1)
  })

  test("its clear patch sits where the line of sight crosses it", () => {
    expect(deckFocus([0, 200, 0], [100, 0, 0], 100)).toEqual([50, 0])
    expect(deckFocus([0, 50, 0], [100, 0, 0], 100)).toBeNull()
  })

  test("the noise tiles: its opposite edges meet, and it spans most of 0..255", () => {
    const size = 64
    const n = cloudNoise(size, 3)
    let lo = 255
    let hi = 0
    for (let y = 0; y < size; y++) {
      const left = n[4 * (y * size)] as number
      const right = n[4 * (y * size + size - 1)] as number
      expect(Math.abs(left - right)).toBeLessThan(40)
      for (let x = 0; x < size; x++) {
        lo = Math.min(lo, n[4 * (y * size + x)] as number)
        hi = Math.max(hi, n[4 * (y * size + x)] as number)
      }
    }
    expect(hi - lo).toBeGreaterThan(150)
  })
})
