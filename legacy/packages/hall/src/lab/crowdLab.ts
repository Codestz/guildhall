import {
  AmbientLight,
  type AnimationClip,
  AnimationMixer,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three"
import { BACKEND_NAME, type Backend, frameCounts, isWebGPU, requestedBackend } from "../render/backend.ts"
import { CARRY_WALK, carryClip } from "../scene/activity.ts"
import { installRadialFog } from "../scene/atmosphere/fog.ts"
import { bakeBytes, bakeClips } from "../scene/crowd/bake.ts"
import { Crowd, type Member } from "../scene/crowd/Crowd.ts"
import { GLSL_SHADING, nodeShading, wantsNodes } from "../scene/crowd/material.ts"
import { attachGrip, KIT_GRIPS } from "../scene/grips.ts"
import { cloneRig } from "../scene/rig.ts"
import { TSL } from "../scene/tsl.ts"
import { ANIMS_URL, isModel, KIT_URL, MODELS, type Model, modelUrl } from "../world/cast.ts"
import { createStage, load } from "./stage.ts"

/**
 * The crowd lab (dev and probe only): the baked-bone-texture crowd (scene/crowd/) alone.
 *
 *   ?lab=crowd&n=300                    a field of n adventurers, every model, random loops
 *   ?lab=crowd&n=300&model=mage&clip=Walking_A   one model, one clip (phases still random)
 *   ?lab=crowd&n=300&skinned=1          the same field as SkinnedMeshes + mixers (the baseline)
 *   ?lab=crowd&held=1                   knights chop with an axe riding the baked hand slot
 *   ?lab=crowd&compare=1&clip=Pickaxing&at=0.3   a real SkinnedMesh (left) beside a baked one
 *                                       (right), same clip and time, from four sides
 *   ?lab=crowd&n=300&renderer=webgpu    the field on WebGPURenderer (node materials, materialNodes.ts)
 *   ?lab=crowd&n=300&tsl=1              the field's node materials on WebGL (scene/tsl.ts)
 *   ?lab=crowd&n=300&at=12.5            frozen at crowd second 12.5 (the same pose on any backend)
 *
 * `window.lab`: `measure(seconds)` → fps and frame times, uncapped; `shuffle()` → every member
 * blends to a new clip; `stats()`.
 */

/** Clips that play once and hold (everything else loops). */
const ONCE = new Set([
  "Death_A",
  "Spawn_Ground",
  "Sit_Chair_Down",
  "Sit_Chair_StandUp",
  "Lie_Down",
  "Lie_StandUp",
  "PickUp",
  "Throw",
])
/** What the field plays when no clip is asked for: things a busy island does. */
const FIELD = [
  "Idle_A",
  "Idle_B",
  "Walking_A",
  "Running_A",
  "Cheering",
  "Waving",
  "Chopping",
  "Digging",
  "Hammering",
  "Pickaxing",
  "Sawing",
  "Working_A",
  "Working_B",
  "Sit_Floor_Idle",
  "Fishing_Idle",
  CARRY_WALK,
]
const TINTS = ["#c0392b", "#2e86c1", "#27ae60", "#8e44ad", "#d4ac0d", "#d35400", "#16a085", "#7f8c8d"]
const SPACING = 1.7
const BAKE_FPS = 30

export async function start(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const wanted = params.get("model")
  const models: Model[] = wanted && isModel(wanted) ? [wanted] : [...MODELS]
  const held = params.get("held") === "1"
  const [anims, kit, ...loaded] = await Promise.all([
    load(ANIMS_URL),
    held || params.get("compare") === "1" ? load(KIT_URL) : null,
    ...models.map((model) => load(modelUrl(model))),
  ])
  const scenes = Object.fromEntries(
    models.map((model, i) => [model, (loaded[i] as { scene: Object3D }).scene]),
  )
  const clips: AnimationClip[] = [...anims.animations]
  const carry = carryClip(anims.animations)
  if (carry) clips.push(carry)

  const began = performance.now()
  const bake = bakeClips(scenes[models[0] as Model] as Object3D, clips, BAKE_FPS, { once: ONCE })
  const bakeMs = performance.now() - began
  const summary = `bake ${bake.texture.image.width}×${bake.texture.image.height} RGBA16F ${(bakeBytes(bake) / 1e6).toFixed(2)} MB in ${bakeMs.toFixed(0)} ms`

  if (params.get("compare") === "1") {
    compare(root, params, bake, scenes, clips, kit?.scene ?? null, summary)
    return
  }
  await field(root, params, bake, scenes, models, clips, kit?.scene ?? null, summary)
}

/** A field of n: one draw per model part, whatever n is. */
async function field(
  root: HTMLElement,
  params: URLSearchParams,
  bake: ReturnType<typeof bakeClips>,
  scenes: Record<string, Object3D>,
  models: Model[],
  clips: AnimationClip[],
  kit: Object3D | null,
  summary: string,
): Promise<void> {
  const n = Math.min(5000, Math.max(1, Number(params.get("n") ?? 300) || 300))
  const held = params.get("held") === "1"
  const asked = params.get("clip")
  const clipFor = (i: number) =>
    asked && bake.clipIds.has(asked) ? asked : (FIELD[(i * 7 + 3) % FIELD.length] as string)
  const random = seeded(7)
  const side = Math.ceil(Math.sqrt(n))
  const members: Member[] = []
  for (let i = 0; i < n; i++) {
    const model = models[i % models.length] as Model
    const clip = held && model === "knight" ? "Chopping" : clipFor(i)
    const duration = bake.clips[bake.clipIds.get(clip) as number]?.duration ?? 1
    const x = ((i % side) - (side - 1) / 2) * SPACING
    const z = (Math.floor(i / side) - (side - 1) / 2) * SPACING
    members.push({
      model,
      clip,
      place: new Matrix4().compose(
        new Vector3(x, 0, z),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI * 2),
        new Vector3(1, 1, 1),
      ),
      tint: TINTS[i % TINTS.length],
      start: -random() * duration,
      speed: 0.9 + random() * 0.2,
    })
  }
  // `skinned=1`: the same field as real SkinnedMeshes with a mixer each (Adventurer's way), to
  // measure against on the same machine at the same moment.
  const skinned = params.get("skinned") === "1"
  const backend = requestedBackend(params.toString())
  root.innerHTML = ""
  const renderer = await labRenderer(backend)
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setSize(window.innerWidth, window.innerHeight)
  root.append(renderer.domElement)
  const label = overlay(root)
  const shading = wantsNodes(renderer) ? await nodeShading(renderer) : GLSL_SHADING

  const crowd = new Crowd(bake, scenes, skinned ? [] : members, undefined, shading)
  const axe = held ? kit?.getObjectByName("axe") : undefined
  if (axe) crowd.hold("knight", axe, KIT_GRIPS.axe)
  const herd = skinned ? skinnedField(members, scenes, clips) : null

  // The island's own radial fog (atmosphere/fog.ts): the crowd's shader must keep receiving it.
  installRadialFog()
  const radius = (side * SPACING) / 2
  const scene = new Scene()
  scene.background = new Color("#d9d3c6")
  const fog = new Fog("#d9d3c6", radius * 0.8, radius * 1.35)
  scene.fog = fog
  // WebGPU reads the fog node, not the chunks (render/webgpu.ts does the same for the hall).
  if (isWebGPU(renderer))
    Object.assign(scene, { fogNode: (await import("../scene/atmosphere/fogNode.ts")).radialFog(fog) })
  lights(scene)
  const ground = new Mesh(
    new CircleGeometry(radius * 1.6, 64),
    new MeshStandardMaterial({ color: "#b9b09e" }),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground, herd?.root ?? crowd.root)
  const camera = new PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 2000)
  camera.position
    .set(1, 0.93, 1)
    .normalize()
    .multiplyScalar(Math.max(8, radius * 3.2))
  camera.lookAt(0, 0.6, 0)
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  })

  const t0 = performance.now()
  const at = params.get("at")
  const frozen = at === null ? undefined : Number(at) || 0
  const draw = () => {
    const t = frozen ?? (performance.now() - t0) / 1000
    crowd.time = t
    herd?.pose(t)
    renderer.render(scene, camera)
  }
  const frames: number[] = []
  let measuring = false
  let last = performance.now()
  let shown = 0
  const loop = (now: number) => {
    requestAnimationFrame(loop)
    // At most 60 a second (as the stage does) unless measuring: a free-running lab starves shots.
    if (!measuring && now - last < 1000 / 60) return
    frames.push(now - last)
    if (!measuring && frames.length > 120) frames.shift()
    last = now
    draw()
    if (now - shown > 500) {
      shown = now
      label.textContent = `n ${n}${skinned ? " SkinnedMesh" : " baked"} · ${BACKEND_NAME[isWebGPU(renderer) ? "webgpu" : "webgl"]}${TSL && !isWebGPU(renderer) ? " TSL" : ""} · ${stats().calls} draws · ${(stats().triangles / 1000).toFixed(0)}k tris · ${stats().fps.toFixed(0)} fps (capped 60) · ${summary}`
    }
  }
  requestAnimationFrame(loop)

  function stats() {
    const sorted = [...frames].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0
    const counts = frameCounts(renderer.info as never, isWebGPU(renderer) ? "webgpu" : "webgl")
    return {
      n,
      backend: isWebGPU(renderer) ? "webgpu" : TSL ? "webgl tsl" : "webgl",
      calls: counts.calls,
      triangles: counts.triangles,
      fps: p50 > 0 ? 1000 / p50 : 0,
      p50,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      bakeMB: bakeBytes(bake) / 1e6,
    }
  }

  /**
   * Uncapped for `seconds`, every requestAnimationFrame drawn: `fps` is frames drawn over the window
   * (p50/p95 are rAF intervals, which bunch up when the GPU queue is full; trust `fps` first).
   */
  async function measure(seconds = 3) {
    frames.length = 0
    measuring = true
    const from = performance.now()
    await new Promise((done) => setTimeout(done, seconds * 1000))
    measuring = false
    const result = stats()
    const fps = (frames.length * 1000) / (performance.now() - from)
    return { ...result, fps, frames: frames.length, skinned }
  }

  function shuffle(): string {
    for (let i = 0; i < n; i++) crowd.play(i, FIELD[Math.floor(random() * FIELD.length)] as string)
    return "ok"
  }

  Object.assign(window, { lab: { measure, shuffle, stats, crowd } })
}

