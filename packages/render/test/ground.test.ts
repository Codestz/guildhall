import { describe, expect, test } from "bun:test"
import { GOLDEN_HOUR, lightAt } from "../src/light.ts"

/** The ground's and the water's geometry is world's (packages/world/test/ground.test.ts); render uploads it. */

describe("lightAt", () => {
  test("golden hour is a low warm sun, about 24° up (plan §5)", () => {
    const light = lightAt(GOLDEN_HOUR)
    expect(light.elevation).toBeGreaterThan(20)
    expect(light.elevation).toBeLessThan(28)
    expect(light.sun.r).toBeGreaterThan(light.sun.b)
    expect(light.golden).toBeGreaterThan(0.5)
  })

  test("the sun is down at 20:00 and up at 10:00", () => {
    expect(lightAt(20).sunIntensity).toBe(0)
    expect(lightAt(10).elevation).toBeGreaterThan(40)
    expect(lightAt(34).hour).toBe(10)
  })
})
