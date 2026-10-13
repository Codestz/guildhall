import { describe, expect, test } from "bun:test"
import { type Mount, type NpcLook, PALETTE, rampMapToSwatchMap, tintColours } from "@guildhall/assets"
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint8BufferAttribute,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
} from "three"
import { createCharacter } from "../src/character/load.ts"
import { attachMount } from "../src/character/mount.ts"
import { dressNpc } from "../src/character/npc.ts"
import { type BakePose, bakeClips, bakeClipsSliced, boneAt, boneMap, frameAt } from "../src/crowd/bake.ts"
import { advance, bakePose, FADE, lookClips } from "../src/crowd/crowd.ts"
import { chooseHeroes, heroShown, type Playing, poseHero, SHORT, TALL } from "../src/crowd/heroes.ts"
import { outfitTable, tintTable } from "../src/crowd/outfit.ts"
import { mergeBody, mergeParts, skinnedParts } from "../src/crowd/parts.ts"
import { propMatrix } from "../src/crowd/props.ts"
import { createSlicer } from "../src/slice.ts"

const ramp = (name: string) => PALETTE.ramps.find((r) => r.name === name)!.tones
const TIMBER = ramp("timber")

/** A part: three vertices, each on one bone (hips, arm, hand), cloth-coloured. */
function part(name: string, skeleton: Skeleton, joints: readonly number[]): SkinnedMesh {
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute([0, 1, 0, 0.5, 1.4, 0, 0.5, 1.1, 0.1], 3))
  g.setAttribute("normal", new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  g.setAttribute("color", new Uint8BufferAttribute(new Uint8Array(9).fill(200), 3, true))
  g.setAttribute("_swatch", new Uint8BufferAttribute(new Uint8Array(3).fill(TIMBER.base), 1))
  g.setAttribute("_shade", new Uint8BufferAttribute(Uint8Array.from([128, 100, 160]), 1, true))
  g.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(
      joints.flatMap((j) => [j, 0, 0, 0]),
      4,
    ),
  )
  g.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  g.setIndex([0, 1, 2])
  const mesh = new SkinnedMesh(g, new MeshBasicMaterial())
  mesh.name = name
  mesh.bind(skeleton)
  return mesh
}

/**
 * A KayKit-shaped body: hips → arm → hand slot, hips → head, and two parts. `shuffled` lists the
 * skeleton's joints in another order (as the KayKit bodies do), its parts' skin indices to match.
 */
function body(shuffled = false) {
  const root = new Group()
  const rig = new Object3D()
  rig.name = "Rig_Medium"
  const hips = new Bone()
  hips.name = "hips"
  hips.position.set(0, 1, 0)
  const arm = new Bone()
  arm.name = "arm"
  arm.position.set(0.3, 0.4, 0)
  const hand = new Bone()
  hand.name = "handslotr"
  hand.position.set(0.2, -0.3, 0)
  const head = new Bone()
  head.name = "head"
  head.position.set(0, 0.6, 0)
  hips.add(arm, head)
  arm.add(hand)
  rig.add(hips)
  root.add(rig)
  root.updateMatrixWorld(true)
  const bones = shuffled ? [head, hand, arm, hips] : [hips, arm, hand, head]
  const skeleton = new Skeleton(bones)
  const at = (b: Bone) => bones.indexOf(b)
  const parts = [
    part("Body", skeleton, [at(hips), at(arm), at(hand)]),
    part("Hat", skeleton, [at(head), at(head), at(head)]),
  ]
  rig.add(...parts)
  return { root, parts, hand }
}

const turn = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis, angle).toArray()
const CLIPS = [
  new AnimationClip("Wave", 1, [
    new QuaternionKeyframeTrack(
      "arm.quaternion",
      [0, 0.5, 1],
      [
        ...turn(new Vector3(0, 0, 1), 0),
        ...turn(new Vector3(0, 0, 1), 1.2),
        ...turn(new Vector3(0, 0, 1), 0),
      ],
    ),
  ]),
  new AnimationClip("Bob", 2, [
    new VectorKeyframeTrack("hips.position", [0, 1, 2], [0, 1, 0, 0, 1.2, 0, 0, 1, 0]),
    new QuaternionKeyframeTrack(
      "hand.quaternion".replace("hand", "handslotr"),
      [0, 2],
      [...turn(new Vector3(1, 0, 0), 0), ...turn(new Vector3(1, 0, 0), 2)],
    ),
  ]),
]

