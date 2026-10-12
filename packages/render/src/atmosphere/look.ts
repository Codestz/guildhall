/**
 * The clouds' colours and the strength of their shadows at an hour (pure, from light.ts's `DayLight`):
 * white with blue-grey undersides by day, warm cream at golden hour, pink and lilac at dusk, a dark
 * blue veil a shade lighter than the night sky. Coverage greys them toward overcast. Shadows fade with
 * the sun: none once it is down.
 */
import { Color } from "three"
import type { DayLight } from "../light.ts"
import { smoothstep } from "./field.ts"

export interface CloudLook {
  /** The sunlit side. */
  lit: Color
  /** The side turned from the sun, and the flat underside. */
  shade: Color
  /** How dark a cloud's shadow makes the sunlit ground at full mask (0–1). */
  shadow: number
}

const WHITE = new Color("#fbfcff")
const DAY_SHADE = new Color("#b4c3d9")
const WARM = new Color("#ffe2bd")
const GOLDEN_SHADE = new Color("#b9a6c4")
const PINK = new Color("#f6a7a9")
const DUSK_SHADE = new Color("#7a6c98")
const OVERCAST = new Color("#c3c8cf")
const OVERCAST_SHADE = new Color("#7f8896")

/** The clouds' look under `light` at `coverage` (0 clear … 1 overcast). */
export function cloudLook(light: DayLight, coverage: number): CloudLook {
  const e = light.elevation
  // Night: the sky's own blue, a little lighter than the dome behind it, so a cloud is a veil, not a hole.
  const nightLit = light.zenith.clone().lerp(light.horizon, 0.45).multiplyScalar(1.35)
  const nightShade = light.zenith.clone().multiplyScalar(0.9)
  const dusk = smoothstep(-10, -1, e)
  const golden = smoothstep(2, 14, e)
  const day = smoothstep(22, 42, e)
  const lit = nightLit.lerp(PINK, dusk).lerp(WARM, golden).lerp(WHITE, day)
  const shade = nightShade.lerp(DUSK_SHADE, dusk).lerp(GOLDEN_SHADE, golden).lerp(DAY_SHADE, day)
  const grey = smoothstep(0.55, 1, coverage)
  const dim = 0.35 + 0.65 * smoothstep(-12, 4, e)
  lit.lerp(OVERCAST.clone().multiplyScalar(dim), 0.75 * grey)
  shade.lerp(OVERCAST_SHADE.clone().multiplyScalar(dim), 0.7 * grey)
  const sun = smoothstep(0, 10, e)
  return { lit, shade, shadow: sun * (0.55 + 0.15 * grey) }
}
