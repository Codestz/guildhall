import { describe, expect, test } from "bun:test"
import { type Environment, skyOf } from "../src/guild/environment.ts"
import { DESATURATE_STEPS, packExposure, unpackExposure } from "../src/scene/atmosphere/lowGrade.ts"
import { createSky, updateSky } from "../src/scene/atmosphere/sky.ts"
import { MOODS } from "../src/world/moods.ts"

function env(hour: number, weather: Environment["weather"]): Environment {
  return {
    ...skyOf(hour),
    weather,
    cloudCover: weather === "clear" ? 0.15 : 0.9,
    precipitation: weather === "storm" ? 1 : 0,
    wind: 0.25,
    lightningAt: -1,
    temperature: 18,
    health: 1,
    activity: 0,
  }
}

describe("the Low tier's grade, packed into the tone mapping exposure", () => {
  test("exposure and desaturation survive the round trip (to 1/64)", () => {
    for (const exposure of [0.7, 0.85, 1, 1.25, 1.35])
      for (const desaturate of [0, 0.1, 0.27, 0.5]) {
        const [e, d] = unpackExposure(packExposure(exposure, desaturate))
        expect(e).toBeCloseTo(exposure, 5)
        expect(Math.abs(d - desaturate)).toBeLessThanOrEqual(0.5 / DESATURATE_STEPS + 1e-9)
      }
  })

  test("no desaturation packs to the plain exposure (Neutral, as before)", () => {
    expect(packExposure(1.1, 0)).toBe(1.1)
    expect(packExposure(1.1, -0.2)).toBe(1.1)
  })

  test("Low greys a storm as the grade does, and leaves a clear noon alone", () => {
    const sky = createSky()
    updateSky(sky, env(14, "storm"), MOODS.keep)
    const [, storm] = unpackExposure(packExposure(sky.exposure, 1 - sky.saturation))
    updateSky(sky, env(12, "clear"), MOODS.keep)
    const [, clear] = unpackExposure(packExposure(sky.exposure, 1 - sky.saturation))
    expect(storm).toBeGreaterThan(0.2)
    expect(clear).toBe(0)
  })
})
