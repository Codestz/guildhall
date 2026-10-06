import { describe, expect, test } from "bun:test"
import { type Environment, skyOf } from "../src/guild/environment.ts"
import { createSky, updateSky } from "../src/scene/atmosphere/sky.ts"
import { MOODS } from "../src/world/moods.ts"

function env(hour: number, weather: Environment["weather"] = "clear"): Environment {
  const cloudy = weather === "clear" ? 0.15 : weather === "cloudy" ? 0.6 : 0.9
  return {
    ...skyOf(hour),
    weather,
    cloudCover: cloudy,
    precipitation: weather === "storm" ? 1 : weather === "rain" ? 0.6 : 0,
    wind: 0.25,
    lightningAt: -1,
    temperature: 18,
    health: 1,
    activity: 0,
  }
}

const sky = createSky()
const brightness = (c: { r: number; g: number; b: number }) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722

describe("sky over the day", () => {
  test("noon is bright day, midnight is night, in every mood", () => {
    for (const mood of Object.values(MOODS)) {
      updateSky(sky, env(12), mood)
      const noonKey = sky.keyIntensity
      const noonFill = sky.hemiIntensity * brightness(sky.hemiSky)
      expect(sky.night).toBe(0)
      updateSky(sky, env(0), mood)
      expect(sky.night).toBe(1)
      expect(sky.keyIntensity).toBeLessThan(noonKey * 0.3)
      expect(sky.hemiIntensity * brightness(sky.hemiSky)).toBeLessThan(noonFill * 0.4)
      expect(sky.lamps).toBe(1)
    }
  })

  test("no popping: every level changes smoothly through a full day", () => {
    const step = 1 / 120 // 30 s of day
    const keys = [
      "keyIntensity",
      "hemiIntensity",
      "fogNear",
      "lamps",
      "stars",
      "saturation",
      "exposure",
    ] as const
    const last = new Map<string, number>()
    for (let hour = 0; hour <= 24; hour += step) {
      updateSky(sky, env(hour), MOODS.keep)
      const values: Record<string, number> = {
        ...Object.fromEntries(keys.map((key) => [key, sky[key]])),
        fog: brightness(sky.fog),
        zenith: brightness(sky.zenith),
        key: brightness(sky.keyColor) * sky.keyIntensity,
      }
      for (const [name, value] of Object.entries(values)) {
        const before = last.get(name)
        if (before !== undefined) expect(Math.abs(value - before)).toBeLessThan(0.08)
        last.set(name, value)
      }
    }
  })

  test("clouds dim the sun and grey the sky", () => {
    updateSky(sky, env(12), MOODS.keep)
    const clearKey = sky.keyIntensity
    const clearSaturation = sky.saturation
    updateSky(sky, env(12, "storm"), MOODS.keep)
    expect(sky.keyIntensity).toBeLessThan(clearKey * 0.5)
    expect(sky.saturation).toBeLessThan(clearSaturation)
    expect(sky.fogNear).toBeLessThan(1)
  })

  test("a lightning flash brightens the fill", () => {
    updateSky(sky, env(13, "storm"), MOODS.keep, 0)
    const calm = sky.hemiIntensity
    updateSky(sky, env(13, "storm"), MOODS.keep, 1)
    expect(sky.hemiIntensity).toBeGreaterThan(calm + 1)
  })
})
