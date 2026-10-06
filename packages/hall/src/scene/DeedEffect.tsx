import type { Effect } from "@guildhall/roster"
import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import { InstancedMesh, MeshStandardMaterial, Object3D, SphereGeometry } from "three"
import { useGuild } from "../guild/useGuild.ts"
import { useOwnedMeshes } from "./owned.ts"

const MAX_MOTES = 10

/**
 * Deed effects: a few glowing motes whose colour and motion say which kind of deed is running
 * (pages drift up, sparks burst, steam rises slow, portals ring the feet). One InstancedMesh, so an
 * effect costs one draw call however many motes it has.
 */
export function DeedEffect({ effect }: { effect: Effect }) {
  const { mood } = useGuild()
  const dummy = useMemo(() => new Object3D(), [])
  const count = effect === "portal" ? MAX_MOTES : 6
  const color = colorOf(effect, mood.fire, mood.magic, mood.trim)
  const built = useOwnedMeshes(
    () => ({ meshes: effect === "none" ? [] : [motes(effect, color)] }),
    [effect, color],
    "materials",
  )

  useFrame(({ clock }) => {
    const mesh = built?.meshes[0]
    if (!mesh) return
    const t = clock.elapsedTime
    for (let i = 0; i < count; i++) {
      const phase = (t * speedOf(effect) + i / count) % 1
      const angle = i * 2.4 + t * (effect === "portal" ? 2.5 : 0.8)
      const radius = effect === "portal" ? 0.42 : 0.25 + phase * 0.25
      dummy.position.set(
        Math.cos(angle) * radius,
        effect === "portal" ? 0.05 : 0.7 + phase * 0.9,
        Math.sin(angle) * radius,
      )
      dummy.scale.setScalar(effect === "steam" ? 0.6 + phase : 1 - phase * 0.7)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  })

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

/** Up to MAX_MOTES glowing motes in `color`: one InstancedMesh. */
function motes(effect: Effect, color: string): InstancedMesh {
  const geometry = new SphereGeometry(effect === "steam" ? 0.07 : 0.045, 8, 8)
  const mesh = new InstancedMesh(geometry, glowOf(color), MAX_MOTES)
  mesh.frustumCulled = false
  return mesh
}

/**
 * One glow material per colour, kept for the whole run (a handful: the moods' fire, magic and trim,
 * and steam). Freed with the last effect, its shader program went too, and the next deed to start
 * compiled it again: a 150–200 ms stall on this Mac each time (docs/perf-budget.md, final pass).
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
    glows.set(color, material)
  }
  return material
}

function speedOf(effect: Effect): number {
  return effect === "sparks" ? 1.6 : effect === "steam" ? 0.35 : 0.6
}

function colorOf(effect: Effect, fire: string, magic: string, trim: string): string {
  if (effect === "sparks") return fire
  if (effect === "portal") return magic
  if (effect === "steam") return "#c8c8c8"
  return trim
}
