import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  type AnimationAction,
  AnimationMixer,
  type Group,
  IcosahedronGeometry,
  InstancedMesh,
  LoopOnce,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  Quaternion,
  type SkinnedMesh,
  MeshStandardMaterial as StandardMaterial,
  Vector3,
} from "three"
import type { Riser } from "../guild/undead.ts"
import { useGuild, useGuildStore } from "../guild/useGuild.ts"
import { UNDEAD_ANIMS_URL, undeadUrl } from "../world/cast.ts"
import { GRAVEYARD } from "../world/graveyard.ts"
import { sky } from "./atmosphere/state.ts"
import { useBlob } from "./Blobs.tsx"
import { addChip, CHIP_HEIGHT, chipSlot, removeChip } from "./chips.ts"
import { Dissolver, Fade, fadeSeconds } from "./dissolve.ts"
import { Label } from "./Label.tsx"
import { useOwnedMeshes } from "./owned.ts"
import { cloneRig } from "./rig.ts"

/**
 * The graveyard's undead (guild/undead.ts): skeletons that claw out of a grave when a session
 * fails, keep vigil while it stays failed, and die back into the earth when it recovers; minions
 * that claw up for a failed deed and crumble. Nothing pops: a riser dissolves in as it lies in the
 * earth before stirring (scene/dissolve.ts); the dead go down into the ground, their name and
 * shadow fading as they sink. Skeleton models and their clips are fetched only once
 * the graveyard first needs them (`UndeadGate`), under their own small Suspense, never in the
 * world's preload: the world never waits on them.
 *
 * Cost: 2–4 meshes per skeleton (body and glowing eyes skinned; a helmet, hood or hat rigid), at
 * most 8 standing + 3 minions; the dirt puffs are one instanced draw, hidden when idle. Nothing
 * here allocates per frame.
 */

/** Mounts the undead once anyone has stood in the graveyard; they stay loaded after that. */
export function UndeadGate() {
  const { undead } = useGuild()
  if (!undead.wanted) return null
  return (
    <Suspense fallback={null}>
      <Undead />
    </Suspense>
  )
}

function Undead() {
  const { undead } = useGuild()
  return (
    <group>
      {undead.risers.map((riser) => (
        <Skeleton key={riser.key} riser={riser} />
      ))}
      {undead.minions.map((minion) => (
        <Skeleton key={minion.key} riser={minion} />
      ))}
      <Puffs />
      {undead.overflow > 0 && (
        <Label position={GRAVEYARD.plaque} center zIndexRange={[19, 0]} style={{ pointerEvents: "none" }}>
          <div aria-hidden="true" className="chip undead">
            <div className="name">
              <b>☠ +{undead.overflow}</b>
            </div>
          </div>
        </Label>
      )}
    </group>
  )
}

/** Lying still on the earth this long before the skeleton stirs (s). */
const STIR_S = 0.5
/** How deep a rising skeleton starts in its grave, and how deep the dead sink. */
const BURIED = -0.32
const SUNK = -1.8
/** Death plays this long before the bones go down (s), then sink over SINK_S. */
const DIE_S = 1.5
const SINK_S = 1
/** Skeletons_Death's length (s), and how far back it falls (root + hips, measured). */
const DEATH_S = 2
const DRIFT = 1.7
const FADE_S = 0.25

