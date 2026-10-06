import type { Effect } from "@guildhall/roster"
import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import { type InstancedMesh, Object3D } from "three"
import { useGuild } from "../guild/useGuild.ts"

const MAX_MOTES = 10

/**
 * Deed effects: a few glowing motes whose colour and motion say which kind of deed is running
 * (pages drift up, sparks burst, steam rises slow, portals ring the feet). One InstancedMesh, so an
 * effect costs one draw call however many motes it has.
 */
export function DeedEffect({ effect }: { effect: Effect }) {
  const { mood } = useGuild()
  const motes = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const count = effect === "portal" ? MAX_MOTES : 6

  useFrame(({ clock }) => {
    const mesh = motes.current
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

  if (effect === "none") return null
  const color = colorOf(effect, mood.fire, mood.magic, mood.trim)

  return (
    <instancedMesh ref={motes} args={[undefined, undefined, MAX_MOTES]} frustumCulled={false}>
      <sphereGeometry args={[effect === "steam" ? 0.07 : 0.045, 8, 8]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={2.2}
        transparent
        opacity={0.85}
      />
    </instancedMesh>
  )
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
