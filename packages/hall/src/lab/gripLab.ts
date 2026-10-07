import {
  AmbientLight,
  type AnimationClip,
  AnimationMixer,
  AxesHelper,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { CARRY_WALK, carryClip } from "../scene/activity.ts"
import { attachGrip, HAND_SLOT, type HeldPiece, KIT_GRIPS, keepUpright, PROP_GRIPS } from "../scene/grips.ts"
import { cloneRig } from "../scene/rig.ts"
import type { Held, Tool } from "../world/behaviours.ts"
import { ANIMS_URL, KIT_URL, type Model, modelUrl } from "../world/cast.ts"

/**
 * The grip lab (dev only, `/?grips`): one character, frozen in the clips an item is used with, the
 * item in hand through the same table the hall uses (scene/grips.ts), drawn from the front, the
 * side, three-quarters and the diorama's own angle into one contact sheet. Driven by
 * scripts/shot.ts: `lab.sheet("pickaxe")`, then a shot. `lab.sheet("axes")` draws the hand slots'
 * own axes (x red, y green, z blue).
 */

type Item = { piece: HeldPiece } | { prop: Held | Tool }
interface Study {
  model: Model
  items: Item[]
  /** [clip, fraction of its length] per column. */
  poses: [string, number][]
  axes?: boolean
  /** Frame the hands (close) or the whole figure. */
  close?: boolean
}

const walk: [string, number][] = [
  ["Walking_A", 0.25],
  ["Walking_A", 0.75],
]
const carry: [string, number][] = [
  [CARRY_WALK, 0.25],
  [CARRY_WALK, 0.75],
]

export const STUDIES: Record<string, Study> = {
  axes: {
    model: "knight",
    items: [],
    axes: true,
    close: true,
    poses: [
      ["Idle_A", 0],
      ["Pickaxing", 0.3],
      ["Sit_Chair_Idle", 0.2],
      [CARRY_WALK, 0.3],
      ["Use_Item", 0.4],
      ["Working_B", 0.4],
    ],
  },
  pickaxe: {
    model: "barbarian",
    items: [{ piece: "pickaxe" }],
    poses: [
      ["Pickaxing", 0.1],
      ["Pickaxing", 0.35],
      ["Pickaxing", 0.55],
      ["Pickaxing", 0.8],
      ["Idle_A", 0.3],
      ...walk.slice(0, 1),
    ],
  },
  axe: {
    model: "barbarian",
    items: [{ piece: "axe" }],
    poses: [
      ["Chopping", 0.1],
      ["Chopping", 0.3],
      ["Chopping", 0.5],
      ["Chopping", 0.8],
      ["Idle_A", 0.3],
      ...walk.slice(0, 1),
    ],
  },
  mug: {
    model: "rogue",
    items: [{ piece: "mug_full" }],
    poses: [
      ["Sit_Chair_Idle", 0.1],
      ["Sit_Chair_Idle", 0.5],
      ["Sit_Floor_Idle", 0.2],
      ["Sit_Floor_Idle", 0.6],
      ["Sit_Chair_Down", 1],
    ],
    close: true,
  },
  lantern: {
    model: "knight",
    items: [{ piece: "lantern" }],
    poses: [...walk, ["Running_A", 0.3], ["Idle_A", 0.3], ["Idle_B", 0.5], ["Interact", 0.5]],
  },
  hammer: {
    model: "knight",
    items: [{ piece: "hammer_A" }],
    poses: [["Hammering", 0.1], ["Hammering", 0.4], ["Hammering", 0.7], ["Idle_A", 0.3], ...walk],
  },
  staff: {
    model: "mage",
    items: [{ piece: "staff" }],
    poses: [
      ["Idle_A", 0.3],
      ["Ranged_Magic_Summon", 0.5],
      ["Ranged_Magic_Spellcasting", 0.3],
      ["Waving", 0.4],
      ...walk,
    ],
  },
  wand: {
    model: "mage",
    items: [{ piece: "wand" }],
    poses: [
      ["Idle_A", 0.3],
      ["Ranged_Magic_Spellcasting", 0.3],
      ["Ranged_Magic_Raise", 0.6],
      ["Working_B", 0.4],
      ...walk,
    ],
  },
  dagger: {
    model: "rogue",
    items: [{ piece: "dagger" }],
    poses: [["Idle_A", 0.3], ["Lockpicking", 0.4], ["Interact", 0.5], ["Working_A", 0.4], ...walk],
  },
  crossbow: {
    model: "ranger",
    items: [{ piece: "crossbow_1handed" }],
    poses: [["Idle_A", 0.3], ["Idle_B", 0.5], ["Interact", 0.5], ["Working_B", 0.4], ...walk],
  },
  map: {
    model: "rogue-hooded",
    items: [{ piece: "map_rolled" }],
    poses: [["Idle_A", 0.3], ["Interact", 0.5], ["Working_B", 0.4], ["Ranged_Magic_Summon", 0.5], ...walk],
  },
  spellbooks: {
    model: "mage",
    items: [{ piece: "spellbook_open" }],
    poses: [
      ["Idle_A", 0.3],
      ["Idle_B", 0.5],
      ["Working_B", 0.4],
      ["Ranged_Magic_Spellcasting", 0.3],
      ...walk,
    ],
  },
  spellbook_closed: {
    model: "mage",
    items: [{ piece: "spellbook_closed" }],
    poses: [["Idle_A", 0.3], ["Idle_B", 0.5], ["Working_B", 0.4], ["Interact", 0.5], ...walk],
  },
  shield: {
    model: "knight",
    items: [{ piece: "shield_badge_color" }],
    poses: [["Idle_A", 0.3], ["Idle_B", 0.5], ["Working_A", 0.4], ["Interact", 0.5], ...walk],
  },
  book: {
    model: "mage",
    items: [{ prop: "book" }],
    poses: [
      ["Working_B", 0.15],
      ["Working_B", 0.5],
      ["Working_A", 0.4],
      ["Idle_B", 0.5],
      ["Interact", 0.6],
      carry[0] as [string, number],
    ],
  },
  note: {
    model: "rogue",
    items: [{ prop: "note" }],
    poses: [["Working_B", 0.2], ["Working_B", 0.6], ["Idle_B", 0.5], ["Interact", 0.6], ...carry],
  },
  loads: {
    model: "barbarian",
    items: [{ prop: "log" }],
    poses: [...carry, ["PickUp", 0.6], ["Holding_A", 0.3]],
  },
  stone: { model: "barbarian", items: [{ prop: "stone" }], poses: [...carry, ["PickUp", 0.6]] },
  plank: { model: "knight", items: [{ prop: "plank" }], poses: [...carry, ["PickUp", 0.6]] },
  produce: { model: "rogue", items: [{ prop: "produce" }], poses: [...carry, ["PickUp", 0.6]] },
  crate: { model: "rogue", items: [{ prop: "crate" }], poses: [...carry, ["PickUp", 0.6]] },
  fish: {
    model: "ranger",
    items: [{ prop: "fish" }],
    poses: [["Fishing_Catch", 0.6], ["Fishing_Catch", 0.9], ...carry, ["PickUp", 0.6]],
  },
  rod: {
    model: "ranger",
    items: [{ prop: "rod" }],
    poses: [
      ["Fishing_Cast", 0.2],
      ["Fishing_Cast", 0.7],
      ["Fishing_Idle", 0.4],
      ["Fishing_Reeling", 0.4],
      ["Fishing_Catch", 0.3],
      walk[0] as [string, number],
    ],
  },
  bow: {
    model: "ranger",
    items: [{ prop: "bow" }],
    poses: [
      ["Ranged_Bow_Draw", 0.7],
      ["Ranged_Bow_Aiming_Idle", 0.4],
      ["Ranged_Bow_Release", 0.2],
      ["Idle_B", 0.5],
      ["Interact", 0.5],
      walk[0] as [string, number],
    ],
  },
  hoe: {
    model: "barbarian",
    items: [{ prop: "hoe" }],
    poses: [
      ["Digging", 0.1],
      ["Digging", 0.35],
      ["Digging", 0.6],
      ["Digging", 0.85],
      ["Idle_A", 0.3],
      walk[0] as [string, number],
    ],
  },
  bucket: {
    model: "rogue",
    items: [{ prop: "bucket" }],
    poses: [
      ["Use_Item", 0.2],
      ["Use_Item", 0.5],
      ["Use_Item", 0.8],
      ["Idle_A", 0.3],
      ["Interact", 0.5],
      walk[0] as [string, number],
    ],
  },
  spear: {
    model: "knight",
    items: [{ prop: "spear" }],
    poses: [["Idle_A", 0.2], ["Idle_A", 0.7], ["Idle_B", 0.5], ["Waving", 0.4], ...walk],
  },
  broom: {
    model: "mage",
    items: [{ prop: "broom" }],
    poses: [["Working_A", 0.2], ["Working_A", 0.6], ["Interact", 0.5], ["Idle_B", 0.5], ...walk],
  },
}

/** The views (rows): the camera's way from the figure, which faces +z (its right hand at −x). */
const VIEWS: [string, Vector3][] = [
  ["front", new Vector3(0, 0.12, 1)],
  ["right side", new Vector3(-1, 0.12, 0)],
  ["3/4 right", new Vector3(-0.75, 0.2, 0.75)],
  ["diorama", new Vector3(1, 0.93, 1)],
]

/** Posed: levels the upright grips as the hall does after its mixers' update. */
function settle(body: Object3D): void {
  body.updateMatrixWorld(true)
  body.traverse((node) => keepUpright(node))
  body.updateMatrixWorld(true)
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const cache = new Map<string, Promise<GLTF>>()
const load = (url: string): Promise<GLTF> => {
  let hit = cache.get(url)
  if (!hit) {
    hit = loader.loadAsync(url)
    cache.set(url, hit)
  }
  return hit
}

export async function start(root: HTMLElement): Promise<void> {
  root.innerHTML = ""
  const sheet = document.createElement("canvas")
  sheet.style.cssText = "display:block;width:100vw;height:100vh;background:#e9e4da"
  root.append(sheet)
  const cell = { w: 0, h: 0 }
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  const scene = new Scene()
  scene.background = new Color("#d9d3c6")
  scene.add(new AmbientLight("#ffffff", 1.3))
  const sun = new DirectionalLight("#fff4e0", 2.4)
  sun.position.set(2, 5, 4)
  scene.add(sun)
  const fill = new DirectionalLight("#cfe0ff", 0.9)
  fill.position.set(-3, 2, -2)
  scene.add(fill)
  const camera = new PerspectiveCamera(30, 1, 0.05, 100)

  const [anims, kit] = await Promise.all([load(ANIMS_URL), load(KIT_URL)])
  const clips = new Map<string, AnimationClip>(anims.animations.map((clip) => [clip.name, clip]))
  const made = carryClip(anims.animations)
  if (made) clips.set(CARRY_WALK, made)
  const kitNodes = new Map<string, Object3D>()
  kit.scene.traverse((node) => kitNodes.set(node.name, node))
  const propMaterial = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 })

  /** Several studies, one row each, from the 3/4 right only, close up: a batch to compare at once. */
  async function strip(names: string[]): Promise<string[]> {
    const missing: string[] = []
    const ctx = sheet.getContext("2d")
    if (!ctx) return ["no 2d context"]
    const dpr = window.devicePixelRatio || 1
    sheet.width = Math.floor(window.innerWidth * dpr)
    sheet.height = Math.floor(window.innerHeight * dpr)
    const cols = Math.max(...names.map((name) => STUDIES[name]?.poses.length ?? 0))
    cell.w = Math.floor(sheet.width / cols)
    cell.h = Math.floor(sheet.height / names.length)
    renderer.setSize(cell.w, cell.h, false)
    camera.aspect = cell.w / cell.h
    camera.updateProjectionMatrix()
    ctx.fillStyle = "#e9e4da"
    ctx.fillRect(0, 0, sheet.width, sheet.height)
    const way = new Vector3(-0.8, 0.35, 0.75).normalize()
    for (const [row, name] of names.entries()) {
      const study = STUDIES[name]
      if (!study) continue
      const body = await posed(study, missing)
      const mixer = new AnimationMixer(body)
      const hand = new Vector3()
      const chest = new Vector3()
      study.poses.forEach(([clipName, at], col) => {
        mixer.stopAllAction()
        const clip = clips.get(clipName)
        if (clip) {
          mixer.clipAction(clip).play()
          mixer.setTime(clip.duration * at)
        }
        openFor(body, clipName)
        settle(body)
        body.getObjectByName(HAND_SLOT.right)?.getWorldPosition(hand)
        body.getObjectByName("chest")?.getWorldPosition(chest)
        const target = hand.clone().lerp(chest, 0.5)
        camera.position.copy(target).addScaledVector(way, 4.2)
        camera.lookAt(target)
        renderer.render(scene, camera)
        const x = col * cell.w
        const y = row * cell.h
        ctx.drawImage(renderer.domElement, x, y)
        ctx.strokeStyle = "#9c917f"
        ctx.strokeRect(x + 0.5, y + 0.5, cell.w - 1, cell.h - 1)
        ctx.fillStyle = "#1d1813"
        ctx.font = `${Math.round(12 * dpr)}px ui-monospace, monospace`
        ctx.fillText(`${name} · ${clipName} @${at}`, x + 8 * dpr, y + 16 * dpr)
      })
      mixer.stopAllAction()
      scene.remove(body)
    }
    return missing
  }

  /** A prop as the hall makes it: closed and open in one group when it opens (scene/activity.ts). */
  function propOf(kind: Held | Tool): Object3D {
    const grip = PROP_GRIPS[kind]
    const closed = new Mesh(grip.make(), propMaterial)
    if (!grip.open) return closed
    const open = new Mesh(grip.open.make(), propMaterial)
    const both = new Group()
    both.add(closed, open)
    both.userData.opens = { closed, open, clips: grip.open.clips }
    return both
  }

  /** Opens what is read in `clip`, as Hands.show does. */
  function openFor(body: Object3D, clip: string): void {
    body.traverse((node) => {
      const opens = node.userData.opens as
        | { closed: Object3D; open: Object3D; clips: ReadonlySet<string> }
        | undefined
      if (!opens) return
      opens.open.visible = opens.clips.has(clip)
      opens.closed.visible = !opens.open.visible
    })
  }

  /** The study's character with its items in hand, added to the scene. */
  async function posed(study: Study, missing: string[]): Promise<Object3D> {
    const gltf = await load(modelUrl(study.model))
    const body = cloneRig(gltf.scene)
    scene.add(body)
    for (const item of study.items) {
      const grip = "piece" in item ? KIT_GRIPS[item.piece] : PROP_GRIPS[item.prop]
      const bone = body.getObjectByName(grip.bone)
      const thing = "piece" in item ? kitNodes.get(item.piece)?.clone(true) : propOf(item.prop)
      if (!bone || !thing) {
        missing.push("piece" in item ? item.piece : item.prop)
        continue
      }
      attachGrip(bone, thing, grip)
    }
    return body
  }

  async function draw(name: string, zoom?: boolean): Promise<string[]> {
    const found = STUDIES[name]
    const study = found && zoom !== undefined ? { ...found, close: zoom } : found
    if (!study) return [`no study "${name}": ${Object.keys(STUDIES).join(", ")}`]
    const missing: string[] = []
    const gltf = await load(modelUrl(study.model))
    const body = cloneRig(gltf.scene)
    scene.add(body)
    for (const item of study.items) {
      if ("piece" in item) {
        const grip = KIT_GRIPS[item.piece]
        const source = kitNodes.get(item.piece)
        const bone = body.getObjectByName(grip.bone)
        if (!source || !bone) missing.push(item.piece)
        else {
          attachGrip(bone, source.clone(true), grip)
        }
      } else {
        const grip = PROP_GRIPS[item.prop]
        const bone = body.getObjectByName(grip.bone)
        if (!bone) missing.push(item.prop)
        else {
          attachGrip(bone, propOf(item.prop), grip)
        }
      }
    }
    if (study.axes)
      for (const slot of [HAND_SLOT.right, HAND_SLOT.left])
        body.getObjectByName(slot)?.add(new AxesHelper(0.6))

    const cols = study.poses.length
    const rows = VIEWS.length
    const dpr = window.devicePixelRatio || 1
    sheet.width = Math.floor(window.innerWidth * dpr)
    sheet.height = Math.floor(window.innerHeight * dpr)
    cell.w = Math.floor(sheet.width / cols)
    cell.h = Math.floor(sheet.height / rows)
    renderer.setSize(cell.w, cell.h, false)
    camera.aspect = cell.w / cell.h
    camera.updateProjectionMatrix()
    const ctx = sheet.getContext("2d")
    if (!ctx) return ["no 2d context"]
    ctx.fillStyle = "#e9e4da"
    ctx.fillRect(0, 0, sheet.width, sheet.height)

    const mixer = new AnimationMixer(body)
    const hand = new Vector3()
    const chest = new Vector3()
    study.poses.forEach(([clipName, at], col) => {
      mixer.stopAllAction()
      const clip = clips.get(clipName)
      if (!clip) missing.push(clipName)
      else {
        mixer.clipAction(clip).play()
        mixer.setTime(clip.duration * at)
      }
      openFor(body, clipName)
      settle(body)
      body.getObjectByName(HAND_SLOT.right)?.getWorldPosition(hand)
      body.getObjectByName("chest")?.getWorldPosition(chest)
      const target = study.close ? hand.clone().lerp(chest, 0.4) : new Vector3(0, chest.y * 0.82, 0)
      const distance = study.close ? 3.4 : 6.6
      VIEWS.forEach(([label, way], row) => {
        camera.position.copy(target).addScaledVector(way.clone().normalize(), distance)
        camera.lookAt(target)
        renderer.render(scene, camera)
        const x = col * cell.w
        const y = row * cell.h
        ctx.drawImage(renderer.domElement, x, y)
        ctx.strokeStyle = "#9c917f"
        ctx.strokeRect(x + 0.5, y + 0.5, cell.w - 1, cell.h - 1)
        ctx.fillStyle = "#1d1813"
        ctx.font = `${Math.round(12 * dpr)}px ui-monospace, monospace`
        ctx.fillText(`${clipName} @${at}  ·  ${label}`, x + 8 * dpr, y + 16 * dpr)
      })
    })
    ctx.font = `bold ${Math.round(15 * dpr)}px ui-monospace, monospace`
    ctx.fillStyle = "#7a1f12"
    ctx.fillText(name, 8 * dpr, sheet.height - 10 * dpr)
    mixer.stopAllAction()
    scene.remove(body)
    return missing
  }

  /** Each hand slot's own axes in the body's frame (+x the figure's left, +y up, +z forward). */
  async function measure(clipName: string, at: number) {
    const gltf = await load(modelUrl("knight"))
    const body = cloneRig(gltf.scene)
    const mixer = new AnimationMixer(body)
    const clip = clips.get(clipName)
    if (clip) {
      mixer.clipAction(clip).play()
      mixer.setTime(clip.duration * at)
    }
    body.updateMatrixWorld(true)
    const round = (v: Vector3) => v.toArray().map((n) => Math.round(n * 100) / 100)
    const out: Record<string, unknown> = {}
    for (const [hand, slot] of Object.entries(HAND_SLOT)) {
      const bone = body.getObjectByName(slot)
      if (!bone) continue
      const origin = bone.getWorldPosition(new Vector3())
      const axis = (x: number, y: number, z: number) =>
        round(
          bone
            .localToWorld(new Vector3(x, y, z))
            .sub(origin)
            .normalize(),
        )
      out[hand] = { at: round(origin), x: axis(1, 0, 0), y: axis(0, 1, 0), z: axis(0, 0, 1) }
    }
    mixer.stopAllAction()
    return out
  }

  /**
   * Each kit piece alone in its own model axes, from +z (x to the right, y up) and from +x: a red
   * ball marks +x, a blue one +z, so a piece's one-sided parts can be told apart.
   */
  function pieces(names: string[]): string[] {
    const ctx = sheet.getContext("2d")
    if (!ctx) return ["no 2d context"]
    const dpr = window.devicePixelRatio || 1
    sheet.width = Math.floor(window.innerWidth * dpr)
    sheet.height = Math.floor(window.innerHeight * dpr)
    const cols = Math.ceil(names.length / 2)
    cell.w = Math.floor(sheet.width / cols)
    cell.h = Math.floor(sheet.height / 4)
    renderer.setSize(cell.w, cell.h, false)
    camera.aspect = cell.w / cell.h
    camera.updateProjectionMatrix()
    ctx.fillStyle = "#e9e4da"
    ctx.fillRect(0, 0, sheet.width, sheet.height)
    const ball = (color: string, at: [number, number, number]) => {
      const mesh = new Mesh(new SphereGeometry(0.05, 10, 8), new MeshStandardMaterial({ color }))
      mesh.position.set(...at)
      return mesh
    }
    names.forEach((name, i) => {
      const source = kitNodes.get(name)
      if (!source) return
      const copy = source.clone(true)
      copy.position.set(0, 0, 0)
      copy.rotation.set(0, 0, 0)
      const group = new Group()
      group.add(
        copy,
        ball("#d02020", [0.9, 0, 0]),
        ball("#2050d0", [0, 0, 0.9]),
        ball("#20a040", [0, 1.3, 0]),
      )
      scene.add(group)
      const col = i % cols
      const band = Math.floor(i / cols) * 2
      ;[new Vector3(0, 0.1, 1), new Vector3(1, 0.1, 0)].forEach((way, k) => {
        camera.position
          .copy(way)
          .multiplyScalar(5)
          .add(new Vector3(0, 0.4, 0))
        camera.lookAt(0, 0.4, 0)
        renderer.render(scene, camera)
        const x = col * cell.w
        const y = (band + k) * cell.h
        ctx.drawImage(renderer.domElement, x, y)
        ctx.strokeStyle = "#9c917f"
        ctx.strokeRect(x + 0.5, y + 0.5, cell.w - 1, cell.h - 1)
        ctx.fillStyle = "#1d1813"
        ctx.font = `${Math.round(12 * dpr)}px ui-monospace, monospace`
        ctx.fillText(
          `${name} · from ${k ? "+x (red=+x toward you)" : "+z (red=+x right)"}`,
          x + 8 * dpr,
          y + 16 * dpr,
        )
      })
      scene.remove(group)
    })
    return []
  }

  Object.assign(window, {
    lab: {
      pieces: (names: string[]) => pieces(names),
      strip: (names: string[]) => strip(names),
      studies: () => Object.keys(STUDIES),
      clips: () => [...clips.keys()],
      sheet: (name: string, zoom?: boolean) => draw(name, zoom),
      axes: (clipName: string, at: number) => measure(clipName, at),
    },
  })
}
