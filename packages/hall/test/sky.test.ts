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

describe("golden hour, blue hour, storms (design review #6)", () => {
  const warmth = (c: { r: number; b: number }) => c.r / Math.max(c.b, 1e-3)

  test("17:30–19:30 is golden hour: a warm, low sun, not night", () => {
    updateSky(sky, env(13), MOODS.keep)
    const noonWarmth = warmth(sky.sunColor)
    for (const hour of [17.5, 18, 18.5, 19, 19.25]) {
      updateSky(sky, env(hour), MOODS.keep)
      expect(sky.night).toBeLessThan(0.05)
      expect(sky.sunIntensity).toBeGreaterThan(0.3)
      expect(warmth(sky.sunColor)).toBeGreaterThan(noonWarmth * 1.25)
    }
  })

  test("then a blue hour (sun gone, not yet full night), then night", () => {
    updateSky(sky, env(20), MOODS.keep)
    expect(sky.sunIntensity).toBe(0)
    expect(sky.night).toBeGreaterThan(0.2)
    expect(sky.night).toBeLessThan(0.8)
    updateSky(sky, env(21), MOODS.keep)
    expect(sky.night).toBe(1)
  })

  test("a storm at 14:00: sun ~0.35×, saturation ~30% down, a cool grade", () => {
    updateSky(sky, env(14), MOODS.keep)
    const clear = { key: sky.keyIntensity, saturation: sky.saturation }
    updateSky(sky, env(14, "storm"), MOODS.keep)
    expect(sky.keyIntensity / clear.key).toBeGreaterThan(0.3)
    expect(sky.keyIntensity / clear.key).toBeLessThan(0.4)
    expect(sky.saturation / clear.saturation).toBeGreaterThan(0.65)
    expect(sky.saturation / clear.saturation).toBeLessThan(0.75)
    expect(sky.shadows.b).toBeGreaterThan(sky.shadows.r)
    expect(sky.highlights.b).toBeGreaterThan(sky.highlights.r)
    expect(sky.exposure).toBeLessThan(0.85)
  })

  test("night rain keeps a floor of moon and fill, so silhouettes read", () => {
    updateSky(sky, env(23), MOODS.keep)
    const clearMoon = sky.keyIntensity
    const clearFill = sky.hemiIntensity * brightness(sky.hemiSky)
    updateSky(sky, env(23, "rain"), MOODS.keep)
    expect(sky.keyIntensity).toBeGreaterThan(clearMoon * 0.5)
    expect(sky.hemiIntensity * brightness(sky.hemiSky)).toBeGreaterThan(clearFill * 0.75)
    expect(sky.exposure).toBeGreaterThan(1)
  })
})

describe("cloud shadows", () => {
  test("sparse on a clear day, thicker and faster as it clouds over, none at night", () => {
    updateSky(sky, env(13), MOODS.keep)
    const clear = { coverage: sky.cloudCoverage, speed: sky.cloudSpeed, shadow: sky.cloudShadow }
    expect(clear.shadow).toBeGreaterThan(0.2)
    expect(clear.coverage).toBeLessThan(0.3)
    updateSky(sky, { ...env(13, "cloudy"), wind: 0.35 }, MOODS.keep)
    expect(sky.cloudCoverage).toBeGreaterThan(clear.coverage + 0.2)
    expect(sky.cloudSpeed).toBeGreaterThan(clear.speed)
    updateSky(sky, { ...env(13, "storm"), cloudCover: 1, wind: 0.9 }, MOODS.keep)
    expect(sky.cloudCoverage).toBeGreaterThan(0.7)
    expect(sky.cloudSpeed).toBeGreaterThan(5)
    updateSky(sky, env(23, "cloudy"), MOODS.keep)
    expect(sky.cloudShadow).toBe(0)
  })
})

describe("mist, sun shafts and ink (visual upgrades V1, V4)", () => {
  test("mist is a morning thing: thick at dawn, gone at noon, thinner at dusk", () => {
    updateSky(sky, env(6), MOODS.keep)
    const dawn = sky.mist
    updateSky(sky, env(13), MOODS.keep)
    expect(sky.mist).toBeLessThan(0.02)
    updateSky(sky, env(18.75), MOODS.keep)
    const dusk = sky.mist
    expect(dawn).toBeGreaterThan(0.25)
    expect(dusk).toBeGreaterThan(0)
    expect(dusk).toBeLessThan(dawn * 0.6)
  })

  test("damp, cold, still air thickens it; wind blows it off; rain raises a taller murk", () => {
    updateSky(sky, env(6), MOODS.keep)
    const clear = { mist: sky.mist, top: sky.mistTop }
    updateSky(sky, { ...env(6), temperature: 3 }, MOODS.keep)
    expect(sky.mist).toBeGreaterThan(clear.mist)
    updateSky(sky, { ...env(6), wind: 0.95 }, MOODS.keep)
    expect(sky.mist).toBeLessThan(clear.mist)
    updateSky(sky, env(14), MOODS.keep)
    const dry = { mist: sky.mist, top: sky.mistTop }
    updateSky(sky, env(14, "rain"), MOODS.keep)
    expect(sky.mist).toBeGreaterThan(dry.mist + 0.08)
    expect(sky.mistTop).toBeGreaterThan(Math.max(dry.top, clear.top) + 0.5)
  })

  test("sun shafts only at golden hour with the sun out, warm", () => {
    updateSky(sky, env(13), MOODS.keep)
    expect(sky.shafts).toBe(0)
    updateSky(sky, env(17.75), MOODS.keep)
    expect(sky.shafts).toBeGreaterThan(0.5)
    expect(sky.shaftColor.r).toBeGreaterThan(sky.shaftColor.b)
    updateSky(sky, env(17.75, "storm"), MOODS.keep)
    expect(sky.shafts).toBeLessThan(0.1)
    updateSky(sky, env(23), MOODS.keep)
    expect(sky.shafts).toBe(0)
  })

  test("ink is lighter at night (dark on dark) but never gone, so silhouettes still read", () => {
    updateSky(sky, env(13), MOODS.keep)
    const day = sky.ink
    updateSky(sky, env(23), MOODS.keep)
    expect(sky.ink).toBeLessThan(day)
    expect(sky.ink).toBeGreaterThan(day * 0.5)
  })

  test("the LUT's time weights follow the sky: golden at 18:00, storm in a storm", () => {
    updateSky(sky, env(18), MOODS.keep)
    expect(sky.golden).toBeGreaterThan(0.8)
    expect(sky.storm).toBe(0)
    updateSky(sky, env(14, "storm"), MOODS.keep)
    expect(sky.storm).toBeGreaterThan(0.9)
    expect(sky.golden).toBe(0)
  })
})
