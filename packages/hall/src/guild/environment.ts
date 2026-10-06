import type { Model } from "@guildhall/core"

/**
 * The world's conditions (ADR 0007): time of day, weather, temperature. One pure function of the
 * clock, the session model and the viewer's settings, computed by the store ~10×/s. Every visual
 * layer (sky, lights, water, grass, rain, life) reads `Environment` and nothing else, so they all
 * agree on what time it is and what the weather is doing.
 *
 * What drives what (each idea must mean something — docs/ideas.md):
 *   time of day   the viewer's real clock, a compressed demo day, or a fixed hour
 *   weather       repo health: the share of recent deeds that failed, and failed sessions
 *   temperature   activity: how busy the guild has been lately (busy = warm, long quiet = cold)
 */

export type Weather = "clear" | "cloudy" | "rain" | "storm" | "snow"
export type TimeMode = "real" | "cycle" | "fixed"

export interface EnvironmentSettings {
  /** real: the viewer's clock · cycle: one day every `cycleMinutes` · fixed: always `hour`. */
  time: TimeMode
  hour: number
  cycleMinutes: number
  /** "auto" follows repo health and activity; anything else pins the weather (the demo's lever). */
  weather: Weather | "auto"
}

export const DEFAULT_SETTINGS: EnvironmentSettings = {
  time: "real",
  hour: 10,
  cycleMinutes: 6,
  weather: "auto",
}

export interface EnvironmentInput {
  /** Wall clock, ms since the epoch: real time of day. */
  wallClock: number
  /** Run time, ms (simulated or live): drives the demo cycle and the recent-window maths. */
  runTime: number
  /** `Change.at` of run time 0 — to turn `at` into run time. */
  runStart: number
  model: Model
  settings: EnvironmentSettings
}

export type Vec3 = readonly [x: number, y: number, z: number]

export interface Environment {
  /** 0–24, local. */
  hour: number
  /** 0 at night, 1 at noon; smooth through dawn and dusk. */
  daylight: number
  /** Unit vector from the ground towards the sun (y < 0: below the horizon). */
  sun: Vec3
  /** Unit vector towards the moon: roughly opposite the sun. */
  moon: Vec3
  weather: Weather
  /** 0–1 each. */
  cloudCover: number
  precipitation: number
  wind: number
  /** Run time (ms) of the latest lightning strike, for a storm's flashes; -1 when none. */
  lightningAt: number
  /** Degrees Celsius: below ~0 rain becomes snow. */
  temperature: number
  /** 0–1: share of recent deeds that succeeded (1 with no data). */
  health: number
  /** 0–1: how busy the guild is right now. */
  activity: number
}

const TAU = Math.PI * 2

/** The hour the settings ask for. */
export function hourOf(input: Pick<EnvironmentInput, "wallClock" | "runTime" | "settings">): number {
  const { settings } = input
  if (settings.time === "fixed") return ((settings.hour % 24) + 24) % 24
  if (settings.time === "cycle") {
    const day = Math.max(0.5, settings.cycleMinutes) * 60_000
    // Start the demo day at 7 am so the first thing a visitor sees is a sunrise.
    return (7 + (input.runTime / day) * 24) % 24
  }
  const date = new Date(input.wallClock)
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
}

/**
 * Sun and moon from the hour: the sun rises in the east (+x) at 6, is highest at noon, sets in the
 * west at 18; its arc leans south (+z) so shadows fall towards the back of the hall.
 */
export function skyOf(hour: number): Pick<Environment, "hour" | "daylight" | "sun" | "moon"> {
  const angle = ((hour - 6) / 24) * TAU
  const elevation = Math.sin(angle)
  const sun: Vec3 = normalize([Math.cos(angle), elevation, 0.45])
  const moon: Vec3 = normalize([-sun[0], -sun[1] * 0.85 + 0.15, 0.35])
  const daylight = smoothstep(-0.12, 0.35, elevation)
  return { hour, daylight, sun, moon }
}

/**
 * The world for this moment. The weather and temperature parts are deliberately simple here
 * (clear, mild); scene/weather's author replaces them with the full model (task: Weather).
 */
export function environmentOf(input: EnvironmentInput): Environment {
  const sky = skyOf(hourOf(input))
  const weather = input.settings.weather === "auto" ? "clear" : input.settings.weather
  return {
    ...sky,
    weather,
    cloudCover: weather === "clear" ? 0.15 : weather === "cloudy" ? 0.6 : 0.9,
    precipitation: weather === "rain" || weather === "snow" ? 0.6 : weather === "storm" ? 1 : 0,
    wind: weather === "storm" ? 0.9 : 0.25,
    lightningAt: -1,
    temperature: weather === "snow" ? -3 : 18,
    health: 1,
    activity: 0,
  }
}

function normalize([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
