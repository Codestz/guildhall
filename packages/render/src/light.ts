import { Color, Fog, HemisphereLight, NeutralToneMapping } from "three"
import type { Stage } from "./stage.ts"

/**
 * The light of an hour (plan §5 "Golden hour"): where the sun is, the key and fill colours, the sky's
 * colours and the haze. Pure numbers, so the sky dome, the lights and the fog never disagree.
 *
 * The sun rises at SUNRISE in −x, crosses +z at its highest (NOON_ELEVATION) and sets at SUNSET in
 * +x. From the concept camera (azimuth ≈ 40°) the evening sun stands to its right and a little in
 * front, so street fronts facing the camera are lit and shadows fall away up-left.
 */
export interface DayLight {
  hour: number
  /** Unit vector from the ground toward the sun, clamped no lower than MIN_SHADOW_ELEVATION. */
  sunDir: [number, number, number]
  /** Unit vector toward where the sun really is (below the horizon by night): the sky's glow and disc. */
  sunTrue: [number, number, number]
  /** The sun's true elevation, degrees (negative after sunset). */
  elevation: number
  sun: Color
  sunIntensity: number
  hemiSky: Color
  hemiGround: Color
  hemiIntensity: number
  /** The dome: straight up, at the horizon (and the haze), round the sun. */
  zenith: Color
  horizon: Color
  glow: Color
  exposure: number
  /** 0 by day, 1 at golden hour: how thick the warm haze is. */
  golden: number
  /** 0 by day, 1 in deep night (the sun 14° under the horizon): stars, the moon, the night grade. */
  night: number
  /**
   * How lit the town's lanterns and windows are: 0 through the bright day, a soft first glow from
   * late afternoon (~16:30), about half by golden hour, 1 from just before sunset to dawn.
   */
  lamps: number
  /** How lit the light sources' own flames and glass are: never below FIRE_FLOOR (fires burn all day). */
  fire: number
  /** How much of the key light a shadow takes (three's `shadow.intensity`): the rest lifts the shade warm. */
  shadow: number
  /** Unit vector toward the moon (clamped no lower than MIN_MOON_ELEVATION, for its shadows). */
  moonDir: [number, number, number]
  /** Unit vector toward where the moon really is: its disc. */
  moonTrue: [number, number, number]
  /** The moon's true elevation, degrees (negative by day). */
  moonElevation: number
  moon: Color
  moonIntensity: number
}

/** The default hour: the low, warm light the concept image is lit by. */
export const GOLDEN_HOUR = 17.5
const SUNRISE = 5.75
const SUNSET = 19.25
const NOON_ELEVATION = 62
/** Shadows from a grazing sun smear across the town; the key light never goes lower than this. */
const MIN_SHADOW_ELEVATION = 10
/** The moon crosses the night sky from SUNSET to SUNRISE, this high at its highest (degrees). */
const MOON_ELEVATION = 48
/** Moonlight is soft and high: its shadows never come from lower than this. */
const MIN_MOON_ELEVATION = 30
/**
 * A grey-blue moon, faint, so firelight keeps its colour against it and a red roof stays a dark red
 * (V1's #9fb6ff turned every roof electric blue here).
 */
const MOON = "#b3bdd4"
const MOON_INTENSITY = 0.6
/** Fires, forges and lantern flames glow a little all day (V1's always-cozy town). */
export const FIRE_FLOOR = 0.15
/** A sunlit shadow keeps this much of the warm key, so shade is a lifted blue-warm, never black. */
const SUN_SHADOW = 0.9
/** Moonlight is soft: its shadows are fainter still. */
const MOON_SHADOW = 0.65

/**
 * Lamplight by sun elevation. The evening lights early (V1's always-cozy town): a soft first glow from
 * ~40° (16:15), ~0.45 at golden hour (24°), full a little under the horizon. The morning puts them out
 * briskly once the sun is up (by ~9°). The two meet at noon, where both are 0: no pop.
 */
export function lampsAt(elevation: number, evening: boolean): number {
  if (!evening) return 1 - smoothstep(-3, 9, elevation)
  const afternoon = 1 - smoothstep(22, 40, elevation)
  const dusk = 1 - smoothstep(-3, 20, elevation)
  return Math.min(1, 0.4 * afternoon + 0.6 * dusk)
}

interface Stop {
  /** Sun elevation, degrees. */
  at: number
  zenith: string
  horizon: string
  glow: string
  sun: string
  sunIntensity: number
  sky: string
  ground: string
  hemiIntensity: number
  exposure: number
}

