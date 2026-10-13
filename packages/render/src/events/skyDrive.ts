/**
 * The CI weather drive (plan-hud-events §2 "CI: weather"): it moves the existing sky, cloud deck and
 * light toward clear, cloudy or a storm, easing over a few seconds, and never touches the clock.
 *
 * It wraps the sky (`drive.sky`, handed to the night, the air and the post in place of the sky): each
 * `setHour` lets the sky write the hour's light as always, then lays the weather over what it just
 * wrote (`weathered`: the key dimmed, the sky greyed, the exposure lowered), and `light()` answers the
 * weathered light, so the clouds' colours, the water's reflections and the windows follow. Clear lays
 * nothing over it: the picture is the sky's own, bit for bit. While the weather eases, it re-runs the
 * hour (`retint`) each frame; settled, it writes nothing.
 *
 * A storm also rains (rain.ts) and throws lightning (bolt.ts) over `strikeAt` (the castle): a flash
 * of the whole frame through the exposure and a bolt, every 4–11 s of the FX clock (seeded, so a
 * replay strikes the same).
 */
import type { Mesh, ShaderMaterial } from "three"
import { AIR } from "../atmosphere/air.ts"
import type { Atmosphere } from "../atmosphere/index.ts"
import { cloudLook } from "../atmosphere/look.ts"
import { ATMOSPHERE } from "../atmosphere/shade.ts"
import { applyLight, type DayLight } from "../light.ts"
import type { Sky } from "../sky.ts"
import type { Stage } from "../stage.ts"
import { createBolt, flashAt, nextStrike, STRIKE_S } from "./bolt.ts"
import { random, transition } from "./ease.ts"
import { createRain } from "./rain.ts"
import {
  BASE_COVER,
  BASE_WIND,
  mixOf,
  slateOf,
  type WeatherKind,
  type WeatherLook,
  type WeatherMix,
  weathered,
  weatherLook,
} from "./weather.ts"

/** Seconds a change of weather takes. */
export const WEATHER_EASE_S = 4

export interface SkyDriveOpts {
  /** The sky it drives (the island's `createSky`). */
  sky: Sky
  /**
   * Re-runs the hour through the wrapped sky while the weather eases (the night's `setHour(hour())`,
   * so the windows follow too); by default the sky's own `setHour` at its hour.
   */
  retint?: () => void
  /** Where lightning strikes (the top of the castle's keep); none: the sky flashes, no bolt. */
  strikeAt?: readonly [number, number, number] | null
  /** The weather to start in, already settled (clear by default). */
  weather?: WeatherKind
  seed?: number
  /** A storm lights the lanterns and windows by day too (the night's lamp pools: two more draws then). */
  lamps?: boolean
}

export interface SkyDriveStats {
  weather: WeatherKind
  mix: WeatherMix
  strikes: number
  /** Mean CPU ms a frame over the last second (the drive's frame hook plus any retint it ran). */
  ms: number
}

export interface SkyDrive {
  /** The sky with the weather over it: hand it to whatever reads the light (night, air, post). */
  sky: Sky
  /** The cloud deck to cover and darken (the island's air), once it exists. */
  attach(atmosphere: Atmosphere | null): void
  /** Moves toward a weather, easing (or at once with `now`, for shots). */
  set(kind: WeatherKind, now?: boolean): void
  weather(): WeatherKind
  /**
   * A strike now, in any weather. `hold` (shots): the flash stays at that many seconds after it, and
   * no other strike comes, until the next `strike()`.
   */
  strike(hold?: number): void
  stats(): SkyDriveStats
  dispose(): void
}

type Dome = Mesh<never, ShaderMaterial>

