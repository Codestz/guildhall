/**
 * The island's air: fog belongs in the sky, not on the water. A clear blue sea round the island; haze
 * that thickens with distance from the eye, so the far sea melts into the sky and its end never shows
 * (render atmosphere/horizon.ts); and a thin, broken cloud deck high over it (atmosphere/deck.ts),
 * which the camera looks down through when far out and never meets close in, its shadows drifting over
 * the water and the land. Debug knobs, multipliers of today's look: `?haze=0..2` the horizon haze,
 * `?clouds=0..2` the deck's cover (0: no deck, no shadows), `?atmo=0` all of it off.
 */
import {
  type Atmosphere,
  createAtmosphere,
  createHorizon,
  type DayLight,
  DEFAULT_ATMOSPHERE,
  deckHeight,
  distanceRange,
  type Horizon,
  RIG_LIMITS,
  type Stage,
} from "@guildhall/render"
import { islandWorld } from "../shell/worldCamera.ts"

export interface AtmoKnobs {
  on: boolean
  haze: number
  clouds: number
}

const knob = (query: URLSearchParams, key: string): number => {
  const v = Number(query.get(key))
  return query.has(key) && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : 1
}

export function atmoKnobs(query: URLSearchParams): AtmoKnobs {
  return {
    on: query.get("atmo") !== "0",
    haze: knob(query, "haze"),
    clouds: knob(query, "clouds"),
  }
}

export interface IslandAir {
  dispose(): void
}

/** The tallest the island stands, metres (its highest hill and the tower on it): the deck clears it. */
const TALLEST = 40

/** The eye's height over the island's middle at the farthest zoom, at the rig's lowest tilt there. */
export function farEyeHeight(stage: Stage, span: number): number {
  const { camera } = stage
  const lens = { fov: camera.fov, aspect: camera.aspect, far: camera.far }
  const far = distanceRange(
    islandWorld(span, () => 0, 0),
    lens,
  )[1]
  return far * Math.sin((RIG_LIMITS.highFloor * Math.PI) / 180)
}

export function createIslandAir(
  stage: Stage,
  opts: { light: () => DayLight; span: number; seed: number; sea: number; knobs: AtmoKnobs },
): IslandAir {
  const { span, knobs } = opts
  if (!knobs.on) return { dispose() {} }
  const horizon: Horizon = createHorizon(stage, { centre: [0, 0], sea: opts.sea, span, haze: knobs.haze })
  const coverage = Math.min(1, DEFAULT_ATMOSPHERE.coverage * knobs.clouds)
  const atmosphere: Atmosphere = createAtmosphere(stage, {
    light: opts.light,
    centre: [0, 0],
    reach: span,
    seed: opts.seed,
    deck: {
      centre: [0, 0],
      radius: opts.sea,
      height: deckHeight(farEyeHeight(stage, span), TALLEST),
      span,
    },
    params: { coverage, clouds: coverage > 0, shadows: coverage > 0 },
  })
  return {
    dispose() {
      atmosphere.dispose()
      horizon.dispose()
    },
  }
}
