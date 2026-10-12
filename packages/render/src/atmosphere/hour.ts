/**
 * What the air does at an hour (pure, from light.ts's `DayLight`): the sky's light on the shade (its
 * colours by direction), how thick the haze is, and the colour grade. Keyed by the sun's elevation like
 * the light itself, so dawn and dusk match, and smooth through every hour: nothing pops as the clock runs.
 *
 * The look it aims at is the concept image (`.probe/concept/island-inhabited.png`): a warm key, shade
 * that turns blue (the sky lights it, not a grey ambient), sun-facing walls in shade warmed by the glow,
 * depth haze that is warm toward the sun and cool away from it, crisp at noon and thick at golden hour.
 */
import { Color } from "three"
import type { DayLight } from "../light.ts"
import { smoothstep } from "./field.ts"

/** The sky's light on a surface, by the way it faces (replaces the flat hemisphere fill). */
export interface SkyLight {
  /** Straight up: the zenith's blue. */
  top: Color
  /** A level face turned from the sun: the cool side of the sky. */
  away: Color
  /** A level face turned toward the sun: the glow round it. */
  toward: Color
  /** Facing down: the light bounced off the ground. */
  bounce: Color
  intensity: number
}

/** The haze between the eye and what it sees. */
export interface Haze {
  /** Extinction per metre past the clear zone, at the ground. */
  density: number
  /** Metres over which it thins with height (a roof is a little clearer than the street). */
  falloff: number
  /** Its most, short of the far plane (where it always reaches 1). */
  max: number
  /** The cool side of the horizon (the warm side is the dome's own horizon and glow). */
  away: Color
}

/** The colour grade, applied to the display colour of everything lit (and of the sky). */
export interface Grade {
  /** Multipliers on dark and on bright tones: split toning (cool shadows, warm highlights). */
  shadows: Color
  highlights: Color
  /** 1 leaves saturation as it is. */
  saturation: number
  /** 0 is linear; 1 is a full smoothstep S curve. */
  contrast: number
}

export interface AirLook {
  sky: SkyLight
  haze: Haze
  grade: Grade
}

type Rgb = readonly [number, number, number]

interface Stop {
  at: number
  /** Haze extinction (per km) and its ceiling. */
  density: number
  max: number
  /** Display-space multipliers (raw numbers, not colours: no sRGB decode). */
  shadows: Rgb
  highlights: Rgb
  saturation: number
  contrast: number
}

// Keyed by sun elevation. Deep night is quiet (the night grade in night/glow.ts carries it); blue hour
// and golden hour are where the air shows; noon is crisp, near neutral.
// biome-ignore format: a table reads better aligned
const STOPS: readonly Stop[] = [
  { at: -20, density: 0.6, max: 0.3,  shadows: [0.92, 0.95, 1.00], highlights: [0.98, 0.96, 0.93], saturation: 0.96, contrast: 0.06 },
  { at: -6,  density: 0.9, max: 0.3,  shadows: [0.88, 0.91, 1.00], highlights: [1.00, 0.93, 0.88], saturation: 1.0,  contrast: 0.1 },
  { at: 2,   density: 1.5, max: 0.42, shadows: [0.86, 0.91, 1.00], highlights: [1.00, 0.91, 0.80], saturation: 1.04, contrast: 0.14 },
  { at: 14,  density: 1.8, max: 0.5,  shadows: [0.86, 0.91, 1.00], highlights: [1.00, 0.91, 0.76], saturation: 1.05, contrast: 0.14 },
  { at: 28,  density: 1.2, max: 0.4,  shadows: [0.88, 0.92, 1.00], highlights: [1.00, 0.93, 0.82], saturation: 1.03, contrast: 0.12 },
  { at: 50,  density: 0.7, max: 0.28, shadows: [0.92, 0.95, 1.00], highlights: [1.00, 0.97, 0.91], saturation: 1.0,  contrast: 0.1 },
]

function around(elevation: number): [Stop, Stop, number] {
  let i = 0
  while (i < STOPS.length - 2 && elevation > (STOPS[i + 1] as Stop).at) i++
  const a = STOPS[i] as Stop
  const b = STOPS[i + 1] as Stop
  return [a, b, Math.min(1, Math.max(0, (elevation - a.at) / (b.at - a.at)))]
}

/** The sky's light is brighter than the flat fill it replaces: shade reads soft and blue, not grey and dark. */
const SKY_GAIN = 1.3

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** The sky's light, the haze and the grade at `light`'s hour. */
export function airAt(light: DayLight): AirLook {
  const [a, b, t] = around(light.elevation)
  const day = smoothstep(-8, 6, light.elevation)
  // The cool side of the sky: the hemisphere's blue pulled toward the zenith, deeper at golden hour.
  // By night the zenith is near black: the fill keeps the hemisphere's moonlit blue instead.
  const away = light.hemiSky.clone().lerp(light.zenith, (0.5 + 0.2 * light.golden) * day)
  // The warm side: the hemisphere's sky tinted by the glow, as much as the sun is low and up.
  const toward = light.hemiSky.clone().lerp(light.glow, (0.25 + 0.45 * light.golden) * day)
  const sky: SkyLight = {
    top: light.hemiSky.clone().lerp(light.zenith, 0.4 * day),
    away,
    toward,
    bounce: light.hemiGround.clone(),
    intensity: light.hemiIntensity * (1 + (SKY_GAIN - 1) * day),
  }
  const haze: Haze = {
    density: lerp(a.density, b.density, t) / 1000,
    falloff: 70,
    max: lerp(a.max, b.max, t),
    // The far side of the horizon from the sun: a clean pale blue by day (horizon cream mixed with the
    // zenith reads grey-lilac), the night horizon a shade toward the zenith after dark.
    away: light.horizon
      .clone()
      .lerp(light.zenith, 0.3)
      .lerp(light.hemiSky.clone().lerp(light.horizon, 0.2), day),
  }
  const grade: Grade = {
    shadows: new Color(...a.shadows).lerp(new Color(...b.shadows), t),
    highlights: new Color(...a.highlights).lerp(new Color(...b.highlights), t),
    saturation: lerp(a.saturation, b.saturation, t),
    contrast: lerp(a.contrast, b.contrast, t),
  }
  return { sky, haze, grade }
}
