import { beforeAll, describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  type BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  type SkinnedMesh,
  Vector3,
} from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { Body } from "../src/scene/body.ts"
import { bakeClips } from "../src/scene/crowd/bake.ts"
import { Crowd } from "../src/scene/crowd/Crowd.ts"
import { FADE_S, ONCE } from "../src/scene/crowd/cast.ts"
import { FIGURE_HEIGHT, lens, look, MESH_LODS, meshLod, tallAt } from "../src/scene/crowd/lod.ts"
import { LEVELS, type PartLods, simplifyModels } from "../src/scene/crowd/simplify.ts"
import { attachGrip, KIT_GRIPS, keepUpright } from "../src/scene/grips.ts"
import { type Carried, carried, carryLantern, track } from "../src/scene/lights/carried.ts"
import { cloneRig } from "../src/scene/rig.ts"

/**
 * The crowd's mesh levels (crowd/lod.ts, crowd/simplify.ts, crowd/Crowd.ts) on the real models,
 * and a lantern carried by a crowd member: its light where the crowd draws the glass.
 */

const assets = join(import.meta.dir, "../public/assets")
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const MODELS = ["knight", "barbarian", "mage", "rogue", "rogue-hooded", "ranger"]

async function glb(path: string): Promise<GLTF> {
  const bytes = readFileSync(path)
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

let models: Record<string, Object3D>
let clips: AnimationClip[]
let bake: ReturnType<typeof bakeClips>
let lods: PartLods

beforeAll(async () => {
  const loaded = await Promise.all(MODELS.map((name) => glb(join(assets, `characters/${name}.glb`))))
  models = Object.fromEntries(MODELS.map((name, i) => [name, (loaded[i] as GLTF).scene]))
  clips = (await glb(join(assets, "anims.glb"))).animations
  bake = bakeClips(models.knight as Object3D, clips, 30, { once: ONCE })
  lods = await simplifyModels(models)
})

function partsOf(model: Object3D): SkinnedMesh[] {
  const parts: SkinnedMesh[] = []
  model.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh) parts.push(node as SkinnedMesh)
  })
  return parts
}

/** The box round the vertices `index` draws. */
function boxOf(geometry: BufferGeometry, index: ArrayLike<number>): Box3 {
  const position = geometry.getAttribute("position")
  const box = new Box3()
  const point = new Vector3()
  for (let i = 0; i < index.length; i++)
    box.expandByPoint(point.fromBufferAttribute(position, index[i] as number))
  return box
}

describe("which mesh level a member draws at (crowd/lod.ts)", () => {
  const [first, second] = MESH_LODS as [{ under: number; over: number }, { under: number; over: number }]

  test("tall on screen: the full mesh; small: the coarsest; one level at a time", () => {
    expect(meshLod(0, 200, 3)).toBe(0)
    expect(meshLod(0, first.under - 1, 3)).toBe(1)
    expect(meshLod(0, second.under - 1, 3)).toBe(2)
    expect(meshLod(2, 200, 3)).toBe(0)
  })

  test("a member stays at its level through the gap (no flicker at the edge)", () => {
    const between = (first.under + first.over) / 2
    expect(meshLod(0, between, 3)).toBe(0)
    expect(meshLod(1, between, 3)).toBe(1)
    expect(meshLod(1, first.over + 1, 3)).toBe(0)
  })

  test("no coarser level made yet: everyone draws the full mesh", () => {
    expect(meshLod(0, 1, 1)).toBe(0)
    expect(meshLod(2, 1, 1)).toBe(0)
  })

  test("a figure's height on screen halves with twice the depth", () => {
    const camera = new PerspectiveCamera(40, 1.5, 0.1, 500)
    camera.position.set(0, FIGURE_HEIGHT / 2, 0)
    camera.lookAt(0, FIGURE_HEIGHT / 2, -1)
    camera.updateMatrixWorld()
    const view = look(camera, 800, lens())
    const near = tallAt(view, 0, 0, -10)
    // 800 px span 2·10·tan(20°) units at depth 10.
    expect(near).toBeCloseTo((FIGURE_HEIGHT * 800) / (2 * 10 * Math.tan((20 * Math.PI) / 180)), 6)
    expect(tallAt(view, 0, 0, -20)).toBeCloseTo(near / 2, 6)
  })
})

