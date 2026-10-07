import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  Color,
  Frustum,
  type Group,
  MathUtils,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
  Sphere,
} from "three"
import { audio } from "../../audio/engine.ts"
import { worldEventsOf } from "../../guild/events.ts"
import { PROBE } from "../../guild/mode.ts"
import type { Tier } from "../../guild/quality.ts"
import type { GuildStore } from "../../guild/store.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { legOf, Routine, seedOf } from "../../world/behaviours.ts"
import { ANIMS_URL, MODELS, modelUrl } from "../../world/cast.ts"
import type { Spot } from "../../world/layout.ts"
import { attachHands, CARRY_WALK, carryClip, HAND_SLOT, type Hands } from "../activity.ts"
import { useBlob } from "../Blobs.tsx"
import { Dissolver, Fade, fadeSeconds } from "../dissolve.ts"
import { FRAME } from "../frame.ts"
import { clonePiece, useKit } from "../Kit.tsx"
import { useOwned } from "../owned.ts"
import { cloneRig } from "../rig.ts"
import {
  CALLED_AWAY,
  Day,
  errandOf,
  nightOf,
  onQuay,
  placeOfNpc,
  QUAY_DECK,
  raining,
  SQUARE,
  TOWNSFOLK,
  TOWNSFOLK_PER_TIER,
  type Townsperson,
} from "./rounds.ts"
import { BEAT_HEIGHT, emitBeat } from "./work.ts"

/**
 * The townsfolk (ADR 0007 Life, roadmap "More life on the map"): farmers, a fisher, merchants, gate
 * guards, children, a graveyard keeper and villagers going about their day (scene/life/rounds.ts).
 * Their work is the agents' activity engine (world/behaviours.ts `Routine`, ADR 0009) with the
 * same carries and props; their day (`Day`) sends them home at dusk and in the rain, and to the
 * square at a festival.
 *
 * Never to be mistaken for an agent: agents are full-size, caped and hatted in their role's
 * colour, ringed, named and walk briskly; townsfolk are smaller, bare-headed in muted homespun (a
 * tint each), unringed, unnamed, sigil-less, and amble.
 *
 * Cost (docs/perf-budget.md): each is one skinned draw (cape and hat hidden; no shadow-map cast, a
 * blob instead) plus a mixer. The tier caps how many (rounds.ts TOWNSFOLK_PER_TIER); clips are the
 * one shared anims.glb set; a mixer far from the camera steps every other frame and one off screen
 * or indoors not at all (its time is kept and spent when it's seen again). No allocation per frame.
 */
export function Villagers({ tier }: { tier: Tier }) {
  const shown = useSyncExternalStore(abSwitch.subscribe, abSwitch.get)
  const count = shown ? TOWNSFOLK_PER_TIER[tier] : 0
  const folk = useMemo(() => TOWNSFOLK.slice(0, count), [count])
  const store = useGuildStore()

  // Once a frame, before any of them reads it: the camera's view, the time of day, the weather.
  useFrame((state) => {
    const camera = state.camera
    town.frame++
    town.frustum.setFromProjectionMatrix(
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    )
    town.camera.copy(camera.position)
    const env = store.environment
    town.now.night = nightOf(env.daylight, town.now.night)
    town.now.rain = raining(env.weather)
    town.now.festival = festive(store)
  }, FRAME.SKY)

  return (
    <>
      {folk.map((npc, i) => (
        <Townsfolk key={npc.id} npc={npc} index={i} />
      ))}
    </>
  )
}

/** Beyond this distance from the camera, a mixer steps every other frame. */
const FAR = 38
const projection = new Matrix4()
/** Shared per-frame reading (written at FRAME.SKY, read by every one of them at WORLD). */
const town = {
  frame: 0,
  frustum: new Frustum(),
  camera: {
    x: 0,
    y: 0,
    z: 0,
    copy(v: { x: number; y: number; z: number }) {
      this.x = v.x
      this.y = v.y
      this.z = v.z
    },
  },
  now: { night: false, rain: false, festival: false },
}
const bounds = new Sphere()

/** Where the hands are, for a beat that happens there (a broom's dust). */
const HANDS_AHEAD = 0.4
const HANDS_UP = 0.9

/** One NPC's body and what drives it: built and freed by the same mount (scene/owned.ts). */
interface Body {
  body: Object3D
  mixer: AnimationMixer
  actions: Map<string, AnimationAction>
  clips: Map<string, AnimationClip>
  hands: Hands
  lantern: Object3D | null
  materials: MeshStandardMaterial[]
  /** Going in and coming out of their door: dissolved, never shrunk (scene/dissolve.ts). */
  dissolver: Dissolver
}

