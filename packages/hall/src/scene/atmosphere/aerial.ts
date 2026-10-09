import { Color } from "three"

const BLUE = new Color(0.66, 0.78, 1)
const scratch = new Color()

/**
 * The colour of distance (GradeEffect.aerial): the sky's fog cooled towards blue, and only as bright
 * as the sky itself, so by day far ranges go pale blue and at night the haze is as dark as the fog.
 */
export function hazeTint(fog: Color, saturation: number, out: Color): Color {
  const luminance = fog.r * 0.2126 + fog.g * 0.7152 + fog.b * 0.0722
  return out
    .copy(fog)
    .lerp(scratch.copy(BLUE).multiplyScalar(Math.min(luminance * 1.5, 1)), 0.65 * saturation)
}
