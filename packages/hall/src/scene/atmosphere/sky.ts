import { Color } from "three"
import type { Environment } from "../../guild/environment.ts"
import type { Mood } from "../../world/moods.ts"

/**
 * The sky as numbers (ADR 0007, task "Sky"): one pure step from `environment` (sun height, cloud
 * cover, rain) and the mood to every colour and level the atmosphere draws with — dome, fog,
 * sun and moon, ambient fill, lamp glow, colour grade. Written in place into one `SkyState` once a
 * frame (no allocations); the lights, the dome, the lamps and the post-processing all read it, so
 * they can never disagree about the hour.
 *
 * Time of day is keyed by the sun's elevation, not the clock, so dawn and dusk look alike and a
 * weather layer that moves the sun would still be right. A mood grades on top: it tints the light
 * and the image, it never fixes an absolute level, so any mood at midnight is still night.
 */
export interface SkyState {
  /** Dome: straight up, at the horizon, below it (= the fog), and the glow round the sun. */
  zenith: Color
  horizon: Color
  fog: Color
  glow: Color
  /** Sun and moon light (colour × intensity); the key light is whichever of the two is up. */
  sunColor: Color
  sunIntensity: number
  moonColor: Color
  moonIntensity: number
  /** The one shadow-casting light: unit direction towards it, colour, intensity, shadow strength. */
  keyDirection: [number, number, number]
  keyColor: Color
  keyIntensity: number
  keyShadow: number
  /** Hemisphere fill. */
  hemiSky: Color
  hemiGround: Color
  hemiIntensity: number
  /** Fog as fractions of the sea's radius from the island's centre: starts, fully hidden. */
  fogNear: number
  fogFar: number
  /** 0 by day, 1 in deep night. */
  night: number
  /** How visible the stars, the sun disc and the moon disc are (0–1). */
  stars: number
  sunDisc: number
  moonDisc: number
  /** Fires, torches and lanterns: a faint glow by day, full at night (0–1). */
  lamps: number
  /** Lightning flash, 0–1 (decays; see flash.ts). */
  flash: number
  /** Colour grade: exposure, saturation, contrast, and the split-tone multipliers. */
  exposure: number
  saturation: number
  /** Saturation of the darkest tones (lower at night, so moonlit ground goes grey-blue). */
  darkSaturation: number
  contrast: number
  shadows: Color
  highlights: Color
  bloomIntensity: number
  bloomThreshold: number
  vignette: number
  /**
   * Cloud shadows (drawn by the grade, GradeEffect.ts): how dark a patch under a cloud gets (0 =
   * none, by night), the share of the ground under one (0–1), how soft the edges are (in noise
   * units), and how fast they drift with the wind (world units per second).
   */
  cloudShadow: number
  cloudCoverage: number
  cloudSoftness: number
  cloudSpeed: number
}

export function createSky(): SkyState {
  return {
    zenith: new Color(),
    horizon: new Color(),
    fog: new Color(),
    glow: new Color(),
    sunColor: new Color(),
    sunIntensity: 0,
    moonColor: new Color().copy(MOON),
    moonIntensity: 0,
    keyDirection: [0, 1, 0],
    keyColor: new Color(),
    keyIntensity: 0,
    keyShadow: 1,
    hemiSky: new Color(),
    hemiGround: new Color(),
    hemiIntensity: 1,
    fogNear: 0.7,
    fogFar: 1.1,
    night: 0,
    stars: 0,
    sunDisc: 0,
    moonDisc: 0,
    lamps: 0,
    flash: 0,
    exposure: 1,
    saturation: 1,
    darkSaturation: 1,
    contrast: 1,
    shadows: new Color(1, 1, 1),
    highlights: new Color(1, 1, 1),
    bloomIntensity: 0.6,
    bloomThreshold: 1,
    vignette: 0.3,
    cloudShadow: 0,
    cloudCoverage: 0,
    cloudSoftness: 0.08,
    cloudSpeed: 0,
  }
}

/** One key of the day, at a sun elevation (the y of the unit vector towards the sun). */
interface Stop {
  at: number
  zenith: Color
  horizon: Color
  fog: Color
  glow: Color
  sun: Color
  sunIntensity: number
  hemiSky: Color
  hemiGround: Color
  hemiIntensity: number
}

function stop(
  at: number,
  colours: {
    zenith: string
    horizon: string
    fog: string
    glow: string
    sun: string
    sky: string
    ground: string
  },
  sunIntensity: number,
  hemiIntensity: number,
): Stop {
  return {
    at,
    zenith: new Color(colours.zenith),
    horizon: new Color(colours.horizon),
    fog: new Color(colours.fog),
    glow: new Color(colours.glow),
    sun: new Color(colours.sun),
    sunIntensity,
    hemiSky: new Color(colours.sky),
    hemiGround: new Color(colours.ground),
    hemiIntensity,
  }
}

