import { MathUtils, type Object3D } from "three"
import type { AdventurerView } from "../guild/store.ts"
import { legOf, type Routine } from "../world/behaviours.ts"
import type { Spot } from "../world/layout.ts"
import { groundAt, pace, route } from "../world/paths.ts"
import { DESTINATIONS } from "../world/sites.ts"
import { CARRY_WALK } from "./activity.ts"
import { Visiting } from "./visit.ts"

/**
 * An adventurer's brain (scene/Adventurer.tsx): where they walk, which way they face and which clip
 * the moment calls for. It moves the figure's root and names a clip; it never draws. Whichever body
 * draws them — a SkinnedMesh with its own mixer, or a slot in the cast's baked crowd (scene/body.ts)
 * — follows the same root and plays the same clip, so walking is written once.
 */

const WALK_SPEED = 3.4
/** The infirmary bed's blanket, measured on kit.glb's bed_frame (0.84 up, scale 1). */
const BED_TOP = 0.84
/** No walk lasts longer than this: far trips run instead (Motion language board). */
const MAX_WALK_S = 5
const RUN_ABOVE = 5.2
/** Carrying slows the walk a little. */
const CARRY_SPEED = WALK_SPEED * 0.85
/** Out through the gate nobody is hurried: a leaver runs only when the way out is very long. */
const LEAVE_WALK_S = 8

/** What a frame's walk came to. */
export interface Stride {
  walking: boolean
  /** Units a second (0 standing). */
  speed: number
  /** Distance still to walk. */
  remaining: number
  /** Walking with a load in both arms (the work loop's). */
  carrying: boolean
}

export class Brain {
  /** Going in at a venue's door and coming out (scene/visit.ts): its leg, while it has one, is the aim. */
  readonly visit: Visiting
  /** Spots still to walk through; recomputed whenever the aim moves. */
  private path: Spot[] = []
  private readonly routed = { x: Number.NaN, z: Number.NaN }
  private readonly stride: Stride = { walking: false, speed: 0, remaining: 0, carrying: false }

  constructor(who: string) {
    this.visit = new Visiting(who)
  }

  /**
   * One frame: walks `node` towards the work loop's aim (`looping`) or the view's target, turns it,
   * lifts it into bed. `holding`: summoned and still rising, they stand where they appeared.
   */
  walk(
    node: Object3D,
    view: AdventurerView,
    work: Routine | null,
    looping: boolean,
    holding: boolean,
    delta: number,
  ): Stride {
    const leg = this.visit.leg()
    const aim = leg?.to ?? (looping && work ? work.aim : view.target)
    const tx = aim[0]
    const tz = aim[1]
    if (this.routed.x !== tx || this.routed.z !== tz) {
      this.routed.x = tx
      this.routed.z = tz
      const from: Spot = [node.position.x, node.position.z]
      // The loop's own walks are short and tested clear; going to a post takes the roads.
      this.path = looping || leg?.direct ? legOf(from, [tx, tz]) : route(from, [tx, tz])
    }
    const path = this.path
    let next = path[0]
    while (
      next &&
      path.length > 1 &&
      Math.hypot(next[0] - node.position.x, next[1] - node.position.z) < 0.3
    ) {
      path.shift()
      next = path[0]
    }
    const [nx, nz] = next ?? [tx, tz]
    const dx = nx - node.position.x
    const dz = nz - node.position.z
    const step = Math.hypot(dx, dz)
    const remaining = step + pathLength(path)
    const walking = !holding && remaining > 0.12
    const carrying = looping && work !== null && work.held !== null
    const leaving = view.phase === "leaving"
    // On a mountain the ground has a grade (a gen 2 island's trails): a slower pace uphill, and a lean into it.
    const here = groundAt(node.position.x, node.position.z)
    const mountain = here > 0.3 || groundAt(nx, nz) > 0.3
    const grade = walking && step > 0.01 ? (groundAt(nx, nz) - here) / step : 0
    let speed = 0
    if (walking) {
      // A hike keeps its own pace: the far-trip run (MAX_WALK_S) is for the flat.
      const base = mountain
        ? WALK_SPEED
        : Math.max(WALK_SPEED, remaining / (leaving ? LEAVE_WALK_S : MAX_WALK_S))
      speed = (carrying ? CARRY_SPEED : base) * pace(grade)
      const move = Math.min(1, (speed * delta) / Math.max(step, 1e-6))
      node.position.x += dx * move
      node.position.z += dz * move
      turn(node, Math.atan2(dx, dz), delta * 10)
    } else if (holding) {
      // Facing the guildmaster who summoned them.
    } else if (looping && work) {
      // Face the work, or the post's own way at the post; elsewhere, stay as they stand.
      const face = work.faceAt
      if (face) turn(node, Math.atan2(face[0] - node.position.x, face[1] - node.position.z), delta * 6)
      else if (work.atPost) turn(node, view.target[2], delta * 5)
    } else {
      turn(node, leg?.face ?? view.target[2], delta * 5)
    }
    // In bed: up onto the mattress. The post is at floor level beside it, so lying down there
    // put them on the floor under the bed (the user: "they sleep below the bed").
    const inBed = view.seat === "bed" && !walking
    // On a mountain they stand on its ground, the toes lifted a little on an uphill leg so they don't sink.
    const lift = Math.max(0, Math.min(0.15, 0.3 * grade))
    node.position.y = MathUtils.damp(node.position.y, inBed ? BED_TOP : here + lift, mountain ? 12 : 6, delta)
    node.rotation.order = "YXZ"
    node.rotation.x = MathUtils.damp(node.rotation.x, Math.min(0.2, 0.35 * Math.max(0, grade)), 8, delta)
    const out = this.stride
    out.walking = walking
    out.speed = speed
    out.remaining = remaining
    out.carrying = carrying
    this.visit.update(view.visit, !walking, delta, node)
    return out
  }
}

