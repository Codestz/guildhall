import type { Chronicle } from "./format.ts"
import type { GrowthPlan } from "./growth.ts"
import type { GrowthStory } from "./growthStory.ts"

/**
 * The growth timelapse's transport (ADR 0021): which repo is asked to grow, the film's clock, play,
 * pause, speed and seek. No three, no React: the scene drives `tick` once a frame and draws
 * whatever `t` says (scene/growth), the HUD reads and steers it (hud/TimelineGrowth.tsx).
 *
 *   off       nothing asked: the hall as always
 *   waiting   asked, the island or its history still loading (the land stays under the sea)
 *   playing / paused
 *   failed    no history could be had for this repo: the island is shown as it is today
 *
 * `?grow` (with `?repo=`) asks on load; `?grow=2017` starts paused at that year; `grow=t:30` at a
 * film time. Any change notifies subscribers (not the clock: it moves every frame, read it directly).
 */

export type GrowthPhase = "off" | "waiting" | "playing" | "paused" | "failed"

export interface GrowthFilm {
  repo: string
  plan: GrowthPlan
  story: GrowthStory
  chronicle: Chronicle
  /** The chronicle's span, for labels. */
  start: number
  end: number
}

/** Where a link asks the film to start: a year (paused there) or a film time (paused there). */
export type GrowthStart = { year: number } | { t: number } | undefined

export const SPEEDS = [1, 2, 4] as const

/** Reads `?grow` from a page's search: undefined when not asked. */
export function growParam(search: string): { start: GrowthStart } | undefined {
  const params = new URLSearchParams(search)
  if (!params.has("grow")) return undefined
  const value = params.get("grow") ?? ""
  const t = /^t:(\d+(?:\.\d+)?)$/.exec(value)
  if (t) return { start: { t: Number(t[1]) } }
  const year = /^(\d{4})$/.exec(value)
  return { start: year ? { year: Number(year[1]) } : undefined }
}

class GrowthControl {
  phase: GrowthPhase = "off"
  repo: string | undefined
  film: GrowthFilm | undefined
  /** Film time, seconds. */
  t = 0
  speed: (typeof SPEEDS)[number] = 1
  start: GrowthStart
  failure: string | undefined
  /** Bumps on every notified change (useSyncExternalStore's snapshot). */
  version = 0
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  snapshot = (): number => this.version

  /** Asks `repo`'s island to grow, from its first commit (or `start`). */
  request(repo: string, start?: GrowthStart): void {
    this.repo = repo
    this.start = start
    this.film = undefined
    this.failure = undefined
    this.t = 0
    this.set("waiting")
  }

  /** The film is ready (scene/growth built it): play from the start, or pause where the link asked. */
  ready(film: GrowthFilm, startAt = 0, paused = false): void {
    this.film = film
    this.t = Math.min(film.plan.duration, Math.max(0, startAt))
    this.set(paused ? "paused" : "playing")
  }

  fail(reason: string): void {
    this.failure = reason
    this.film = undefined
    this.set("failed")
  }

  play(): void {
    if (!this.film) return
    if (this.t >= this.film.plan.duration) this.t = 0
    this.set("playing")
  }
  pause(): void {
    if (this.film) this.set("paused")
  }
  toggle(): void {
    if (this.phase === "playing") this.pause()
    else this.play()
  }
  seek(t: number): void {
    if (!this.film) return
    this.t = Math.min(this.film.plan.duration, Math.max(0, t))
    this.changed()
  }
  setSpeed(speed: (typeof SPEEDS)[number]): void {
    this.speed = speed
    this.changed()
  }
  /** Ends the film: the hall goes back to the island as it is today. */
  stop(): void {
    this.film = undefined
    this.repo = undefined
    this.set("off")
  }

  /** Advances the clock (the scene, once a frame). Returns true when the film just ended. */
  tick(delta: number): boolean {
    if (this.phase !== "playing" || !this.film) return false
    this.t += Math.min(delta, 0.1) * this.speed
    if (this.t < this.film.plan.duration) return false
    this.t = this.film.plan.duration
    this.stop()
    return true
  }

  private set(phase: GrowthPhase): void {
    this.phase = phase
    this.changed()
  }
  private changed(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }
}

export const growth = new GrowthControl()

/** True while the island is under the film's control (the scene hides what lives on today's island). */
export const growing = (): boolean =>
  growth.phase === "waiting" || growth.phase === "playing" || growth.phase === "paused"
