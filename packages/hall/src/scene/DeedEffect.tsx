import type { Effect } from "@guildhall/roster"
import { useFrame } from "@react-three/fiber"
import { type RefObject, useEffect, useState } from "react"
import {
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type WebGLProgramParametersWithUniforms,
} from "three"
import { useGuildStore } from "../guild/useGuild.ts"
import { capacityFor } from "./Blobs.tsx"
import { useOwnedMeshes } from "./owned.ts"
import { DITHER_FUNCTIONS, presenceDiscard } from "./Rings.tsx"

const MAX_MOTES = 10

/**
 * Deed effects: a few glowing motes around each working adventurer whose colour and motion say
 * which kind of deed is running (pages drift up, sparks burst, steam rises slow, portals ring the
 * feet). Every adventurer's motes are drawn together: one InstancedMesh per kind of glow (fire,
 * magic, steam, trim), so the whole cast's effects cost at most four draw calls. Each adventurer
 * registers its root (`useDeedEffect`); motes follow the root, hide with it, and dissolve with it.
 */
interface Deed {
  node: Object3D
  effect: Effect
  presence: () => number
}

const deeds = new Set<Deed>()

/** Motes around `node` while `effect` is set (and not "none"). `presence` must be stable. */
export function useDeedEffect(
  node: RefObject<Object3D | null>,
  effect: Effect | undefined,
  presence: () => number,
): void {
  useEffect(() => {
    if (!node.current || !effect || effect === "none") return
    const entry: Deed = { node: node.current, effect, presence }
    deeds.add(entry)
    return () => {
      deeds.delete(entry)
    }
  }, [node, effect, presence])
}

/** Which of the four glows an effect draws with. */
export type Glow = "sparks" | "portal" | "steam" | "trim"
const GLOWS: readonly Glow[] = ["sparks", "portal", "steam", "trim"]

export function glowOfEffect(effect: Effect): Glow {
  return effect === "sparks" || effect === "portal" || effect === "steam" ? effect : "trim"
}

/** How many motes an effect shows. */
export function motesOf(effect: Effect): number {
  return effect === "portal" ? MAX_MOTES : 6
}

/**
 * Mote `i` of `count` at time `t`, in the adventurer's own frame before the effect's 2× scale.
 * Pure, for tests: writes position and scale into `out`.
 */
export function moteAt(effect: Effect, i: number, count: number, t: number, out: Object3D): void {
  const phase = (t * speedOf(effect) + i / count) % 1
  const angle = i * 2.4 + t * (effect === "portal" ? 2.5 : 0.8)
  const radius = effect === "portal" ? 0.42 : 0.25 + phase * 0.25
  out.position.set(
    Math.cos(angle) * radius,
    effect === "portal" ? 0.05 : 0.7 + phase * 0.9,
    Math.sin(angle) * radius,
  )
  out.scale.setScalar(effect === "steam" ? 0.6 + phase : 1 - phase * 0.7)
}

/** The effect hangs at twice its modelled size from the adventurer's root. */
const EFFECT_SCALE = new Matrix4().makeScale(2, 2, 2)

/** Every working adventurer's motes. Mounted once, beside the cast. */
export function DeedEffects() {
  const store = useGuildStore()
  const [capacity, setCapacity] = useState(64)
  const built = useOwnedMeshes(
    () => {
      const meshes = GLOWS.map((glow) => {
        const geometry = new SphereGeometry(glow === "steam" ? 0.07 : 0.045, 8, 8)
        geometry.setAttribute(
          "aPresence",
          new InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1),
        )
        const mesh = new InstancedMesh(geometry, glowOf(colorOf(glow, store.mood)), capacity)
        mesh.frustumCulled = false
        mesh.count = 0
        mesh.visible = false
        return mesh
      })
      return { meshes }
    },
    [capacity],
    "materials",
  )

  useFrame(({ clock }) => {
    if (!built) return
    const t = clock.elapsedTime
    const counts = [0, 0, 0, 0]
    let needed = 0
    for (const deed of deeds) {
      const g = GLOWS.indexOf(glowOfEffect(deed.effect))
      const mesh = built.meshes[g] as InstancedMesh
      const n = motesOf(deed.effect)
      const k = counts[g] ?? 0
      needed = Math.max(needed, k + n)
      if (!deed.node.visible || k + n > capacity) continue
      deed.node.updateWorldMatrix(true, false)
      base.multiplyMatrices(deed.node.matrixWorld, EFFECT_SCALE)
      const presence = deed.presence()
      const fades = mesh.geometry.getAttribute("aPresence") as InstancedBufferAttribute
      for (let i = 0; i < n; i++) {
        moteAt(deed.effect, i, n, t, dummy)
        dummy.updateMatrix()
        mesh.setMatrixAt(k + i, world.multiplyMatrices(base, dummy.matrix))
        fades.setX(k + i, presence)
      }
      counts[g] = k + n
    }
    const wanted = capacityFor(needed, capacity)
    if (wanted !== capacity) setCapacity(wanted)
    GLOWS.forEach((glow, g) => {
      const mesh = built.meshes[g] as InstancedMesh
      // The mood can change mid-story: its glow colours with it (materials are kept per colour).
      mesh.material = glowOf(colorOf(glow, store.mood))
      mesh.count = counts[g] ?? 0
      mesh.visible = mesh.count > 0
      mesh.instanceMatrix.needsUpdate = true
      mesh.geometry.getAttribute("aPresence").needsUpdate = true
    })
  })

  return built ? built.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />) : null
}

/**
 * One glow material per colour, kept for the whole run (a handful: the moods' fire, magic and trim,
 * and steam). Freed with the last effect, its shader program went too, and the next deed to start
 * compiled it again: a 150–200 ms stall on this Mac each time (docs/perf-budget.md, final pass).
 * Each mote's presence dithers it in and out with its adventurer (scene/dissolve.ts).
 */
const glows = new Map<string, MeshStandardMaterial>()
function glowOf(color: string): MeshStandardMaterial {
  let material = glows.get(color)
  if (!material) {
    material = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.85,
    })
    material.onBeforeCompile = patchPresence
    material.customProgramCacheKey = () => "deed-glow"
    glows.set(color, material)
  }
  return material
}

function patchPresence(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aPresence;\nvarying float vPresence;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPresence = aPresence;")
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\nvarying float vPresence;\n${DITHER_FUNCTIONS}`)
    .replace("void main() {", `void main() {\n\t${presenceDiscard("vPresence")}`)
}

function speedOf(effect: Effect): number {
  return effect === "sparks" ? 1.6 : effect === "steam" ? 0.35 : 0.6
}

function colorOf(glow: Glow, mood: { fire: string; magic: string; trim: string }): string {
  if (glow === "sparks") return mood.fire
  if (glow === "portal") return mood.magic
  if (glow === "steam") return "#c8c8c8"
  return mood.trim
}

const dummy = new Object3D()
const base = new Matrix4()
const world = new Matrix4()
