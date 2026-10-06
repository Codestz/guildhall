import {
  AnimationClip,
  type BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PropertyBinding,
} from "three"
import {
  type Behaviour,
  type Held,
  type Place,
  type Routine,
  stepsOf,
  type Tool,
} from "../world/behaviours.ts"
import {
  bookGeometry,
  bowGeometry,
  fishGeometry,
  logGeometry,
  noteGeometry,
  plankGeometry,
  rodGeometry,
  stoneGeometry,
} from "./life/shapes.ts"

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

/**
 * The rig's hand slots, as three names them: GLTFLoader drops the dot from glTF node names
 * (`handslot.r` → `handslotr`), so asking for the glTF name finds nothing.
 */
export const HAND_SLOT = {
  right: PropertyBinding.sanitizeNodeName("handslot.r"),
  left: PropertyBinding.sanitizeNodeName("handslot.l"),
} as const

interface Grip {
  make: () => BufferGeometry
  /** The rig bone it rides on. */
  bone: string
  scale: number
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
}

/**
 * How each thing sits in the hands. Loads carried in both arms ride on the chest bone, which keeps
 * the body's axes (+z forward, measured): centred between Holding_A's hands (±0.32 across, 0.56
 * ahead, 0.16 below the chest). Small things and tools sit in a hand slot like the kit's gear.
 */
const GRIPS: Record<Held | Tool, Grip> = {
  log: {
    make: logGeometry,
    bone: "chest",
    scale: 0.45,
    position: [0, -0.1, 0.62],
    rotation: [0, Math.PI / 2, 0],
  },
  stone: { make: stoneGeometry, bone: "chest", scale: 0.72, position: [0, -0.1, 0.6], rotation: [0, 0.6, 0] },
  plank: { make: plankGeometry, bone: "chest", scale: 0.75, position: [0, -0.12, 0.6], rotation: [0, 0, 0] },
  fish: {
    make: fishGeometry,
    bone: HAND_SLOT.right,
    scale: 1,
    position: [0, 0.1, 0],
    rotation: [0, 0, Math.PI / 2],
  },
  book: {
    make: () => bookGeometry(new Color("#2f5a8a")),
    bone: HAND_SLOT.right,
    scale: 0.55,
    position: [0, 0.12, 0],
    rotation: [Math.PI / 2, 0, 0],
  },
  note: {
    make: noteGeometry,
    bone: HAND_SLOT.right,
    scale: 1,
    position: [0, 0.15, 0],
    rotation: [Math.PI / 2, 0, 0],
  },
  rod: { make: rodGeometry, bone: HAND_SLOT.right, scale: 1, position: [0, -0.1, 0], rotation: [0, 0, 0] },
  bow: { make: bowGeometry, bone: HAND_SLOT.left, scale: 1, position: [0, 0, 0], rotation: [0, 0, 0] },
}

/** One geometry per kind and one material for all of it, for the app's lifetime (never freed). */
const shapes = new Map<Held | Tool, BufferGeometry>()
let material: MeshStandardMaterial | null = null

function meshOf(kind: Held | Tool): Mesh {
  const grip = GRIPS[kind]
  let geometry = shapes.get(kind)
  if (!geometry) {
    geometry = grip.make()
    shapes.set(kind, geometry)
  }
  material ??= new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 })
  const mesh = new Mesh(geometry, material)
  mesh.scale.setScalar(grip.scale)
  mesh.position.set(...grip.position)
  mesh.rotation.set(...grip.rotation)
  mesh.visible = false
  // Moving with the body every frame: no shadow-map caster (atmosphere/shadows.ts).
  mesh.castShadow = false
  return mesh
}

/** What a worker's hands show: toggled each frame, without a render. */
export interface Hands {
  /** `held` in the hands (or nothing); the trade's tool while the hands are otherwise free. */
  show(held: Held | null, tool: boolean): void
  dispose(): void
}

/** Every thing a behaviour ever puts in the hands, attached to `body`'s bones, hidden. */
export function attachHands(body: Object3D, behaviour: Behaviour): Hands {
  const kinds = new Set<Held | Tool>()
  for (const step of stepsOf(behaviour)) if ("clip" in step && step.take) kinds.add(step.take)
  if (behaviour.tool) kinds.add(behaviour.tool)
  const meshes = new Map<Held | Tool, Mesh>()
  for (const kind of kinds) {
    const bone = body.getObjectByName(GRIPS[kind].bone)
    if (!bone) continue
    const mesh = meshOf(kind)
    bone.add(mesh)
    meshes.set(kind, mesh)
  }
  const tool = behaviour.tool
  return {
    show(held, showTool) {
      for (const [kind, mesh] of meshes)
        mesh.visible = kind === tool ? showTool && held === null : kind === held
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
