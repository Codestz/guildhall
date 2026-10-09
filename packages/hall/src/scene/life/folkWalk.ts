import { slotAt } from "../../world/folk/day.ts"
import type { Folk, Slot, Stop } from "../../world/folk/types.ts"
import type { Spot } from "../../world/layout.ts"

/**
 * One folk's day on their feet (world/folk, scene/life/Folk.tsx): the schedule says which part of
 * the day it is, the walker does the rest: out of the door, along the roads to a stop, its clip for
 * a while, on to the next, back in at the door when the day turns. No three, no clock but the `dt`
 * it is given, so a test can live a day in a loop.
 *
 * What it does is a queue of steps: walk along a path, stand at a stop, pass through a door (or a
 * wall's stair) — hidden a while, out the other side. A part of the day starting replaces the
 * queue; a part already running when the walker is made (or the clock jumps) is joined where it
 * would be: `snap`.
 */

/** What a walker needs of the island: its roads, the venues' room, the ground's height. */
export interface Around {
  route(from: Spot, to: Spot): readonly Spot[]
  /** Is `venue` holding all it can (`cap`) inside and on the way, `self` apart? */
  crowded(venue: string, cap: number, self: string): boolean
  ground(x: number, z: number): number
}

type Step =
  | { kind: "walk"; path: readonly Spot[]; i: number }
  | { kind: "stand"; stop: Stop; left: number }
  | {
      kind: "pass"
      /** Walk (straight) here, hide for `left`, come out at `appear` on `level`. */
      to: Spot
      appear: Spot
      level: number
      left: number
      /** Where they walk on to once out. */
      onward?: Spot
      venue?: string
      cap?: number
      hidden: boolean
    }

/** Close enough to a spot to be there. */
const ARRIVED = 0.2
/** A wall's stair takes this long. */
const STAIR_S = 1.4
/** Slower along a wall's walk. */
const WALK_ON_WALL = 0.85
/** The clip a walker's feet carry the whole of. */
export const WALK = "Walking_A"
/** The pace the baked walk is at 1×: units a second. */
const STRIDE = 2.7

export class Walker {
  x = 0
  z = 0
  /** Heading (rotation-y). */
  yaw = 0
  /** Height above the ground: a wall's walk. */
  level = 0
  /** In the open (drawn); false while behind a door or in the wall. */
  visible = true
  clip = "Idle_A"
  /** Clip speed: the walk matched to the pace. */
  rate = 1
  moving = false
  /** The venue (or home) they are inside, while they are. */
  venue: string | undefined
  /** The venue whose door they are walking to, until they are in (or turned away): it counts them already. */
  bound: string | undefined
  slot: Slot = "home"
  /** How many times a door has opened for them, and where the last was. */
  opened = 0
  doorAt: Spot = [0, 0]

  private stops: readonly Stop[] = []
  private index = 0
  private dir: 1 | -1 = 1
  private steps: Step[] = []
  /** Where they come out if the day turns while they are hidden, and where they walk on to. */
  private exit: { at: Spot; level: number; onward?: Spot } | undefined
  private pick: number
  /** The level the queue ends on (a stair in it changes it before they are there). */
  private ahead = 0

  constructor(
    readonly folk: Folk,
    private readonly around: Around,
  ) {
    this.pick = hash(folk.id)
  }

  /** Joins the day at `hour`: where they would be, doing what they would be doing. */
  snap(hour: number, wet = false): void {
    const slot = slotAt(this.folk, hour, wet)
    this.slot = slot
    this.setStops(slot)
    // Joined part-way through the loop: each at a stop of their own, and part-way through it.
    this.index = Math.floor(this.unit() * this.stops.length)
    const stop = this.stops[this.index]
    if (!stop) return
    this.steps.length = 0
    this.bound = undefined
    this.level = stop.up ?? 0
    this.ahead = this.level
    this.exit = undefined
    this.venue = undefined
    this.moving = false
    if (stop.door && stop.venue) {
      this.x = stop.door.sill[0]
      this.z = stop.door.sill[1]
      this.visible = false
      this.venue = stop.venue
      this.exit = { at: stop.door.sill, level: 0, onward: stop.door.step }
      this.steps.push({
        kind: "pass",
        to: stop.door.sill,
        appear: stop.door.sill,
        level: 0,
        left: this.wait(stop) * this.partway(stop),
        onward: stop.door.step,
        venue: stop.venue,
        hidden: true,
        ...(stop.cap ? { cap: stop.cap } : {}),
      })
      return
    }
    this.visible = true
    this.x = stop.at[0]
    this.z = stop.at[1]
    this.yaw = stop.face
    this.steps.push({ kind: "stand", stop, left: this.wait(stop) * this.partway(stop) })
  }

