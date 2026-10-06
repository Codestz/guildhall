import { Html, useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import {
  type AnimationAction,
  AnimationMixer,
  Color,
  type Group,
  LoopOnce,
  type Material,
  MathUtils,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
} from "three"
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js"
import type { AdventurerView } from "../guild/store.ts"
import { positions, useGuildStore } from "../guild/useGuild.ts"
import { verbOf } from "../hud/format.ts"
import { Icon } from "../hud/icons.tsx"
import { ANIMS_URL, GEAR, isModel, MODELS, modelUrl } from "../world/cast.ts"
import type { Piece } from "../world/furniture.ts"
import { GATE, type Spot } from "../world/layout.ts"
import { route } from "../world/paths.ts"
import { DESTINATIONS, SITE_DEFS } from "../world/sites.ts"
import { useBlob } from "./Blobs.tsx"
import { addChip, CHIP_HEIGHT, chipSlot, declutter, removeChip } from "./chips.ts"
import { DeedEffect } from "./DeedEffect.tsx"
import { clonePiece, useKit } from "./Kit.tsx"

const WALK_SPEED = 3.4
/** The infirmary bed's blanket, measured on kit.glb's bed_frame (0.84 up, scale 1). */
const BED_TOP = 0.84
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
      // Characters move every frame; the shadow map is static (atmosphere/shadows.ts). A soft blob
      // under their feet grounds them instead.
      mesh.castShadow = false
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
  const gear = (atWork && view.site ? SITE_DEFS[view.site].gear : undefined) ?? GEAR[view.agent] ?? {}
  const right: Piece | undefined = view.phase === "resting" ? "mug_full" : gear.right
  useHeld(body, kit, "handslot.r", right)
  // After dark, a free left hand carries a lantern: you can always find your agents at night.
  const dark = store.environment.daylight < 0.3
  const left = view.phase === "resting" ? undefined : (gear.left ?? (dark ? "lantern" : undefined))
  useHeld(body, kit, "handslot.l", left)

  useBlob(root, 0.85)

  useEffect(() => {
    const id = view.id
    const node = root.current
    if (node) positions.set(id, node.position)
    return () => {
      positions.delete(id)
    }
  }, [view.id])

  // The name chip joins the declutter (scene/chips.ts), which nudges and folds it directly in the DOM.
  const chip = useMemo(chipSlot, [])
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
    chip.anchor = root.current
    addChip(chip)
    return () => {
      removeChip(chip)
      chip.anchor = null
    }
  }, [chip])

  useFrame((state, delta) => {
    declutter(state.camera, state.size.width, state.size.height)
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
    // In bed: up onto the mattress. The post is at floor level beside it, so lying down there
    // put them on the floor under the bed (the user: "they sleep below the bed").
    const inBed = view.seat === "bed" && !walking
    node.position.y = MathUtils.damp(node.position.y, inBed ? BED_TOP : 0, 6, delta)

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
  /** Resting and leaving adventurers keep a softer label so the busy ones stay readable. */
  const quiet = view.phase === "resting" || view.phase === "leaving"
  const pleading = view.phase === "waiting"
  // Read by the declutter on its next run (refs, not state: no re-render for it).
  chip.pinned = selected || pleading
  // Its deed sigil (scene/Sigils.tsx) finds this chip by id, to sit under it and follow its lift.
  chip.id = view.id
  const { verb, glyph } = verbOf(view)
  const Glyph = Icon[glyph]
  /** The full deed, for Detailed mode and whoever you follow; Minimal shows the verb instead. */
  const deed = view.doing && !quiet ? view.doing : ""

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
      {/* Decorative: the roster is the accessible list of who is here and what they are doing. */}
      <Html position={[0, CHIP_HEIGHT, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div
          ref={chipRef}
          aria-hidden="true"
          className={`chip${selected ? " selected" : ""}${quiet && !selected ? " quiet" : ""}${deed ? " has-deed" : ""}`}
          data-tone={glyph}
        >
          {pleading && <div className="plea">!</div>}
          {view.bubble && <div className="bubble">{view.bubble}</div>}
          <div className="name" style={{ borderColor: view.color }}>
            <b>
              {view.title}
              <i className="more" ref={moreRef} />
            </b>
            <em className="verb">
              <Glyph />
              {verb}
            </em>
            {deed && <span className="deed">{deed}</span>}
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
      return (view.destination && DESTINATIONS[view.destination]?.clip) || "Lie_Idle"
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
  // Work at an island site (ADR 0006): the site sets the trade, the deed picks the motion.
  if (view.site) return SITE_DEFS[view.site].clip(view.tool, view.thinking)
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
