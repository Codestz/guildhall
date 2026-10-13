/**
 * The island's air (V1's look, ported to V2's WebGL): the sea mist (render atmosphere/mist.ts: a fog
 * ring that melts the sea into the sky before its end shows, and low banks of mist off the coast), the
 * clouds in a ring over the sea rather than over the town, lower and fewer, and their shadows crossing
 * land and sea. Debug knobs, all multipliers of today's look: `?mist=0..2` the banks, `?haze=0..2` the
 * fog ring, `?clouds=0..2` the cloud cover (0: no clouds, no shadows), `?atmo=0` all of it off.
 */
import {
  type Atmosphere,
  createAtmosphere,
  createMist,
  type DayLight,
  DEFAULT_ATMOSPHERE,
  fogRing,
  type Mist,
  type ShoreField,
  type Stage,
} from "@guildhall/render"

export interface AtmoKnobs {
  on: boolean
  mist: number
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
    mist: knob(query, "mist"),
    haze: knob(query, "haze"),
    clouds: knob(query, "clouds"),
  }
}

export interface IslandAir {
  /** The shore field arrived: the mist keeps off the coast with it. */
  setShore(field: ShoreField): void
  dispose(): void
}

/** The clouds' base heights over the island's sea, metres: low, as V1's (60–95 over the town before). */
const CLOUD_HEIGHT: [number, number] = [20, 34]

export function createIslandAir(
  stage: Stage,
  opts: { light: () => DayLight; span: number; seed: number; level: number; knobs: AtmoKnobs },
): IslandAir {
  const { span, knobs } = opts
  if (!knobs.on) return { setShore() {}, dispose() {} }
  const mist: Mist = createMist(stage, {
    light: opts.light,
    centre: [0, 0],
    radius: span,
    level: opts.level,
    params: { mist: knobs.mist, haze: knobs.haze },
  })
  const ring = fogRing(span, Math.max(knobs.haze, 0.5))
  const coverage = DEFAULT_ATMOSPHERE.coverage * knobs.clouds
  const atmosphere: Atmosphere = createAtmosphere(stage, {
    light: opts.light,
    centre: [0, 0],
    reach: span,
    seed: opts.seed,
    height: CLOUD_HEIGHT,
    // over the sea round the island, gone before the fog ring is whole
    ring: [span * 1.1, span * 1.4, ring.whole * 0.8, ring.whole * 0.98],
    params: { coverage: Math.min(1, coverage), clouds: coverage > 0, shadows: coverage > 0 },
  })
  return {
    setShore: (field) => mist.setShore(field),
    dispose() {
      atmosphere.dispose()
      mist.dispose()
    },
  }
}