  /** One frame: `dt` seconds on, at `hour` of the world clock (`wet`: it rains). */
  update(dt: number, hour: number, wet = false): void {
    const slot = slotAt(this.folk, hour, wet)
    if (slot !== this.slot) this.begin(slot)
    this.moving = false
    let budget = this.folk.speed * dt
    // A step may finish with time (or walking) to spare: the next takes it up. Bounded: no step is free.
    for (let guard = 0; guard < 4; guard++) {
      const step = this.steps[0]
      if (!step) {
        this.plan(this.next(0))
        if (this.steps.length === 0) return
        continue
      }
      const left = this.run(step, dt, budget)
      if (left === undefined) return
      budget = left
    }
  }

  // ---- The day turns ----------------------------------------------------------------------------

  private begin(slot: Slot): void {
    this.slot = slot
    this.setStops(slot)
    this.steps.length = 0
    this.bound = undefined
    // Behind a door when it turns: out of it first.
    if (!this.visible && this.exit) {
      const { at, level, onward } = this.exit
      this.x = at[0]
      this.z = at[1]
      this.level = level
      this.visible = true
      this.venue = undefined
      this.exit = undefined
      if (onward) this.steps.push({ kind: "walk", path: [onward], i: 0 })
    }
    this.ahead = this.level
    this.plan(this.full(this.stops[0]) ? this.next(1) : this.stops[0])
  }

  private setStops(slot: Slot): void {
    this.stops = this.folk.stops[slot]
    this.index = 0
    this.dir = 1
  }

  /** Is this stop a door whose house is full? They do not queue for it: they go on to the next. */
  private full(stop: Stop | undefined): boolean {
    return !!(stop?.door && stop.venue && stop.cap && this.around.crowded(stop.venue, stop.cap, this.folk.id))
  }

  /** The next stop of the loop, back and forth, past full houses' doors (`skipped`: those passed over so far). */
  private next(skipped: number): Stop | undefined {
    const count = this.stops.length
    if (count === 0) return undefined
    if (count > 1) {
      this.index += this.dir
      if (this.index >= count) {
        this.dir = -1
        this.index = count - 2
      } else if (this.index < 0) {
        this.dir = 1
        this.index = 1
      }
    }
    const stop = this.stops[this.index]
    return this.full(stop) && skipped < count ? this.next(skipped + 1) : stop
  }

  // ---- Planning ---------------------------------------------------------------------------------

  private plan(stop: Stop | undefined): void {
    if (!stop) return
    const target = stop.door?.step ?? stop.at
    const want = stop.up ?? 0
    if (want !== this.ahead) this.stair(want)
    this.walkTo(target)
    this.bound = stop.door && stop.venue && stop.cap ? stop.venue : undefined
    if (stop.door && stop.venue) {
      this.steps.push({
        kind: "pass",
        to: stop.door.sill,
        appear: stop.door.sill,
        level: 0,
        left: this.wait(stop),
        onward: stop.door.step,
        venue: stop.venue,
        hidden: false,
        ...(stop.cap ? { cap: stop.cap } : {}),
      })
      this.steps.push({ kind: "walk", path: [stop.door.step], i: 0 })
    } else this.stand(stop)
  }

  /** Up to or down from the wall's walk, by the stair of their post. */
  private stair(want: number): void {
    const lift = this.folk.lift
    if (!lift) return
    if (want > this.level) {
      this.walkTo(lift.step)
      this.steps.push({
        kind: "pass",
        to: lift.sill,
        appear: lift.top,
        level: lift.up,
        left: STAIR_S,
        hidden: false,
      })
    } else {
      this.walkTo(lift.top)
      this.steps.push({
        kind: "pass",
        to: lift.top,
        appear: lift.sill,
        level: 0,
        left: STAIR_S,
        onward: lift.step,
        hidden: false,
      })
      this.steps.push({ kind: "walk", path: [lift.step], i: 0 })
    }
    // Planned as if they were there: the walk on is from the stair's far side.
    this.ahead = want
  }