const LOOK: NpcLook = {
  recipe: "night-watch",
  seed: 1,
  body: "b",
  hide: [],
  rampMap: {},
  mounts: [],
  clips: { work: "Wave", idle: "Bob", walk: "Wave" },
  scale: 1,
  speed: 1,
  phase: 0,
}

/** A lantern on the right hand: kept upright. */
const LANTERN: Mount = {
  slot: "hand.r",
  hands: 1,
  handle: [0, 0.3, 0],
  axis: [0, 0, 1],
  edge: [1, 0, 0],
  upright: { up: [0, 1, 0] },
}

/** Where `mesh`'s vertex `v` is drawn as three skins it now. */
const skinned = (mesh: SkinnedMesh, v: number) => {
  let root: Object3D = mesh
  while (root.parent) root = root.parent
  root.updateMatrixWorld(true)
  mesh.skeleton.update()
  return mesh.applyBoneTransform(
    v,
    new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), v),
  )
}

/** The crowd shader's skinning of vertex `v` of `mesh` (one bone each here), on the CPU. */
const baked = (
  bake: ReturnType<typeof bakeClips>,
  pose: BakePose,
  mesh: SkinnedMesh,
  map: number[],
  v: number,
) => {
  const joint = map[mesh.geometry.getAttribute("skinIndex").getX(v)] as number
  return new Vector3()
    .fromBufferAttribute(mesh.geometry.getAttribute("position"), v)
    .applyMatrix4(boneAt(bake, pose, joint, new Matrix4()))
}

const playing = (clip: string, phase: number): Playing => ({ clip, phase, was: null, wasPhase: 0, fade: 1 })

/** A hero (dressed NPC) and a bake of the same rig, from two copies of the body. */
function heroAndBake(shuffled = false) {
  const bake = bakeClips(body().root, CLIPS, 30)
  const b = body(shuffled)
  const ch = createCharacter(b.root, CLIPS)
  const piece = new Object3D()
  attachMount(ch, piece, LANTERN)
  const npc = dressNpc(ch, LOOK, [])
  return { bake, npc, parts: b.parts, piece }
}

describe("bake", () => {
  test("a person drawn from the bake stands where the hero's skeleton puts them, on rows and between them", () => {
    const { bake, npc, parts } = heroAndBake(true)
    const map = boneMap(bake, parts[0]!)!
    expect(map).not.toBeNull()
    for (const [clip, phase, within] of [
      ["Wave", 0.5, 1e-3],
      ["Bob", 0.25, 1e-3],
      ["Wave", 0.37, 5e-3],
    ] as const) {
      const state = playing(clip, phase)
      poseHero(npc, state)
      const pose = bakePose(bake, state, { now: 0, blendNow: 0, was: 0, blendWas: 0, fade: 1 })
      for (const mesh of parts)
        for (let v = 0; v < 3; v++)
          expect(baked(bake, pose, mesh, map, v).distanceTo(skinned(mesh, v))).toBeLessThan(within)
    }
  })

  test("a body on another rig does not map onto the bake", () => {
    const bake = bakeClips(body().root, CLIPS, 30)
    const other = body().parts[0]!
    other.skeleton.boneInverses[1]!.makeTranslation(9, 9, 9)
    expect(boneMap(bake, other)).toBeNull()
  })

  test("frameAt wraps the phase and never reads past a clip's last row", () => {
    const clip = { name: "x", row: 10, frames: 31, duration: 1 }
    expect(frameAt(clip, 0)).toEqual({ row: 10, blend: 0 })
    expect(frameAt(clip, 1.5)).toEqual({ row: 25, blend: 0 })
    const end = frameAt(clip, 0.99999)
    expect(end.row).toBe(39)
    expect(end.blend).toBeLessThanOrEqual(1)
  })
})

