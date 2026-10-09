import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import {
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { hash } from "../../guild/traces.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { island } from "../../world/lands.ts"
import { WIND_DIRECTION, wind } from "../atmosphere/wind.ts"
import { useOwnedMeshes } from "../owned.ts"
import { life } from "./state.ts"

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
  // Rounder puffs, softly see-through, a little grey-blue: low-poly smoke, not white dice.
  const built = useOwnedMeshes(() => {
    const material = new MeshStandardMaterial({
      color: "#d9dde3",
      roughness: 1,
      flatShading: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    })
    const mesh = new InstancedMesh(new IcosahedronGeometry(0.5, 1), material, chimneys.length * puffs)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    return { meshes: [mesh] }
  }, [chimneys, puffs])
  const state = useMemo(() => ({ cold: 0, wet: 0, time: 0 }), [])

  useFrame((_, delta) => {
    const instances = built?.meshes[0]
    if (!instances) return
    const env = store.environment
    const dt = Math.min(delta, 0.1)
    state.time += dt
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
        const bend = wind.strength * 4.5 * age ** 1.5
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

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

const AXIS = new Vector3(0.3, 1, 0.2).normalize()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const matrix = new Matrix4()