/**
 * The light lags the sun: these keys run past the geometric sunset (e = 0, 18:00), so the evening
 * keeps a warm, low sun until ~19:30 (golden hour, e ≈ -0.35), then a blue hour to ~20:30, then
 * night (and the same backwards before dawn). Hours for reference: e 0.24 ≈ 17:00, 0.12 ≈ 17:30,
 * -0.12 ≈ 18:30, -0.24 ≈ 19:00, -0.35 ≈ 19:30, -0.46 ≈ 20:00, -0.56 ≈ 20:30, -0.91 = midnight.
 */
// biome-ignore format: a table reads better aligned
const DAY: readonly Stop[] = [
  stop(-0.75, { zenith: "#02050d", horizon: "#0a1428", fog: "#0b1424", glow: "#000000", sun: "#000000", sky: "#4060a0", ground: "#151c30" }, 0, 1.35),
  stop(-0.56, { zenith: "#040a1c", horizon: "#13213f", fog: "#111c33", glow: "#140f2a", sun: "#000000", sky: "#4560a4", ground: "#161c30" }, 0, 1.3),
  stop(-0.44, { zenith: "#0f2052", horizon: "#33467a", fog: "#26345c", glow: "#3c3264", sun: "#000000", sky: "#7088cc", ground: "#222842" }, 0, 1.4),
  stop(-0.32, { zenith: "#18306a", horizon: "#b06a66", fog: "#5e5470", glow: "#d8604a", sun: "#ff7848", sky: "#8a8cc4", ground: "#2c2838" }, 0.9, 1.05),
  stop(-0.14, { zenith: "#2a4c8c", horizon: "#f0986a", fog: "#b48c86", glow: "#ff8048", sun: "#ff9e5e", sky: "#a8a6d4", ground: "#3e3842" }, 1.9, 1.05),
  stop(0.04,  { zenith: "#3c6aae", horizon: "#f4bc8c", fog: "#d0b2a2", glow: "#ffa062", sun: "#ffbe86", sky: "#bcc2e6", ground: "#58545c" }, 2.4, 1.18),
  stop(0.2,   { zenith: "#4a80c6", horizon: "#e8d6c0", fog: "#cdc8c6", glow: "#ffc890", sun: "#ffe2c0", sky: "#d0dcf4", ground: "#6c6e6c" }, 2.8, 1.25),
  stop(0.36,  { zenith: "#4486d2", horizon: "#c4dcf0", fog: "#bfd3e4", glow: "#fff0d2", sun: "#fff0d8", sky: "#dcebff", ground: "#7a8072" }, 2.8, 1.18),
  stop(0.9,   { zenith: "#377ccf", horizon: "#cde2f6", fog: "#c6d9ea", glow: "#fff8ea", sun: "#fff8ee", sky: "#e3efff", ground: "#7c8aa0" }, 3.0, 1.22),
]

const MOON = new Color("#9fb6ff")
/** Overcast: what a cloud-covered sky's colours drift towards (scaled by their own brightness). */
const OVERCAST = new Color("#c3cad3")
const STORM_FLASH = new Color("#dfe6ff")
const NIGHT_SHADOWS = new Color(0.74, 0.9, 1.22)
/** Night highlights warm, shadows cool: firelight keeps its colour against blue moonlight. */
const NIGHT_HIGHLIGHTS = new Color(1.08, 1.0, 0.88)
/** Golden hour: warm light, violet-blue shade. */
const GOLDEN_SHADOWS = new Color(0.92, 0.94, 1.1)
const GOLDEN_HIGHLIGHTS = new Color(1.09, 0.97, 0.9)
/** Blue hour: the whole image cool, the lamps (highlights) barely warmer. */
const BLUE_SHADOWS = new Color(0.82, 0.92, 1.24)
const BLUE_HIGHLIGHTS = new Color(1.02, 0.98, 0.96)
/** A storm grades cool: steel shade, cold highlights. */
const STORM_SHADOWS = new Color(0.88, 0.96, 1.14)
const STORM_HIGHLIGHTS = new Color(0.94, 0.99, 1.06)
const SNOW_TINT = new Color(0.94, 0.98, 1.06)
const WHITE = new Color(1, 1, 1)

const scratch = new Color()
const tint = new Color()

