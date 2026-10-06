import { Html, useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import {
  type AnimationAction,
  AnimationMixer,
  Color,
  type Group,
  LoopOnce,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from "three"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import type { AdventurerView } from "../guild/store.ts"
import { positions, useGuildStore } from "../guild/useGuild.ts"
import { ANIMS_URL, GEAR, isModel, modelUrl } from "../world/cast.ts"
import type { Piece } from "../world/furniture.ts"
import { GATE } from "../world/layout.ts"
import { DeedEffect } from "./DeedEffect.tsx"
import { clonePiece, useKit } from "./Kit.tsx"

const WALK_SPEED = 3.4
/** No walk lasts longer than this: far trips run instead (Motion language board). */
const MAX_WALK_S = 5
const RUN_ABOVE = 5.2
const FADE_S = 0.25

useGLTF.preload(ANIMS_URL)

/**
 * A KayKit adventurer: the role's model with its gear, animated from the shared Rig_Medium clips.
 * Walks to `view.target`, then plays what the phase and current deed call for.
 */
export function Adventurer({ view }: { view: AdventurerView }) {
  const store = useGuildStore()
  const root = useRef<Group>(null)
  const model = isModel(view.character) ? view.character : "rogue-hooded"
  const { scene } = useGLTF(modelUrl(model))
  const { animations } = useGLTF(ANIMS_URL)
  const kit = useKit()

  const body = useMemo(() => cloneSkinned(scene), [scene])
  const mixer = useMemo(() => new AnimationMixer(body), [body])
  const actions = useMemo(() => {
    const map = new Map<string, AnimationAction>()
    for (const clip of animations) map.set(clip.name, mixer.clipAction(clip))
    return map
  }, [animations, mixer])
  const current = useRef<AnimationAction | null>(null)
  const start = view.master ? view.target : ([GATE[0], GATE[1], Math.PI] as const)

  // Role colour on cape and hat; shadows on.
  useEffect(() => {
    const tint = new Color(view.color)
    body.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      if (/Cape|Hat|Hood/i.test(mesh.name)) {
        const own = (mesh.material as MeshStandardMaterial).clone()
        own.color = tint.clone().lerp(new Color("#ffffff"), 0.25)
        mesh.material = own
      }
    })
  }, [body, view.color])

  // Gear in the hand slots; a mug instead while resting in the tavern.
  const gear = GEAR[view.agent] ?? {}
  const right: Piece | undefined = view.phase === "resting" ? "mug_full" : gear.right
  useHeld(body, kit, "handslot.r", right)
  useHeld(body, kit, "handslot.l", view.phase === "resting" ? undefined : gear.left)

  useEffect(() => {
    const id = view.id
    const node = root.current
    if (node) positions.set(id, node.position)
    return () => {
      positions.delete(id)
      mixer.stopAllAction()
    }
  }, [view.id, mixer])

  useFrame((_, delta) => {
    const node = root.current
    if (!node) return
    const [tx, tz, facing] = view.target
    const dx = tx - node.position.x
    const dz = tz - node.position.z
    const distance = Math.hypot(dx, dz)
    const walking = distance > 0.12
    let speed = 0
    if (walking) {
      speed = Math.max(WALK_SPEED, distance / MAX_WALK_S)
      const step = Math.min(1, (speed * delta) / distance)
      node.position.x += dx * step
      node.position.z += dz * step
      turn(node, Math.atan2(dx, dz), delta * 10)
    } else {
      turn(node, facing, delta * 5)
    }

    const leaving = view.phase === "leaving" ? distance : 99
    node.scale.setScalar(leaving < 1.2 ? Math.max(0.01, leaving / 1.2) : 1)

    play(clipFor(view, walking, speed))
    mixer.update(delta)
  })

  function play(name: string): void {
    const next = actions.get(name) ?? actions.get("Idle_A")
    if (!next || next === current.current) return
    next.reset()
    if (name === "Sit_Chair_Down" || name === "Lie_Down") {
      next.setLoop(LoopOnce, 1)
      next.clampWhenFinished = true
    }
    next.fadeIn(FADE_S).play()
    current.current?.fadeOut(FADE_S)
    current.current = next
  }

  const selected = store.selected === view.id
  /** Resting and leaving adventurers keep a small, faded label so the busy ones stay readable. */
  const quiet = view.phase === "resting" || view.phase === "leaving"

  return (
    <group
      ref={root}
      position={[start[0], 0, start[1]]}
      rotation-y={start[2]}
      onClick={(event) => {
        event.stopPropagation()
        store.select(selected ? null : view.id)
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer"
      }}
      onPointerOut={() => {
        document.body.style.cursor = ""
      }}
    >
      <primitive object={body} />
      <mesh position-y={0.06} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.75, selected ? 1.05 : 0.9, 40]} />
        <meshBasicMaterial
          color={view.color}
          transparent
          opacity={selected ? 0.95 : 0.55}
          depthWrite={false}
        />
      </mesh>
      {view.look && view.phase === "working" && (
        <group scale={2}>
          <DeedEffect effect={view.look.effect} />
        </group>
      )}
      <Html position={[0, 3.2, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className={`chip${selected ? " selected" : ""}${quiet && !selected ? " quiet" : ""}`}>
          {view.phase === "waiting" && <div className="plea">!</div>}
          {view.bubble && <div className="bubble">{view.bubble}</div>}
          <div className="name" style={{ borderColor: view.color }}>
            <b>{view.title}</b>
            {view.doing && !quiet && <span>{view.doing}</span>}
          </div>
        </div>
      </Html>
    </group>
  )
}