/**
 * The same model, clip and time: a real SkinnedMesh posed by a mixer (left) and a baked crowd of
 * one (right), each holding the same pickaxe (`held`: attached to the bone; baked: riding the bake).
 */
function compare(
  root: HTMLElement,
  params: URLSearchParams,
  bake: ReturnType<typeof bakeClips>,
  scenes: Record<string, Object3D>,
  clips: AnimationClip[],
  kit: Object3D | null,
  summary: string,
): void {
  const model = (Object.keys(scenes)[0] ?? "knight") as Model
  const source = scenes[model] as Object3D
  const name = params.get("clip") ?? "Pickaxing"
  const clip = clips.find((c) => c.name === name)
  const stage = createStage(root)
  if (!clip || !bake.clipIds.has(name)) {
    stage.caption(`no clip "${name}"`)
    return
  }
  const pair = new Group()
  const real = cloneRig(source)
  real.position.x = -0.75
  const mixer = new AnimationMixer(real)
  mixer.clipAction(clip).play()
  const crowd = new Crowd(
    bake,
    { [model]: source },
    [{ model, clip: name, place: new Matrix4().makeTranslation(0.75, 0, 0), tint: TINTS[0] }],
    0,
  )
  tint(real, TINTS[0] as string)
  const pickaxe = kit?.getObjectByName("pickaxe")
  if (pickaxe) {
    const slot = real.getObjectByName(KIT_GRIPS.pickaxe.bone)
    if (slot) attachGrip(slot, pickaxe.clone(true), KIT_GRIPS.pickaxe)
    crowd.hold(model, pickaxe, KIT_GRIPS.pickaxe)
  }
  pair.add(real, crowd.root)
  stage.scene.add(pair)
  stage.fit(real)
  stage.aim.target.x = 0
  stage.aim.distance *= 1.5

  const at = params.get("at")
  const frozen = at === null ? undefined : Math.min(1, Math.max(0, Number(at) || 0))
  const t0 = performance.now()
  const pose = () => {
    const t = frozen === undefined ? (performance.now() - t0) / 1000 : clip.duration * frozen * 0.9999
    mixer.setTime(t)
    crowd.time = t
  }
  stage.caption(
    `${model} · ${name}${frozen === undefined ? " (playing)" : ` @${frozen}`} · left: SkinnedMesh + mixer · right: baked · ${summary}`,
  )
  stage.run(pose)
  Object.assign(window, { lab: { crowd, mixer } })
}

