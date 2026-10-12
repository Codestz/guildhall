import { describe, expect, test } from "bun:test"
import { bakeLut, createLook, gradeColour, lookFor, NEUTRAL } from "../src/post/lut.ts"
import { COMPOSITE_FRAGMENT } from "../src/post/shaders.ts"
import { shoreDistances } from "../src/shoreField.ts"

/** V1's post look ported (post/), and the shore field the V1 water reads (shoreField.ts). */

describe("the mood LUT (V1 lut.ts)", () => {
  test("the neutral look leaves every colour where it was", () => {
    for (const c of [
      [0, 0, 0],
      [1, 1, 1],
      [0.2, 0.5, 0.8],
      [0.9, 0.3, 0.1],
    ] as const) {
      const out = gradeColour(NEUTRAL, c[0], c[1], c[2])
      for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(c[i] as number, 5)
    }
  })

  test("a baked table is size³ RGBA, its corners black and white for the neutral look", () => {
    const table = bakeLut(NEUTRAL, 4)
    expect(table.length).toBe(4 * 4 * 4 * 4)
    expect([...table.slice(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...table.slice(-4)]).toEqual([255, 255, 255, 255])
  })

  test("golden hour firms the curve and warms the split; night adds a blue toe", () => {
    const day = lookFor(createLook(), "keep", { golden: 0, night: 0, storm: 0 })
    const curve = day.curve
    const split = day.split
    const golden = lookFor(createLook(), "keep", { golden: 1, night: 0, storm: 0 })
    expect(golden.curve).toBeGreaterThan(curve)
    expect(golden.split).toBeGreaterThan(split)
    const night = lookFor(createLook(), "keep", { golden: 0, night: 1, storm: 0 })
    expect(night.fade).toBeGreaterThan(day.fade)
    expect(night.fadeColour[2]).toBeGreaterThan(night.fadeColour[0])
  })

  test("the composite pass tone maps, looks up the LUT and grades, in that order", () => {
    const at = (s: string) => COMPOSITE_FRAGMENT.indexOf(s)
    expect(at("neutral(c * exposure)")).toBeGreaterThan(0)
    expect(at("texture(tLut")).toBeGreaterThan(at("neutral(c * exposure)"))
    expect(at("airGrade(toSrgb(c))")).toBeGreaterThan(at("texture(tLut"))
  })
})

describe("shoreDistances", () => {
  test("metres to the nearest land texel: 0 on land, growing out over the water", () => {
    // A 1 m texel field 20 m across with land west of x = 5.
    const d = shoreDistances({ min: [0, 0], size: 20, res: 20, isLand: (x) => x < 5 })
    const at = (i: number, j: number) => d[j * 20 + i] as number
    expect(at(2, 10)).toBe(0)
    expect(at(4, 10)).toBe(0)
    expect(at(5, 10)).toBeCloseTo(1, 6)
    expect(at(12, 3)).toBeCloseTo(8, 6)
  })

  test("it is Euclidean, not grid steps: a lone land texel's ring is round", () => {
    const d = shoreDistances({
      min: [0, 0],
      size: 21,
      res: 21,
      isLand: (x, z) => x > 10 && x < 11 && z > 10 && z < 11,
    })
    const at = (i: number, j: number) => d[j * 21 + i] as number
    expect(at(10, 10)).toBe(0)
    expect(at(13, 14)).toBeCloseTo(5, 6)
    expect(at(10, 2)).toBeCloseTo(8, 6)
  })

  test("with no land at all every texel is far", () => {
    const d = shoreDistances({ min: [0, 0], size: 8, res: 8, isLand: () => false })
    for (const v of d) expect(v).toBeGreaterThan(1e3)
  })
})
