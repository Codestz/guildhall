/**
 * The island's regions as a small texture's bytes (three-free, for the generation worker): over the
 * island's square, RGBA per texel, each channel one kind of country's weight 0–255 (REGION_CHANNELS),
 * blurred a texel round so a region's rim is soft before the GPU's filtering softens it again. The
 * region tint (regionTint.ts) reads it in the shader.
 */

/** What each channel of the field holds (world regions.ts kinds; autumn is in the pieces' tones only). */
export const REGION_CHANNELS = ["highlands", "dry", "marsh", "meadow"] as const
export type RegionChannel = (typeof REGION_CHANNELS)[number]

/** The baked field: its world window (min x, z and side, metres), resolution, bytes and heights. */
export interface RegionFieldData {
  min: [number, number]
  size: number
  res: number
  /** RGBA bytes, res × res, row by row from min z. */
  data: Uint8Array
  /** The height (world y) from which the highlands' peaks are snowed; null for none. */
  snowY: number | null
  /** The height of the marsh's still water, the mist lying over it; null for none. */
  mistY: number | null
  /** The ground's small hex (centre to corner, metres), on the island's grid: what a meadow blooms by. */
  cell: number
}

/**
 * The field's bytes: `weightAt(x, z)` gives the four channels' weights (0–1) at a point, sampled at
 * each texel's centre and then box-blurred one texel round.
 */
export function regionBytes(opts: {
  min: [number, number]
  size: number
  res: number
  weightAt: (x: number, z: number) => readonly [number, number, number, number]
}): Uint8Array {
  const { min, size, res, weightAt } = opts
  const raw = new Float32Array(res * res * 4)
  const cell = size / res
  for (let row = 0; row < res; row++)
    for (let col = 0; col < res; col++) {
      const w = weightAt(min[0] + (col + 0.5) * cell, min[1] + (row + 0.5) * cell)
      const o = (row * res + col) * 4
      raw[o] = w[0]
      raw[o + 1] = w[1]
      raw[o + 2] = w[2]
      raw[o + 3] = w[3]
    }
  const out = new Uint8Array(res * res * 4)
  for (let row = 0; row < res; row++)
    for (let col = 0; col < res; col++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0
        let n = 0
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const r = row + dr
            const k = col + dc
            if (r < 0 || k < 0 || r >= res || k >= res) continue
            sum += raw[(r * res + k) * 4 + c]!
            n++
          }
        out[(row * res + col) * 4 + c] = Math.round(Math.min(1, Math.max(0, sum / n)) * 255)
      }
    }
  return out
}
