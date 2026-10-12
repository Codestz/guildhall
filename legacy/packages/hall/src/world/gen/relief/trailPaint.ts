import { SWATCH, swatchV } from "./swatches.ts"
import { ON_STAIRS, ON_TRAIL } from "./trailCarve.ts"

/**
 * A face on a trail's shelf (trailCarve.ts) wears the path's sand; where the shelf is steps, stone,
 * so a steep leg reads as a stair. A face is on the shelf when all three corners are; vertex arrays
 * carry the flags at index 4 (mesh.ts).
 */
export function trailTexel(
  p: readonly number[],
  q: readonly number[],
  r: readonly number[],
): readonly [number, number] | undefined {
  const [a, b, c] = [p[4] as number, q[4] as number, r[4] as number]
  if (!(a & b & c & ON_TRAIL)) return undefined
  if ((a | b | c) & ON_STAIRS) return [SWATCH.slate.u, swatchV(SWATCH.slate, 0.12)]
  return [SWATCH.path.u, swatchV(SWATCH.path, 0.5)]
}
