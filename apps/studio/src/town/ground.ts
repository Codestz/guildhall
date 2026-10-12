/**
 * The town's ground, made to go through render's `createGround`. Painting a few hundred overlapping
 * street ribbons through its polygon booleans fails on many seeds ("Unable to complete output ring",
 * or a stack overflow); overlays snapped to a coarser grid go through. So the painted ground is tried
 * at each snap of SNAPS in turn, and bare land (with its contact shading) is the last resort. Bare
 * land without footprints is also the fast stand-in the first frame shows.
 */
import type { TownDraw } from "@guildhall/world"

export type GroundDraw = TownDraw["ground"]

/** Overlay snaps tried in turn, metres (25 cm still reads as a straight kerb at town scale). */
export const SNAPS: readonly number[] = [0.25, 0.5, 1]

/** Overlay corners snapped to `step` metres. */
export function snapOverlays(g: GroundDraw, step: number): GroundDraw {
  const s = (v: number) => Math.round(v / step) * step
  return { ...g, overlays: g.overlays.map((o) => ({ ...o, poly: o.poly.map(([x, z]) => [s(x), s(z)]) })) }
}

/** The land alone: no overlays, no footprints (the cheap first-frame ground). */
export const bareGround = (g: GroundDraw): GroundDraw => ({ ...g, overlays: [], footprints: [] })

/**
 * `build` on the painted ground at the first snap that goes through; bare land with its footprints
 * when none does. Returns what was built, the snap used (null: bare) and why finer snaps failed.
 */
export function paintGround<T>(
  g: GroundDraw,
  build: (g: GroundDraw) => T,
): { built: T; snap: number | null; failures: string[] } {
  const failures: string[] = []
  for (const snap of SNAPS)
    try {
      return { built: build(snapOverlays(g, snap)), snap, failures }
    } catch (error) {
      failures.push(`${snap} m: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200))
    }
  return { built: build({ ...g, overlays: [] }), snap: null, failures }
}