/** A step through their doorway: the dissolve takes about as long. */
const DOOR_FADE_S = 0.6

function Townsfolk({ npc, index }: { npc: Townsperson; index: number }) {
  const root = useRef<Group>(null)
  const { scene } = useGLTF(modelUrl(npc.model))
  const { animations } = useGLTF(ANIMS_URL)
  const kit = useKit()

  const built = useOwned(
    () => build(npc, scene, animations, kit),
    (b) => free(b),
    [npc, scene, animations, kit],
  )
  // Their day and work, kept across rebuilds of the body.
  const life = useMemo(() => {
    const errand = errandOf(npc, town.now)
    const day = new Day(npc, errand)
    return {
      day,
      routine: new Routine(placeOfNpc(npc), seedOf(npc.id)),
      /** The polyline being walked and how far along it. */
      path: [] as readonly Spot[],
      next: 0,
      trip: -1,
      aimX: Number.NaN,
      aimZ: Number.NaN,
      /** How present they are: 0 indoors, 1 out; eased as they step through the door. */
      fade: new Fade(day.shown ? 1 : 0),
      /** The door openings already heard (Day.opened). */
      opened: day.opened,
      beats: 0,
      lag: 0,
      current: null as AnimationAction | null,
    }
  }, [npc])
  // The blob fades with them (a soft disc: smaller reads as fainter).
  const presence = useCallback(() => life.fade.value * (npc.scale / 0.82), [life, npc])
  useBlob(root, 0.8, presence)
  useEffect(() => {
    const node = root.current
    if (!import.meta.env.DEV || !node) return
    probed.set(npc.id, {
      day: life.day,
      routine: life.routine,
      node,
      clip: () => life.current?.getClip().name ?? "",
    })
    return () => {
      probed.delete(npc.id)
    }
  }, [npc, life])

  useFrame((_, delta) => {
    const node = root.current
    if (!node || !built) return
    const dt = Math.min(delta, 0.1)
    const { day, routine } = life
    const here = node.position

    // ---- Where to: the loop's aim while working, else the day's polyline ----
    const working = day.phase === "work"
    if (working) {
      const aim = routine.aim
      if (aim[0] !== life.aimX || aim[1] !== life.aimZ) {
        life.aimX = aim[0]
        life.aimZ = aim[1]
        life.path = legOf([here.x, here.z], aim)
        life.next = 0
      }
    } else if (day.trip !== life.trip) {
      life.trip = day.trip
      life.path = day.path
      life.next = 0
      life.aimX = Number.NaN
    }
    if (!working && (day.phase === "indoors" || day.phase === "post" || day.phase === "cheer"))
      life.next = life.path.length

    // ---- Walk ----
    const carrying = working && routine.held !== null
    const speed = npc.gait.speed * (carrying ? 0.85 : 1)
    let walking = false
    let budget = speed * dt
    while (life.next < life.path.length && budget > 0) {
      const to = life.path[life.next] as Spot
      const dx = to[0] - here.x
      const dz = to[1] - here.z
      const d = Math.hypot(dx, dz)
      if (d <= budget) {
        here.x = to[0]
        here.z = to[1]
        budget -= d
        life.next++
        continue
      }
      here.x += (dx / d) * budget
      here.z += (dz / d) * budget
      turn(node, Math.atan2(dx, dz), dt * 6)
      walking = true
      budget = 0
    }
    const arrived = !walking && life.next >= life.path.length
    const door = day.doorway
    if (door.y > 0 && (day.phase === "enter" || day.phase === "exit" || day.phase === "indoors")) {
      // Up or down the steps to a raised doorway: the height follows how far through it they are.
      const span = Math.hypot(door.step[0] - door.sill[0], door.step[1] - door.sill[1]) || 1
      const through = 1 - Math.min(1, Math.hypot(here.x - door.sill[0], here.z - door.sill[1]) / span)
      here.y = door.y * through
    } else here.y = MathUtils.damp(here.y, onQuay(here.x, here.z) ? QUAY_DECK : 0, 8, dt)

    // ---- The day, then the work ----
    const free = routine.atPost && arrived && routine.held === null
    day.update(errandOf(npc, town.now), arrived, free, dt)
    // Their door opens (going in at dusk, out at dawn): its sound, from the house, if sound is on.
    if (day.opened !== life.opened) {
      life.opened = day.opened
      knock(door.step)
    }
    if (day.phase === "work") {
      // Called away (dusk, rain, a festival): the routine's steer walks them back to the post.
      const away = errandOf(npc, town.now) !== "work"
      routine.update(dt, { thinking: true, tool: away ? CALLED_AWAY : undefined, arrived })
    } else if (routine.started) {
      routine.reset()
      life.aimX = Number.NaN
    }

    // ---- In or out of the door: dissolve stepping through it, never shrink ----
    const shown = life.fade.step(day.shown ? 1 : 0, dt, fadeSeconds(DOOR_FADE_S))
    node.visible = shown > 0
    built.dissolver.set(built.body, shown)
    if (!node.visible) return

    // ---- Facing and the clip ----
    let clip: string = npc.gait.clip
    let rate = npc.gait.rate
    if (walking) {
      if (carrying) {
        clip = CARRY_WALK
        rate = 0.75
      }
    } else if (day.phase === "work") {
      clip = routine.clip ?? "Idle_A"
      rate = 1
      const face = routine.faceAt
      if (face) turn(node, Math.atan2(face[0] - here.x, face[1] - here.z), dt * 5)
      else if (routine.atPost) turn(node, npc.post[2], dt * 4)
    } else if (day.phase === "enter") {
      // At their door: facing it, waiting for it to open, then through it.
      rate = 1
      clip = "Idle_A"
      turn(node, door.inward, dt * 6)
    } else {
      rate = 1
      const cheering = day.phase === "cheer" || (day.phase === "post" && town.now.festival)
      clip = cheering ? "Cheering" : "Idle_A"
      if (cheering) turn(node, Math.atan2(SQUARE[0] - here.x, SQUARE[1] - here.z), dt * 4)
      else turn(node, npc.post[2], dt * 4)
    }
    built.hands.show(day.phase === "work" ? routine.held : null, true)
    if (built.lantern) built.lantern.visible = town.now.night && !carrying

    // ---- Animate: every frame near, every other frame far, never off screen ----
    bounds.center.set(here.x, here.y + 0.9 * npc.scale, here.z)
    bounds.radius = 1.3 * npc.scale
    const seen = town.frustum.intersectsSphere(bounds)
    if (seen && routine.beats !== life.beats && day.phase === "work") beat(routine, node)
    life.beats = routine.beats
    play(built, clip, rate)
    life.lag = Math.min(life.lag + dt, 1)
    if (!seen) return
    const dx = here.x - town.camera.x
    const dy = here.y - town.camera.y
    const dz = here.z - town.camera.z
    if (dx * dx + dy * dy + dz * dz > FAR * FAR && (town.frame + index) % 2 === 1) return
    built.mixer.update(life.lag)
    life.lag = 0
  })

  function play(b: Body, name: string, rate: number): void {
    const next = actionOf(b, name) ?? actionOf(b, "Idle_A")
    if (!next) return
    next.timeScale = rate
    if (next === life.current && next.isRunning()) return
    next.reset().fadeIn(0.3).play()
    if (life.current && life.current !== next) life.current.fadeOut(0.3)
    life.current = next
  }

  const start = life.day.start
  return (
    <group ref={root} position={[start[0], 0, start[1]]} rotation-y={npc.post[2]} scale={npc.scale}>
      {built && <primitive object={built.body} />}
    </group>
  )
}