/** Which clip the moment calls for. Clip names are KayKit Rig_Medium (scripts/assets.ts CLIPS). */
function clipFor(view: AdventurerView, walking: boolean, speed: number): string {
  if (walking) return speed > RUN_ABOVE ? "Running_A" : "Walking_A"
  if (view.stung) return "Hit_A"
  switch (view.phase) {
    case "resting":
      return view.seat === "floor" ? "Sit_Floor_Idle" : "Sit_Chair_Idle"
    case "failed":
      return "Lie_Idle"
    case "waiting":
      return "Waving"
    case "loot":
      return "Cheering"
    case "leaving":
      return "Waving"
    case "idle":
      return "Idle_A"
    default:
      break
  }
  if (view.look) {
    if (view.master && (view.tool === "task" || view.tool === "subagent")) return "Ranged_Magic_Summon"
    switch (view.look.clip) {
      case "Spellcasting":
        return "Ranged_Magic_Spellcasting"
      case "Use_Item":
        if (view.station === "forge") return "Hammering"
        if (view.station === "inspection-bench") return "Lockpicking"
        if (view.station === "drafting-table" || view.station === "scroll-desk") return "Working_A"
        return "Use_Item"
      case "Interact":
        return view.station === "library" || view.station === "map-table" ? "Working_B" : "Interact"
      default:
        return view.look.clip
    }
  }
  return view.thinking ? "Idle_B" : "Idle_A"
}

/** Keeps `piece` attached to the bone named `slot` (nothing when undefined). */
function useHeld(
  body: Object3D,
  kit: Record<string, Object3D>,
  slot: string,
  piece: Piece | undefined,
): void {
  useEffect(() => {
    if (!piece) return
    const bone = body.getObjectByName(slot)
    if (!bone || !kit[piece]) return
    const held = clonePiece(kit, piece)
    bone.add(held)
    // Materials are shared with the kit: detach only, never dispose.
    return () => {
      bone.remove(held)
    }
  }, [body, kit, slot, piece])
}

function turn(node: Object3D, heading: number, rate: number): void {
  const delta = Math.atan2(Math.sin(heading - node.rotation.y), Math.cos(heading - node.rotation.y))
  node.rotation.y += delta * Math.min(1, rate)
}
