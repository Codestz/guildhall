import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import {
  AdditiveBlending,
  Color,
  type InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
} from "three"
import { useGuildStore } from "../../guild/useGuild.ts"
import { island } from "../../world/lands.ts"
import { HEARTH } from "../../world/layout.ts"
import { LIGHTS } from "../../world/lights.ts"
import { sky } from "../atmosphere/state.ts"
import { useTier } from "../Quality.tsx"

/**
 * The night moves: fireflies drift and blink over the meadows and the forest's edge, embers rise
 * from the hearth and the street torches. Both wake with the night (`sky.night`) and hide in rain.
 * One instanced draw each, positions animated in place — no allocations per frame.
 */
const FIREFLIES = [0, 90, 160] as const
const EMBERS = [0, 40, 80] as const

const land = island()
/** Meadows, plus a ring of spots just outside the forest's trees. */
const HOMES = [
  ...land.meadow,
  ...land.decor.filter((d) => d.piece.startsWith("trees_")).map((d) => [d.x + 3, d.z + 2] as const),
]

export function NightLife() {
  const tier = useTier()
  return (
    <>
      <Fireflies count={FIREFLIES[tier]} />
      <Embers count={EMBERS[tier]} />
    </>
  )
}

function Fireflies({ count }: { count: number }) {
  const store = useGuildStore()
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const geometry = useMemo(() => new SphereGeometry(0.09, 6, 6), [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false }),
    [],
  )
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const home = HOMES[(i * 7919) % Math.max(1, HOMES.length)] ?? [0, 0]
        return {
          x: home[0] + jitter(i, 1) * 4,
          z: home[1] + jitter(i, 2) * 4,
          phase: i * 2.399,
          speed: 0.4 + (i % 7) * 0.08,
        }
      }),
    [count],
  )
  const glow = useMemo(() => new Color(), [])

  useFrame(({ clock }) => {
    const instances = mesh.current
    if (!instances || count === 0) return
    const wet = store.environment.precipitation
    const visible = sky.night * (1 - Math.min(1, wet * 1.5)) * (store.environment.temperature > 4 ? 1 : 0)
    instances.visible = visible > 0.02
    if (!instances.visible) return
    const t = clock.elapsedTime
    for (let i = 0; i < count; i++) {
      const s = seeds[i]
      if (!s) continue
      const a = t * s.speed + s.phase
      dummy.position.set(
        s.x + Math.sin(a) * 1.6,
        0.8 + Math.sin(a * 1.7) * 0.5,
        s.z + Math.cos(a * 0.8) * 1.6,
      )
      dummy.updateMatrix()
      instances.setMatrixAt(i, dummy.matrix)
      // A slow blink: mostly dark, a soft green-gold pulse.
      const blink = Math.max(0, Math.sin(t * 1.3 + s.phase * 3)) ** 6
      instances.setColorAt(i, glow.setRGB(2.2, 2.6, 0.9).multiplyScalar(blink * visible))
    }
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  if (count === 0) return null
  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />
}

/** Fire sources: the hearth and every street torch flame. */
const FIRES = [
  [HEARTH[0], 1.4, HEARTH[1]] as const,
  ...LIGHTS.filter((l) => l.placement.piece === "torch").map((l) => l.flame),
]

function Embers({ count }: { count: number }) {
  const store = useGuildStore()
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const geometry = useMemo(() => new SphereGeometry(0.05, 5, 5), [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false }),
    [],
  )
  const ember = useMemo(() => new Color(), [])

  useFrame(({ clock }) => {
    const instances = mesh.current
    if (!instances || count === 0) return
    const strength = Math.max(0.25, sky.lamps) * (1 - Math.min(1, store.environment.precipitation * 2))
    const wind = store.environment.wind
    const t = clock.elapsedTime
    for (let i = 0; i < count; i++) {
      // The first few always rise from the hearth; the rest are shared round the torches.
      const fire = i < 12 ? FIRES[0] : FIRES[1 + ((i * 31) % Math.max(1, FIRES.length - 1))]
      if (!fire) continue
      const life = (t * (0.35 + (i % 5) * 0.06) + i * 0.618) % 1
      dummy.position.set(
        fire[0] + Math.sin(i * 12.9 + t) * 0.25 + life * wind * 1.8,
        fire[1] + life * 3.2,
        fire[2] + Math.cos(i * 7.3 + t) * 0.25,
      )
      dummy.scale.setScalar(1 - life * 0.8)
      dummy.updateMatrix()
      instances.setMatrixAt(i, dummy.matrix)
      instances.setColorAt(i, ember.setRGB(3.2, 1.1, 0.25).multiplyScalar((1 - life) * strength))
    }
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  if (count === 0) return null
  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />
}

function jitter(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}
