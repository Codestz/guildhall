/**
 * Day and night for a town: one `setHour(h)` moves the sun or the moon, the sky, the haze, the light
 * sources' glow, the lit windows and the lamplight together; `cycle(speed)` runs the clock. The town's
 * lights come from `townLights` (packages/world): append its `pieces` to the batch, hand its `points`
 * and `windows` here.
 */
import type { TownLights } from "@guildhall/world"
import type { Sky } from "../sky.ts"
import type { Stage } from "../stage.ts"
import { setGlow, setNightGrade } from "./glow.ts"
import { createLamps, MAX_LIGHTS } from "./lamps.ts"
import { createWindows } from "./windows.ts"

export { GLOW_SWATCHES, patchGlow, setGlow, setNightGrade } from "./glow.ts"
export { MAX_LIGHTS } from "./lamps.ts"
export { windowsDark } from "./windows.ts"

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
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
  stats(): NightStats
  dispose(): void
}

export function createNight(
  stage: Pick<Stage, "scene" | "getCamera" | "onFrame">,
  lights: Pick<TownLights, "points" | "windows">,
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
    setGlow(light.lamps)
    // The grade comes in with the dusk (blue hour), ahead of the stars.
    setNightGrade(1 - smoothstep(-10, 3, light.elevation))
    windows.update(light.lamps, light.night, hour)
  }
  setHour(hour)

  const unsubscribe = stage.onFrame((dt) => {
    if (speed !== 0) setHour(hour + speed * dt)
    lamps.update(opts.sky.light().lamps, dt)
  })

  return {
    setHour,
    hour: () => hour,
    cycle(next) {
      speed = next
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
