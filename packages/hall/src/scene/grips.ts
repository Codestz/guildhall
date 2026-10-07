import { type BufferGeometry, Color, Group, type Object3D, PropertyBinding, Quaternion, Vector3 } from "three"
import type { Held, Tool } from "../world/behaviours.ts"
import type { Piece } from "../world/furniture.ts"
import {
  bookGeometry,
  bowGeometry,
  broomGeometry,
  bucketGeometry,
  crateGeometry,
  fishGeometry,
  hoeGeometry,
  logGeometry,
  noteGeometry,
  openBookGeometry,
  plankGeometry,
  produceGeometry,
  rodGeometry,
  spearGeometry,
  stoneGeometry,
} from "./life/shapes.ts"

/**
 * How everything held sits in the hands: one table for the kit's pieces (an adventurer's gear, the
 * tavern mug, the night lantern) and one for the hand-made props of the work loops (scene/activity.ts).
 * Shared by scene/Adventurer, scene/life/Villagers and the grip lab (lab/gripLab.ts, `?grips` in
 * dev), which renders each entry in the clips it is used with. Nothing held falls back to its raw
 * model orientation: test/grips.test.ts checks every piece and prop has its entry here.
 */

/*
 * The hand slots' own axes (measured in the grip lab over Idle_A, Pickaxing, Holding_A, Sit_Chair_Idle,
 * Walking_A, Working_B and the bow clips):
 * - +y runs through the fist, out of the thumb side: where KayKit models a handle's working end (a
 *   sword's blade, an axe's head). Arms hanging, it points forward.
 * - +z is the back of the hand (the palm faces −z, in towards the body when the arms hang).
 * - +x: towards the fingertips on the right hand (straight down, arms hanging), towards the wrist on
 *   the left (mirrored). In a right-handed downswing (Pickaxing, Chopping, Hammering) +x leads into
 *   the strike, so a tool's working edge goes on +x. Holding a bow out (left), +z is up and +x
 *   points back at the archer.
 * One fixed turn cannot suit every clip when the wrist rolls (sitting on the floor, waving): what
 * must stay level (a mug, a lantern, a bucket, a staff, a bow, a spear, the tomes) is `upright`.
 */

/**
 * The rig's hand slots, as three names them: GLTFLoader drops the dot from glTF node names
 * (`handslot.r` → `handslotr`), so asking for the glTF name finds nothing.
 */
export const HAND_SLOT = {
  right: PropertyBinding.sanitizeNodeName("handslot.r"),
  left: PropertyBinding.sanitizeNodeName("handslot.l"),
} as const

export type Vec3 = readonly [number, number, number]

export interface Grip {
  /** The rig bone it rides on: a hand slot, or the chest for loads carried in both arms. */
  bone: string
  position: Vec3
  /** Radians, XYZ order, in the bone's frame. */
  rotation: Vec3
  scale: number
  /**
   * Kept level whatever the wrist does (a mug, a bucket, a lantern): it hangs from a pivot at the
   * fist, which `keepUpright` turns each frame so the thing's own +y is the world's up.
   */
  upright?: true
  /** The thing's own axis kept up when upright: +y unless said (an open book keeps its pages up). */
  up?: Vec3
}

/** A hand-made prop's grip: its grip and the geometry it is made of (scene/life/shapes.ts). */
export interface PropGrip extends Grip {
  make: () => BufferGeometry
  /** Shown open instead, in the same grip, while one of these clips plays (a book being read). */
  open?: { make: () => BufferGeometry; clips: ReadonlySet<string> }
}

/** The clips a held book is read in (world/behaviours.ts: the library's and the steer's reading). */
export const READING_CLIPS: ReadonlySet<string> = new Set(["Working_B"])
const BOOK_COVER = new Color("#2f5a8a")

/** Puts `object` in its grip's place, relative to the bone it is (or will be) added to. */
export function applyGrip(object: Object3D, grip: Grip): void {
  object.position.set(...grip.position)
  object.rotation.set(...grip.rotation)
  object.scale.setScalar(grip.scale)
}

/**
 * Adds `object` to `bone` in its grip. Returns what was added: the object itself, or for an upright
 * grip the pivot it hangs from (toggle visibility on that, and pass it to `keepUpright`).
 */
export function attachGrip(bone: Object3D, object: Object3D, grip: Grip): Object3D {
  applyGrip(object, grip)
  if (!grip.upright) {
    bone.add(object)
    return object
  }
  const pivot = new Group()
  pivot.name = "upright-grip"
  pivot.userData.upright = true
  pivot.userData.up = new Vector3(...(grip.up ?? [0, 1, 0]))
  pivot.add(object)
  bone.add(pivot)
  return pivot
}

const UP = new Vector3(0, 1, 0)
const scratch = { hand: new Quaternion(), align: new Quaternion(), up: new Vector3() }

/**
 * After the pose (the mixer's update): turns an upright grip's pivot so what hangs from it is level,
 * the handle still in the fist. Anything else is left alone.
 */
export function keepUpright(root: Object3D | null): void {
  if (!root?.userData.upright || !root.visible) return
  const held = root.children[0]
  if (!root.parent || !held) return
  const { hand, align, up } = scratch
  root.parent.getWorldQuaternion(hand)
  up.copy(root.userData.up ?? UP)
    .applyQuaternion(held.quaternion)
    .applyQuaternion(hand)
  align.setFromUnitVectors(up, UP)
  // pivot (local) = hand⁻¹ · align · hand: in the world, the hand's turn followed by the levelling.
  root.quaternion.copy(hand).invert().multiply(align).multiply(hand)
}

