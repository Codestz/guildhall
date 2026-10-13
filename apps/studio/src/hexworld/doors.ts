/**
 * Doors that open on the hex island (decisions.md "doors are dynamic"), driven by the day and by life:
 *
 *   gates     open by day (DAY_OPEN to DAY_SHUT) and whenever someone is within GATE_NEAR of one, shut
 *             at night when nobody is near, swinging over GATE_SWING (render doors.ts);
 *   doorways  a building's door opens as someone goes in or comes out (life's door passes, world
 *             `doorPasses`): it swings in a little before they reach it and shuts behind them.
 *
 * Only a handful move at once: the gates ask who is near a few times a second, the doorways find the
 * passes round the clock by a binary search; a still frame writes nothing.
 */
import {
  type BatchInstance,
  createDoorways,
  createGates,
  type Doorways,
  type Gates,
  type Stage,
} from "@guildhall/render"
import type { DoorPass, HexDoorway } from "@guildhall/world"
import { SPEEDUP } from "./life.ts"

/** Hours a gate stands open whoever is about. */
export const DAY_OPEN = 6.5
export const DAY_SHUT = 20.5
/** Metres from a gate within which someone opens it. */
export const GATE_NEAR = 6
/** How often the gates look for people, seconds. */
const LOOK_EVERY = 0.2
/** Real seconds a door opens before someone reaches it, and stays open after they are through. */
const BEFORE = 1.1
const AFTER = 1.0
/** Real seconds a door takes to swing. */
const SWING = 0.55
/** How far from its doorway a pass may be and still be its door's, metres. */
const SNAP = 0.8

export interface DoorLife {
  /** The day's clock life runs on, hours. */
  clock(): number
  /** Whether anyone outdoors is within r metres of (x, z). */
  near(x: number, z: number, r: number): boolean
  /** Every townsfolk's passes through a door in the day, in time order (hours). */
  passes(): readonly DoorPass[]
}

export interface Doors {
  gates: Gates | null
  doorways: Doorways
  /** Doors open now (doorways), for the stats. */
  readonly open: number
  dispose(): void
}

/** A pass, timed and tied to its doorway. */
interface Timed {
  t: number
  door: number
  enter: boolean
}

export async function createDoors(
  stage: Stage,
  opts: {
    gates: readonly BatchInstance[]
    load: Parameters<typeof createGates>[2]
    doorways: readonly HexDoorway[]
    life: DoorLife | null
    /** Every doorway drawn open (`?doors=open`: to check them against the meshes). */
    all?: boolean
    /** The screen's clock, hours (what day and night follow). */
    hour(): number
  },
): Promise<Doors> {
  const gates = opts.gates.length ? await createGates(stage, opts.gates, opts.load) : null
  const doorways = createDoorways(stage, opts.doorways)
  // ---- the passes, each tied to the doorway it goes through ----
  const cell = (x: number, z: number) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`
  const grid = new Map<string, number[]>()
  opts.doorways.forEach((d, k) => {
    const key = cell(d.x, d.z)
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(k)
  })
  const doorAt = (x: number, z: number): number => {
    let best = -1
    let bd = SNAP
    const cx = Math.floor(x / 2)
    const cz = Math.floor(z / 2)
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const k of grid.get(`${cx + a},${cz + b}`) ?? []) {
          const d = opts.doorways[k]!
          const e = Math.hypot(d.x - x, d.z - z)
          if (e < bd) {
            bd = e
            best = k
          }
        }
    return best
  }
  const timed: Timed[] = []
  for (const p of opts.life?.passes() ?? []) {
    const door = doorAt(p.at[0], p.at[2])
    if (door >= 0) timed.push({ t: p.t, door, enter: p.enter })
  }
  timed.sort((a, b) => a.t - b.t)
  /** Real seconds as day-hours, at life's pace. */
  const H = SPEEDUP / 3600
  const reach = (BEFORE + SWING + AFTER + SWING) * H
  const first = (t: number) => {
    let lo = 0
    let hi = timed.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (timed[mid]!.t < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  /** How open a door is `s` real seconds after a pass (negative: before it). */
  const profile = (s: number, enter: boolean) => {
    // going in: open as they come up to it; coming out: open just as they step out
    const lead = enter ? BEFORE : SWING * 0.6
    const opening = (s + lead + SWING) / SWING
    const closing = (AFTER + SWING - s) / SWING
    return Math.max(0, Math.min(1, opening, closing))
  }
  const open = new Map<number, number>()
  const each = (from: number, to: number, fn: (p: Timed) => void) => {
    for (let k = first(from); k < timed.length && timed[k]!.t <= to; k++) fn(timed[k]!)
  }
  let since = LOOK_EVERY
  const near: boolean[] = gates ? gates.at.map(() => false) : []
  let count = 0
  const off = stage.onFrame((dt) => {
    const hour = opts.hour()
    // ---- gates ----
    if (gates) {
      since += dt
      if (since >= LOOK_EVERY && opts.life) {
        since = 0
        gates.at.forEach((g, k) => {
          near[k] = opts.life!.near(g[0], g[2], GATE_NEAR)
        })
      }
      const day = hour >= DAY_OPEN && hour < DAY_SHUT
      gates.update(dt, (k) => day || near[k]!)
    }
    // ---- doorways: the passes round the clock (and across midnight) ----
    open.clear()
    if (opts.all) for (let k = 0; k < opts.doorways.length; k++) open.set(k, 1)
    if (opts.life && timed.length) {
      const now = opts.life.clock()
      const add = (p: Timed, at: number) => {
        const v = profile((at - p.t) / H, p.enter)
        if (v > (open.get(p.door) ?? 0)) open.set(p.door, v)
      }
      each(now - reach, now + reach, (p) => add(p, now))
      if (now - reach < 0) each(now - reach + 24, 24, (p) => add(p, now + 24))
      if (now + reach > 24) each(0, now + reach - 24, (p) => add(p, now - 24))
    }
    doorways.show(open)
    count = open.size
    // lamplight inside by night
    const dusk = Math.min(1, Math.max(0, (hour - 18.5) / 1.5))
    const dawn = Math.min(1, Math.max(0, (7 - hour) / 1.5))
    doorways.setNight(Math.max(dusk, dawn))
  })
  return {
    gates,
    doorways,
    get open() {
      return count
    },
    dispose() {
      off()
      gates?.dispose()
      doorways.dispose()
    },
  }
}
