import { beforeAll, describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { Body } from "../src/scene/body.ts"
import { bakeClips, frameAt } from "../src/scene/crowd/bake.ts"
import { Crowd } from "../src/scene/crowd/Crowd.ts"
import { FADE_S, ONCE } from "../src/scene/crowd/cast.ts"
import { gearOf, pieceOf } from "../src/scene/crowd/gear.ts"
import { FAR, heroic, NEAR, SHORT, TALL } from "../src/scene/crowd/lod.ts"
import { STAGE_ROW } from "../src/scene/crowd/material.ts"
import { attachGrip } from "../src/scene/grips.ts"
import { cloneRig } from "../src/scene/rig.ts"

/**
 * The cast's crowd (scene/crowd/, scene/body.ts) on the real assets: who is a hero, members coming
 * and going, the clock, and a body switching between its rig and a crowd slot without a pose jump.
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

let knight: Object3D
let clips: AnimationClip[]
let bake: ReturnType<typeof bakeClips>

beforeAll(async () => {
  const [model, anims] = await Promise.all([
    glb(join(assets, "characters/knight.glb")),
    glb(join(assets, "anims.glb")),
  ])
  knight = model.scene
  clips = anims.animations
  bake = bakeClips(knight, clips, 30, { once: ONCE })
})

const crowdOf = () => new Crowd(bake, { knight }, [], FADE_S)
const duration = (name: string) => (clips.find((clip) => clip.name === name) as AnimationClip).duration
/** Which members a troop's slots draw (its per-instance member ids, in slot order). */
function drawn(crowd: Crowd, part = "Knight_Body"): number[] {
  const mesh = crowd.root.children.find((child) => child.name === part && child.visible) as
    | (Mesh & { count: number })
    | undefined
  if (!mesh) return []
  const who = mesh.geometry.getAttribute("crowdMember")
  return Array.from({ length: mesh.count }, (_, slot) => who.getX(slot))
}

describe("who is a hero (crowd/lod.ts)", () => {
  test("pinned is always a hero, wherever the camera is", () => {
    expect(heroic(false, true, 1000, 1)).toBe(true)
  })

  test("joins the heroes only near the target and drawn tall", () => {
    expect(heroic(false, false, NEAR - 1, TALL)).toBe(true)
    expect(heroic(false, false, NEAR + 1, TALL)).toBe(false)
    expect(heroic(false, false, NEAR - 1, TALL - 1)).toBe(false)
  })

  test("a hero stays one through the gap (no flicker at the edge)", () => {
    const between = (NEAR + FAR) / 2
    const height = (TALL + SHORT) / 2
    expect(heroic(true, false, between, height)).toBe(true)
    expect(heroic(false, false, between, height)).toBe(false)
    expect(heroic(true, false, FAR + 0.1, height)).toBe(false)
    expect(heroic(true, false, between, SHORT - 1)).toBe(false)
  })
})

describe("the crowd's members (crowd/Crowd.ts)", () => {
  test("a leaver's slot goes to the last member; everyone else is still drawn", () => {
    const crowd = crowdOf()
    const ids = [0, 1, 2, 3].map(() => crowd.join("knight"))
    crowd.leave(ids[1] as number)
    crowd.flush()
    expect(drawn(crowd).sort()).toEqual([0, 2, 3])
    // The freed id is reused, and drawn again.
    expect(crowd.join("knight")).toBe(1)
    crowd.flush()
    expect(drawn(crowd).sort()).toEqual([0, 1, 2, 3])
  })

  test("more members than a troop's first room: it grows and keeps them all", () => {
    const crowd = crowdOf()
    const count = STAGE_ROW + 20
    for (let i = 0; i < count; i++) crowd.join("knight")
    crowd.flush()
    expect(crowd.size).toBe(count)
    expect(new Set(drawn(crowd)).size).toBe(count)
  })

  test("a clip started part-way in is that far in, and moves on with the clock", () => {
    const crowd = crowdOf()
    const id = crowd.join("knight")
    crowd.time = 10
    crowd.start(id, "Walking_A", 0.3, 1.05)
    expect(crowd.phaseOf(id).time).toBeCloseTo(0.3, 6)
    crowd.time = 10.2
    expect(crowd.phaseOf(id).time).toBeCloseTo(0.3 + 0.2 * 1.05, 6)
  })

  test("a loop wraps; a clip played once holds its end", () => {
    const crowd = crowdOf()
    const loop = crowd.join("knight")
    const once = crowd.join("knight")
    crowd.start(loop, "Idle_A", 0)
    crowd.start(once, "Lie_Down", 0)
    const laps = Math.ceil(duration("Lie_Down") / duration("Idle_A")) + 0.5
    crowd.time = duration("Idle_A") * laps
    expect(crowd.phaseOf(loop).time).toBeCloseTo(duration("Idle_A") * 0.5, 5)
    expect(crowd.phaseOf(once).time).toBeCloseTo(duration("Lie_Down"), 6)
  })

  test("the stage holds the rows the shader blends, and a change fades in over the fade", () => {
    const crowd = crowdOf()
    const id = crowd.join("knight")
    crowd.start(id, "Idle_A", 0)
    crowd.time = 5
    crowd.play(id, "Walking_A")
    crowd.time = 5 + FADE_S / 2
    const stage = crowd.uniforms.crowdStage.value?.image.data as Float32Array
    const at = id * 12
    const walk = frameAt(bake.clips[bake.clipIds.get("Walking_A") as number]!, FADE_S / 2)
    const idle = frameAt(bake.clips[bake.clipIds.get("Idle_A") as number]!, 5 + FADE_S / 2)
    expect(stage[at + 4]).toBe(walk.row)
    expect(stage[at + 5]).toBeCloseTo(walk.blend, 5)
    expect(stage[at + 6]).toBe(idle.row)
    expect(stage[at + 7]).toBeCloseTo(idle.blend, 4)
    expect(stage[at + 8]).toBeCloseTo(0.5, 5)
  })

  test("hours in, the clock is as exact as at the start (it never reaches the shader)", () => {
    const crowd = crowdOf()
    const id = crowd.join("knight")
    const late = 3600 * 30
    crowd.time = late
    crowd.start(id, "Walking_A", 0.25)
    crowd.time = late + 1 / 120
    expect(crowd.phaseOf(id).time).toBeCloseTo(0.25 + 1 / 120, 9)
  })

  test("a place is read as where the root stands and its turn about y", () => {
    const crowd = crowdOf()
    const id = crowd.join("knight")
    const place = new Matrix4().compose(
      new Vector3(3, 0.5, -7),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2.2),
      new Vector3(1, 1, 1),
    )
    crowd.place(id, place)
    const stage = crowd.uniforms.crowdStage.value?.image.data as Float32Array
    expect(Array.from(stage.slice(id * 12, id * 12 + 4)).map((x) => +x.toFixed(4))).toEqual([3, 0.5, -7, 2.2])
  })

  test("a troop spread over a big island is fitted round every member, the far ones too", () => {
    // The React rush: most of a troop round the hall, a few at the far districts (the quarry, a
    // package village, the shore): none of them may fall outside the troop's culling sphere.
    const crowd = crowdOf()
    const spots: [number, number][] = []
    for (let i = 0; i < 83; i++) spots.push([12 + ((i * 7) % 23) - 11, 16 + ((i * 11) % 23) - 11])
    for (let i = 0; i < 8; i++) spots.push([-43.3 + (i % 3), -35 + Math.floor(i / 3)])
    spots.push([95.3, -35], [69.3, 50])
    const ids = spots.map(() => crowd.join("knight"))
    const at = (x: number, z: number) => new Matrix4().makeTranslation(x, 0.2, z)
    ids.forEach((id, i) => {
      crowd.place(id, at(...(spots[i] as [number, number])))
    })
    crowd.flush()
    const enclosed = () => {
      const mesh = crowd.root.children.find((c) => c.name === "Knight_Body" && c.visible) as Mesh
      const sphere = mesh.boundingSphere
      if (!sphere) return false
      // The root and a head and a raised arm above it.
      return spots.every(([x, z]) =>
        [0, 2.5].every((up) => sphere.containsPoint(new Vector3(x, 0.2 + up, z))),
      )
    }
    expect(drawn(crowd)).toHaveLength(spots.length)
    expect(enclosed()).toBe(true)
    // They walk off to the far edge: the next flush follows them.
    spots[0] = [-110, 60]
    crowd.place(ids[0] as number, at(-110, 60))
    crowd.flush()
    expect(enclosed()).toBe(true)
  })

  test("gear joins and leaves a member's hands as one troop per piece", () => {
    const crowd = crowdOf()
    const a = crowd.join("knight")
    const b = crowd.join("knight")
    const piece = {
      geometry: new BoxGeometry(0.1, 0.4, 0.1),
      material: new MeshStandardMaterial({ name: "hammer" }),
      bone: "handslotr",
      matrix: new Matrix4(),
    }
    crowd.carry(a, [piece])
    crowd.carry(b, [piece])
    crowd.flush()
    expect(drawn(crowd, "hammer").sort()).toEqual([a, b])
    crowd.carry(a, [])
    crowd.flush()
    expect(drawn(crowd, "hammer")).toEqual([b])
  })
})