/**
 * Which clip the moment calls for. Clip names are KayKit Rig_Medium (scripts/assets.ts CLIPS);
 * `work` is the routine when its loop is running.
 */
export function clipFor(view: AdventurerView, walking: boolean, speed: number, work: Routine | null): string {
  const moving = work?.held ? CARRY_WALK : speed > RUN_ABOVE ? "Running_A" : "Walking_A"
  if (walking) return moving
  if (view.stung) return "Hit_A"
  switch (view.phase) {
    case "resting":
      return view.seat === "floor" ? "Sit_Floor_Idle" : "Sit_Chair_Idle"
    case "failed":
      return (view.destination && DESTINATIONS[view.destination]?.clip) || "Lie_Idle"
    case "waiting":
      return "Waving"
    case "loot":
      return "Cheering"
    case "leaving":
      return "Waving"
    case "idle":
      return "Idle_A"
    default:
      break
  }
  // At work: the loop's step. Between two walks (a waypoint), keep walking rather than flicker.
  if (work) return work.clip ?? moving
  if (view.look) {
    if (view.master && (view.tool === "task" || view.tool === "subagent")) return "Ranged_Magic_Summon"
    switch (view.look.clip) {
      case "Spellcasting":
        return "Ranged_Magic_Spellcasting"
      case "Use_Item":
        if (view.station === "forge") return "Hammering"
        if (view.station === "inspection-bench") return "Lockpicking"
        if (view.station === "drafting-table" || view.station === "scroll-desk") return "Working_A"
        return "Use_Item"
      case "Interact":
        return view.station === "library" || view.station === "map-table" ? "Working_B" : "Interact"
      default:
        return view.look.clip
    }
  }
  return view.thinking ? "Idle_B" : "Idle_A"
}

/** Length of the rest of the walk, after the spot being walked to now. */
function pathLength(path: Spot[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return total
}

function turn(node: Object3D, heading: number, rate: number): void {
  const delta = Math.atan2(Math.sin(heading - node.rotation.y), Math.cos(heading - node.rotation.y))
  node.rotation.y += delta * Math.min(1, rate)
}
