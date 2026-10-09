import type { Object3D } from "three"
import { audio } from "../audio/engine.ts"
import type { Visit } from "../guild/visits.ts"
import { seedOf } from "../world/behaviours.ts"
import type { Spot } from "../world/layout.ts"
import type { VenueDoor } from "../world/venues.ts"
import { occupy, vacate } from "./life/occupancy.ts"

/**
 * Going into a venue and coming out (scene/brain.ts drives it once a frame): the figure walks to the
 * door's step, stops and faces it for DOOR_PAUSE_S while it opens (its sound), walks through the
 * sill dissolving (scene/dissolve.ts: never a shrink), stays hidden while the visit lasts, then
 * comes out the same way and goes on. What it does is a pure state machine, like the townsfolk's
 * `Day` (scene/life/rounds.ts): no clock but the dt it is given.
 *
 *   out     not at a venue            go      walking to the step       knock   at the door, waiting
 *   enter   through the sill, fading  inside  hidden, time passing      leave   out of the sill, fading in
 *
 * Two kinds of visit (guild/visits.ts): an agent's (`hold`) lasts as long as the view asks; a
 * townsperson's (`cycle`) is theirs to take, now and then, between spells of work.
 */

/** At the door they stop and face it this long before it opens. */
export const DOOR_PAUSE_S = 0.6

export type Phase = "out" | "go" | "knock" | "enter" | "inside" | "leave"

/** Where to walk this frame instead of the view's target, and which way to face when standing. */
export interface Leg {
  to: Spot
  /** A short step between the door's step and its sill: walked straight, never by the roads. */
  direct: boolean
  face?: number
}

/** A townsperson calls in every so often (seconds) and stays a while. */
const EVERY_S = 16
const EVERY_SPREAD_S = 22
const STAY_S = 8
const STAY_SPREAD_S = 6

/** 0…1, stable per figure and `salt`. */
const unit = (id: string, salt: number): number => ((seedOf(id) >>> salt) % 1000) / 1000

export class Visiting {
  phase: Phase = "out"
  /** The door in use, from "go" until "out" again. */
  door: VenueDoor | undefined
  /** Bumps each time the door opens (going in, coming out). */
  opened = 0
  private venue = ""
  private pause = 0
  private clock = 0
  /** A townsperson's: waiting to call in (the time already waited), or calling (the time stayed). */
  private idle: number
  private calling = false
  private readonly every: number
  private readonly stay: number

  constructor(
    private readonly who: string,
    /** The door's sound, at the step; swapped for a no-op in tests. */
    private readonly knock: (at: Spot) => void = (at) => audio.spot("door", { x: at[0], z: at[1] }),
    /** Seconds, for occupancy. */
    private readonly now: () => number = () => performance.now() / 1000,
  ) {
    this.every = EVERY_S + EVERY_SPREAD_S * unit(who, 3)
    this.stay = STAY_S + STAY_SPREAD_S * unit(who, 7)
    this.idle = this.every * unit(who, 11)
  }

  /** Not at a venue's door or beyond it yet? Then the view's own target and work stand. */
  get engaged(): boolean {
    return this.phase !== "out"
  }

  /** 0 hidden (through the sill, or inside), 1 whole: where the fade is going. */
  get goal(): 0 | 1 {
    return this.phase === "enter" || this.phase === "inside" ? 0 : 1
  }

  /** The leg to walk now, if the visit has one; undefined at "out". */
  leg(): Leg | undefined {
    const door = this.door
    if (!door) return undefined
    switch (this.phase) {
      case "go":
        return { to: door.step, direct: false }
      case "knock":
        return { to: door.step, direct: true, face: door.inward }
      case "enter":
      case "inside":
        return { to: door.sill, direct: true }
      case "leave":
        return { to: door.step, direct: true }
      default:
        return undefined
    }
  }

  /**
   * One frame: `view` is what the figure's view asks (undefined: nothing), `arrived` that the leg
   * is walked, `dt` seconds. Lifts `node` up a flight of steps to a raised sill and back.
   */
  update(view: Visit | undefined, arrived: boolean, dt: number, node?: Object3D): void {
    this.clock += dt
    const want = this.wants(view, dt)
    const same = want !== undefined && want.venue === this.venue
    switch (this.phase) {
      case "out":
        if (want) this.begin(want)
        break
      case "go":
        if (!same) this.finish()
        else if (arrived) {
          this.phase = "knock"
          this.pause = DOOR_PAUSE_S
        }
        break
      case "knock":
        if (!same) this.finish()
        else {
          this.pause -= dt
          if (this.pause <= 0) this.open("enter")
        }
        break
      case "enter":
        if (arrived) this.phase = "inside"
        if (!same) this.open("leave")
        break
      case "inside":
        if (!same) this.open("leave")
        break
      case "leave":
        if (arrived) this.finish()
        break
    }
    if (this.door && (this.phase === "enter" || this.phase === "inside"))
      occupy(this.venue, this.who, this.now())
    if (node) this.lift(node)
  }

  /** What the view asks for now: a held visit as given, a townsperson's when their turn comes. */
  private wants(view: Visit | undefined, dt: number): Visit | undefined {
    if (!view || view.wait) return undefined
    if (!view.cycle) return view
    if (this.calling) {
      if (this.phase === "inside") this.idle += dt
      if (this.idle >= this.stay) {
        this.calling = false
        this.idle = 0
      }
    } else if (this.phase === "out") {
      this.idle += dt
      if (this.idle >= this.every) {
        this.calling = true
        this.idle = 0
      }
    }
    return this.calling ? view : undefined
  }

  private begin(view: Visit): void {
    this.venue = view.venue
    this.door = view.door
    this.phase = "go"
  }

  private finish(): void {
    if (this.venue) vacate(this.venue, this.who)
    this.phase = "out"
    this.door = undefined
    this.venue = ""
  }

  /** The door opens as they go in or come out: its sound from the step, and the venue counts them. */
  private open(next: "enter" | "leave"): void {
    this.opened++
    if (this.door) this.knock(this.door.step)
    if (next === "leave") vacate(this.venue, this.who)
    this.phase = next
  }

  /** A raised sill: up the steps as they go through, down as they come out. */
  private lift(node: Object3D): void {
    const door = this.door
    if (!door || door.y <= 0) return
    if (this.phase !== "enter" && this.phase !== "inside" && this.phase !== "leave") return
    const span = Math.hypot(door.step[0] - door.sill[0], door.step[1] - door.sill[1]) || 1
    const left = Math.hypot(node.position.x - door.sill[0], node.position.z - door.sill[1])
    node.position.y = door.y * (1 - Math.min(1, left / span))
  }
}
