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
  /** How lit the town's lamps, fires and windows are: 0 by day, 1 from just before sunset to dawn. */
  lamps: number
  /** Unit vector toward the moon (clamped no lower than MIN_MOON_ELEVATION, for its shadows). */
  moonDir: [number, number, number]
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

// Keyed by sun elevation, so dawn and dusk match. Golden hour (24°) is plan §5: sun #ffd2a1 at ~3,
// hemisphere sky #9cc3e6 over ground #7a6a4f. The shade leans blue (warm key, cool fill).
// biome-ignore format: a table reads better aligned
const STOPS: readonly Stop[] = [
  { at: -24, zenith: "#040a1c", horizon: "#13213f", glow: "#000000", sun: "#000000", sunIntensity: 0,   sky: "#5d6a86", ground: "#1c1f28", hemiIntensity: 1.0,  exposure: 1.45 },
  { at: -14, zenith: "#0a1838", horizon: "#24345e", glow: "#140f2a", sun: "#000000", sunIntensity: 0,   sky: "#65728f", ground: "#20222c", hemiIntensity: 1.0,  exposure: 1.45 },
  { at: -6,  zenith: "#18306a", horizon: "#6e6c94", glow: "#b0605a", sun: "#000000", sunIntensity: 0,   sky: "#7480a0", ground: "#2a2832", hemiIntensity: 0.95, exposure: 1.3 },
  { at: 0,   zenith: "#33589a", horizon: "#eea070", glow: "#ff8a4c", sun: "#ff9c5c", sunIntensity: 1.2, sky: "#8c9ccc", ground: "#4a3e36", hemiIntensity: 1.0,  exposure: 1.05 },
  { at: 12,  zenith: "#4474b6", horizon: "#f2c49a", glow: "#ffb070", sun: "#ffbf86", sunIntensity: 2.6, sky: "#98b4dc", ground: "#6a5a44", hemiIntensity: 1.05, exposure: 1.0 },
  { at: 24,  zenith: "#4a82c4", horizon: "#f1d4ae", glow: "#ffcf98", sun: "#ffd2a1", sunIntensity: 3.3, sky: "#9cc3e6", ground: "#7a6a4f", hemiIntensity: 1.15, exposure: 1.05 },
  { at: 40,  zenith: "#3f84d0", horizon: "#cfe0ee", glow: "#fff0d8", sun: "#fff0dc", sunIntensity: 3.0, sky: "#b4d2f0", ground: "#7a7660", hemiIntensity: 1.15, exposure: 0.95 },
  { at: 90,  zenith: "#377ccf", horizon: "#cde2f6", glow: "#fff8ea", sun: "#fff8ee", sunIntensity: 3.1, sky: "#bcd8f4", ground: "#7c7a66", hemiIntensity: 1.15, exposure: 0.95 },
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
  return {
    hour: wrapHour(hour),
    sunDir: [heading[0] * flat, Math.sin(lift), heading[1] * flat],
    elevation,
    sun: mix(a.sun, b.sun, t),
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t,
    hemiSky: mix(a.sky, b.sky, t),
    hemiGround: mix(a.ground, b.ground, t),
    hemiIntensity: a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t,
    zenith: mix(a.zenith, b.zenith, t),
    horizon: mix(a.horizon, b.horizon, t),
    glow: mix(a.glow, b.glow, t),
    exposure: a.exposure + (b.exposure - a.exposure) * t,
    golden: smoothstep(-6, 8, elevation) * (1 - smoothstep(26, 40, elevation)),
    night: 1 - smoothstep(-14, -4, elevation),
    lamps: 1 - smoothstep(-3, 9, elevation),
    moonDir: [(mx / mh) * Math.cos(moonLift), Math.sin(moonLift), (mz / mh) * Math.cos(moonLift)],
    moonElevation: moon.elevation,
    moon: new Color(MOON),
    // The moon takes over once the sun is gone (both dark at the hand-over: no pop).
    moonIntensity: MOON_INTENSITY * (1 - smoothstep(-12, -6, elevation)) * smoothstep(-4, 12, moon.elevation),
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
