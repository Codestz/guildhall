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

  test("hypot is the root of the sum of squares", () => {
    expect(DMath.hypot(3, 4)).toBe(5)
    expect(DMath.hypot(-6, 8)).toBe(10)
  })
})