/** The kit pieces anyone holds: the roles' gear (world/cast.ts), the sites' tools, mug and lantern. */
export type HeldPiece = Extract<
  Piece,
  | "pickaxe"
  | "axe"
  | "mug_full"
  | "lantern"
  | "staff"
  | "spellbook_open"
  | "spellbook_closed"
  | "hammer_A"
  | "dagger"
  | "crossbow_1handed"
  | "wand"
  | "shield_badge_color"
  | "map_rolled"
>

const R = HAND_SLOT.right
const L = HAND_SLOT.left
const NONE: Vec3 = [0, 0, 0]

export const KIT_GRIPS: Record<HeldPiece, Grip> = {
  pickaxe: { bone: R, position: NONE, rotation: [0, 0, 0.6], scale: 0.85 },
  axe: { bone: R, position: NONE, rotation: [0, Math.PI, 0], scale: 1 },
  mug_full: {
    bone: R,
    position: [0, 0.23, 0],
    rotation: [-Math.PI, 0, Math.PI / 2],
    scale: 0.8,
    upright: true,
  },
  lantern: { bone: L, position: [0.58, 0, 0], rotation: [0, 0, Math.PI / 2], scale: 0.55, upright: true },
  staff: { bone: R, position: [-0.35, 0, 0], rotation: [0, 0, Math.PI / 2], scale: 1, upright: true },
  spellbook_open: {
    bone: L,
    position: [0, 0, -0.2],
    rotation: [-Math.PI / 2, Math.PI / 2, 0],
    scale: 0.8,
    upright: true,
    up: [0, 0, 1],
  },
  spellbook_closed: {
    bone: L,
    position: [0, 0.17, 0],
    rotation: [-Math.PI / 2, 0, -Math.PI / 2],
    scale: 0.8,
    upright: true,
  },
  hammer_A: { bone: R, position: NONE, rotation: NONE, scale: 0.75 },
  dagger: { bone: R, position: NONE, rotation: NONE, scale: 1 },
  crossbow_1handed: { bone: R, position: NONE, rotation: [Math.PI, Math.PI / 2, 0], scale: 1 },
  wand: { bone: R, position: NONE, rotation: NONE, scale: 1 },
  shield_badge_color: { bone: L, position: NONE, rotation: NONE, scale: 1 },
  map_rolled: { bone: R, position: NONE, rotation: NONE, scale: 1 },
}

/** What a resting adventurer holds in the tavern (scene/Adventurer). */
export const RESTING_MUG: HeldPiece = "mug_full"
/** What a free left hand carries after dark (adventurers and the townsfolk who are out at night). */
export const NIGHT_LANTERN: HeldPiece = "lantern"

export function isHeldPiece(piece: string): piece is HeldPiece {
  return piece in KIT_GRIPS
}

/**
 * Loads carried in both arms ride on the chest bone, which keeps the body's axes (+z forward,
 * measured): centred between Holding_A's hands (±0.32 across, 0.56 ahead, 0.16 below the chest).
 */
export const PROP_GRIPS: Record<Held | Tool, PropGrip> = {
  log: {
    make: logGeometry,
    bone: "chest",
    scale: 0.45,
    position: [0, -0.1, 0.62],
    rotation: [0, Math.PI / 2, 0],
  },
  stone: { make: stoneGeometry, bone: "chest", scale: 0.72, position: [0, -0.1, 0.6], rotation: [0, 0.6, 0] },
  plank: { make: plankGeometry, bone: "chest", scale: 0.75, position: [0, -0.12, 0.6], rotation: [0, 0, 0] },
  fish: { make: fishGeometry, bone: R, scale: 1, position: [0, 0.1, 0], rotation: [0, 0, Math.PI / 2] },
  book: {
    make: () => bookGeometry(BOOK_COVER),
    open: { make: () => openBookGeometry(BOOK_COVER), clips: READING_CLIPS },
    bone: R,
    scale: 0.55,
    position: [0, 0.1, -0.2],
    rotation: [-Math.PI / 2, 0, Math.PI / 2],
  },
  note: { make: noteGeometry, bone: R, scale: 1, position: [0, 0.15, 0], rotation: [Math.PI / 2, 0, 0] },
  rod: { make: rodGeometry, bone: R, scale: 1, position: [0, -0.1, 0], rotation: [0, 0, 0] },
  bow: {
    make: bowGeometry,
    bone: L,
    scale: 1,
    position: [0, 0, 0],
    rotation: [-Math.PI / 2, 0, Math.PI],
    upright: true,
  },
  produce: {
    make: produceGeometry,
    bone: "chest",
    scale: 0.8,
    position: [0, -0.12, 0.6],
    rotation: [0, 0, 0],
  },
  crate: { make: crateGeometry, bone: "chest", scale: 0.85, position: [0, -0.1, 0.6], rotation: [0, 0, 0] },
  hoe: { make: hoeGeometry, bone: R, scale: 1, position: [0, -0.2, 0], rotation: [0, Math.PI / 2, 0] },
  bucket: {
    make: bucketGeometry,
    bone: R,
    scale: 1,
    position: [0, 0, 0],
    rotation: [0, 0, Math.PI / 2],
    upright: true,
  },
  spear: {
    make: spearGeometry,
    bone: R,
    scale: 1,
    position: [0, 0, 0],
    rotation: [0, 0, Math.PI / 2],
    upright: true,
  },
  broom: {
    make: broomGeometry,
    bone: R,
    scale: 1,
    position: [-0.04, 0, 0.07],
    rotation: [0, 1, Math.PI / 2],
  },
}