// Keyed by sun elevation, so dawn and dusk match. Golden hour (24°) is plan §5's warm key (#ffcc94).
// The fill is V1's: a pale, bright sky over a warm, sunlit ground (the bounce off sand and grass), so
// the shade reads soft and cheerful, never brown-black. The warmth pass (2026-10) raised it from a
// darker blue sky over a brown ground; shade then sat at ~11% of lit faces, it now sits near a third.
// biome-ignore format: a table reads better aligned
const STOPS: readonly Stop[] = [
  { at: -24, zenith: "#040a1c", horizon: "#13213f", glow: "#000000", sun: "#000000", sunIntensity: 0,   sky: "#66749a", ground: "#22252f", hemiIntensity: 1.1,  exposure: 1.5 },
  { at: -14, zenith: "#0a1838", horizon: "#24345e", glow: "#140f2a", sun: "#000000", sunIntensity: 0,   sky: "#6e7ba0", ground: "#262833", hemiIntensity: 1.1,  exposure: 1.5 },
  { at: -6,  zenith: "#18306a", horizon: "#6e6c94", glow: "#b0605a", sun: "#000000", sunIntensity: 0,   sky: "#8290b4", ground: "#38333a", hemiIntensity: 1.1,  exposure: 1.4 },
  { at: 0,   zenith: "#33589a", horizon: "#eea070", glow: "#ff8a4c", sun: "#ff9c5c", sunIntensity: 1.2, sky: "#a2acd4", ground: "#6a5444", hemiIntensity: 1.22, exposure: 1.2 },
  { at: 12,  zenith: "#4474b6", horizon: "#f2c49a", glow: "#ffb070", sun: "#ffbf86", sunIntensity: 2.4, sky: "#b8c6e4", ground: "#9c7c58", hemiIntensity: 1.35, exposure: 1.14 },
  { at: 24,  zenith: "#4a82c4", horizon: "#f1d4ae", glow: "#ffcf98", sun: "#ffcc94", sunIntensity: 2.9, sky: "#c4d6ee", ground: "#aa8c64", hemiIntensity: 1.45, exposure: 1.12 },
  { at: 40,  zenith: "#3f84d0", horizon: "#cfe0ee", glow: "#fff0d8", sun: "#fff0d8", sunIntensity: 3.0, sky: "#d0e2f6", ground: "#ac9670", hemiIntensity: 1.35, exposure: 1.04 },
  { at: 90,  zenith: "#377ccf", horizon: "#cde2f6", glow: "#fff8ea", sun: "#fff6e8", sunIntensity: 3.0, sky: "#d6e6fa", ground: "#b09c78", hemiIntensity: 1.35, exposure: 1.02 },
]

const RAD = Math.PI / 180
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const wrapHour = (h: number) => ((h % 24) + 24) % 24

/** The moon's elevation (degrees) and heading: it rises in −x at SUNSET and sets in +x at SUNRISE. */
export function moonAt(hour: number): { elevation: number; heading: [number, number] } {
  const night = 24 - (SUNSET - SUNRISE)
  const t = wrapHour(hour - SUNSET) / night
  // Above the horizon by night; under it by day, on the same kind of arc.
  const elevation =
    t <= 1
      ? MOON_ELEVATION * Math.sin(Math.PI * t)
      : -MOON_ELEVATION * Math.sin((Math.PI * (t - 1) * night) / (24 - night))
  // A little south of the sun's path, so its shadows read across the streets.
  const sweep = Math.PI * Math.min(1.15, Math.max(-0.15, t))
  return { elevation, heading: [-Math.cos(sweep), 0.35 + 0.65 * Math.sin(sweep)] }
}

/** The sun's elevation (degrees) and its heading in the ground plane at `hour`. */
export function sunAt(hour: number): { elevation: number; heading: [number, number] } {
  const h = wrapHour(hour)
  const t = (h - SUNRISE) / (SUNSET - SUNRISE)
  // Above the horizon by day; the same arc continued under it by night.
  const elevation = NOON_ELEVATION * Math.sin(Math.PI * t)
  const sweep = Math.PI * Math.min(1.15, Math.max(-0.15, t))
  return { elevation, heading: [-Math.cos(sweep), Math.sin(sweep)] }
}

function stopsAround(elevation: number): [Stop, Stop, number] {
  let i = 0
  while (i < STOPS.length - 2 && elevation > (STOPS[i + 1] as Stop).at) i++
  const a = STOPS[i] as Stop
  const b = STOPS[i + 1] as Stop
  return [a, b, clamp01((elevation - a.at) / (b.at - a.at))]
}

const mix = (a: string, b: string, t: number) => new Color(a).lerp(new Color(b), t)