describe("held props", () => {
  test("a crowd prop sits exactly where the hero's mounted, levelled one does", () => {
    const { bake, npc, piece } = heroAndBake()
    const hand = bake.bones.indexOf("handslotr")
    for (const [clip, phase] of [
      ["Bob", 0.5],
      ["Wave", 0.5],
    ] as const) {
      const state = playing(clip, phase)
      poseHero(npc, state)
      npc.root.updateMatrixWorld(true)
      const pose = bakePose(bake, state, { now: 0, blendNow: 0, was: 0, blendWas: 0, fade: 1 })
      const m = new Matrix4()
      expect(propMatrix(bake, pose, clip, { mount: LANTERN, slot: "hand.r", bone: hand }, m)).toBe(true)
      for (const [i, e] of m.elements.entries()) expect(e).toBeCloseTo(piece.matrixWorld.elements[i]!, 3)
      // Upright: the lantern's up is the world's.
      const up = new Vector3(0, 1, 0).transformDirection(m)
      expect(up.y).toBeCloseTo(1, 5)
    }
  })

  test("a clip that hides the prop leaves it out", () => {
    const { bake } = heroAndBake()
    const mount: Mount = { ...LANTERN, clips: { Wave: { hide: true } } }
    const pose = bakePose(bake, playing("Wave", 0), { now: 0, blendNow: 0, was: 0, blendWas: 0, fade: 1 })
    expect(propMatrix(bake, pose, "Wave", { mount, slot: "hand.r", bone: 2 }, new Matrix4())).toBe(false)
  })
})

describe("hand-off state", () => {
  test("a clip change fades over FADE seconds from where the old clip was left", () => {
    const p = playing("Wave", 0.4)
    advance(p, "Bob", 0.1, 0.016)
    expect(p).toMatchObject({ clip: "Bob", phase: 0.1, was: "Wave", wasPhase: 0.4, fade: 0 })
    advance(p, "Bob", 0.2, FADE / 2)
    expect(p.fade).toBeCloseTo(0.5, 9)
    advance(p, "Bob", 1.3, FADE)
    expect(p.fade).toBe(1)
    expect(p.phase).toBeCloseTo(0.3, 9)
  })

  test("mid-fade, hero and crowd blend the same two poses, close but not exactly", () => {
    const { bake, npc, parts } = heroAndBake()
    const map = boneMap(bake, parts[0]!)!
    const state: Playing = { clip: "Wave", phase: 0.5, was: "Bob", wasPhase: 0.5, fade: 0.5 }
    poseHero(npc, state)
    const pose = bakePose(bake, state, { now: 0, blendNow: 0, was: 0, blendWas: 0, fade: 1 })
    expect(pose.fade).toBe(0.5)
    // Two large turns on a chain blended halfway: the bake nlerps whole bones, the mixer each joint.
    for (let v = 0; v < 3; v++)
      expect(baked(bake, pose, parts[0]!, map, v).distanceTo(skinned(parts[0]!, v))).toBeLessThan(0.1)
  })

  test("so a hand-off waits for a fade to finish", () => {
    expect(heroShown(true, true, false, 0.5)).toBe(false)
    expect(heroShown(true, true, false, 1)).toBe(true)
    expect(heroShown(false, true, true, 0.5)).toBe(true)
    expect(heroShown(false, true, true, 1)).toBe(false)
    expect(heroShown(true, false, false, 1)).toBe(false)
  })

  test("a person's first clip starts at once, without a fade", () => {
    const p: Playing = { clip: "", phase: 0, was: null, wasPhase: 0, fade: 1 }
    advance(p, "Bob", 0.3, 0)
    expect(p).toMatchObject({ clip: "Bob", phase: 0.3, was: null, fade: 1 })
  })

  test("the clips a crowd bakes are its looks' own, once each", () => {
    expect(lookClips([LOOK, { ...LOOK, clips: { work: "Dig", idle: "Bob", walk: "Wave" } }])).toEqual([
      "Bob",
      "Dig",
      "Wave",
    ])
  })
})