function Skeleton({ riser }: { riser: Riser }) {
  const { scene } = useGLTF(undeadUrl(riser.kind))
  const { animations } = useGLTF(UNDEAD_ANIMS_URL)
  const root = useRef<Group>(null)
  const body = useMemo(() => cloneRig(scene), [scene])
  const grave = GRAVEYARD.graves[riser.grave] ?? { x: 0, z: 0, rot: 0 }
  const animator = useRef<{ mixer: AnimationMixer; actions: Map<string, AnimationAction> } | null>(null)
  const current = useRef<AnimationAction | null>(null)
  /** Seconds in the current state, by this mount's own clock: a late load still rises from the start. */
  const age = useRef(0)
  const state = useRef(riser.state)
  /** Rises only if it arrived rising (a live failure); mounted standing (a seek) it never does. */
  const rises = useRef(riser.state === "rising")
  /** Seconds since mount: the rise runs on it whole, even when the model loaded late. */
  const alive = useRef(0)
  const puffed = useRef(0)
  const sank = useRef(false)
  const nextTaunt = useRef(6 + seeded(riser.key) * 8)
  const eyes = useRef<MeshStandardMaterial[]>([])
  /** A riser is not there and then suddenly lying on its grave: it dissolves in over the stir. */
  const [fade] = useState(() => new Fade(riser.state === "rising" ? 0 : 1))
  const [dissolver] = useState(() => new Dissolver())
  useEffect(() => () => dissolver.dispose(body), [dissolver, body])

  useEffect(() => {
    const glow: MeshStandardMaterial[] = []
    body.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      // Moving characters stay out of the static shadow map; a blob grounds them.
      mesh.castShadow = false
      const material = mesh.material as MeshStandardMaterial
      if (material.name === "Glow") glow.push(material)
    })
    eyes.current = glow
  }, [body])

  useLayoutEffect(() => {
    const mixer = new AnimationMixer(body)
    const actions = new Map<string, AnimationAction>()
    for (const clip of animations) actions.set(clip.name, mixer.clipAction(clip))
    animator.current = { mixer, actions }
    current.current = null
    return () => {
      animator.current = null
      current.current = null
      mixer.stopAllAction()
      mixer.uncacheRoot(body)
      body.traverse((child) => {
        const skinned = child as SkinnedMesh
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose()
      })
    }
  }, [body, animations])

  // The shadow fades in with the riser's dissolve, and out as the dead go under (never shrinks).
  const presence = useCallback(() => fade.value * earthed(root.current?.position.y ?? 0), [fade])
  useBlob(root, 0.75, undefined, presence)

  // The fallen's name over their bones, in the chips' declutter like everyone else's.
  const chip = useMemo(chipSlot, [])
  /** The name's own fade, on a wrapper so the chip's classes keep theirs. */
  const fading = useMemo(() => ({ el: null as HTMLElement | null, shown: -1 }), [])
  const fadeRef = useCallback(
    (el: HTMLDivElement | null) => {
      fading.el = el
      fading.shown = -1
    },
    [fading],
  )
  const chipRef = useCallback(
    (el: HTMLDivElement | null) => {
      chip.el = el
    },
    [chip],
  )
  const moreRef = useCallback(
    (el: HTMLElement | null) => {
      chip.more = el
    },
    [chip],
  )
  useEffect(() => {
    if (!riser.title) return
    chip.anchor = root.current
    addChip(chip)
    return () => {
      removeChip(chip)
      chip.anchor = null
    }
  }, [chip, riser.title])

  useFrame((_, delta) => {
    const node = root.current
    const animation = animator.current
    if (!node || !animation) return
    if (riser.state !== state.current) {
      state.current = riser.state
      age.current = 0
    }
    age.current += delta
    alive.current += delta
    const t = age.current
    let y = 0
    let forward = 0
    if (riser.state === "sinking") {
      play("Skeletons_Death", true)
      // Skeletons_Death falls ~1.8 back (root and hips): slide forward as it falls, so the bones
      // land on their own grave instead of across the headstone behind it.
      const fall = Math.min(1, t / DEATH_S)
      forward = DRIFT * fall * fall * (3 - 2 * fall)
      if (t > DIE_S) {
        y = SUNK * Math.min(1, (t - DIE_S) / SINK_S)
        if (!sank.current) {
          sank.current = true
          puffs.burst(grave.x, grave.z)
        }
      }
    } else if (rises.current && alive.current < STIR_S + AWAKEN_S) {
      // Clawing up: lying in the earth, then the awakening, rising out of the mound as it stands.
      const r = alive.current
      if (r < STIR_S) {
        play("Skeletons_Inactive_Floor_Pose", true)
        y = BURIED
      } else {
        play("Skeletons_Awaken_Floor", true)
        y = BURIED * (1 - Math.min(1, (r - STIR_S) / (AWAKEN_S * 0.6)))
        if (puffed.current === 0) {
          puffed.current = 1
          puffs.burst(grave.x, grave.z)
        }
      }
    } else {
      // Vigil: idle, with a taunt now and then.
      const taunting =
        current.current === animation.actions.get("Skeletons_Taunt") && current.current?.isRunning()
      if (!taunting) {
        nextTaunt.current -= delta
        if (nextTaunt.current <= 0) {
          nextTaunt.current = 9 + seeded(riser.key + t.toFixed(0)) * 10
          play("Skeletons_Taunt", true)
        } else play("Skeletons_Idle", false)
      }
    }
    node.position.y = y
    body.position.z = forward
    const shown = fade.step(1, delta, fadeSeconds(STIR_S))
    dissolver.set(body, shown)
    const opacity = Math.round(shown * earthed(y) * 20) / 20
    if (fading.el && opacity !== fading.shown) {
      fading.shown = opacity
      fading.el.style.opacity = opacity >= 1 ? "" : String(opacity)
    }
    animation.mixer.update(delta)
    // The eyes burn brighter after dark: enough for the bloom to catch.
    for (const material of eyes.current) material.emissiveIntensity = 1 + sky.night * 2.6
  })

  function play(name: string, once: boolean): void {
    const actions = animator.current?.actions
    const next = actions?.get(name)
    if (!next) return
    if (next === current.current && (next.isRunning() || once)) return
    next.reset()
    if (once) {
      next.setLoop(LoopOnce, 1)
      next.clampWhenFinished = true
    }
    next.fadeIn(current.current ? FADE_S : 0).play()
    current.current?.fadeOut(FADE_S)
    current.current = next
  }

  const leaving = riser.state === "sinking"
  return (
    <group ref={root} position={[grave.x, 0, grave.z]} rotation-y={grave.rot}>
      <primitive object={body} />
      {riser.title && (
        <Label
          position={[0, CHIP_HEIGHT - 0.8, 0]}
          center
          zIndexRange={[19, 0]}
          style={{ pointerEvents: "none" }}
        >
          {/* Decorative, like every chip: the roster and the chronicle say who fell. */}
          <div ref={fadeRef}>
            <div ref={chipRef} aria-hidden="true" className={`chip undead${leaving ? " quiet" : ""}`}>
              <div className="name">
                <b>
                  {riser.title}
                  <i className="more" ref={moreRef} />
                </b>
              </div>
            </div>
          </div>
        </Label>
      )}
    </group>
  )
}

