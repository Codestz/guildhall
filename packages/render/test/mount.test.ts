import { describe, expect, test } from "bun:test"
import { MOUNT_SLOTS, type Mount, type MountSlot, SLOT_FRAMES, type Vec3 } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import { AnimationClip, Group, Object3D, PropertyBinding, Quaternion, Vector3 } from "three"
import { createCharacter } from "../src/character/load.ts"
import { attachMount, detachMount } from "../src/character/mount.ts"

const EPS = 1e-5

/** A unit quaternion from three draws (Shoemake), so every run poses the same "random" wrist. */
function randomQuaternion(seed: number, salt: string): Quaternion {
  const [u1, u2, u3] = [roll(seed, `${salt}:a`), roll(seed, `${salt}:b`), roll(seed, `${salt}:c`)]
  const [a, b] = [Math.sqrt(1 - u1), Math.sqrt(u1)]
  return new Quaternion(
    a * Math.sin(2 * Math.PI * u2),
    a * Math.cos(2 * Math.PI * u2),
    b * Math.sin(2 * Math.PI * u3),
    b * Math.cos(2 * Math.PI * u3),
  )
}

/**
 * A stand-in Rig_Medium body: root → hips (turned, moved) → every slot bone under its glTF name, as
 * GLTFLoader names it (dots stripped), each with its own odd pose.
 */
function fakeBody(seed = 1): Group {
  const root = new Group()
  const hips = new Object3D()
  hips.name = "hips"
  hips.position.set(0.1, 0.9, -0.2)
  hips.quaternion.copy(randomQuaternion(seed, "hips"))
  root.add(hips)
  for (const bone of new Set(Object.values(SLOT_FRAMES).map((f) => f.bone))) {
    const node = new Object3D()
    node.name = PropertyBinding.sanitizeNodeName(bone)
    node.position.set(0.3, 0.4, 0.05)
    node.quaternion.copy(randomQuaternion(seed, bone))
    hips.add(node)
  }
  return root
}

/** An axe-like mount whose prop axes are nothing like the slot's, so a wrong basis shows. */
const AXE: Mount = { slot: "hand.r", hands: 1, handle: [0.02, -0.1, 0.03], axis: [0, 0, 1], edge: [-1, 0, 0] }

/** A prop-space point / direction in the world, through the piece's world matrix. */
const worldPoint = (piece: Object3D, p: Vec3) => new Vector3(...p).applyMatrix4(piece.matrixWorld)
const worldDir = (piece: Object3D, d: Vec3) =>
  new Vector3(...d).transformDirection(piece.matrixWorld).normalize()
const slotDir = (bone: Object3D, d: Vec3) =>
  new Vector3(...d).transformDirection(bone.matrixWorld).normalize()

function mounted(mount: Mount, slot?: MountSlot, clips: AnimationClip[] = []) {
  const ch = createCharacter(fakeBody(), clips)
  const piece = new Object3D()
  const m = attachMount(ch, piece, mount, slot)
  ch.root.updateMatrixWorld(true)
  return { ch, piece, m }
}

describe("attachMount", () => {
  test("the handle lands on the slot origin", () => {
    const { piece, m } = mounted(AXE)
    const origin = new Vector3().setFromMatrixPosition(m.bone.matrixWorld)
    expect(worldPoint(piece, AXE.handle).distanceTo(origin)).toBeLessThan(EPS)
  })

  test("maps axis onto along and edge onto the slot edge, in every slot", () => {
    for (const slot of MOUNT_SLOTS) {
      const { piece, m } = mounted(AXE, slot)
      const frame = SLOT_FRAMES[slot]
      expect(m.bone.name).toBe(PropertyBinding.sanitizeNodeName(frame.bone))
      expect(worldDir(piece, AXE.axis).distanceTo(slotDir(m.bone, frame.along))).toBeLessThan(EPS)
      expect(worldDir(piece, AXE.edge).distanceTo(slotDir(m.bone, frame.edge))).toBeLessThan(EPS)
    }
  })

  test("a scaled prop keeps its handle on the slot origin", () => {
    const { piece, m } = mounted({ ...AXE, scale: 0.6 })
    const origin = new Vector3().setFromMatrixPosition(m.bone.matrixWorld)
    expect(worldPoint(piece, AXE.handle).distanceTo(origin)).toBeLessThan(EPS)
    expect(piece.scale.x).toBeCloseTo(0.6, 9)
  })

  test("a clip's roll turns the prop about along and its offset moves the handle", () => {
    const chop = new AnimationClip("Chop", 1, [])
    const mount: Mount = { ...AXE, clips: { Chop: { roll: Math.PI / 2, offset: [0, 0.05, 0] } } }
    const { ch, piece, m } = mounted(mount, "hand.r", [chop])
    expect(ch.play("Chop", { t: 0 })).toBe(true)
    ch.root.updateMatrixWorld(true)
    const frame = SLOT_FRAMES["hand.r"]
    // A quarter turn about +y takes the +x edge to −z, and along stays along.
    expect(worldDir(piece, AXE.edge).distanceTo(slotDir(m.bone, [0, 0, -1]))).toBeLessThan(EPS)
    expect(worldDir(piece, AXE.axis).distanceTo(slotDir(m.bone, frame.along))).toBeLessThan(EPS)
    const offset = new Vector3(0, 0.05, 0).applyMatrix4(m.bone.matrixWorld)
    expect(worldPoint(piece, AXE.handle).distanceTo(offset)).toBeLessThan(EPS)
  })

  test("a clip without an override puts the prop back in its plain grip, and hide hides it", () => {
    const clips = [new AnimationClip("Chop", 1, []), new AnimationClip("Sit", 1, [])]
    const mount: Mount = { ...AXE, clips: { Chop: { roll: 1, offset: [0.1, 0, 0] }, Sit: { hide: true } } }
    const { ch, piece, m } = mounted(mount, "hand.r", clips)
    const plain = piece.quaternion.clone()
    ch.play("Chop")
    expect(m.pivot.visible).toBe(true)
    ch.play("Sit")
    expect(m.pivot.visible).toBe(false)
    expect(piece.quaternion.angleTo(plain)).toBeLessThan(EPS)
    expect(m.pivot.position.length()).toBe(0)
  })

  test("throws when the body has no bone for the slot", () => {
    const ch = createCharacter(new Group(), [])
    expect(() => attachMount(ch, new Object3D(), AXE)).toThrow("handslot.r")
  })

  test("detachMount takes the prop off the bone and out of the character", () => {
    const { ch, m } = mounted(AXE)
    detachMount(ch, m)
    expect(m.pivot.parent).toBeNull()
    expect(ch.mounted).toHaveLength(0)
  })
})