describe("a body switches between its rig and the crowd with no jump (scene/body.ts)", () => {
  /** World-space rotation of `bone` under `root`, posed now. */
  const turnOf = (root: Object3D, bone: string) => {
    root.updateMatrixWorld(true)
    return (root.getObjectByName(bone) as Object3D).getWorldQuaternion(new Quaternion())
  }
  /** The same rig posed by a plain mixer at `time` into `clip`. */
  function reference(clip: string, time: number): Object3D {
    const rig = cloneRig(knight)
    const mixer = new AnimationMixer(rig)
    const action = mixer.clipAction(clips.find((c) => c.name === clip) as AnimationClip)
    action.play()
    mixer.setTime(time)
    return rig
  }

  test("hero → crowd starts the baked clip where the mixer is; crowd → hero puts it back", () => {
    const tempo = 1.03
    const root = new Group()
    const rig = cloneRig(knight)
    root.add(rig)
    const body = new Body(rig, clips, tempo)
    const crowd = crowdOf()
    let now = 0
    body.play("Walking_A", now)
    for (let i = 0; i < 30; i++) {
      now += 1 / 60
      body.step(1 / 60, "full")
    }
    // Settled (the clip's fade-in is over): into the crowd, owing this frame's 1/60 s.
    now += 1 / 60
    crowd.time = now
    expect(body.settled(now)).toBe(true)
    body.toCrowd(crowd, "knight", "#c0392b", root, 1 / 60)
    expect(body.hero).toBe(false)
    expect(rig.parent).toBeNull()
    expect(crowd.phaseOf(0).time).toBeCloseTo((31 / 60) * tempo, 4)

    // A third of a second in the crowd, then back: the rig shows what the crowd showed. (Mid-clip:
    // past its last key a never-wrapped reference mixer ends the loop its own way.)
    for (let i = 0; i < 20; i++) {
      now += 1 / 60
      crowd.time = now
      body.play("Walking_A", now)
    }
    const shown = crowd.phaseOf(0).time
    body.toHero(now, 1 / 60)
    body.step(1 / 60, "full")
    expect(body.hero).toBe(true)
    expect(rig.parent).toBe(root)
    const want = turnOf(reference("Walking_A", shown), "handr")
    expect(turnOf(rig, "handr").angleTo(want)).toBeLessThan(1e-6)
    body.dispose()
  })

  test("in the crowd, a clip change is the crowd's crossfade, and unsettled until it ends", () => {
    const root = new Group()
    const rig = cloneRig(knight)
    root.add(rig)
    const body = new Body(rig, clips, 1)
    const crowd = crowdOf()
    body.play("Idle_A", 0)
    body.toCrowd(crowd, "knight", "#ffffff", root, 0)
    crowd.time = 2
    body.play("Cheering", 2)
    expect(crowd.phaseOf(0).clip).toBe("Cheering")
    expect(body.settled(2 + FADE_S / 2)).toBe(false)
    expect(body.settled(2 + FADE_S)).toBe(true)
    body.dispose()
    expect(crowd.size).toBe(0)
  })
})

