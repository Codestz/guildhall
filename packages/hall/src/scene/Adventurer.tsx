import { Html, useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import {
  type AnimationAction,
  AnimationMixer,
  Color,
  type Group,
  LoopOnce,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
} from "three"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import type { AdventurerView } from "../guild/store.ts"
import { positions, useGuildStore } from "../guild/useGuild.ts"
import { ANIMS_URL, GEAR, isModel, MODELS, modelUrl } from "../world/cast.ts"
import type { Piece } from "../world/furniture.ts"
import { GATE, type Spot } from "../world/layout.ts"
import { route } from "../world/paths.ts"
import { DeedEffect } from "./DeedEffect.tsx"
import { clonePiece, useKit } from "./Kit.tsx"

const WALK_SPEED = 3.4
/** No walk lasts longer than this: far trips run instead (Motion language board). */
const MAX_WALK_S = 5
const RUN_ABOVE = 5.2
const FADE_S = 0.25

useGLTF.preload(ANIMS_URL)
// Every model up front: a model loading mid-run would suspend and hide the whole cast.
for (const model of MODELS) useGLTF.preload(modelUrl(model))

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
  /** Made in a layout effect, below: a mount (StrictMode's second one too) gets its own. */
  const animator = useRef<{ mixer: AnimationMixer; actions: Map<string, AnimationAction> } | null>(null)
  const current = useRef<AnimationAction | null>(null)
  /** Spots still to walk through; recomputed whenever the target moves. */
  const path = useRef<Spot[]>([])
  const routedTo = useRef<string>("")
  const start = view.master ? view.target : ([GATE[0], GATE[1], Math.PI] as const)

  // Role colour on cape and hat; shadows on. The tinted clones are this adventurer's own: on
  // unmount (or a new colour) they are disposed and the model's shared materials put back.
  useEffect(() => {
    const tint = new Color(view.color)
    const tinted: [Mesh, Material][] = []
    body.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      if (/Tinted/.test(mesh.name)) {
        const shared = mesh.material as MeshStandardMaterial
        const own = shared.clone()
        own.color = tint.clone().lerp(new Color("#ffffff"), 0.25)
        mesh.material = own
        tinted.push([mesh, shared])
      }
    })
    return () => {
      for (const [mesh, shared] of tinted) {
        ;(mesh.material as Material).dispose()
        mesh.material = shared
      }
    }
  }, [body, view.color])

  // The mixer and its actions live exactly as long as this mount: made here, before the first frame
  // (no bind-pose flash), and freed on unmount with each skeleton's bone texture — all made for this
  // body alone. Geometry and untinted materials are shared with the loaded model (SkeletonUtils.clone),
  // held gear with the kit: never disposed here. StrictMode's unmount-and-mount gets a fresh mixer,
  // so nothing keeps using a disposed one; the renderer remakes the bone texture on the next draw.
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

  // Gear in the hand slots; a mug instead while resting in the tavern.
  const atWork = view.site && (view.phase === "working" || view.phase === "waiting")
  const gear = (atWork && view.site ? SITE_GEAR[view.site] : undefined) ?? GEAR[view.agent] ?? {}
  const right: Piece | undefined = view.phase === "resting" ? "mug_full" : gear.right
  useHeld(body, kit, "handslot.r", right)
  // After dark, a free left hand carries a lantern: you can always find your agents at night.
  const dark = store.environment.daylight < 0.3
  const left = view.phase === "resting" ? undefined : (gear.left ?? (dark ? "lantern" : undefined))
  useHeld(body, kit, "handslot.l", left)

  useEffect(() => {
    const id = view.id
    const node = root.current
    if (node) positions.set(id, node.position)
    return () => {
      positions.delete(id)
    }
  }, [view.id])

  useFrame((_, delta) => {
    const node = root.current
    if (!node) return
    const [tx, tz, facing] = view.target
    const key = `${tx},${tz}`
    if (routedTo.current !== key) {
      routedTo.current = key
      path.current = route([node.position.x, node.position.z], [tx, tz])
    }
    let next = path.current[0]
    while (
      next &&
      path.current.length > 1 &&
      Math.hypot(next[0] - node.position.x, next[1] - node.position.z) < 0.3
    ) {
      path.current.shift()
      next = path.current[0]
    }
    const [nx, nz] = next ?? [tx, tz]
    const dx = nx - node.position.x
    const dz = nz - node.position.z
    const step = Math.hypot(dx, dz)
    const remaining = step + pathLength(path.current)
    const walking = remaining > 0.12
    let speed = 0
    if (walking) {
      speed = Math.max(WALK_SPEED, remaining / MAX_WALK_S)
      const move = Math.min(1, (speed * delta) / Math.max(step, 1e-6))
      node.position.x += dx * move
      node.position.z += dz * move
      turn(node, Math.atan2(dx, dz), delta * 10)
    } else {
      turn(node, facing, delta * 5)
    }
    const distance = remaining

    const leaving = view.phase === "leaving" ? distance : 99
    node.scale.setScalar(leaving < 1.2 ? Math.max(0.01, leaving / 1.2) : 1)

    play(clipFor(view, walking, speed))
    animator.current?.mixer.update(delta)
  })

  function play(name: string): void {
    const actions = animator.current?.actions
    const next = actions?.get(name) ?? actions?.get("Idle_A")
    if (!next) return
    // Already playing it — unless something stopped it (a suspended tree, a finished fade): then
    // it must start again, or the rig falls back to its bind pose (KayKit's T-pose).
    if (next === current.current && next.isRunning()) return
    if (next === current.current) {
      next.reset().setEffectiveWeight(1).play()
      return
    }
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
  if (view.site) return siteClip(view)
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

/** Work at an island site (ADR 0006): the site sets the trade, the deed picks the motion. */
function siteClip(view: AdventurerView): string {
  const tool = view.tool
  switch (view.site) {
    case "yard":
      if (tool === "write") return "Sawing"
      if (tool === "edit" || tool === "patch" || tool === "bash" || tool === "shell") return "Hammering"
      return tool ? "Working_B" : view.thinking ? "Idle_B" : "Working_A"
    case "forest":
      if (tool === "grep" || tool === "glob" || tool === "list") return "Chopping"
      return tool ? "Working_A" : "Idle_B"
    case "river":
      if (tool === "webfetch" || tool === "websearch") return "Fishing_Reeling"
      return tool ? "Fishing_Cast" : "Fishing_Idle"
    case "proving":
      if (tool === "bash" || tool === "shell") return "Melee_1H_Attack_Chop"
      return tool ? "Working_B" : "Idle_B"
    case "quarry":
      return tool ? "Pickaxing" : "Idle_A"
    case "tower":
      return tool ? "Ranged_Magic_Spellcasting" : "Idle_B"
    default:
      return "Idle_A"
  }
}

/** Tools of each site's trade, in place of the role's own gear while working there. */
const SITE_GEAR: Partial<Record<NonNullable<AdventurerView["site"]>, { right?: Piece; left?: Piece }>> = {
  forest: { right: "axe" },
  quarry: { right: "pickaxe" },
  proving: { right: "sword_1handed" },
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

/** Length of the rest of the walk, after the spot being walked to now. */
function pathLength(path: Spot[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return total
}

function turn(node: Object3D, heading: number, rate: number): void {
  const delta = Math.atan2(Math.sin(heading - node.rotation.y), Math.cos(heading - node.rotation.y))
  node.rotation.y += delta * Math.min(1, rate)
}
