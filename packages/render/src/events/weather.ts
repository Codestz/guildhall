/**
 * CI as weather, as numbers (pure): how far the sky has gone toward cloud and toward storm, and what
 * that does to the light. Clear is today's sky exactly (every multiplier 1, nothing added), so a drive
 * left at clear changes no pixel; cloudy greys and thickens the deck; a storm (CI red) closes it,
 * darkens the light, rains and throws lightning. The hour's own light is never moved: weather scales
 * and greys what the clock gives (`weathered`), the clock stays the clock's.
 */
import { Color } from "three"
import type { DayLight } from "../light.ts"
import { clamp01, lerp, smoothstep } from "./ease.ts"

/** The three skies (sim `weatherOf`: a failed run is a storm, one queued or running clouds, else clear). */
export type WeatherKind = "clear" | "cloudy" | "storm"

export const WEATHER_KINDS: readonly WeatherKind[] = ["clear", "cloudy", "storm"]

/** Where the sky is between the three: `cloud` 0 clear … 1 overcast, `storm` 0 … 1 on top of it. */
export interface WeatherMix {
  cloud: number
  storm: number
}

export function mixOf(kind: WeatherKind): WeatherMix {
  return kind === "storm"
    ? { cloud: 1, storm: 1 }
    : kind === "cloudy"
      ? { cloud: 1, storm: 0 }
      : { cloud: 0, storm: 0 }
}

/** What a mix does to the sky: multipliers of today's light (1 = unchanged) and what it adds. */
export interface WeatherLook {
  /** The cloud deck's cover, 0 … 1 (`base` at clear). */
  coverage: number
  /** The wind the clouds drift on, m/s. */
  wind: number
  /** The sun (or moon) key light's strength, and how much of it a shadow takes. */
  sun: number
  shadow: number
  /** The sky's fill on the shade. */
  fill: number
  exposure: number
  /** How far the sky's colours go toward a cool slate (0 none … 1 all), and how dark that slate is. */
  grey: number
  slate: number
  /** The grade's saturation. */
  saturation: number
  /** The aerial haze's density. */
  haze: number
  /** The sun's disc, the moon's and the stars: how much of them shows through. */
  discs: number
  /** The clouds' own colour, darkened toward a storm's (1 = as the hour paints them). */
  cloudTone: number
  /** Lanterns and windows lit by day under a dark sky (0 … 1, a floor on the hour's own). */
  lamps: number
  /** Rain, 0 … 1. */
  rain: number
  /** Whether lightning strikes. */
  lightning: boolean
}

/** Today's deck cover (atmosphere DEFAULT_ATMOSPHERE.coverage) and wind (m/s). */
export const BASE_COVER = 0.45
export const BASE_WIND = 4

export function weatherLook(
  mix: WeatherMix,
  base: { coverage: number; wind: number } = { coverage: BASE_COVER, wind: BASE_WIND },
): WeatherLook {
  const c = clamp01(mix.cloud)
  const s = clamp01(mix.storm)
  // a cloudy step, then a storm on top of it
  const step = (clear: number, cloudy: number, storm: number) => lerp(lerp(clear, cloudy, c), storm, s)
  return {
    coverage: step(base.coverage, Math.max(base.coverage, 0.74), Math.max(base.coverage, 0.97)),
    wind: step(base.wind, base.wind * 1.6, base.wind * 2.8),
    sun: step(1, 0.72, 0.4),
    shadow: step(1, 0.78, 0.4),
    fill: step(1, 0.96, 0.9),
    exposure: step(1, 0.98, 0.95),
    grey: step(0, 0.38, 0.85),
    slate: step(1, 0.92, 0.75),
    saturation: step(1, 0.88, 0.55),
    haze: step(1, 1.15, 1.6),
    discs: step(1, 0.25, 0),
    cloudTone: step(1, 0.95, 0.7),
    lamps: step(0, 0, 0.6),
    rain: smoothstep(0.35, 1, s),
    lightning: s > 0.85,
  }
}

/** Whether a look is clear: nothing to change. */
export function isClear(
  look: WeatherLook,
  base: { coverage: number; wind: number } = { coverage: BASE_COVER, wind: BASE_WIND },
): boolean {
  return (
    look.coverage === base.coverage &&
    look.sun === 1 &&
    look.grey === 0 &&
    look.exposure === 1 &&
    look.rain === 0 &&
    look.lamps === 0
  )
}

const COOL = new Color(0.86, 0.92, 1.0)

/** A colour gone `grey` of the way to a cool slate of its own brightness times `slate`. */
export function slateOf(colour: Color, grey: number, slate: number, out = new Color()): Color {
  const y = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b
  const target = COOL.clone().multiplyScalar(y * slate)
  return out.copy(colour).lerp(target, grey)
}

/**
 * The hour's light under the weather: the same hour (sun and moon where they are), the key dimmed,
 * the sky's colours greyed, the exposure lowered, the lamps lit early. Pure; a clear look returns
 * `light` itself.
 */
export function weathered(light: DayLight, look: WeatherLook): DayLight {
  if (look.sun === 1 && look.grey === 0 && look.exposure === 1 && look.lamps === 0 && look.fill === 1)
    return light
  return {
    ...light,
    sunIntensity: light.sunIntensity * look.sun,
    moonIntensity: light.moonIntensity * look.sun,
    shadow: light.shadow * look.shadow,
    sun: slateOf(light.sun, look.grey * 0.6, 1),
    hemiSky: slateOf(light.hemiSky, look.grey, look.slate),
    hemiGround: slateOf(light.hemiGround, look.grey * 0.5, 1),
    hemiIntensity: light.hemiIntensity * look.fill,
    zenith: slateOf(light.zenith, look.grey, look.slate),
    horizon: slateOf(light.horizon, look.grey, look.slate),
    glow: slateOf(light.glow, look.grey, look.slate),
    exposure: light.exposure * look.exposure,
    golden: light.golden * (1 - look.grey),
    lamps: Math.max(light.lamps, look.lamps),
    fire: Math.max(light.fire, look.lamps),
  }
}
