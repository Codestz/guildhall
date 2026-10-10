import { DMath } from "../../dmath.ts"
import type { Spot } from "../../layout.ts"
import { type Fall, TERRACE } from "../../waterways.ts"
import { cellAt } from "../hex.ts"
import { LEDGE_STEP } from "../relief/shape.ts"

/**
 * Where a river crosses the tallest wall run of a mountain (this many ledges of consecutive drop
 * within this short a run) it does not step down ledge by ledge: it leaves one lip and falls the
 * whole height in one sheet (scene/nature/fallMesh.ts), into a pool at the foot. Gentle stretches
 * keep their steps. The surface under the lip is the bottom's: the carve (carve.ts) cuts the
 * channel down to it, a gorge with a sheer back wall for the sheet to hang on.
 */

const TALL = 3
const SHORT = 10
/** The sheet's width: a gorge's channel, narrower than a stream's. */
const WIDTH = 3.6

const distance = (a: Spot, b: Spot): number => DMath.hypot(a[0] - b[0], a[1] - b[1])

/** `surface` (its heights down the samples `pts`) with every tall run made one drop, and the falls it makes. */
export function plunge(
  surface: readonly number[],
  pts: readonly Spot[],
): { surface: number[]; falls: Fall[] } {
  const out = [...surface]
  const falls: Fall[] = []
  const drops = surface.flatMap((y, i) =>
    i + 1 < surface.length && y - (surface[i + 1] as number) >= LEDGE_STEP - 0.05 ? [i] : [],
  )
  for (let first = 0; first < drops.length; ) {
    let last = first
    while (
      last + 1 < drops.length &&
      distance(pts[drops[first] as number] as Spot, pts[drops[last + 1] as number] as Spot) <= SHORT
    )
      last++
    if (last - first + 1 < TALL) {
      first++
      continue
    }
    const [lip, foot] = [drops[first] as number, (drops[last] as number) + 1]
    const [top, bottom] = [surface[lip] as number, surface[foot] as number]
    for (let m = lip + 1; m < foot; m++) out[m] = bottom
    const [a, b] = [pts[lip] as Spot, pts[lip + 1] as Spot]
    const length = distance(a, b) || 1
    falls.push({
      from: cellAt(a),
      to: cellAt(pts[foot] as Spot),
      dir: 0,
      top: Math.round(top / TERRACE),
      bottom: Math.round(bottom / TERRACE),
      source: "river",
      into: "river",
      topY: top,
      bottomY: bottom,
      at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      out: [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
      width: WIDTH,
    })
    first = last + 1
  }
  return { surface: out, falls }
}