/** 1 on the ground, easing to 0 as the bones sink under it (by ~1.2 down). */
function earthed(y: number): number {
  return Math.max(0, Math.min(1, (y + 1.2) / 0.9))
}

/** Skeletons_Awaken_Floor's length (s). */
const AWAKEN_S = 2.3

/** A stable 0–1 from a string: each skeleton taunts on its own beat. */
function seeded(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

// ---- Dirt puffs ----------------------------------------------------------------------------

const BURSTS = 6
const BITS = 10
const PUFF_S = 1.1

/** Bursts of earth thrown up from a grave: a ring of preallocated slots, read by `Puffs`. */
const puffs = {
  slots: Array.from({ length: BURSTS }, () => ({ x: 0, z: 0, at: Number.NEGATIVE_INFINITY })),
  next: 0,
  /** Set by `Puffs` each frame: the clock bursts are stamped with. */
  now: 0,
  burst(x: number, z: number): void {
    const slot = puffs.slots[puffs.next]
    puffs.next = (puffs.next + 1) % BURSTS
    if (!slot) return
    slot.x = x
    slot.z = z
    slot.at = puffs.now
  },
}

function Puffs() {
  const store = useGuildStore()
  const built = useOwnedMeshes(() => {
    const mesh = new InstancedMesh(
      new IcosahedronGeometry(0.16, 0),
      new StandardMaterial({ color: "#6b4b33", roughness: 1, flatShading: true }),
      BURSTS * BITS,
    )
    mesh.frustumCulled = false
    mesh.visible = false
    return { meshes: [mesh] }
  }, [])

  useEffect(() => {
    // A seek throws away what's in flight, puffs included.
    return store.moments.onRebuild(() => {
      for (const slot of puffs.slots) slot.at = Number.NEGATIVE_INFINITY
    })
  }, [store])

  useFrame(({ clock }) => {
    puffs.now = clock.elapsedTime
    const mesh = built?.meshes[0]
    if (!mesh) return
    let k = 0
    for (const slot of puffs.slots) {
      const t = puffs.now - slot.at
      if (t < 0 || t > PUFF_S) continue
      const p = t / PUFF_S
      for (let i = 0; i < BITS; i++) {
        const angle = (i / BITS) * Math.PI * 2 + slot.x
        const reach = 0.4 + p * (0.9 + (i % 3) * 0.25)
        const height = 0.15 + (2.2 + (i % 4) * 0.4) * t - 4.5 * t * t
        position.set(
          slot.x + Math.cos(angle) * reach,
          Math.max(0.05, height),
          slot.z + Math.sin(angle) * reach,
        )
        scale.setScalar((1 - p) * (0.8 + (i % 2) * 0.5))
        mesh.setMatrixAt(k++, matrix.compose(position, IDENTITY, scale))
      }
    }
    mesh.count = k
    mesh.visible = k > 0
    if (k > 0) mesh.instanceMatrix.needsUpdate = true
  })

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

const IDENTITY = new Quaternion()
const position = new Vector3()
const scale = new Vector3()
const matrix = new Matrix4()
