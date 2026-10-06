import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { useOwnedMeshes } from "../owned.ts"
import { hash } from "./traces.ts"

/**
 * Quiet ambience (ADR 0007, Life): a few birds wheel over the forest and the lake. They flap now
 * and then and glide between; they roost at night and in rain or storm. Small, dark, high and
 * slow, so nothing about them reads as an agent. One InstancedMesh, unlit.
 */
const COUNT: Record<Tier, number> = { 0: 5, 1: 7, 2: 9, 3: 12 }
const CENTRE = { x: -58, z: -4 }

export function Birds({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const count = COUNT[tier]
  const built = useOwnedMeshes(() => {
    const material = new MeshBasicMaterial({ color: "#2b2e33", side: DoubleSide })
    const mesh = new InstancedMesh(wing(), material, count)
    mesh.frustumCulled = false
    return { meshes: [mesh] }
  }, [count])
  const flock = useMemo(
    () =>
      Array.from({ length: COUNT[3] }, (_, i) => ({
        radius: 9 + hash(i + 1) * 12,
        height: 15 + hash(i + 2) * 7,
        speed: (0.16 + hash(i + 3) * 0.08) * (i % 3 === 0 ? -1 : 1),
        phase: hash(i + 4) * Math.PI * 2,
        flap: 7 + hash(i + 5) * 3,
        drift: hash(i + 6) * Math.PI * 2,
      })),
    [],
  )
  const state = useMemo(() => ({ out: 0, time: 0 }), [])

  useFrame((_, delta) => {
    const instances = built?.meshes[0]
    if (!instances) return
    const env = store.environment
    const dt = Math.min(delta, 0.1)
    state.time += dt
    const fair =
      MathUtils.smoothstep(env.daylight, 0.25, 0.6) * (1 - MathUtils.smoothstep(env.precipitation, 0.2, 0.5))
    state.out = MathUtils.damp(state.out, fair, 0.7, dt)
    const t = state.time
    for (let i = 0; i < count; i++) {
      const bird = flock[i]
      if (!bird) continue
      const angle = bird.phase + t * bird.speed
      // The circle itself drifts slowly, so the flock never traces the same ring twice.
      const cx = CENTRE.x + Math.cos(t * 0.03 + bird.drift) * 6
      const cz = CENTRE.z + Math.sin(t * 0.025 + bird.drift) * 8
      position.set(
        cx + Math.cos(angle) * bird.radius,
        bird.height + Math.sin(t * 0.4 + bird.phase) * 1.2,
        cz + Math.sin(angle) * bird.radius,
      )
      // Heading: along the circle; bank into the turn.
      const heading = Math.atan2(
        -Math.sin(angle) * Math.sign(bird.speed),
        Math.cos(angle) * Math.sign(bird.speed),
      )
      rotation.setFromAxisAngle(UP, heading)
      bank.setFromAxisAngle(FORWARD, -0.35 * Math.sign(bird.speed))
      rotation.multiply(bank)
      // Flap in bursts, glide between.
      const flapping = Math.sin(t * 0.5 + bird.phase * 3) > 0.1
      const beat = flapping ? Math.sin(t * bird.flap + bird.phase) : 0.15
      const size = 0.9 * state.out
      instances.setMatrixAt(i, matrix.compose(position, rotation, scale.set(size, size * beat, size)))
    }
    instances.count = state.out < 0.01 ? 0 : count
    instances.instanceMatrix.needsUpdate = true
  })

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)
const position = new Vector3()
const rotation = new Quaternion()
const bank = new Quaternion()
const scale = new Vector3()
const matrix = new Matrix4()

/** A bird as a shallow V, flying along +z: scaling y flaps the wings (negative = down-stroke). */
export function wing(): BufferGeometry {
  const geometry = new BufferGeometry()
  // body nose, tail, and the two wing tips (raised by 0.35, so y-scale bends them).
  const v = [
    [0, 0, 0.35],
    [0, 0, -0.3],
    [-1, 0.35, -0.1],
    [1, 0.35, -0.1],
  ]
  const tris = [0, 2, 1, 0, 1, 3]
  const data = new Float32Array(tris.flatMap((k) => v[k] ?? [0, 0, 0]))
  geometry.setAttribute("position", new Float32BufferAttribute(data, 3))
  geometry.computeVertexNormals()
  return geometry
}
