import { describe, expect, test } from "bun:test"
import { DMath } from "../src/world/dmath.ts"
import { rng } from "../src/world/gen/hex.ts"

/** world/dmath.ts: the generators' maths, to libm's accuracy and the same bits everywhere. */

const random = rng(7)
const angles = Array.from({ length: 4000 }, () => (random() - 0.5) * 80)
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 2e-15 * Math.max(1, Math.abs(b))

describe("dmath", () => {
  test("sin, cos and tan agree with libm to 1e-15 over many turns", () => {
    for (const x of angles) {
      expect(near(DMath.sin(x), Math.sin(x))).toBe(true)
      expect(near(DMath.cos(x), Math.cos(x))).toBe(true)
      expect(near(DMath.tan(x), Math.tan(x))).toBe(true)
    }
  })

  test("atan2 agrees with libm in every quadrant and on the axes", () => {
    const axes = [0, -0, 1, -1, 3, -2.5]
    for (const y of axes) for (const x of axes) expect(near(DMath.atan2(y, x), Math.atan2(y, x))).toBe(true)
    angles.forEach((y, i) => {
      const x = angles[(i * 3 + 1) % angles.length] as number
      expect(near(DMath.atan2(y, x), Math.atan2(y, x))).toBe(true)
    })
  })

  test("atan agrees with libm, and reaches the pole", () => {
    for (const x of angles) expect(near(DMath.atan(x), Math.atan(x))).toBe(true)
    expect(DMath.atan(Number.POSITIVE_INFINITY)).toBeCloseTo(Math.PI / 2, 15)
  })

  test("log2 is exact on powers of two and agrees with libm elsewhere", () => {
    for (let n = -20; n <= 40; n++) expect(DMath.log2(2 ** n)).toBe(n)
    for (const x of angles) {
      const y = Math.abs(x) + 0.001
      expect(near(DMath.log2(y), Math.log2(y))).toBe(true)
    }
    expect(DMath.log2(0)).toBe(Number.NEGATIVE_INFINITY)
  })

  test("hypot is the root of the sum of squares, of any number of terms", () => {
    expect(DMath.hypot(3, 4)).toBe(5)
    expect(DMath.hypot(-6, 8)).toBe(10)
    expect(DMath.hypot(-7)).toBe(7)
    expect(DMath.hypot(2, 3, 6)).toBe(7)
  })

  test("exp and ln agree with libm to 1e-15 and reach the ends", () => {
    for (const x of angles.map((a) => a / 4)) expect(near(DMath.exp(x), Math.exp(x))).toBe(true)
    for (const x of angles.map((a) => Math.abs(a) + 0.01)) expect(near(DMath.ln(x), Math.log(x))).toBe(true)
    expect(DMath.exp(0)).toBe(1)
    expect(DMath.exp(800)).toBe(Number.POSITIVE_INFINITY)
    expect(DMath.exp(-800)).toBe(0)
  })

  test("pow is exact for whole exponents and agrees with libm to 1e-13 for fractional ones", () => {
    expect(DMath.pow(2, 10)).toBe(1024)
    expect(DMath.pow(-3, 3)).toBe(-27)
    expect(DMath.pow(2.5, -3)).toBe(0.064)
    expect(DMath.pow(9, 0)).toBe(1)
    expect(DMath.pow(0, 0.5)).toBe(0)
    expect(DMath.pow(-8, 0.5)).toBeNaN()
    for (const a of angles) {
      const base = Math.abs(a) + 0.01
      const exponent = (a % 3) + 0.37
      expect(Math.abs(DMath.pow(base, exponent) / base ** exponent - 1)).toBeLessThan(1e-13)
    }
  })

  // The generators' hot spots, pinned to the bit: a platform whose libm rounds differently cannot
  // reach these (they use only + − × ÷ and sqrt), so CI on macOS arm64 and Linux x64 both land here.
  test("the values the relief draws from come out to the same bits everywhere", () => {
    expect(DMath.sin(0.7)).toBe(0.644217687237691)
    expect(DMath.cos(2.1)).toBe(-0.5048461045998576)
    expect(DMath.tan(1.1)).toBe(1.9647596572486525)
    expect(DMath.atan(0.37)).toBe(0.35437991912343775)
    expect(DMath.atan2(-1.3, 0.6)).toBe(-1.1383885512243588)
    expect(DMath.hypot(3.3, 4.1, 1.7)).toBe(5.5308227236099325)
    expect(DMath.log2(10)).toBe(3.321928094887362)
    expect(DMath.exp(1.9)).toBe(6.685894442279269)
    expect(DMath.pow(7.25, 1.9)).toBe(43.11637221889266)
    expect(DMath.pow(0.6, 0.8)).toBe(0.664539805948974)
    expect(DMath.pow(0.35, 5)).toBe(0.005252187499999998)
  })
})