  private walkTo(to: Spot): void {
    const from = this.end()
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) < ARRIVED) return
    // On a wall's walk: straight. At the ground: by the roads, unless a step between.
    const path = this.ahead > 0 ? [to] : this.around.route(from, to)
    this.steps.push({ kind: "walk", path, i: 0 })
  }

  /** Where the queue so far ends (or where they stand). */
  private end(): Spot {
    for (let n = this.steps.length - 1; n >= 0; n--) {
      const step = this.steps[n]
      if (step?.kind === "walk") return step.path[step.path.length - 1] ?? [this.x, this.z]
      if (step?.kind === "pass") return step.appear
    }
    return [this.x, this.z]
  }

  private stand(stop: Stop): void {
    this.steps.push({ kind: "stand", stop, left: this.wait(stop) })
  }

  /** How long they stay: the stop's time, a fifth either way and each their own. */
  private wait(stop: Stop): number {
    return Number.isFinite(stop.wait) ? stop.wait * (0.8 + 0.4 * this.unit()) : stop.wait
  }

  /** How much of a stop's time is left to someone who joins it part-way (all of it, if it has no end). */
  private partway(stop: Stop): number {
    return Number.isFinite(stop.wait) ? 0.15 + 0.85 * this.unit() : 1
  }

  /** The walker's own run of 0…1 numbers: the same every time, whatever the order of frames. */
  private unit(): number {
    this.pick = Math.imul(this.pick ^ (this.pick >>> 15), 0x2c1b3c6d) >>> 0
    return (this.pick % 1000) / 1000
  }

  // ---- Doing ------------------------------------------------------------------------------------

  /** Runs `step` for a frame; the distance left to walk, if it ended with some, else undefined. */
  private run(step: Step, dt: number, budget: number): number | undefined {
    switch (step.kind) {
      case "walk": {
        const left = this.walk(step, budget, dt)
        if (left !== undefined) this.steps.shift()
        return left
      }
      case "stand": {
        this.clip = step.stop.clip
        this.rate = 1
        this.turn(step.stop.face, dt * 5)
        if (!Number.isFinite(step.left)) return undefined
        step.left -= dt
        if (step.left <= 0) this.steps.shift()
        return undefined
      }
      case "pass":
        return this.pass(step, dt, budget)
    }
  }

  /** Walks `step` for a frame; the distance to spare once it is walked, else undefined. */
  private walk(step: Extract<Step, { kind: "walk" }>, budget: number, dt: number): number | undefined {
    const pace = this.level > 0 ? WALK_ON_WALL : 1
    let left = budget * pace
    while (step.i < step.path.length && left > 0) {
      const to = step.path[step.i] as Spot
      const dx = to[0] - this.x
      const dz = to[1] - this.z
      const d = Math.hypot(dx, dz)
      if (d <= left) {
        this.x = to[0]
        this.z = to[1]
        left -= d
        step.i++
        continue
      }
      this.x += (dx / d) * left
      this.z += (dz / d) * left
      this.turn(Math.atan2(dx, dz), dt * 9)
      this.moving = true
      this.clip = WALK
      this.rate = (this.folk.speed * pace) / STRIDE
      return undefined
    }
    return step.i >= step.path.length ? left / pace : undefined
  }

  private pass(step: Extract<Step, { kind: "pass" }>, dt: number, budget: number): number | undefined {
    if (!step.hidden) {
      // Not through a door that is full: skip it (the next stop is outside).
      if (step.venue && step.cap && this.around.crowded(step.venue, step.cap, this.folk.id)) {
        this.bound = undefined
        this.steps.shift()
        return budget
      }
      const left = this.walk({ kind: "walk", path: [step.to], i: 0 }, budget, dt)
      if (left === undefined) return undefined
      step.hidden = true
      this.bound = undefined
      this.visible = false
      if (step.venue) this.knock(step.to)
      this.venue = step.venue
      this.exit = { at: step.appear, level: step.level, ...(step.onward ? { onward: step.onward } : {}) }
      return undefined
    }
    step.left -= dt
    if (step.left > 0) return undefined
    if (step.venue) this.knock(step.to)
    this.x = step.appear[0]
    this.z = step.appear[1]
    this.level = step.level
    this.visible = true
    this.venue = undefined
    this.exit = undefined
    this.steps.shift()
    return 0
  }

  /** A door opens (going in, coming out): `opened` counts them, for its sound, at `doorAt`. */
  private knock(at: Spot): void {
    this.opened++
    this.doorAt = at
  }

  private turn(heading: number, rate: number): void {
    const delta = Math.atan2(Math.sin(heading - this.yaw), Math.cos(heading - this.yaw))
    this.yaw += delta * Math.min(1, rate)
  }
}

/** FNV-1a of a name: each walker's own variety, the same every run. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}