describe("the coarser meshes (crowd/simplify.ts)", () => {
  test("every part gets each level, coarser each time, drawing only its own vertices", () => {
    for (const model of Object.values(models))
      for (const part of partsOf(model)) {
        const levels = lods.get(part.geometry)
        expect(levels?.length).toBe(LEVELS.length)
        const full = part.geometry.index?.count ?? 0
        let before = full
        for (const index of levels ?? []) {
          expect(index.length % 3).toBe(0)
          expect(index.length).toBeLessThanOrEqual(before)
          expect(Math.max(...index)).toBeLessThan(part.geometry.getAttribute("position").count)
          before = index.length
        }
        // The bodies (thousands of triangles) lose at least a third at the first level.
        if (full > 3000) expect((levels?.[0]?.length ?? full) / full).toBeLessThan(0.67)
      }
  })

  test("silhouettes hold: a part's extent moves by at most its level's error (hats, capes, hoods)", () => {
    for (const model of Object.values(models))
      for (const part of partsOf(model)) {
        const index = part.geometry.index?.array as ArrayLike<number>
        const full = boxOf(part.geometry, index)
        for (const [k, level] of (lods.get(part.geometry) ?? []).entries()) {
          const box = boxOf(part.geometry, level)
          const error = (LEVELS[k] as { error: number }).error
          expect(full.min.distanceTo(box.min)).toBeLessThanOrEqual(error * Math.sqrt(3))
          expect(full.max.distanceTo(box.max)).toBeLessThanOrEqual(error * Math.sqrt(3))
        }
      }
  })
})

describe("members move between mesh levels by size on screen (crowd/Crowd.ts)", () => {
  /** A camera at the origin looking down -z, the canvas 860 px tall. */
  function camera(): PerspectiveCamera {
    const view = new PerspectiveCamera(30, 1.6, 0.1, 500)
    view.position.set(0, FIGURE_HEIGHT / 2, 0)
    view.lookAt(0, FIGURE_HEIGHT / 2, -1)
    view.updateMatrixWorld()
    return view
  }
  const at = (z: number) => new Matrix4().makeTranslation(0, 0, z)
  const visible = (crowd: Crowd, name: string) =>
    crowd.root.children.find((child) => child.name === name && child.visible) as
      | (Mesh & { count: number })
      | undefined

  test("near draws the full mesh, far a coarser one; each level one draw per part", () => {
    const crowd = new Crowd(bake, models, [], FADE_S)
    crowd.levels(lods)
    const near = crowd.join("mage")
    const far = crowd.join("mage")
    crowd.place(near, at(-5))
    crowd.place(far, at(-200))
    crowd.flush(camera(), 860)
    expect(crowd.levelOf(near)).toBe(0)
    expect(crowd.levelOf(far)).toBe(LEVELS.length)
    expect(visible(crowd, "Mage_Body")?.count).toBe(1)
    expect(visible(crowd, `Mage_Body_LOD${LEVELS.length}`)?.count).toBe(1)
    // Two levels in use, two parts each: four draws.
    expect(crowd.draws).toBe(4)
    crowd.dispose()
  })

  test("a member coming closer comes back to the full mesh, keeping its tint", () => {
    const crowd = new Crowd(bake, models, [], FADE_S)
    crowd.levels(lods)
    const id = crowd.join("mage", "#3366ff")
    crowd.place(id, at(-200))
    crowd.flush(camera(), 860)
    crowd.place(id, at(-5))
    crowd.flush(camera(), 860)
    expect(crowd.levelOf(id)).toBe(0)
    const cape = visible(crowd, "Mage_Tinted")
    expect(cape?.count).toBe(1)
    // The member's tint (a quarter towards white), carried over from the slot it had far off.
    expect(cape?.instanceColor?.getX(0)).toBeCloseTo(
      new Color("#3366ff").lerp(new Color("#ffffff"), 0.25).r,
      6,
    )
    crowd.dispose()
  })

  test("levels made after members joined are used from the next flush", () => {
    const crowd = new Crowd(bake, models, [], FADE_S)
    const id = crowd.join("knight")
    crowd.place(id, at(-200))
    crowd.flush(camera(), 860)
    expect(crowd.levelOf(id)).toBe(0)
    crowd.levels(lods)
    crowd.flush(camera(), 860)
    expect(crowd.levelOf(id)).toBe(LEVELS.length)
    crowd.dispose()
  })

  test("no camera: everyone keeps their level", () => {
    const crowd = new Crowd(bake, models, [], FADE_S)
    crowd.levels(lods)
    const id = crowd.join("knight")
    crowd.place(id, at(-200))
    crowd.flush()
    expect(crowd.levelOf(id)).toBe(0)
    crowd.dispose()
  })
})

