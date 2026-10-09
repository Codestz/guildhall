import type { World } from "./world.ts"

/** The tallest ground of a world above the sea, world units: its highest massif's main peak (0 without relief). */
export function peakOf(world: World): number {
  let peak = 0
  for (const massif of world.relief?.massifs ?? []) peak = Math.max(peak, massif.height)
  return peak
}
