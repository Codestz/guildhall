import { describe, expect, test } from "bun:test"
import { type Mount, type NpcLook, PALETTE, tintColours } from "@guildhall/assets"
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  type Mesh,
  MeshBasicMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Uint8BufferAttribute,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
} from "three"
import { createCharacter } from "../src/character/load.ts"
import { dressNpc } from "../src/character/npc.ts"

const ramp = (name: string) => PALETTE.ramps.find((r) => r.name === name)!.tones
const [TIMBER, THATCH, SKIN] = [ramp("timber"), ramp("thatch"), ramp("sandstone")]

/** A two-vertex skinned body part as GLTFLoader hands it over: one cloth vertex, one skin vertex. */
function part(name: string, skeleton: Skeleton): SkinnedMesh {
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute([0, 1, 0, 0, 1.5, 0], 3))
  g.setAttribute("color", new Uint8BufferAttribute(new Uint8Array(8).fill(200), 4, true))
  g.setAttribute("_swatch", new Uint8BufferAttribute(Uint8Array.from([TIMBER.base, SKIN.base]), 1))
  g.setAttribute("_shade", new Uint8BufferAttribute(Uint8Array.from([128, 128]), 1, true))
  g.setAttribute("skinIndex", new Uint16BufferAttribute([0, 1, 0, 0, 1, 0, 0, 0], 4))
  g.setAttribute("skinWeight", new Float32BufferAttribute([0.5, 0.5, 0, 0, 1, 0, 0, 0], 4))
  const mesh = new SkinnedMesh(g, new MeshBasicMaterial())
  mesh.name = name
  mesh.bind(skeleton)
  return mesh
}

/** A KayKit-shaped body: hips → hand slot and head bones, a body and a cape part. */
function body() {
  const root = new Group()
  const hips = new Bone()
  hips.name = "hips"
  const hand = new Bone()
  hand.name = "handslotr"
  const head = new Bone()
  head.name = "head"
  hips.add(hand, head)
  root.add(hips)
  const skeleton = new Skeleton([hips, hand, head])
  const meshes = [part("Body", skeleton), part("Cape", skeleton)]
  root.add(...meshes)
  const clip = (name: string) =>
    new AnimationClip(name, 2, [new VectorKeyframeTrack("hips.position", [0, 2], [0, 0, 0, 0, 2, 0])])
  const ch = createCharacter(root, [clip("Idle_B"), clip("Walking_A"), clip("Pickaxing")])
  return { ch, meshes, hips, hand, head }
}

const LOOK: NpcLook = {
  recipe: "farmer",
  seed: 3,
  body: "kaykit-adventurers/barbarian",
  hide: ["Cape"],
  rampMap: { timber: "thatch" },
  mounts: [{ piece: "kaykit-tools/pitchfork", slot: "hand.r" }],
  clips: { work: "Pickaxing", idle: "Idle_B", walk: "Walking_A" },
  scale: 1.03,
  speed: 1.08,
  phase: 0.25,
}
const GRIP: Mount = { slot: "hand.r", hands: 1, handle: [0, 0, 0], axis: [0, 1, 0], edge: [1, 0, 0] }
const HAT: Mount = { ...GRIP, slot: "head" }

/** The colour a vertex of swatch `id` at neutral shade gets, as COLOR_0 stores it (bytes). */
const expected = (id: number): number[] =>
  Array.from(tintColours(Uint8Array.of(id), Uint8Array.of(128), PALETTE), (c) => Math.round(c * 255) / 255)
const rgb = (mesh: Mesh, v: number): number[] =>
  [0, 1, 2].map((c) => mesh.geometry.getAttribute("color").getComponent(v, c))

describe("dressNpc", () => {
  test("re-tints the outfit on skinned geometry: skinning kept, cloth swapped, skin its own colour", () => {
    const { ch, meshes } = body()
    const mesh = meshes[0]!
    const before = mesh.geometry
    dressNpc(ch, LOOK, [])
    expect(mesh.geometry).not.toBe(before)
    expect(mesh).toBeInstanceOf(SkinnedMesh)
    expect(Array.from(mesh.geometry.getAttribute("skinIndex").array)).toEqual(
      Array.from(before.getAttribute("skinIndex").array),
    )
    expect(Array.from(mesh.geometry.getAttribute("skinWeight").array)).toEqual(
      Array.from(before.getAttribute("skinWeight").array),
    )
    expect(mesh.skeleton.bones.map((b) => b.name)).toEqual(["hips", "handslotr", "head"])
    for (const [i, c] of rgb(mesh, 0).entries()) expect(c).toBeCloseTo(expected(THATCH.base)[i]!, 6)
    for (const [i, c] of rgb(mesh, 1).entries()) expect(c).toBeCloseTo(expected(SKIN.base)[i]!, 6)
  })

  test("hides the look's parts, scales the body and hangs props on their slot bones", () => {
    const { ch, hand, head } = body()
    const fork = new Object3D()
    const hat = new Object3D()
    const npc = dressNpc(ch, LOOK, [
      { piece: fork, mount: GRIP, slot: "hand.r" },
      { piece: hat, mount: HAT, slot: "head" },
    ])
    expect(npc.root.getObjectByName("Cape")!.visible).toBe(false)
    expect(npc.root.getObjectByName("Body")!.visible).toBe(true)
    expect(npc.root.scale.toArray()).toEqual([1.03, 1.03, 1.03])
    expect(fork.parent?.parent).toBe(hand)
    expect(hat.parent?.parent).toBe(head)
    expect(ch.mounted).toHaveLength(2)
  })

  test("plays each activity from the look's phase; walking runs at the look's speed", () => {
    const { ch } = body()
    const npc = dressNpc(ch, LOOK, [])
    expect(npc.play("idle")).toBe(true)
    const idle = ch.mixer.existingAction(AnimationClip.findByName(ch.clips, "Idle_B"))!
    expect(idle.time).toBeCloseTo(0.5, 6)
    expect(idle.timeScale).toBe(1)
    expect(npc.play("walk")).toBe(true)
    const walk = ch.mixer.existingAction(AnimationClip.findByName(ch.clips, "Walking_A"))!
    expect(walk.time).toBeCloseTo(0.5, 6)
    expect(walk.timeScale).toBeCloseTo(1.08, 9)
    expect(ch.clip).toBe("Walking_A")
  })

  test("a frozen play holds t, ignoring the phase", () => {
    const { ch, hips } = body()
    const npc = dressNpc(ch, LOOK, [])
    npc.play("work", { t: 0.5 })
    npc.update(1)
    expect(hips.position.y).toBeCloseTo(1, 6)
  })

  test("a clip the rig lacks plays nothing", () => {
    const { ch } = body()
    const npc = dressNpc(ch, { ...LOOK, clips: { ...LOOK.clips, work: "Nope" } }, [])
    expect(npc.play("work")).toBe(false)
  })

  test("dispose stops the clips and takes the body out of its parent", () => {
    const { ch } = body()
    const scene = new Group()
    const npc = dressNpc(ch, LOOK, [])
    scene.add(npc.root)
    npc.play("idle")
    npc.dispose()
    expect(npc.root.parent).toBeNull()
    expect(ch.mixer.existingAction(AnimationClip.findByName(ch.clips, "Idle_B"))?.isRunning() ?? false).toBe(
      false,
    )
  })
})
