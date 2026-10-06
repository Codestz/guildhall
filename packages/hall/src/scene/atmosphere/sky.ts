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

// biome-ignore format: a table reads better aligned
const DAY: readonly Stop[] = [
  stop(-0.45, { zenith: "#02050d", horizon: "#0a1428", fog: "#0b1424", glow: "#000000", sun: "#000000", sky: "#3c5592", ground: "#0c1120" }, 0, 1.35),
  stop(-0.2,  { zenith: "#040a1c", horizon: "#13213f", fog: "#111c33", glow: "#140f2a", sun: "#000000", sky: "#41579a", ground: "#0f1322" }, 0, 1.3),
  stop(-0.08, { zenith: "#122150", horizon: "#3d4676", fog: "#2c3458", glow: "#a24a6e", sun: "#000000", sky: "#6670aa", ground: "#211d2c" }, 0, 1.0),
  stop(0.02,  { zenith: "#2f5290", horizon: "#eb9f86", fog: "#a98c98", glow: "#ff7f56", sun: "#ff9c86", sky: "#a3b0e6", ground: "#3e3a4a" }, 1.3, 1.15),
  stop(0.14,  { zenith: "#4d7fc4", horizon: "#f2d0b4", fog: "#cfc4c4", glow: "#ffaa78", sun: "#ffd6b8", sky: "#c2d0f2", ground: "#5c5a66" }, 2.9, 1.4),
  stop(0.36,  { zenith: "#4486d2", horizon: "#c4dcf0", fog: "#bfd3e4", glow: "#fff0d2", sun: "#fff0d8", sky: "#dcebff", ground: "#7a8072" }, 2.8, 1.18),
  stop(0.9,   { zenith: "#377ccf", horizon: "#cde2f6", fog: "#c6d9ea", glow: "#fff8ea", sun: "#fff8ee", sky: "#e3efff", ground: "#7c8aa0" }, 3.0, 1.22),
]

const MOON = new Color("#9fb6ff")
/** Overcast: what a cloud-covered sky's colours drift towards (scaled by their own brightness). */
const OVERCAST = new Color("#c3cad3")
const STORM_FLASH = new Color("#dfe6ff")
const NIGHT_SHADOWS = new Color(0.78, 0.9, 1.2)
const NIGHT_HIGHLIGHTS = new Color(0.94, 0.98, 1.08)
const GOLDEN_SHADOWS = new Color(0.94, 0.96, 1.08)
const GOLDEN_HIGHLIGHTS = new Color(1.06, 1.0, 0.95)
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
  let sun = lerp(a.sunIntensity, b.sunIntensity, t) * smoothstep(-0.03, 0.08, e)
  let hemi = lerp(a.hemiIntensity, b.hemiIntensity, t)

  const night = 1 - smoothstep(-0.16, 0.08, e)
  const golden = smoothstep(-0.06, 0.04, e) * (1 - smoothstep(0.14, 0.36, e))
  out.night = night

  // 2. Clouds: a grey, softer world; the sun dims, the sky's own light carries more of it.
  const overcast = smoothstep(0.25, 0.95, env.cloudCover)
  const rain = clamp01(env.precipitation)
  greyTowards(out.zenith, overcast * 0.8)
  greyTowards(out.horizon, overcast * 0.8)
  greyTowards(out.fog, overcast * 0.8)
  greyTowards(out.glow, overcast * 0.8)
  greyTowards(out.hemiSky, overcast * 0.8)
  greyTowards(out.sunColor, overcast * 0.8)
  out.zenith.lerp(scratch.copy(out.horizon), overcast * 0.55)
  const dim = 1 - overcast * 0.4 - rain * 0.22
  out.zenith.multiplyScalar(dim)
  out.horizon.multiplyScalar(dim)
  out.fog.multiplyScalar(dim)
  out.glow.multiplyScalar(1 - overcast * 0.85)
  sun *= 1 - overcast * 0.78
  hemi *= 1 - overcast * 0.18 - rain * 0.12
  if (env.weather === "snow") {
    out.fog.multiply(SNOW_TINT)
    out.horizon.multiply(SNOW_TINT)
  }

  // 3. The moon takes over once the sun is down (both are dark at the hand-over: no pop).
  const moon =
    0.62 * (1 - smoothstep(-0.14, -0.03, e)) * smoothstep(-0.02, 0.18, moonUp) * (1 - overcast * 0.7)
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

  const sunUp = e > -0.03
  const [kx, ky, kz] = sunUp ? env.sun : env.moon
  // Never let the shadow light graze the ground: very long shadows smear the one shadow map.
  const y = Math.max(ky, 0.42)
  const length = Math.hypot(kx, y, kz) || 1
  out.keyDirection[0] = kx / length
  out.keyDirection[1] = y / length
  out.keyDirection[2] = kz / length
  out.keyColor.copy(sunUp ? out.sunColor : out.moonColor)
  out.keyIntensity = (sunUp ? sun : moon) * mood.key
  out.keyShadow = (sunUp ? 1 : 0.7) * (1 - overcast * 0.6)

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
  const haze = Math.max(golden * 0.7, rain, overcast * 0.45)
  out.fogNear = 1.0 - haze * 0.42
  out.fogFar = 1.55 - haze * 0.4

  // 7. Sky dome details.
  out.stars = night * night * (1 - overcast * 0.95)
  out.sunDisc = smoothstep(-0.05, 0.01, e) * (1 - overcast * 0.95)
  out.moonDisc = smoothstep(-0.05, 0.1, moonUp) * (1 - overcast * 0.9) * (0.25 + 0.75 * night)

  // 8. Lamps light as the sun goes, and on dark grey days.
  out.lamps = Math.max(0.12, 1 - smoothstep(-0.04, 0.3, e), overcast * 0.45)

  // 9. The grade: golden warmth at the ends of the day, blue and calm at night, flat under clouds.
  out.exposure = (1 + night * 0.25) * (1 - rain * 0.12 - overcast * 0.06)
  out.saturation = (1.04 + golden * 0.04 - night * 0.1) * (1 - overcast * 0.38) * mood.saturation
  // Night vision: what the moon lights goes blue-grey; what a fire lights keeps its colour.
  out.darkSaturation = out.saturation * (1 - night * 0.62)
  out.contrast = (1.03 + night * 0.04 - overcast * 0.04) * mood.contrast
  out.shadows.copy(WHITE).lerp(GOLDEN_SHADOWS, golden).lerp(NIGHT_SHADOWS, night)
  out.highlights.copy(WHITE).lerp(GOLDEN_HIGHLIGHTS, golden).lerp(NIGHT_HIGHLIGHTS, night)
  out.shadows.multiply(normalisedTint(tint, mood.shadows, 0.45))
  out.highlights.multiply(normalisedTint(tint, mood.highlights, 0.45))
  out.bloomIntensity = 0.55 + night * 0.55
  out.bloomThreshold = lerp(mood.bloomThreshold, mood.bloomThreshold * 0.7, night)
  out.vignette = mood.vignette + night * 0.15
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