export function createSkyDrive(stage: Stage, opts: SkyDriveOpts): SkyDrive {
  const base = opts.sky
  const retint = opts.retint ?? (() => wrapped.setHour(base.light().hour))
  const next = random(opts.seed ?? 1)
  let kind: WeatherKind = opts.weather ?? "clear"
  const start = mixOf(kind)
  const cloud = transition(start.cloud, WEATHER_EASE_S)
  const storm = transition(start.storm, WEATHER_EASE_S)
  let t = 0
  let atmosphere: Atmosphere | null = null
  let cover = { coverage: BASE_COVER, wind: BASE_WIND }
  let applied: WeatherMix = { ...start }
  const lamps = { lamps: opts.lamps === true }
  let look: WeatherLook = weatherLook(applied, cover, lamps)
  let light: DayLight = base.light()
  let exposure = stage.renderer.toneMappingExposure
  let rain: ReturnType<typeof createRain> | null = null
  let bolt: ReturnType<typeof createBolt> | null = null
  let strikeT = Number.NEGATIVE_INFINITY
  let nextAt = 2
  let strikes = 0
  let flashing = false
  let cloudKey: unknown = null
  let costs: number[] = []
  let cost = 0

  const dome = () => stage.scene.getObjectByName("sky") as Dome | undefined
  const deck = () => stage.scene.getObjectByName("cloud deck") as Dome | undefined

  /** Lays the weather over what the sky has just written for the hour (only ever right after it). */
  const lay = () => {
    look = weatherLook(applied, cover, lamps)
    const clear = applied.cloud === 0 && applied.storm === 0
    light = clear ? base.light() : weathered(base.light(), look)
    if (atmosphere) {
      const p = atmosphere.params()
      if (p.coverage !== look.coverage || p.windSpeed !== look.wind)
        atmosphere.set({ coverage: look.coverage, windSpeed: look.wind })
    }
    exposure = stage.renderer.toneMappingExposure
    if (clear) return
    const shadow = stage.sun.shadow.intensity
    applyLight(stage, light)
    stage.sun.shadow.intensity = shadow * look.shadow
    exposure = stage.renderer.toneMappingExposure
    AIR.uAirZenith.value.copy(light.zenith)
    AIR.uAirHorizon.value.copy(light.horizon)
    AIR.uAirGlow.value.copy(light.glow)
    slateOf(AIR.uAirAway.value, look.grey, look.slate, AIR.uAirAway.value)
    for (const c of [AIR.uSkyTop, AIR.uSkyAway, AIR.uSkyToward])
      slateOf(c.value, look.grey, look.slate, c.value)
    AIR.uAirSplit.value *= 1 - look.grey
    AIR.uSkyIntensity.value *= look.fill
    AIR.uGradeSaturation.value *= look.saturation
    if (AIR.uHazeDensity.value > 0) AIR.uHazeDensity.value *= look.haze
    const u = dome()?.material.uniforms
    if (u) {
      for (const k of ["sunDisc", "moonDisc", "stars"] as const) if (u[k]) u[k].value *= look.discs
    }
  }

  const wrapped: Sky = {
    setHour(hour) {
      base.setHour(hour)
      lay()
    },
    light: () => light,
    setLook: (next) => {
      base.setLook(next)
      lay()
    },
    look: () => base.look(),
    dispose: () => base.dispose(),
  }

  /** The clouds' own colour, darker under a storm (the atmosphere paints them by the hour). */
  const toneClouds = () => {
    if (look.cloudTone >= 1) {
      cloudKey = null
      return
    }
    const key = `${light.hour}|${look.coverage}|${look.cloudTone}|${light.zenith.getHexString()}`
    if (key === cloudKey) return
    cloudKey = key
    const tone = cloudLook(light, look.coverage)
    tone.lit.multiplyScalar(look.cloudTone)
    tone.shade.multiplyScalar(look.cloudTone * 0.92)
    const u = deck()?.material.uniforms
    if (u?.uLit && u.uShade) {
      u.uLit.value.copy(tone.lit)
      u.uShade.value.copy(tone.shade)
    }
    ATMOSPHERE.uCloudLit.value.copy(tone.lit)
    AIR.uCirrusLit.value.copy(tone.lit)
  }

  const frame = (dt: number) => {
    const t0 = performance.now()
    t += Math.min(dt, 0.1)
    const want = { cloud: cloud.at(t), storm: storm.at(t) }
    if (want.cloud !== applied.cloud || want.storm !== applied.storm) {
      applied = want
      retint()
    }
    // the deck's colours after the atmosphere has painted them this frame (this hook runs after its own)
    if (atmosphere) toneClouds()
    if (look.rain > 0 && !rain) rain = createRain(stage, opts.seed ?? 1)
    if (rain) {
      const heading = ((atmosphere?.params().windHeading ?? 30) * Math.PI) / 180
      rain.set(look.rain, [Math.cos(heading) * look.wind * 0.6, Math.sin(heading) * look.wind * 0.6])
    }
    if (look.lightning && t >= nextAt && held === null) strike()
    const since = held ?? t - strikeT
    const f = since < STRIKE_S ? flashAt(since) : 0
    if (f > 0 || flashing) {
      stage.renderer.toneMappingExposure = exposure * (1 + 1.2 * f)
      bolt?.show(f)
      flashing = f > 0
    }
    cost += performance.now() - t0
    costs.push(cost)
    if (costs.length > 60) costs = costs.slice(-60)
    cost = 0
  }

  let held: number | null = null
  const strike = (hold?: number) => {
    held = hold ?? null
    strikeT = t
    nextAt = t + nextStrike(next)
    strikes++
    const at = opts.strikeAt
    if (!at) return
    bolt ??= createBolt(stage)
    // from the cloud base, or from well up when the deck is far higher (the bolt's jags then show)
    const deck = (ATMOSPHERE.uCloudHeight.value as number) || at[1] + 80
    const top = Math.min(deck, at[1] + 90)
    const drift = (next() - 0.5) * 12
    bolt.strike([at[0] + drift, Math.max(top, at[1] + 30), at[2] - drift], at, Math.floor(next() * 1e9))
  }

  let off = stage.onFrame(frame)
  if (start.cloud > 0 || start.storm > 0) wrapped.setHour(base.light().hour)

  return {
    sky: wrapped,
    attach(next) {
      atmosphere = next
      if (next) {
        const p = next.params()
        cover = { coverage: p.coverage, wind: p.windSpeed }
      }
      // after the atmosphere's own frame hook, so the clouds' tone is laid over its paint
      off()
      off = stage.onFrame(frame)
      retint()
    },
    set(next, now = false) {
      kind = next
      const m = mixOf(next)
      if (now) {
        cloud.jump(m.cloud)
        storm.jump(m.storm)
      } else {
        cloud.to(m.cloud, t)
        storm.to(m.storm, t)
      }
    },
    weather: () => kind,
    strike: (hold) => strike(hold),
    stats: () => ({
      weather: kind,
      mix: { ...applied },
      strikes,
      ms: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
    }),
    dispose() {
      off()
      rain?.dispose()
      bolt?.dispose()
      if (atmosphere) atmosphere.set({ coverage: cover.coverage, windSpeed: cover.wind })
    },
  }
}