describe("a lantern carried in the crowd (crowd/Crowd.ts held, scene/body.ts, lights/carried.ts)", () => {
  /** A lantern-like piece: a frame and a transparent glass pane 0.4 below the handle. */
  function lantern(): { held: Group; glass: Mesh } {
    const glass = new Mesh(
      new BoxGeometry(0.3, 0.3, 0.3).translate(0, -0.4, 0),
      new MeshStandardMaterial({ transparent: true, opacity: 0.2 }),
    )
    const held = new Group()
    held.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardMaterial()), glass)
    return { held, glass }
  }

  /** The hero's flame: the glass's centre in the world, as carried.ts reads it off the rig. */
  function heroFlame(rig: Object3D, root: Object3D, grip: Object3D, glass: Mesh, clip: string, time: number) {
    const mixer = new AnimationMixer(rig)
    mixer.clipAction(clips.find((c) => c.name === clip) as AnimationClip).play()
    mixer.setTime(time)
    root.updateMatrixWorld(true)
    keepUpright(grip)
    root.updateMatrixWorld(true)
    glass.geometry.computeBoundingBox()
    return (glass.geometry.boundingBox as Box3).getCenter(new Vector3()).applyMatrix4(glass.matrixWorld)
  }

  test("the crowd's levelled grip is where the hero's is: the flame within a centimetre", () => {
    const scene = new Scene()
    const root = new Group()
    root.position.set(4, 0, -3)
    root.rotation.y = 0.8
    scene.add(root)
    const rig = cloneRig(models.knight as Object3D)
    root.add(rig)
    const grip = KIT_GRIPS.lantern
    const bone = rig.getObjectByName(grip.bone) as Object3D
    const { held, glass } = lantern()
    const pivot = attachGrip(bone, held, grip)
    // On a baked row (frame 12 at 30 fps): the bake's own rows, no blending between two.
    const time = 12 / 30
    const want = heroFlame(rig, root, pivot, glass, "Walking_A", time)

    const crowd = new Crowd(bake, models, [], FADE_S)
    const body = new Body(rig, clips, 1)
    body.play("Walking_A", 0)
    body.step(time, "full")
    crowd.time = time
    body.toCrowd(crowd, "knight", "#ffffff", root, 0)
    crowd.time = time
    const putDown = carryLantern(pivot, rig)
    track()
    const entry = carried[carried.length - 1] as Carried
    expect(rig.parent).toBeNull()
    expect(entry.lit).toBe(true)
    expect(entry.at.distanceTo(want)).toBeLessThan(0.01)
    expect(entry.ground).toBeCloseTo(0, 6)

    // Hidden figure: no light. Back to a hero: read off the rig again.
    root.visible = false
    track()
    expect(entry.lit).toBe(false)
    root.visible = true
    body.toHero(time, 0)
    track()
    expect(rig.parent).toBe(root)
    expect(entry.lit).toBe(true)
    putDown()
    body.dispose()
    crowd.dispose()
  })
})
