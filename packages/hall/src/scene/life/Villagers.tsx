import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useLayoutEffect, useMemo, useRef } from "react"
import {
  type AnimationAction,
  AnimationMixer,
  Color,
  type Group,
  MathUtils,
  type Mesh,
  type MeshStandardMaterial,
  type SkinnedMesh,
} from "three"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { ANIMS_URL, type Model, modelUrl } from "../../world/cast.ts"
import { ROUNDS, type Round, type Stop, VILLAGER } from "./rounds.ts"

/**
 * Villagers (ADR 0007, Life): quiet ambient life, never to be mistaken for an agent. Agents are
 * full-size, caped and hatted in their role's colour, ringed, named, and walk briskly; villagers
 * are smaller, bare-headed in muted homespun, unringed, unnamed, few, and amble. By day each goes
 * round their errands (rounds.ts); at dusk they walk home and go indoors, and come out at dawn.
 * Skinned, so each costs a draw call (and a shadow-pass one on High): capped per tier.
 */
const COUNT: Record<Tier, number> = { 0: 0, 1: 2, 2: 3, 3: 3 }

export function Villagers({ tier }: { tier: Tier }) {
  const rounds = ROUNDS.slice(0, COUNT[tier])
  return (
    <>
      {rounds.map((round) => (
        <Villager key={round.id} round={round} shadows={tier >= 2} />
      ))}
    </>
  )
}

const MUTED = new Color("#8d8577")

function Villager({ round, shadows }: { round: Round; shadows: boolean }) {
  const store = useGuildStore()
  const root = useRef<Group>(null)
  const { scene } = useGLTF(modelUrl(round.model as Model))
  const { animations } = useGLTF(ANIMS_URL)
  const body = useMemo(() => cloneSkinned(scene), [scene])
  const animator = useRef<{ mixer: AnimationMixer; actions: Map<string, AnimationAction> } | null>(null)
  const current = useRef<AnimationAction | null>(null)
  /** Where in the round: the stop walked to (or stood at), how long stood there, indoors or out. */
  const walk = useMemo(() => ({ stop: 0, waited: 0, home: false, presence: 1, indoors: false }), [])

  // Body only (no tinted cape or hat), its colours pulled towards a muted homespun: own materials,
  // freed on unmount. Mixer and bone textures likewise belong to this mount alone.
  useLayoutEffect(() => {
    const own: MeshStandardMaterial[] = []
    body.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      if (/Tinted/.test(mesh.name)) {
        mesh.visible = false
        return
      }
      mesh.castShadow = shadows
      const material = (mesh.material as MeshStandardMaterial).clone()
      material.color.lerp(MUTED, 0.5).multiplyScalar(0.92)
      mesh.material = material
      own.push(material)
    })
    const mixer = new AnimationMixer(body)
    const actions = new Map<string, AnimationAction>()
    for (const clip of animations) actions.set(clip.name, mixer.clipAction(clip))
    animator.current = { mixer, actions }
    current.current = null
    return () => {
      for (const material of own) material.dispose()
      animator.current = null
      current.current = null
      mixer.stopAllAction()
      mixer.uncacheRoot(body)
      body.traverse((child) => {
        const skinned = child as SkinnedMesh
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose()
      })
    }
  }, [body, animations, shadows])

  useFrame((_, delta) => {
    const node = root.current
    const anim = animator.current
    if (!node || !anim) return
    const dt = Math.min(delta, 0.1)
    const daylight = store.environment.daylight
    // Home at dusk, out again once it's properly light (a gap, so dawn doesn't flicker them).
    if (!walk.home && daylight < 0.3) walk.home = true
    if (walk.home && walk.indoors && daylight > 0.42) {
      walk.home = false
      walk.indoors = false
      walk.stop = 0
      walk.waited = 0
    }

    const stop: Stop = walk.home ? round.door : (round.stops[walk.stop] ?? round.door)
    const dx = stop.x - node.position.x
    const dz = stop.z - node.position.z
    const distance = Math.hypot(dx, dz)
    let clip = stop.clip ?? "Idle_A"
    let rate = 1
    if (distance > 0.08) {
      const move = Math.min(1, (VILLAGER.speed * dt) / distance)
      node.position.x += dx * move
      node.position.z += dz * move
      turn(node, Math.atan2(dx, dz), dt * 6)
      clip = "Walking_A"
      rate = VILLAGER.stride
    } else if (walk.home) {
      walk.indoors = true
    } else {
      if (stop.facing !== undefined) turn(node, stop.facing, dt * 4)
      walk.waited += dt
      if (walk.waited >= (stop.wait ?? 0)) {
        walk.waited = 0
        walk.stop = (walk.stop + 1) % round.stops.length
      }
    }
    // Indoors: shrink away at the door, like an adventurer leaving by the gate; grow back at dawn.
    walk.presence = MathUtils.damp(walk.presence, walk.indoors ? 0 : 1, 3, dt)
    node.visible = walk.presence > 0.02
    node.scale.setScalar(VILLAGER.scale * Math.max(0.02, walk.presence))
    if (!node.visible) return
    play(anim.actions, clip, rate)
    anim.mixer.update(dt)
  })

  function play(actions: Map<string, AnimationAction>, name: string, rate: number): void {
    const next = actions.get(name) ?? actions.get("Idle_A")
    if (!next) return
    next.timeScale = rate
    if (next === current.current && next.isRunning()) return
    next.reset().fadeIn(0.3).play()
    if (current.current !== next) current.current?.fadeOut(0.3)
    current.current = next
  }

  const start = round.door
  return (
    <group ref={root} position={[start.x, 0, start.z]}>
      <primitive object={body} />
    </group>
  )
}

function turn(node: Group, heading: number, rate: number): void {
  const delta = Math.atan2(Math.sin(heading - node.rotation.y), Math.cos(heading - node.rotation.y))
  node.rotation.y += delta * Math.min(1, rate)
}