/** The field as real SkinnedMeshes, a mixer each: what the crowd replaces. */
function skinnedField(members: Member[], scenes: Record<string, Object3D>, clips: AnimationClip[]) {
  const root = new Group()
  const mixers = members.map((member) => {
    const body = cloneRig(scenes[member.model] as Object3D)
    member.place.decompose(body.position, body.quaternion, body.scale)
    tint(body, String(member.tint ?? "#ffffff"))
    root.add(body)
    const mixer = new AnimationMixer(body)
    const clip = clips.find((c) => c.name === member.clip)
    if (clip) mixer.clipAction(clip).play()
    mixer.timeScale = member.speed ?? 1
    mixer.update(-(member.start ?? 0))
    return mixer
  })
  let last = 0
  return {
    root,
    pose(t: number) {
      for (const mixer of mixers) mixer.update(t - last)
      last = t
    },
  }
}

/**
 * The field's renderer: WebGL by default; three's WebGPURenderer for `renderer=webgpu` (loaded only
 * then), or WebGL again when the browser has no WebGPU. `?tsl=1` on WebGL is node materials through
 * the nodes handler (material.ts `nodeShading` installs it).
 */
async function labRenderer(backend: Backend): Promise<WebGLRenderer> {
  if (backend === "webgpu" && (navigator as { gpu?: unknown }).gpu) {
    const { WebGPURenderer } = await import("three/webgpu")
    const renderer = new WebGPURenderer({ antialias: true })
    await renderer.init()
    if (isWebGPU(renderer) && (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend)
      return renderer as unknown as WebGLRenderer
    renderer.dispose()
  }
  return new WebGLRenderer({ antialias: true })
}

function lights(scene: Scene): void {
  scene.add(new AmbientLight("#ffffff", 1.3))
  const sun = new DirectionalLight("#fff4e0", 2.4)
  sun.position.set(2, 5, 4)
  const fill = new DirectionalLight("#cfe0ff", 0.9)
  fill.position.set(-3, 2, -2)
  scene.add(sun, fill)
}

/** The real one's cape in the same colour the crowd gives its member. */
function tint(body: Object3D, colour: string): void {
  body.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh || !/Tinted/.test(mesh.name)) return
    const own = (mesh.material as MeshStandardMaterial).clone()
    own.color = new Color(colour).lerp(new Color("#ffffff"), 0.25)
    mesh.material = own
  })
}

function overlay(root: HTMLElement): HTMLElement {
  root.style.position = "relative"
  const label = document.createElement("div")
  label.style.cssText =
    "position:absolute;left:12px;bottom:10px;font:13px ui-monospace,monospace;color:#1d1813;pointer-events:none;background:#ffffffaa;padding:2px 6px"
  root.append(label)
  return label
}

/** A small deterministic random (mulberry32): the same field every load, for comparable shots. */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
