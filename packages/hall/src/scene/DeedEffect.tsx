import type { Effect } from "@guildhall/roster"
import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import type { Group } from "three"
import { useGuild } from "../guild/useGuild.ts"

/**
 * Placeholder deed effects: a few glowing motes whose colour and motion say which kind of deed is
 * running (pages drift up, sparks burst, steam rises slow, portals ring the feet).
 */
export function DeedEffect({ effect }: { effect: Effect }) {
  const { mood } = useGuild()
  const motes = useRef<Group>(null)

  useFrame(({ clock }) => {
    const group = motes.current
    if (!group) return
    const t = clock.elapsedTime
    group.children.forEach((mote, i) => {
      const phase = (t * speedOf(effect) + i / group.children.length) % 1
      const angle = i * 2.4 + t * (effect === "portal" ? 2.5 : 0.8)
      const radius = effect === "portal" ? 0.42 : 0.25 + phase * 0.25
      mote.position.set(
        Math.cos(angle) * radius,
        effect === "portal" ? 0.05 : 0.7 + phase * 0.9,
        Math.sin(angle) * radius,
      )
      mote.scale.setScalar(effect === "steam" ? 0.6 + phase : 1 - phase * 0.7)
    })
  })

  if (effect === "none") return null
  const color = colorOf(effect, mood.fire, mood.magic, mood.trim)

  return (
    <group ref={motes}>
      {Array.from({ length: effect === "portal" ? 10 : 6 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed set of identical motes
        <mesh key={i}>
          <sphereGeometry args={[effect === "steam" ? 0.07 : 0.045, 8, 8]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={2.2}
            transparent
            opacity={0.85}
          />
        </mesh>
      ))}
    </group>
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
