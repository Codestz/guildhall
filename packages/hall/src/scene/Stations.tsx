import { ROLES } from "@guildhall/roster"
import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import type { MeshBasicMaterial, PointLight } from "three"
import { AdditiveBlending } from "three"
import { useGuild } from "../guild/useGuild.ts"
import { HEARTH, STATIONS, type Station } from "../world/layout.ts"

/**
 * What the furniture can't say: a glowing sigil under each station that brightens while someone
 * works there (light = work), and the hearth's fire.
 */
export function Stations() {
  const { views, mood } = useGuild()
  const busy = new Set(
    views.filter((v) => v.phase === "working" || v.phase === "waiting").map((v) => v.station),
  )

  return (
    <group>
      {Object.values(STATIONS).map((station) => (
        <Sigil key={station.id} station={station} busy={busy.has(station.id)} />
      ))}
      <Hearth color={mood.fire} intensity={mood.fireIntensity} />
    </group>
  )
}

function Sigil({ station, busy }: { station: Station; busy: boolean }) {
  const material = useRef<MeshBasicMaterial>(null)
  const color = ROLES.find((role) => role.station === station.id)?.color ?? "#9a8f80"
  const [x, z] = centreOf(station)

  useFrame((_, delta) => {
    if (!material.current) return
    const goal = busy ? 0.55 : 0.08
    material.current.opacity += (goal - material.current.opacity) * Math.min(1, delta * 3)
  })

  return (
    <mesh position={[x, 0.09, z]} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[1.6, 2.1, 48]} />
      <meshBasicMaterial
        ref={material}
        color={color}
        transparent
        opacity={0.08}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

/** Between the station and its posts: where the work visibly happens. */
function centreOf(station: Station): [number, number] {
  const xs = station.posts.map((post) => post[0])
  const zs = station.posts.map((post) => post[1])
  const px = xs.reduce((a, b) => a + b, 0) / xs.length
  const pz = zs.reduce((a, b) => a + b, 0) / zs.length
  return [(px + station.at[0]) / 2, (pz + station.at[1]) / 2]
}

/** Angles of the stones ringing the hearth. */
const STONES = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2)

function Hearth({ color, intensity }: { color: string; intensity: number }) {
  const light = useRef<PointLight>(null)
  const flame = useRef<MeshBasicMaterial>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const flicker = 0.85 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 13.1) * 0.05 + Math.sin(t * 2.1) * 0.04
    if (light.current) light.current.intensity = intensity * 4 * flicker
    if (flame.current) flame.current.opacity = 0.75 + flicker * 0.2
  })

  return (
    <group position={[HEARTH[0], 0, HEARTH[1]]}>
      {STONES.map((a) => {
        return (
          <mesh
            key={a}
            position={[Math.cos(a) * 1.35, 0.22, Math.sin(a) * 1.35]}
            rotation-y={a}
            castShadow
            receiveShadow
          >
            <dodecahedronGeometry args={[0.42, 0]} />
            <meshStandardMaterial color="#8d8478" flatShading />
          </mesh>
        )
      })}
      <mesh position-y={0.9}>
        <coneGeometry args={[0.7, 1.6, 7]} />
        <meshBasicMaterial ref={flame} color={color} transparent opacity={0.9} />
      </mesh>
      <mesh position-y={0.7}>
        <coneGeometry args={[0.4, 1.1, 6]} />
        <meshBasicMaterial color="#fff2c4" />
      </mesh>
      <pointLight
        ref={light}
        position-y={2.4}
        color={color}
        intensity={intensity * 4}
        distance={22}
        decay={1.4}
        castShadow
      />
    </group>
  )
}
