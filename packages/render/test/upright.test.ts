import { describe, expect, test } from "bun:test"
import type { Mount, Vec3 } from "@guildhall/assets"
import { roll } from "@guildhall/core"
import { AnimationClip, Group, Object3D, Quaternion, QuaternionKeyframeTrack, Vector3 } from "three"
import { createCharacter } from "../src/character/load.ts"
import { attachMount } from "../src/character/mount.ts"
import { keepUpright } from "../src/character/upright.ts"

const UP = new Vector3(0, 1, 0)
const DEG = Math.PI / 180
const WRISTS = 200

/** A unit quaternion from three draws (Shoemake), so every run poses the same "random" wrists. */
function randomQuaternion(salt: string): Quaternion {
  const [u1, u2, u3] = [roll(7, `${salt}:a`), roll(7, `${salt}:b`), roll(7, `${salt}:c`)]
  const [a, b] = [Math.sqrt(1 - u1), Math.sqrt(u1)]
  return new Quaternion(
    a * Math.sin(2 * Math.PI * u2),
    a * Math.cos(2 * Math.PI * u2),
    b * Math.sin(2 * Math.PI * u3),
    b * Math.cos(2 * Math.PI * u3),
  )
}

/** A body that is just a forearm (turned, moved) holding the right hand slot, as GLTFLoader names it. */
function fakeBody(): { root: Group; wrist: Object3D } {
  const root = new Group()
  const arm = new Object3D()
  arm.position.set(0.25, 1.1, 0.1)
  arm.quaternion.copy(randomQuaternion("arm"))
  const wrist = new Object3D()
  wrist.name = "handslotr"
  wrist.position.set(0, 0.3, 0)
  arm.add(wrist)
  root.add(arm)
  return { root, wrist }
}

/** A lantern hung by its ring: up is the prop's +y, the handle at its top, the grip axes turned. */
const LANTERN: Mount = {
  slot: "hand.r",
  hands: 1,
  handle: [0, 0.3, 0],
  axis: [0, 0, 1],
  edge: [1, 0, 0],
  upright: { up: [0, 1, 0] },
}

function rig(mount: Mount, clips: AnimationClip[] = []) {
  const { root, wrist } = fakeBody()
  const ch = createCharacter(root, clips)
  const piece = new Object3D()
  const m = attachMount(ch, piece, mount)
  return { ch, wrist, piece, m }
}

const upError = (piece: Object3D, up: Vec3) =>
  new Vector3(...up).transformDirection(piece.matrixWorld).angleTo(UP)
const handleAt = (piece: Object3D, handle: Vec3) => new Vector3(...handle).applyMatrix4(piece.matrixWorld)
const slotOrigin = (bone: Object3D) => new Vector3().setFromMatrixPosition(bone.matrixWorld)

describe("keepUpright", () => {
  test(`over ${WRISTS} random wrists the prop's up stays world-up and the handle stays in the hand`, () => {
    const { ch, wrist, piece, m } = rig(LANTERN)
    let worstUp = 0
    let worstHandle = 0
    for (let i = 0; i < WRISTS; i++) {
      wrist.quaternion.copy(randomQuaternion(`wrist${i}`))
      keepUpright(m)
      ch.root.updateMatrixWorld(true)
      worstUp = Math.max(worstUp, upError(piece, LANTERN.upright!.up))
      worstHandle = Math.max(worstHandle, handleAt(piece, LANTERN.handle).distanceTo(slotOrigin(wrist)))
    }
    expect(worstUp).toBeLessThan(0.5 * DEG)
    expect(worstHandle).toBeLessThan(1e-5)
  })

  test("the levelling turn is the shortest one: no twist beyond what tilt needs", () => {
    const { ch, wrist, piece, m } = rig(LANTERN)
    for (let i = 0; i < 20; i++) {
      wrist.quaternion.copy(randomQuaternion(`twist${i}`))
      m.pivot.quaternion.identity()
      ch.root.updateMatrixWorld(true)
      const tilt = upError(piece, LANTERN.upright!.up)
      expect(tilt).toBeGreaterThan(DEG) // the wrist really tilts it
      keepUpright(m)
      expect(m.pivot.quaternion.angleTo(new Quaternion())).toBeCloseTo(tilt, 6)
    }
  })

  test("a prop that is not upright follows the hand exactly", () => {
    const { upright: _level, ...axe } = LANTERN
    const { ch, wrist, piece, m } = rig(axe)
    const inHand = piece.quaternion.clone()
    for (let i = 0; i < 20; i++) {
      wrist.quaternion.copy(randomQuaternion(`axe${i}`))
      ch.update(0)
      ch.root.updateMatrixWorld(true)
      const expected = wrist.getWorldQuaternion(new Quaternion()).multiply(inHand)
      expect(piece.getWorldQuaternion(new Quaternion()).angleTo(expected)).toBeLessThan(1e-6)
      expect(m.pivot.quaternion.angleTo(new Quaternion())).toBe(0)
    }
  })

  test("an upright up other than +y is the axis kept level (an open book's pages)", () => {
    const book: Mount = { ...LANTERN, upright: { up: [0, 0, -1] } }
    const { ch, wrist, piece, m } = rig(book)
    wrist.quaternion.copy(randomQuaternion("book"))
    keepUpright(m)
    ch.root.updateMatrixWorld(true)
    expect(upError(piece, [0, 0, -1])).toBeLessThan(0.5 * DEG)
  })

  test("each frame of a playing clip, after the mixer, the prop is level", () => {
    // A wrist that rolls through five random poses over one second, looped.
    const keys = Array.from({ length: 5 }, (_, i) => randomQuaternion(`clip${i}`).toArray()).flat()
    const track = new QuaternionKeyframeTrack("handslotr.quaternion", [0, 0.25, 0.5, 0.75, 1], keys)
    const clip = new AnimationClip("Waving", 1, [track])
    const { ch, wrist, piece } = rig(LANTERN, [clip])
    expect(ch.play("Waving")).toBe(true)
    const seen = new Set<string>()
    for (let frame = 0; frame < 30; frame++) {
      ch.update(1 / 24)
      ch.root.updateMatrixWorld(true)
      seen.add(
        wrist.quaternion
          .toArray()
          .map((v) => v.toFixed(3))
          .join(),
      )
      expect(upError(piece, LANTERN.upright!.up)).toBeLessThan(0.5 * DEG)
      expect(handleAt(piece, LANTERN.handle).distanceTo(slotOrigin(wrist))).toBeLessThan(1e-5)
    }
    expect(seen.size).toBeGreaterThan(20) // the mixer really moved the wrist
  })

  test("a frozen clip holds its pose at t, and stays level", () => {
    const keys = [...new Quaternion().toArray(), ...randomQuaternion("frozen").toArray()]
    const clip = new AnimationClip("Sit", 2, [
      new QuaternionKeyframeTrack("handslotr.quaternion", [0, 2], keys),
    ])
    const { ch, wrist, piece } = rig(LANTERN, [clip])
    ch.play("Sit", { t: 1 })
    const held = wrist.quaternion.clone()
    // Keyframes are float32, and acos near 1 magnifies that: ~1e-4 rad is "the last key".
    expect(held.angleTo(randomQuaternion("frozen"))).toBeLessThan(1e-3)
    ch.update(0.5)
    ch.root.updateMatrixWorld(true)
    expect(wrist.quaternion.toArray()).toEqual(held.toArray())
    expect(upError(piece, LANTERN.upright!.up)).toBeLessThan(0.5 * DEG)
  })
})