/** An action made the first time its clip is asked for: a townsperson plays a dozen of the set. */
function actionOf(b: Body, name: string): AnimationAction | undefined {
  let action = b.actions.get(name)
  if (action) return action
  const clip = b.clips.get(name)
  if (!clip) return undefined
  action = b.mixer.clipAction(clip)
  b.actions.set(name, action)
  return action
}

/** A beat of their work (a splash on the beds, dust off the broom) for scene/life/WorkFx. */
function beat(routine: Routine, node: Object3D): void {
  const kind = routine.beat
  if (!kind) return
  const at = routine.beatAt
  if (!at) {
    const hx = node.position.x + Math.sin(node.rotation.y) * HANDS_AHEAD
    const hz = node.position.z + Math.cos(node.rotation.y) * HANDS_AHEAD
    emitBeat(kind, hx, kind === "dust" ? BEAT_HEIGHT.dust : HANDS_UP, hz)
    return
  }
  emitBeat(kind, at[0], BEAT_HEIGHT[kind], at[1], node.position.x, 0, node.position.z)
}

/**
 * The body: the model without its tinted cape and hat, its palette pulled towards the NPC's
 * homespun tint (own materials); a mixer over the shared clips; the trade's things in the hands
 * (scene/activity.ts); a lantern for those out after dark.
 */