/** The light at `hour` (0–24, wraps). */
export function lightAt(hour: number): DayLight {
  const { elevation, heading } = sunAt(hour)
  const [a, b, t] = stopsAround(elevation)
  const lift = Math.max(elevation, MIN_SHADOW_ELEVATION) * RAD
  const flat = Math.cos(lift)
  const moon = moonAt(hour)
  const moonLift = Math.max(moon.elevation, MIN_MOON_ELEVATION) * RAD
  const [mx, mz] = moon.heading
  const mh = Math.hypot(mx, mz) || 1
  const sh = Math.hypot(heading[0], heading[1]) || 1
  const e = elevation * RAD
  const me = moon.elevation * RAD
  const sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t
  // The moon takes over once the sun is gone (both dark at the hand-over: no pop).
  const moonIntensity =
    MOON_INTENSITY * (1 - smoothstep(-12, -6, elevation)) * smoothstep(-4, 12, moon.elevation)
  return {
    hour: wrapHour(hour),
    sunDir: [heading[0] * flat, Math.sin(lift), heading[1] * flat],
    sunTrue: [(heading[0] / sh) * Math.cos(e), Math.sin(e), (heading[1] / sh) * Math.cos(e)],
    elevation,
    sun: mix(a.sun, b.sun, t),
    sunIntensity,
    hemiSky: mix(a.sky, b.sky, t),
    hemiGround: mix(a.ground, b.ground, t),
    hemiIntensity: a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t,
    zenith: mix(a.zenith, b.zenith, t),
    horizon: mix(a.horizon, b.horizon, t),
    glow: mix(a.glow, b.glow, t),
    exposure: a.exposure + (b.exposure - a.exposure) * t,
    golden: smoothstep(-6, 8, elevation) * (1 - smoothstep(26, 40, elevation)),
    night: 1 - smoothstep(-14, -4, elevation),
    lamps: lampsAt(elevation, wrapHour(hour) >= 12),
    fire: Math.max(FIRE_FLOOR, lampsAt(elevation, wrapHour(hour) >= 12)),
    shadow: sunIntensity >= moonIntensity ? SUN_SHADOW : MOON_SHADOW,
    moonDir: [(mx / mh) * Math.cos(moonLift), Math.sin(moonLift), (mz / mh) * Math.cos(moonLift)],
    moonTrue: [(mx / mh) * Math.cos(me), Math.sin(me), (mz / mh) * Math.cos(me)],
    moonElevation: moon.elevation,
    moon: new Color(MOON),
    moonIntensity,
  }
}

/** The stage's fill light (stage.ts adds one hemisphere light and does not expose it). */
function hemisphere(stage: Stage): HemisphereLight {
  const found = stage.scene.children.find((c): c is HemisphereLight => c instanceof HemisphereLight)
  if (found) return found
  const made = new HemisphereLight()
  stage.scene.add(made)
  return made
}

/**
 * Lights the stage with `light`: the sun's direction (kept round its current target), colour and
 * intensity, the hemisphere fill, neutral tone mapping at the hour's exposure, and the haze colour. A
 * stable-cascade sun (`createSun`) must be marked dirty afterwards, since its direction moved.
 */
export function applyLight(stage: Stage, light: DayLight): void {
  const { sun, scene, renderer } = stage
  // The key light (and its cascades) is whichever of the sun and the moon is brighter.
  const key = keyLight(light)
  const [x, y, z] = key.dir
  const at = sun.target.position
  sun.position.set(at.x + x * 100, at.y + y * 100, at.z + z * 100)
  sun.color.copy(key.colour)
  sun.intensity = key.intensity
  // The cascades copy the key's shadow strength (sun/cascades.ts).
  sun.shadow.intensity = light.shadow
  const fill = hemisphere(stage)
  fill.color.copy(light.hemiSky)
  fill.groundColor.copy(light.hemiGround)
  fill.intensity = light.hemiIntensity
  // Neutral, not AgX (plan §5): AgX greys the grass the concept image keeps saturated.
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = light.exposure
  const haze = hazeColour(light)
  if (scene.fog instanceof Fog) scene.fog.color.copy(haze)
  else scene.fog = new Fog(haze, 1e4, 2e4)
  scene.background = haze
}

/** The light that casts the shadows at this hour: the sun, or the moon once it outshines the sun. */
export function keyLight(light: DayLight): {
  dir: [number, number, number]
  colour: Color
  intensity: number
} {
  return light.sunIntensity >= light.moonIntensity
    ? { dir: light.sunDir, colour: light.sun, intensity: light.sunIntensity }
    : { dir: light.moonDir, colour: light.moon, intensity: light.moonIntensity }
}

/** The haze: the horizon, warmer toward the glow at golden hour. */
export function hazeColour(light: DayLight): Color {
  return light.horizon.clone().lerp(light.glow, 0.25 * light.golden)
}

/** The golden-hour preset (plan §5) on the stage's lights; returns the light it applied. */
export function goldenHour(stage: Stage): DayLight {
  const light = lightAt(GOLDEN_HOUR)
  applyLight(stage, light)
  return light
}
