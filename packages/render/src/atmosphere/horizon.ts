/**
 * The horizon round an island: aerial haze by distance from the eye, so the water near the eye stays
 * clear and blue while the far sea melts into the sky's own colour (air.ts `airHaze`, toward the dome
 * along the level ray). The band follows the camera every frame: it starts a little past what the
 * camera looks at and is whole before the nearest point of the sea's rim or the far plane, so from any
 * pose (the orbit's farthest and lowest, free flight at the edge of its box) neither ever shows.
 */
import type { Stage } from "../stage.ts"
import { AIR } from "./air.ts"

export interface HorizonOpts {
  /** The sea's middle (x, z) and its radius, metres (the water disc: its rim must never show). */
  centre: [number, number]
  sea: number
  /** The island's half side, metres: the band's scale. */
  span: number
  /** 0 none (only the far plane's fade), 1 the default, 2 close in. */
  haze?: number
}

export interface HorizonBand {
  /** Where the haze starts and where it is whole, metres from the eye; its most (0: off). */
  start: number
  whole: number
  max: number
}

/** Where the band is whole, as a share of the nearest of the sea's rim and the far plane. */
const SAFE = 0.9

/**
 * The band for an eye `offset` metres (across the ground) from the sea's middle, looking at a point
 * `focus` metres away, under a far plane `far` metres off.
 */
export function horizonBand(o: {
  sea: number
  offset: number
  focus: number
  far: number
  span: number
  haze: number
}): HorizonBand {
  if (o.haze <= 0) return { start: 1e5, whole: 2e5, max: 0 }
  const h = Math.min(2, o.haze)
  // The rim's nearest point is straight out from the middle past the eye (and no nearer than the eye's
  // height would make it, which only helps).
  const limit = SAFE * Math.max(1, Math.min(o.sea - o.offset, o.far))
  const whole = Math.min(limit, o.focus + (o.span * 3) / h)
  const start = Math.min(o.focus + (o.span * 0.3) / h, whole * 0.5)
  return { start, whole, max: 1 }
}

export interface Horizon {
  set(haze: number): void
  dispose(): void
}

export function createHorizon(stage: Stage, opts: HorizonOpts): Horizon {
  let haze = opts.haze ?? 1
  const [cx, cz] = opts.centre
  const unsubscribe = stage.onFrame(() => {
    const eye = stage.camera.position
    const band = horizonBand({
      sea: opts.sea,
      offset: Math.hypot(eye.x - cx, eye.z - cz),
      focus: stage.getCamera().distance,
      far: stage.camera.far,
      span: opts.span,
      haze,
    })
    AIR.uHorizon.value.set(band.start, band.whole)
    AIR.uHorizonMax.value = band.max
  })
  return {
    set(next) {
      haze = next
    },
    dispose() {
      unsubscribe()
      AIR.uHorizonMax.value = 0
    },
  }
}