function build(
  npc: Townsperson,
  scene: Object3D,
  animations: readonly AnimationClip[],
  kit: Record<string, Object3D>,
): Body {
  const body = cloneRig(scene)
  const tint = new Color(npc.tint)
  const materials: MeshStandardMaterial[] = []
  body.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    if (/Tinted/.test(mesh.name)) {
      mesh.visible = false
      return
    }
    // Walkers would need the shadow map redrawn every frame (atmosphere/shadows.ts).
    mesh.castShadow = false
    const material = (mesh.material as MeshStandardMaterial).clone()
    material.color.lerp(tint, 0.55).multiplyScalar(0.92)
    mesh.material = material
    materials.push(material)
  })
  const mixer = new AnimationMixer(body)
  mixer.timeScale = 0.94 + (seedOf(npc.id) % 1000) * 0.00012
  const clips = new Map<string, AnimationClip>(animations.map((clip) => [clip.name, clip]))
  const carry = carryClip(animations)
  if (carry) clips.set(CARRY_WALK, carry)
  const hands = attachHands(body, npc.work)
  let lantern: Object3D | null = null
  const left = body.getObjectByName(HAND_SLOT.left)
  if (npc.lantern && left && kit.lantern) {
    lantern = clonePiece(kit, "lantern")
    lantern.scale.setScalar(0.55)
    lantern.traverse((child) => {
      child.castShadow = false
    })
    lantern.visible = false
    left.add(lantern)
  }
  return { body, mixer, actions: new Map(), clips, hands, lantern, materials, dissolver: new Dissolver() }
}

/** Frees what this mount made: its materials, mixer and bone textures. Geometry, the clips, the
 * held shapes and the kit's lantern materials are shared: detached, never disposed. */
function free(b: Body): void {
  // First: the body's own materials back on before they are freed.
  b.dissolver.dispose(b.body)
  b.hands.dispose()
  b.lantern?.removeFromParent()
  for (const material of b.materials) material.dispose()
  b.mixer.stopAllAction()
  b.mixer.uncacheRoot(b.body)
  b.body.traverse((child) => {
    const skinned = child as SkinnedMesh
    if (skinned.isSkinnedMesh) skinned.skeleton.dispose()
  })
}

/**
 * A door opening, heard from the house: the `door` spot sound (audio/samples.ts), through the
 * engine's own gate: silent when muted, locked or hidden; capped by the limiter (one door every
 * few seconds, the SFX bus's voices); placed by the camera's focus. Carried by a `leave` moment,
 * whose motif is silent, so the door alone sounds; it never enters the store's moment stream.
 */
function knock(at: Spot): void {
  if (!audio.audible) return
  audio.moment(
    {
      id: "townsfolk:door",
      agent: "",
      title: "",
      color: "",
      master: "",
      seq: 0,
      at: 0,
      live: true,
      kind: "leave",
    },
    { sample: "door", where: { x: at[0], z: at[1] } },
  )
}

function turn(node: Object3D, heading: number, rate: number): void {
  const delta = Math.atan2(Math.sin(heading - node.rotation.y), Math.cos(heading - node.rotation.y))
  node.rotation.y += delta * Math.min(1, rate)
}

/** Is a festival on stage? (Once a frame: a tiny scan of at most a few shows.) */
function festive(store: GuildStore): boolean {
  for (const show of worldEventsOf(store).shows) if (show.kind === "festival" && !show.leaving) return true
  return false
}

// Every model up front (Adventurer.tsx preloads them too): a model loading mid-run would suspend.
for (const model of MODELS) useGLTF.preload(modelUrl(model))

/**
 * Dev only: `townsfolk()` lists each one's phase, clip and place, for close-up probes
 * (scripts/shot.ts); `townsfolk("fisher")` just that one.
 */
const probed = new Map<string, { day: Day; routine: Routine; node: Object3D; clip: () => string }>()
if (import.meta.env?.DEV && typeof window !== "undefined")
  Object.assign(window, {
    townsfolk(id?: string) {
      const rows = [...probed.entries()].map(([name, { day, routine, node, clip }]) => ({
        id: name,
        phase: day.phase,
        clip: clip(),
        held: routine.held,
        x: Math.round(node.position.x * 10) / 10,
        z: Math.round(node.position.z * 10) / 10,
        shown: node.visible,
      }))
      return id ? rows.find((row) => row.id === id) : rows
    },
  })

/**
 * Probe only (dev, or a `VITE_GUILDHALL_PROBE=1` build): `townsfolkOn(false)` takes every one of
 * them off the island (no body, no mixer) for a bundled A/B (docs/perf-budget.md).
 */
const abSwitch = (() => {
  let on = true
  const listeners = new Set<() => void>()
  return {
    get: () => on,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: boolean) {
      on = next
      for (const listener of listeners) listener()
    },
  }
})()
if (PROBE && typeof window !== "undefined")
  Object.assign(window, {
    townsfolkOn(on: boolean) {
      abSwitch.set(on)
      return `townsfolk ${on}`
    },
  })