describe("what the hands hold, read for the crowd (crowd/gear.ts)", () => {
  const geometry = new BoxGeometry(0.1, 0.3, 0.1)
  const material = new MeshStandardMaterial()
  const grip = { bone: "handslotr", position: [0, 0.2, 0], rotation: [0.3, 0, 0], scale: 0.8 } as const

  function holding(upright: boolean): { bone: Object3D; root: Object3D } {
    const bone = new Group()
    bone.name = "handslotr"
    const root = attachGrip(bone, new Mesh(geometry, material), {
      ...grip,
      ...(upright ? { upright: true } : {}),
    })
    return { bone, root }
  }

  test("the same piece in the same grip is one Gear, whoever holds it", () => {
    const a = holding(false)
    const b = holding(false)
    expect(gearOf([a.bone], [])).toEqual(gearOf([b.bone], []))
    expect(gearOf([a.bone], [])[0]).toBe(gearOf([b.bone], [])[0] as never)
  })

  test("a hidden piece is not held", () => {
    const a = holding(false)
    a.root.visible = false
    expect(gearOf([a.bone], [])).toEqual([])
  })

  test("a levelled grip keeps its piece unturned by the pivot, its up axis for the shader", () => {
    const { bone, root } = holding(true)
    // keepUpright has turned the pivot: what the crowd draws must not depend on it.
    root.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 1)
    const gear = pieceOf(root.children[0] as Mesh, bone)
    const up = new Vector3(0, 1, 0).applyQuaternion(root.children[0]?.quaternion as Quaternion)
    expect(gear.up?.distanceTo(up)).toBeLessThan(1e-6)
    const expected = new Matrix4().compose(
      new Vector3(0, 0.2, 0),
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3),
      new Vector3(0.8, 0.8, 0.8),
    )
    for (const [i, value] of gear.matrix.elements.entries())
      expect(value).toBeCloseTo(expected.elements[i] as number, 6)
  })
})
