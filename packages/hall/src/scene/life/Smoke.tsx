import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import {
  IcosahedronGeometry,
  type InstancedMesh,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { island } from "../../world/lands.ts"
import { WIND_DIRECTION } from "../weather/shared.ts"
import { life } from "./state.ts"
import { hash } from "./traces.ts"

/**
 * Chimney smoke (ADR 0007, Life): low-poly puffs that rise, swell and shrink away from every
 * chimney top on the island — opaque (no sorting, no overdraw), one InstancedMesh.
 *   how many chimneys   the temperature: on a warm busy day a few hearths; as the guild goes
 *                       quiet and cools, more fires are lit, and the puffs grow thicker
 *   which way           bent by the wind (the weather layer's direction and strength)
 *   heavy rain          puts the smoke out (precipitation)
 *   the smithy          always smokes, harder, while implementers are at work (forging)
 */
const PUFFS: Record<Tier, number> = { 0: 3, 1: 4, 2: 5, 3: 6 }
const RISE = 5.2
const PERIOD_S = 6

export function Smoke({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const puffs = PUFFS[tier]
  const chimneys = useMemo(() => {
    const land = island()
    const smithy = land.landmarks.find((mark) => mark.piece === "building_blacksmith_blue")
    return land.landmarks
      .filter((mark) => mark.kind === "chimney")
      .map((mark, i) => ({
        x: mark.x,
        y: mark.y ?? 4,
        z: mark.z,
        smithy: !!smithy && Math.hypot(mark.x - smithy.x, mark.z - smithy.z) < 3,
        /** Fires light in this order as it gets colder. */
        threshold: hash(i * 7 + 1),
        phase: hash(i * 7 + 2),
        presence: 0,
      }))
  }, [])
  const geometry = useMemo(() => new IcosahedronGeometry(0.5, 0), [])
  const material = useMemo(
    () => new MeshStandardMaterial({ color: "#e4e2dc", roughness: 1, flatShading: true }),
    [],
  )
  const mesh = useRef<InstancedMesh>(null)
  const state = useMemo(() => ({ wind: 0.2, cold: 0, wet: 0, time: 0 }), [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((_, delta) => {
    const instances = mesh.current
    if (!instances) return
    const env = store.environment
    const dt = Math.min(delta, 0.1)
    state.time += dt
    state.wind = MathUtils.damp(state.wind, env.wind, 1, dt)
    state.cold = MathUtils.damp(state.cold, 1 - MathUtils.smoothstep(env.temperature, 4, 22), 1, dt)
    state.wet = MathUtils.damp(state.wet, MathUtils.smoothstep(env.precipitation, 0.45, 0.8), 1, dt)
    // A share of the hearths always burns (cooking); the cold lights the rest.
    const lit = 0.3 + 0.7 * state.cold
    let k = 0
    for (const chimney of chimneys) {
      const forging = chimney.smithy && life.forging > 0
      const goal = (chimney.threshold < lit || forging ? 1 : 0) * (1 - state.wet)
      chimney.presence = MathUtils.damp(chimney.presence, goal, 0.6, dt)
      const size = (0.8 + 0.6 * state.cold + (forging ? 0.4 : 0)) * chimney.presence
      for (let p = 0; p < puffs; p++) {
        const age = (state.time / PERIOD_S + chimney.phase + p / puffs) % 1
        const bend = state.wind * 4.5 * age ** 1.5
        position.set(
          chimney.x + WIND_DIRECTION.x * bend + Math.sin(age * 9 + p) * 0.12,
          chimney.y + 0.2 + age * RISE,
          chimney.z + WIND_DIRECTION.z * bend,
        )
        // Swells as it leaves the chimney, then thins away.
        const s = size * (0.35 + 1.4 * age) * Math.sin(Math.PI * Math.min(1, age * 1.15)) ** 0.6
        rotation.setFromAxisAngle(AXIS, age * 2 + p)
        scale.setScalar(Math.max(s, 0.0001))
        instances.setMatrixAt(k++, matrix.compose(position, rotation, scale))
      }
    }
    instances.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      key={puffs}
      ref={mesh}
      args={[geometry, material, chimneys.length * puffs]}
      frustumCulled={false}
      castShadow={false}
      receiveShadow={false}
    />
  )
}

const AXIS = new Vector3(0.3, 1, 0.2).normalize()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const matrix = new Matrix4()
