import { beforeAll, describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type AnimationClip,
  AnimationMixer,
  DataUtils,
  Group,
  LoopOnce,
  Matrix4,
  type Object3D,
  type SkinnedMesh,
  Vector3,
} from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import {
  type BoneBake,
  bakeClips,
  boneAt,
  boneMap,
  frameAt,
  skinningMatrix,
  socketAt,
  TEXELS_PER_BONE,
} from "../src/scene/crowd/bake.ts"
import { HAND_SLOT } from "../src/scene/grips.ts"
import { cloneRig } from "../src/scene/rig.ts"
import { MODELS } from "../src/world/cast.ts"

/**
 * scene/crowd/bake.ts on the real assets: the knight posed by the shared anims.glb, baked at 30 fps,
 * checked against a live AnimationMixer on its own copy of the rig — what a SkinnedMesh would draw.
 */

const assets = join(import.meta.dir, "../public/assets")
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

async function glb(path: string): Promise<GLTF> {
  const bytes = readFileSync(path)
  // The models' palette texture can't decode without a DOM; geometry and skins are all we need.
  const quiet = spyOn(console, "warn").mockImplementation(() => {})
  try {
    return await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    )
  } finally {
    quiet.mockRestore()
  }
}

function skinnedOf(root: Object3D): SkinnedMesh[] {
  const found: SkinnedMesh[] = []
  root.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) found.push(node as SkinnedMesh)
  })
  return found
}

const FPS = 30
let knight: GLTF
let clips: AnimationClip[]
let bake: BoneBake

function clipNamed(name: string): AnimationClip {
  const clip = clips.find((c) => c.name === name)
  if (!clip) throw new Error(`no clip ${name}`)
  return clip
}

