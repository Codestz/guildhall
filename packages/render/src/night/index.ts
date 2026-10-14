/**
 * Day and night for a town: one `setHour(h)` moves the sun or the moon, the sky, the haze, the light
 * sources' glow, the lit windows and the lamplight together; `cycle(speed)` runs the clock. The town's
 * lights are its lamps' `points` and its lit `windows`.
 */
import type { DayLight } from "../light.ts"
import type { Sky } from "../sky.ts"
import type { Stage } from "../stage.ts"
import { setGlow, setNightGrade } from "./glow.ts"
import { createLamps, type LampLit, type LightPoint, MAX_LIGHTS } from "./lamps.ts"
import { createWindows, type WindowLight } from "./windows.ts"

export { GLOW_SWATCHES, patchGlow, setGlow, setNightGrade } from "./glow.ts"
export { type LampLit, litLevel, MAX_LIGHTS } from "./lamps.ts"
export { windowsDark } from "./windows.ts"

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The lamps' light on the ground: the lanterns glow from late afternoon, but a pool of lamplight only
 * shows once the sun is low and going (in daylight it reads as a yellow stain on the street).
 */
export function poolLevel(light: Pick<DayLight, "lamps" | "elevation">): number {
  return light.lamps * (1 - 0.9 * smoothstep(-2, 12, light.elevation))
}

export interface NightOpts {
  /** The sky that owns the sun, the moon and the haze (`createSky`). */
  sky: Sky
  /** The hour to start at; the sky's own when left out. */
  hour?: number
}

export interface NightStats {
  hour: number
  /** Lamplight level, 0 (day) to 1. */
  lamps: number
  /** Real point lights lit last frame (at most MAX_LIGHTS). */
  lights: number
  /** Ground light pools (one per lamp) and lit-window panes drawn. */
  pools: number
  windows: number
}

export interface Night {
  /** Moves everything to `hour` (0–24, wraps). */
  setHour(hour: number): void
  hour(): number
  /** Runs the clock at `speed` hours per second (0 stops it). */
  cycle(speed: number): void
  /**
   * Leaves dark what stands where `at(x, z)` says (a history replay's land not yet risen): its lamps'
   * pools, halos and real lights, and its lit windows. Null lights the whole town again.
   */
  hide(at: ((x: number, z: number) => boolean) | null): void
  /** The lamps lit by hand at their hours (a lamplighter's round); null: all with the town's level. */
  schedule(lit: readonly LampLit[] | null): void
  stats(): NightStats
  dispose(): void
}

export function createNight(
  stage: Pick<Stage, "scene" | "getCamera" | "onFrame">,
  lights: { points: readonly LightPoint[]; windows: readonly WindowLight[] },
  opts: NightOpts,
): Night {
  const lamps = createLamps(stage, lights.points)
  const windows = createWindows(stage, lights.windows)
  let hour = opts.hour ?? opts.sky.light().hour
  let speed = 0

  const setHour = (h: number) => {
    hour = ((h % 24) + 24) % 24
    opts.sky.setHour(hour)
    const light = opts.sky.light()
    setGlow(light.fire)
    // The grade comes in with the dusk (blue hour), ahead of the stars.
    setNightGrade(1 - smoothstep(-10, 3, light.elevation))
    windows.update(light.lamps, light.night, hour)
    lamps.setHour(hour)
  }
  setHour(hour)

  const unsubscribe = stage.onFrame((dt) => {
    if (speed !== 0) setHour(hour + speed * dt)
    lamps.update(poolLevel(opts.sky.light()), dt)
  })

  return {
    setHour,
    hour: () => hour,
    cycle(next) {
      speed = next
    },
    schedule(lit) {
      lamps.schedule(lit)
    },
    hide(at) {
      lamps.hide(at)
      windows.hide(at)
    },
    stats: () => ({
      hour,
      lamps: opts.sky.light().lamps,
      lights: Math.min(MAX_LIGHTS, lamps.lit()),
      pools: lights.points.length,
      windows: windows.count,
    }),
    dispose() {
      unsubscribe()
      lamps.dispose()
      windows.dispose()
      setGlow(0)
      setNightGrade(0)
    },
  }
}
