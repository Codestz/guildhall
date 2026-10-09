import { Matrix4 } from "three"
import { audio } from "../../audio/engine.ts"
import type { Folk } from "../../world/folk/types.ts"
import type { Crowd } from "../crowd/Crowd.ts"
import { type Around, Walker } from "./folkWalk.ts"
import { occupy } from "./occupancy.ts"

/**
 * The island's folk as members of the cast's crowd (scene/crowd): one Walker each (folkWalk.ts), a
 * crowd slot while they are out in the open and none while they are indoors, so a night street
 * costs nothing. Written once a frame, before the cast flushes the crowd (which also gives each
 * member the mesh level its size on screen calls for); no React per folk.
 */

/** The world clock moving more than this in a frame (hours) is a jump: everyone is placed afresh. */
const JUMP_H = 0.5

export class Troupe {
  readonly walkers: Walker[]
  private readonly ids: number[]
  private readonly clips: string[]
  /** The door openings already heard, for each. */
  private readonly heard: number[]
  private crowd: Crowd | null = null
  private last = Number.NaN
  private readonly place = new Matrix4()

  constructor(
    folk: readonly Folk[],
    private readonly around: Around,
  ) {
    this.walkers = folk.map((one) => new Walker(one, around))
    this.ids = folk.map(() => -1)
    this.clips = folk.map(() => "")
    this.heard = folk.map(() => 0)
  }

  /** The ground's height at a spot (the island's, for whatever is drawn beside the walkers). */
  heightAt(x: number, z: number): number {
    return this.around.ground(x, z)
  }

  /** Folk out in the open now. */
  get out(): number {
    return this.ids.reduce((n, id) => (id >= 0 ? n + 1 : n), 0)
  }

  /** One frame: `dt` seconds on, `hour` of the world clock, `now` the page's seconds, `wet` rain. */
  frame(crowd: Crowd | null, dt: number, hour: number, now: number, wet: boolean): void {
    // A crowd made anew (the renderer changed) took its members with it.
    if (crowd !== this.crowd) {
      this.release()
      this.crowd = crowd
      this.last = Number.NaN
    }
    if (!crowd) return
    const step = Number.isNaN(this.last) ? Number.NaN : ((hour - this.last + 36) % 24) - 12
    const jumped = !(step >= -0.02 && step <= JUMP_H)
    this.last = hour
    for (let i = 0; i < this.walkers.length; i++) {
      const walker = this.walkers[i] as Walker
      if (jumped) walker.snap(hour, wet)
      else walker.update(dt, hour, wet)
      if (walker.venue) occupy(walker.venue, walker.folk.id, now)
      // Their door, heard from where it is (silent unless sound is on; the engine places and limits it).
      if (walker.opened !== this.heard[i]) {
        this.heard[i] = walker.opened
        audio.spot("door", { x: walker.doorAt[0], z: walker.doorAt[1] })
      }
      this.show(crowd, i, walker)
    }
  }

  /** Everyone out of the crowd: the island is going, or the crowd is. */
  release(): void {
    const crowd = this.crowd
    for (let i = 0; i < this.ids.length; i++) {
      const id = this.ids[i] as number
      if (crowd && id >= 0) crowd.leave(id)
      this.ids[i] = -1
      this.clips[i] = ""
    }
  }

  private show(crowd: Crowd, i: number, walker: Walker): void {
    let id = this.ids[i] as number
    if (!walker.visible) {
      if (id >= 0) {
        crowd.leave(id)
        this.ids[i] = -1
      }
      return
    }
    if (id < 0) {
      id = crowd.join(walker.folk.model, walker.folk.tint)
      this.ids[i] = id
      // Each its own beat: no two at a bench are in step.
      crowd.start(id, walker.clip, this.beat(walker), walker.rate)
      this.clips[i] = walker.clip
    } else if (walker.clip !== this.clips[i]) {
      crowd.play(id, walker.clip, walker.rate)
      this.clips[i] = walker.clip
    }
    const y = this.around.ground(walker.x, walker.z) + walker.level
    this.place.makeRotationY(walker.yaw).setPosition(walker.x, y, walker.z)
    crowd.place(id, this.place)
  }

  private beat(walker: Walker): number {
    let h = 0
    for (let n = 0; n < walker.folk.id.length; n++) h = (h * 31 + walker.folk.id.charCodeAt(n)) >>> 0
    return (h % 1000) / 500
  }
}
