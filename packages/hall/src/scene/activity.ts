import { AnimationClip, type BufferGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from "three"
import {
  type Behaviour,
  type Held,
  type Place,
  type Routine,
  stepsOf,
  type Tool,
} from "../world/behaviours.ts"
import { attachGrip, keepUpright, PROP_GRIPS } from "./grips.ts"

/**
 * The scene's half of activities (world/behaviours.ts, ADR 0009): who stands at which berth, the
 * carrying walk, and the things in a worker's hands. scene/Adventurer.tsx runs the routine.
 */

// ---- Reservations ---------------------------------------------------------------------------

/** Who holds each berth, in arrival order: `site:forest#0` → [ids]. */
const holders = new Map<string, string[]>()

/**
 * Reserve a berth for `id`: 0 for the first to hold it, 1 for the next (more workers than posts),
 * and so on — that lap shifts their spots beside the first one's (`shifted`), so two workers never
 * share a standing spot. Held until `release`.
 */
export function reserve(place: Place, id: string): number {
  const key = `${place.key}#${place.berth}`
  const list = holders.get(key) ?? []
  if (!list.includes(id)) list.push(id)
  holders.set(key, list)
  return list.indexOf(id)
}

export function release(place: Place, id: string): void {
  const key = `${place.key}#${place.berth}`
  const list = holders.get(key)
  if (!list) return
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
  if (list.length === 0) holders.delete(key)
}

// ---- The carrying walk ------------------------------------------------------------------------

export const CARRY_WALK = "Carry_Walk"
/** Arm and hand bones (three's names drop the dot: `upperarm.l` is `upperarml`; see HAND_SLOT). */
const ARMS = /^(upperarm|lowerarm|wrist|handslot|hand)\.?[lr]\./

const carries = new WeakMap<readonly AnimationClip[], AnimationClip | null>()

/**
 * Walking with full hands: Holding_A's arms over Walking_A's legs, hips and back, as one clip made
 * once per animation set (KayKit has no carrying walk). Null if either clip is missing.
 */
export function carryClip(animations: readonly AnimationClip[]): AnimationClip | null {
  const known = carries.get(animations)
  if (known !== undefined) return known
  const walk = animations.find((clip) => clip.name === "Walking_A")
  const hold = animations.find((clip) => clip.name === "Holding_A")
  const made =
    walk && hold
      ? new AnimationClip(CARRY_WALK, walk.duration, [
          ...walk.tracks.filter((track) => !ARMS.test(track.name)).map((track) => track.clone()),
          ...hold.tracks.filter((track) => ARMS.test(track.name)).map((track) => track.clone()),
        ])
      : null
  carries.set(animations, made)
  return made
}

// ---- In the hands ---------------------------------------------------------------------------

export { HAND_SLOT } from "./grips.ts"

/** One geometry per kind and one material for all of it, for the app's lifetime (never freed). */
const shapes = new Map<string, BufferGeometry>()
let material: MeshStandardMaterial | null = null

function meshOf(kind: Held | Tool, open = false): Mesh {
  const key = open ? `${kind}:open` : kind
  let geometry = shapes.get(key)
  if (!geometry) {
    const grip = PROP_GRIPS[kind]
    geometry = open && grip.open ? grip.open.make() : grip.make()
    shapes.set(key, geometry)
  }
  material ??= new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 })
  const mesh = new Mesh(geometry, material)
  // Moving with the body every frame: no shadow-map caster (atmosphere/shadows.ts).
  mesh.castShadow = false
  return mesh
}

/** What a worker's hands show: toggled each frame, without a render. */
export interface Hands {
  /**
   * `held` in the hands (or nothing); the trade's tool while the hands are otherwise free. `clip`,
   * the one playing, opens what is read in it (a book in Working_B).
   */
  show(held: Held | null, tool: boolean, clip?: string): void
  /** After the pose (the mixer's update): levels what hangs level (scene/grips.ts `upright`). */
  settle(): void
  dispose(): void
}

/** Every thing a behaviour ever puts in the hands, attached to `body`'s bones, hidden. */
export function attachHands(body: Object3D, behaviour: Behaviour): Hands {
  const kinds = new Set<Held | Tool>()
  for (const step of stepsOf(behaviour)) if ("clip" in step && step.take) kinds.add(step.take)
  if (behaviour.tool) kinds.add(behaviour.tool)
  /** Each kind's root in the hand: its mesh, or the pivot an upright one hangs from. */
  const meshes = new Map<Held | Tool, Object3D>()
  const opening = new Map<Held | Tool, { closed: Object3D; open: Object3D; clips: ReadonlySet<string> }>()
  for (const kind of kinds) {
    const grip = PROP_GRIPS[kind]
    const bone = body.getObjectByName(grip.bone)
    if (!bone) continue
    let thing: Object3D = meshOf(kind)
    if (grip.open) {
      // Closed and open, one root: the clip picks which shows.
      const both = new Group()
      const open = meshOf(kind, true)
      open.visible = false
      both.add(thing, open)
      opening.set(kind, { closed: thing, open, clips: grip.open.clips })
      thing = both
    }
    const root = attachGrip(bone, thing, grip)
    root.visible = false
    meshes.set(kind, root)
  }
  const tool = behaviour.tool
  return {
    show(held, showTool, clip) {
      for (const [kind, mesh] of meshes)
        mesh.visible = kind === tool ? showTool && held === null : kind === held
      for (const { closed, open, clips } of opening.values()) {
        const reading = clip !== undefined && clips.has(clip)
        open.visible = reading
        closed.visible = !reading
      }
    },
    settle() {
      for (const root of meshes.values()) keepUpright(root)
    },
    dispose() {
      // Geometry and material are shared: detach only.
      for (const mesh of meshes.values()) mesh.removeFromParent()
    },
  }
}

// ---- Dev probes -----------------------------------------------------------------------------

/**
 * Dev only: `window.work` lists each working adventurer's routine and body, for close-up probes
 * (scripts/shot.ts): `work.at("forest")` → { title, step, clip, held, x, z }.
 */
export const probed = new Map<string, { title: string; routine: Routine; body: Object3D }>()

if (import.meta.env?.DEV && typeof window !== "undefined") {
  Object.assign(window, {
    work: {
      all: probed,
      at(where: string) {
        for (const { title, routine, body } of probed.values()) {
          if (!routine.place.key.endsWith(`:${where}`) || !routine.started) continue
          const p = body.parent?.position ?? body.position
          return {
            title,
            source: routine.source,
            step: routine.step,
            clip: routine.clip,
            held: routine.held,
            x: p.x,
            z: p.z,
            heading: body.parent?.rotation.y ?? 0,
          }
        }
        return null
      },
    },
  })
}
