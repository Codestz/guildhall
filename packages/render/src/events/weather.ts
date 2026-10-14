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

/**
 * The skies. The guild's CI only ever makes three (sim `weatherOf`: a failed run is a storm, one
 * queued or running clouds, else clear); `rain` (a steady rain, no thunder) and `snow` are the viewer's,
 * pinned in Settings.
 */
export type WeatherKind = "clear" | "cloudy" | "rain" | "storm" | "snow"

export const WEATHER_KINDS: readonly WeatherKind[] = ["clear", "cloudy", "rain", "storm", "snow"]

/**
 * Where the sky is between them: `cloud` 0 clear … 1 overcast, `storm` 0 … 1 on top of it; `rain` and
 * `snow` (0 when absent) are the quieter rain's and the snow's sky; `frost` is the white dusting on the
 * ground and roofs, which follows the snow far more slowly than the sky does (`FROST_EASE_S`).
 */
export interface WeatherMix {
  cloud: number
  storm: number
  rain?: number
  snow?: number
  frost?: number
}

export function mixOf(kind: WeatherKind): WeatherMix {
  switch (kind) {
    case "storm":
      return { cloud: 1, storm: 1, rain: 0, snow: 0, frost: 0 }
    case "rain":
      return { cloud: 1, storm: 0, rain: 1, snow: 0, frost: 0 }
    case "snow":
      return { cloud: 1, storm: 0, rain: 0, snow: 1, frost: 1 }
    case "cloudy":
      return { cloud: 1, storm: 0, rain: 0, snow: 0, frost: 0 }
    default:
      return { cloud: 0, storm: 0, rain: 0, snow: 0, frost: 0 }
  }
}

/** Seconds the snow takes to settle on the ground and to melt off it. */
export const FROST_EASE_S = 20

/**
 * What a Settings pick (or a link) means: the kind it pins, null for Auto (follow the guild's CI) or
 * anything unknown.
 */
export function pinOf(pick: string | null | undefined): WeatherKind | null {
  return pick !== null && pick !== undefined && (WEATHER_KINDS as readonly string[]).includes(pick)
    ? (pick as WeatherKind)
    : null
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
  /**
   * Lanterns and windows lit by day under a dark sky (0 … 1, a floor on the hour's own). Off unless
   * asked (`weatherLook(…, { lamps: true })`): by day it shows the night's lamp pools, two more draws.
   */
  lamps: number
  /** The flames' own glow under a dark sky (a floor on the hour's): no draws of its own. */
  fire: number
  /** Rain, 0 … 1. */
  rain: number
  /** Snow falling, 0 … 1. */
  snow: number
  /** The ground wet (a subtle darkening), 0 … 1. */
  wet: number
  /** The white dusting on the ground and roofs, 0 … 1. */
  frost: number
  /** Whether lightning strikes. */
  lightning: boolean
}

/** Today's deck cover (atmosphere DEFAULT_ATMOSPHERE.coverage) and wind (m/s). */
export const BASE_COVER = 0.45
export const BASE_WIND = 4

export function weatherLook(
  mix: WeatherMix,
  base: { coverage: number; wind: number } = { coverage: BASE_COVER, wind: BASE_WIND },
  opts: { lamps?: boolean } = {},
): WeatherLook {
  return lookOf(mix, base, opts.lamps === true)
}

function lookOf(mix: WeatherMix, base: { coverage: number; wind: number }, lamps: boolean): WeatherLook {
  const c = clamp01(mix.cloud)
  const s = clamp01(mix.storm)
  const r = clamp01(mix.rain ?? 0)
  const n = clamp01(mix.snow ?? 0)
  // a cloudy step, then the rain's or the snow's sky, then a storm on top of it
  const step = (clear: number, cloudy: number, storm: number, rainy = cloudy, snowy = cloudy) =>
    lerp(lerp(lerp(lerp(clear, cloudy, c), rainy, r), snowy, n), storm, s)
  return {
    coverage: step(
      base.coverage,
      Math.max(base.coverage, 0.74),
      Math.max(base.coverage, 0.97),
      Math.max(base.coverage, 0.9),
      Math.max(base.coverage, 0.85),
    ),
    wind: step(base.wind, base.wind * 1.6, base.wind * 2.8, base.wind * 1.8, base.wind * 0.8),
    sun: step(1, 0.72, 0.4, 0.64, 0.78),
    shadow: step(1, 0.78, 0.4, 0.5, 0.6),
    fill: step(1, 0.96, 0.9, 1.04, 1.08),
    exposure: step(1, 0.98, 0.95, 1.05, 1.06),
    grey: step(0, 0.38, 0.85, 0.55, 0.5),
    slate: step(1, 0.92, 0.75, 0.92, 1),
    saturation: step(1, 0.88, 0.55, 0.78, 0.66),
    haze: step(1, 1.15, 1.6, 1.35, 1.5),
    discs: step(1, 0.25, 0, 0.05, 0.05),
    cloudTone: step(1, 0.95, 0.7, 0.85, 1),
    lamps: lamps ? step(0, 0, 0.6) : 0,
    fire: step(0, 0.1, 0.5, 0.2, 0.2),
    rain: Math.max(smoothstep(0.35, 1, s), 0.75 * smoothstep(0.35, 1, r)),
    snow: smoothstep(0.35, 1, n),
    wet: Math.max(smoothstep(0.2, 1, s), 0.6 * smoothstep(0.2, 1, r)),
    frost: clamp01(mix.frost ?? 0),
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
    look.snow === 0 &&
    look.wet === 0 &&
    look.frost === 0 &&
    look.lamps === 0 &&
    look.fire === 0
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
  if (
    look.sun === 1 &&
    look.grey === 0 &&
    look.exposure === 1 &&
    look.lamps === 0 &&
    look.fire === 0 &&
    look.fill === 1
  )
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
    fire: Math.max(light.fire, look.fire),
  }
}