/** Advance `out` to this moment. Pure apart from writing `out`; no allocations. */
export function updateSky(out: SkyState, env: Environment, mood: Mood, flash = 0): SkyState {
  const e = env.sun[1]
  const moonUp = env.moon[1]

  // 1. The day's keys, blended by sun elevation.
  let i = 0
  while (i < DAY.length - 2 && e > (DAY[i + 1] as Stop).at) i++
  const a = DAY[i] as Stop
  const b = DAY[i + 1] as Stop
  const t = clamp01((e - a.at) / (b.at - a.at))
  out.zenith.lerpColors(a.zenith, b.zenith, t)
  out.horizon.lerpColors(a.horizon, b.horizon, t)
  out.fog.lerpColors(a.fog, b.fog, t)
  out.glow.lerpColors(a.glow, b.glow, t)
  out.sunColor.lerpColors(a.sun, b.sun, t)
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t)
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t)
  // The low sun lingers through golden hour and is gone by ~19:35 (see DAY).
  let sun = lerp(a.sunIntensity, b.sunIntensity, t) * smoothstep(-0.38, -0.24, e)
  let hemi = lerp(a.hemiIntensity, b.hemiIntensity, t)

  /** Full night from ~20:30 to ~03:30; blue hour is the half-way band before it. */
  const night = 1 - smoothstep(-0.6, -0.3, e)
  /** Golden hour, ~17:15–19:30 (and its mirror at dawn). */
  const golden = smoothstep(-0.4, -0.26, e) * (1 - smoothstep(0.08, 0.3, e))
  /** Blue hour, ~19:30–20:30: the sun gone, the sky still lit. */
  const blue = smoothstep(-0.62, -0.46, e) * (1 - smoothstep(-0.38, -0.28, e))
  out.night = night

  // 2. Clouds: a grey, softer world; the sun dims, the sky's own light carries more of it. A storm
  // (heavy rain under full cover) goes further: sun ~0.35×, a darker, cooler, flatter island.
  const overcast = smoothstep(0.25, 0.95, env.cloudCover)
  const rain = clamp01(env.precipitation)
  const storm = overcast * smoothstep(0.75, 1, rain)
  /** By day rain dims the scene; by night it must not crush it (silhouettes still read). */
  const wetDim = rain * (1 - night * 0.7)
  greyTowards(out.zenith, overcast * 0.8)
  greyTowards(out.horizon, overcast * 0.8)
  greyTowards(out.fog, overcast * 0.8)
  greyTowards(out.glow, overcast * 0.8)
  greyTowards(out.hemiSky, overcast * 0.8)
  greyTowards(out.sunColor, overcast * 0.8)
  out.zenith.lerp(scratch.copy(out.horizon), overcast * 0.55)
  const dim = 1 - overcast * 0.4 - wetDim * 0.22 - storm * 0.12
  out.zenith.multiplyScalar(dim)
  out.horizon.multiplyScalar(dim)
  out.fog.multiplyScalar(dim)
  out.glow.multiplyScalar(1 - overcast * 0.85)
  sun *= (1 - overcast * 0.5) * (1 - storm * 0.3)
  hemi *= 1 - overcast * 0.15 - wetDim * 0.1 - storm * 0.12
  out.hemiSky.multiplyScalar(1 - storm * 0.15)
  if (env.weather === "snow") {
    out.fog.multiply(SNOW_TINT)
    out.horizon.multiply(SNOW_TINT)
  }

  // 3. The moon takes over once the sun has gone (both are dark at the hand-over: no pop). Cloud
  // thins it but never puts it out: a rainy night keeps enough moonlight for roofs and walls.
  const moon =
    0.85 * (1 - smoothstep(-0.5, -0.36, e)) * smoothstep(-0.02, 0.18, moonUp) * (1 - overcast * 0.45)
  out.sunIntensity = sun
  out.moonIntensity = moon

  // 4. The mood grades the light: tinted, scaled, never relit from scratch.
  normalisedTint(tint, mood.tint, mood.tintAmount)
  out.sunColor.multiply(tint)
  out.moonColor.copy(MOON).multiply(tint)
  out.hemiSky.multiply(tint)
  out.hemiGround.multiply(tint)
  normalisedTint(tint, mood.tint, mood.tintAmount * 0.5)
  out.zenith.multiply(tint)
  out.horizon.multiply(tint)
  out.fog.multiply(tint)

  const sunUp = sun >= moon
  const [kx, ky, kz] = sunUp ? env.sun : env.moon
  // Never let the shadow light graze the ground: very long shadows smear the one shadow map.
  const y = Math.max(ky, 0.42)
  const length = Math.hypot(kx, y, kz) || 1
  out.keyDirection[0] = kx / length
  out.keyDirection[1] = y / length
  out.keyDirection[2] = kz / length
  out.keyColor.copy(sunUp ? out.sunColor : out.moonColor)
  out.keyIntensity = (sunUp ? sun : moon) * mood.key
  out.keyShadow = (sunUp ? 1 : 0.9) * (1 - overcast * 0.6)

  // 5. Lightning: a cold, flat flash of the whole sky.
  out.flash = flash
  out.hemiIntensity = hemi * mood.ambient + flash * 2.6
  if (flash > 0) {
    out.hemiSky.lerp(STORM_FLASH, Math.min(1, flash))
    out.zenith.lerp(STORM_FLASH, flash * 0.45)
    out.horizon.lerp(STORM_FLASH, flash * 0.6)
    out.fog.lerp(STORM_FLASH, flash * 0.35)
  }

  // 6. Fog: the coast fades into the sky; closer in at dawn and dusk, and in the rain.
  const haze = Math.max(golden * 0.6, rain, overcast * 0.45)
  out.fogNear = 1.0 - haze * 0.42
  out.fogFar = 1.55 - haze * 0.4

  // 7. Sky dome details.
  out.stars = night * night * (1 - overcast * 0.95)
  out.sunDisc = smoothstep(-0.05, 0.01, e) * (1 - overcast * 0.95)
  out.moonDisc = smoothstep(-0.05, 0.1, moonUp) * (1 - overcast * 0.9) * (0.25 + 0.75 * night)

  // 8. Lamps are lit through golden hour and full by blue hour; and on dark grey days.
  out.lamps = Math.max(0.12, 1 - smoothstep(-0.4, 0.1, e), overcast * 0.45 + storm * 0.2)

  // 9. The grade: golden warmth at the ends of the day, blue and calm at night, flat and cool
  // under clouds and in a storm.
  out.exposure = (1 + night * 0.25 + blue * 0.06) * (1 - wetDim * 0.1 - overcast * 0.05 - storm * 0.1)
  out.saturation =
    (1.04 + golden * 0.03 - night * 0.1) * (1 - overcast * 0.22 - storm * 0.08) * mood.saturation
  // Night vision: what the moon lights goes blue-grey; what a fire lights keeps its colour.
  out.darkSaturation = out.saturation * (1 - night * 0.42)
  // Moonlight is crisp: more contrast at night, so lit edges read against the dark (less in rain,
  // where it would crush the wet dark into black).
  out.contrast = (1.03 + night * (0.14 - rain * 0.1) - overcast * 0.04) * mood.contrast
  const cool = Math.max(storm, overcast * 0.35) * (1 - night)
  out.shadows
    .copy(WHITE)
    .lerp(GOLDEN_SHADOWS, golden)
    .lerp(BLUE_SHADOWS, blue)
    .lerp(NIGHT_SHADOWS, night)
    .lerp(STORM_SHADOWS, cool)
  out.highlights
    .copy(WHITE)
    .lerp(GOLDEN_HIGHLIGHTS, golden)
    .lerp(BLUE_HIGHLIGHTS, blue)
    .lerp(NIGHT_HIGHLIGHTS, night)
    .lerp(STORM_HIGHLIGHTS, cool)
  out.shadows.multiply(normalisedTint(tint, mood.shadows, 0.45))
  out.highlights.multiply(normalisedTint(tint, mood.highlights, 0.45))
  out.bloomIntensity = 0.55 + night * 0.55
  out.bloomThreshold = lerp(mood.bloomThreshold, mood.bloomThreshold * 0.7, night)
  out.vignette = mood.vignette + night * 0.15

  // 10. Cloud shadows: sparse dapples on a clear day, most of the ground as the sky closes, darker
  // cells in a storm; they fade with the sun through golden hour and are gone by night.
  const cover = clamp01(env.cloudCover)
  const daylit = smoothstep(-0.3, 0.12, e)
  out.cloudShadow = daylit * (0.36 + 0.08 * overcast + 0.06 * storm)
  out.cloudCoverage = lerp(0.18, 0.8, smoothstep(0.1, 1, cover))
  out.cloudSoftness = 0.07 + 0.06 * overcast
  out.cloudSpeed = 1 + 7 * clamp01(env.wind) * (0.6 + 0.4 * cover)
  return out
}

/** A colour pulled towards a luminance-matched grey. */
function greyTowards(colour: Color, amount: number): void {
  if (amount <= 0) return
  const luminance = colour.r * 0.2126 + colour.g * 0.7152 + colour.b * 0.0722
  const grey = OVERCAST.r * 0.2126 + OVERCAST.g * 0.7152 + OVERCAST.b * 0.0722
  scratch.copy(OVERCAST).multiplyScalar(luminance / grey)
  colour.lerp(scratch, amount)
}

/** A tint as a multiplier that keeps brightness: the colour divided by its luminance, eased in. */
function normalisedTint(out: Color, hex: string, amount: number): Color {
  out.copy(parsed(hex))
  const luminance = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722 || 1
  out.multiplyScalar(1 / luminance)
  return out.lerp(WHITE, 1 - amount)
}

/** Mood colours arrive as hex strings; parse each once, not every frame. */
const PARSED = new Map<string, Color>()
function parsed(hex: string): Color {
  let colour = PARSED.get(hex)
  if (!colour) {
    colour = new Color(hex)
    PARSED.set(hex, colour)
  }
  return colour
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