/** A live copy of `model`, posed by a real mixer at `time` into `clip` (held at the end, like the bake). */
function live(clip: AnimationClip, time: number, model: Object3D = knight.scene): Object3D {
  const root = cloneRig(model)
  const mixer = new AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.setLoop(LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  mixer.setTime(time)
  root.updateMatrixWorld(true)
  for (const mesh of skinnedOf(root)) mesh.skeleton.update()
  return root
}

/**
 * Furthest any vertex of `mesh` lands between three's own skinning (applyBoneTransform) and the
 * bake's, at `time` into `clip`: the shader's sum, done on the CPU.
 */
function vertexGap(mesh: SkinnedMesh, from: BoneBake, clip: string, time: number, map?: number[]): number {
  const id = from.clipIds.get(clip) as number
  const position = mesh.geometry.getAttribute("position")
  const joints = mesh.geometry.getAttribute("skinIndex")
  const weights = mesh.geometry.getAttribute("skinWeight")
  const baked = from.bones.map((_, bone) => boneAt(from, id, time, bone, new Matrix4()))
  const want = new Vector3()
  const got = new Vector3()
  const part = new Vector3()
  let worst = 0
  for (let v = 0; v < position.count; v++) {
    want.fromBufferAttribute(position, v)
    got.set(0, 0, 0)
    for (let k = 0; k < 4; k++) {
      const weight = weights.getComponent(v, k)
      if (weight === 0) continue
      const joint = joints.getComponent(v, k)
      part.copy(want).applyMatrix4(baked[map ? (map[joint] as number) : joint] as Matrix4)
      got.addScaledVector(part, weight)
    }
    mesh.applyBoneTransform(v, want)
    want.applyMatrix4(mesh.matrixWorld)
    worst = Math.max(worst, want.distanceTo(got))
  }
  return worst
}

/** The bake as the GPU sees it: every number rounded through a half float. */
function halved(from: BoneBake): BoneBake {
  return {
    ...from,
    data: Float32Array.from(from.data, (x) => DataUtils.fromHalfFloat(DataUtils.toHalfFloat(x))),
  }
}

/** The time of row `frame` of `clip`, nudged inside so the last row of a loop isn't read as the next lap. */
function rowTime(clip: string, frame: number): number {
  const entry = bake.clips[bake.clipIds.get(clip) as number]!
  return Math.min((entry.duration * frame) / (entry.frames - 1), entry.duration - 1e-6)
}

beforeAll(async () => {
  const [model, anims] = await Promise.all([
    glb(join(assets, "characters/knight.glb")),
    glb(join(assets, "anims.glb")),
  ])
  knight = model
  clips = anims.animations
  bake = bakeClips(knight.scene, clips, FPS, { once: new Set(["Death_A"]) })
})

describe("bakeClips", () => {
  test("lays every clip out in consecutive rows, two texels per bone", () => {
    const { image } = bake.texture
    expect(image.width).toBe(bake.bones.length * TEXELS_PER_BONE)
    const last = bake.clips.at(-1)!
    expect(image.height).toBe(last.row + last.frames)
    for (const [i, clip] of bake.clips.entries()) {
      const before = bake.clips[i - 1]
      expect(clip.row).toBe(before ? before.row + before.frames : 0)
      expect(clip.frames).toBe(Math.round(clip.duration * FPS) + 1)
    }
    expect(bake.clips.find((c) => c.name === "Death_A")?.loop).toBe(false)
    expect(bake.clips.find((c) => c.name === "Walking_A")?.loop).toBe(true)
  })

  test("a baked frame is the mixer's live skinning matrix for every bone", () => {
    for (const name of ["Walking_A", "Pickaxing", "Death_A", "Spawn_Ground"]) {
      const entry = bake.clips[bake.clipIds.get(name)!]!
      for (const frame of [0, 1, Math.floor(entry.frames / 2), entry.frames - 1]) {
        const time = rowTime(name, frame)
        const mesh = skinnedOf(live(clipNamed(name), time))[0]!
        const prefix = mesh.matrixWorld.clone().multiply(mesh.bindMatrixInverse)
        for (let bone = 0; bone < bake.bones.length; bone++) {
          const want = skinningMatrix(mesh, bone, prefix, new Matrix4()).elements
          const got = boneAt(bake, bake.clipIds.get(name)!, time, bone, new Matrix4()).elements
          const gap = Math.max(...want.map((value, i) => Math.abs(value - (got[i] as number))))
          expect({ name, frame, bone, close: gap < 1e-4 }).toEqual({ name, frame, bone, close: true })
        }
      }
    }
  })

  test("as half floats (what the GPU reads), no vertex moves more than 3 mm", () => {
    const gpu = halved(bake)
    for (const name of ["Walking_A", "Melee_2H_Attack_Chop", "Spawn_Ground", "Sit_Floor_Idle"]) {
      const entry = bake.clips[bake.clipIds.get(name)!]!
      for (const frame of [0, Math.floor(entry.frames / 3), entry.frames - 1]) {
        const time = rowTime(name, frame)
        const mesh = skinnedOf(live(clipNamed(name), time))[0]!
        expect({ name, frame, mm: Math.round(vertexGap(mesh, gpu, name, time) * 1000) <= 3 }).toEqual({
          name,
          frame,
          mm: true,
        })
      }
    }
  })

  test("between rows, walking and running stay within 1.5 cm of the mixer's own pose", () => {
    // The mixer slerps each bone in its parent's space; the bake blends in the root's. Measured
    // worst mid-frame over all 41 clips: 12 mm walking, 47 mm in the two-handed chop.
    for (const name of ["Walking_A", "Running_A"]) {
      const entry = bake.clips[bake.clipIds.get(name)!]!
      const step = entry.duration / (entry.frames - 1)
      for (let frame = 0; frame < entry.frames - 1; frame++) {
        const time = (frame + 0.5) * step
        const mesh = skinnedOf(live(clipNamed(name), time))[0]!
        expect({ name, frame, near: vertexGap(mesh, bake, name, time) < 0.015 }).toEqual({
          name,
          frame,
          near: true,
        })
      }
    }
  })

  test("a looping clip wraps past its end; a once clip holds its last frame", () => {
    const walk = bake.clips[bake.clipIds.get("Walking_A")!]!
    const lap = frameAt(walk, walk.duration + 0.3)
    expect(lap.row).toBe(frameAt(walk, 0.3).row)
    expect(lap.blend).toBeCloseTo(frameAt(walk, 0.3).blend, 9)
    const death = bake.clips[bake.clipIds.get("Death_A")!]!
    expect(frameAt(death, death.duration + 5)).toEqual({ row: death.row + death.frames - 2, blend: 1 })
    expect(frameAt(death, -1)).toEqual({ row: death.row, blend: 0 })
  })

  test("a hand slot's socket is where the live bone is (gear can ride the bake)", () => {
    const id = bake.clipIds.get("Pickaxing")!
    for (const time of [0, 0.8, 1.9]) {
      const root = live(clipNamed("Pickaxing"), time)
      for (const name of [HAND_SLOT.right, HAND_SLOT.left, "chest"]) {
        const bone = bake.bones.indexOf(name)
        expect(bone).toBeGreaterThanOrEqual(0)
        const want = new Vector3().setFromMatrixPosition((root.getObjectByName(name) as Object3D).matrixWorld)
        const got = new Vector3().setFromMatrixPosition(socketAt(bake, id, time, bone, new Matrix4()))
        expect(got.distanceTo(want)).toBeLessThan(0.01)
      }
    }
  })

  test("one bake serves every adventurer model, through each one's joint order", async () => {
    for (const model of MODELS) {
      const root = live(clipNamed("Waving"), 0.7, (await glb(join(assets, `characters/${model}.glb`))).scene)
      for (const mesh of skinnedOf(root)) {
        const map = boneMap(bake, mesh)
        expect({ model, part: mesh.name, mapped: map !== null }).toEqual({
          model,
          part: mesh.name,
          mapped: true,
        })
        expect(vertexGap(mesh, bake, "Waving", 0.7, map ?? undefined)).toBeLessThan(0.01)
      }
    }
  })

  test("a skin on another rig gets no bone map", () => {
    const mesh = skinnedOf(cloneRig(knight.scene))[0]!
    mesh.skeleton.boneInverses[3]!.makeTranslation(0, 1, 0)
    expect(boneMap(bake, mesh)).toBeNull()
  })

  test("a rig without a skinned mesh is refused", () => {
    expect(() => bakeClips(new Group(), clips, FPS)).toThrow(/no skinned mesh/)
  })
})
