import { ARCHETYPE_IDS, ARCHETYPES } from "@guildhall/roster"
import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import type { MeshBasicMaterial, PointLight } from "three"
import { AdditiveBlending, CanvasTexture, Color, SRGBColorSpace } from "three"
import { useGuild } from "../guild/useGuild.ts"
import { HEARTH, STATIONS, type Station } from "../world/layout.ts"
import { sky } from "./atmosphere/state.ts"

/**
 * What the furniture can't say: a glowing sigil under each station that brightens while someone
 * works there (light = work), and the hearth's fire. Both burn brighter as night falls (`sky.lamps`).
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
  const color =
    ARCHETYPE_IDS.map((id) => ARCHETYPES[id]).find((a) => a.station === station.id)?.color ?? "#9a8f80"
  const [x, z] = centreOf(station)

  const base = useMemo(() => new Color(color), [color])

  useFrame((_, delta) => {
    if (!material.current) return
    const goal = busy ? 0.55 : 0.08
    material.current.opacity += (goal - material.current.opacity) * Math.min(1, delta * 3)
    // At night a working sigil is a light in the dark: HDR, so bloom picks it up.
    material.current.color.copy(base).multiplyScalar(1 + sky.lamps * (busy ? 1.4 : 0.4))
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
  const core = useRef<MeshBasicMaterial>(null)
  const pool = useRef<MeshBasicMaterial>(null)
  const fire = useMemo(() => new Color(color), [color])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const flicker = 0.85 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 13.1) * 0.05 + Math.sin(t * 2.1) * 0.04
    // By day the fire is a modest glow in a bright hall; at night it is the room's main light.
    const night = sky.lamps
    if (light.current) light.current.intensity = intensity * (2.2 + night * 4.5) * flicker
    if (flame.current) {
      flame.current.opacity = 0.75 + flicker * 0.2
      flame.current.color.copy(fire).multiplyScalar(1 + night * 1.6)
    }
    if (core.current) core.current.color.copy(CORE).multiplyScalar(1 + night * 2)
    if (pool.current) {
      pool.current.color.copy(fire)
      pool.current.opacity = (0.05 + night * 0.32) * flicker
    }
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
        <meshBasicMaterial ref={core} color="#fff2c4" />
      </mesh>
      {/* The pool of firelight on the floor round the hearth. */}
      <mesh position-y={0.06} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[6, 40]} />
        <meshBasicMaterial
          ref={pool}
          map={POOL}
          transparent
          opacity={0.1}
          blending={AdditiveBlending}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      <pointLight
        ref={light}
        position-y={2.4}
        color={color}
        intensity={intensity * 4}
        distance={22}
        decay={1.4}
      />
    </group>
  )
}

const CORE = new Color("#fff2c4")

/** A radial falloff for the firelight pool, drawn once. */
const POOL = (() => {
  if (typeof document === "undefined") return null
  const size = 128
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, "rgba(255,255,255,1)")
    gradient.addColorStop(0.35, "rgba(255,255,255,0.45)")
    gradient.addColorStop(1, "rgba(255,255,255,0)")
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
})()