describe("chooseHeroes", () => {
  const c = (id: number, distance: number, tall = 200) => ({ id, distance, tall })

  test("the nearest tall-enough people, up to the cap", () => {
    const heroes = chooseHeroes([c(1, 30), c(2, 5), c(3, 10), c(4, 3, TALL - 1)], new Set(), new Set(), 2)
    expect([...heroes].sort()).toEqual([2, 3])
  })

  test("pinned ids are heroes at any distance and count toward the cap", () => {
    const heroes = chooseHeroes([c(1, 900, 3), c(2, 5), c(3, 10)], new Set(), new Set([1]), 2)
    expect([...heroes].sort()).toEqual([1, 2])
  })

  test("a hero stays one down to SHORT px and keeps its place against an equally near newcomer", () => {
    const current = new Set([1])
    expect(chooseHeroes([c(1, 10, SHORT + 1)], current, new Set(), 4).has(1)).toBe(true)
    expect(chooseHeroes([c(1, 10, SHORT + 1)], new Set(), new Set(), 4).has(1)).toBe(false)
    expect([...chooseHeroes([c(1, 10.5), c(2, 10)], current, new Set(), 1)]).toEqual([1])
  })

  test("a cap of zero makes nobody a hero", () => {
    expect(chooseHeroes([c(1, 1)], new Set(), new Set(), 0).size).toBe(0)
  })
})

describe("outfits", () => {
  test("the tint table holds the bytes recolour writes for every shade", () => {
    const table = tintTable().image.data as Uint8Array
    for (const shade of [0, 64, 128, 200, 255]) {
      const rgb = tintColours(Uint8Array.of(TIMBER.base), Uint8Array.of(shade), PALETTE)
      const at = (TIMBER.base * 256 + shade) * 4
      for (let k = 0; k < 3; k++) expect(table[at + k]).toBe(Math.round(rgb[k]! * 255))
    }
  })

  test("one outfit row per person: its ramp map, identity elsewhere", () => {
    const rows = outfitTable([{}, { timber: "thatch" }]).image.data as Uint8Array
    const map = rampMapToSwatchMap(PALETTE, { timber: "thatch" })
    expect(rows[TIMBER.base]).toBe(TIMBER.base)
    expect(rows[256 + TIMBER.base]).toBe(map[TIMBER.base])
    expect(rows[256 + 3]).toBe(3)
  })
})

describe("parts", () => {
  test("merges a body's parts with their part index and joints renumbered into the bake's order", () => {
    const { parts } = body(true)
    const merged = mergeParts(parts, [10, 11, 12, 13])
    expect(merged.getAttribute("position").count).toBe(6)
    expect(Array.from(merged.getAttribute("_part").array)).toEqual([0, 0, 0, 1, 1, 1])
    // Shuffled order is [head, hand, arm, hips]: the body's hips vertex is joint 3 → 13.
    expect(merged.getAttribute("skinIndex").getX(0)).toBe(13)
    expect(merged.getAttribute("_swatch").getX(0)).toBe(TIMBER.base)
    expect(Array.from(merged.index!.array)).toEqual([0, 1, 2, 3, 4, 5])
  })

  test("a hero's shown parts become one skinned draw; hidden parts are left out", () => {
    const { root, parts } = body()
    parts[1]!.visible = false
    const mesh = mergeBody(root)!
    expect(skinnedParts(root)).toEqual([mesh])
    expect(mesh.geometry.getAttribute("position").count).toBe(3)
    expect(mesh.skeleton).toBe(parts[0]!.skeleton)
  })
})

describe("bakeClipsSliced", () => {
  test("writes the bytes bakeClips writes, a clip a slice", async () => {
    const whole = bakeClips(body().root, CLIPS, 30)
    let clock = 0
    // a budget of 0: every step yields, so each clip is its own slice
    const sliced = await bakeClipsSliced(
      body().root,
      CLIPS,
      30,
      createSlicer(0, () => clock++),
    )
    expect(sliced.data).toEqual(whole.data)
    expect(sliced.clips).toEqual(whole.clips)
    expect(sliced.bones).toEqual(whole.bones)
  })
})
