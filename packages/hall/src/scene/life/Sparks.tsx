import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import {
  BoxGeometry,
  Color,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three"
import { island } from "../../world/lands.ts"
import { life } from "./state.ts"
import { hash } from "./traces.ts"

/**
 * The smithy forges while implementers work at the yard (ADR 0007, Life): a shower of sparks
 * flies off the anvil on every hammer blow, a blow every ~0.7 s, faster with more implementers at
 * work. Unlit, HDR orange so bloom picks it up at night. One InstancedMesh.
 */
const COUNT = 36
const PER_BLOW = 7
/** The anvil's face, in the smithy's own units: in front of the forge's mouth. */
const ANVIL = { x: -0.22, y: 0.2, z: 0.58 }
const GRAVITY = 9

export function Sparks() {
  const at = useMemo(() => {
    const smithy = island().landmarks.find((mark) => mark.piece === "building_blacksmith_blue")
    if (!smithy) return null
    const rot = smithy.rot ?? 0
    const s = 5
    return new Vector3(
      smithy.x + (ANVIL.x * Math.cos(rot) + ANVIL.z * Math.sin(rot)) * s,
      ANVIL.y * s,
      smithy.z + (-ANVIL.x * Math.sin(rot) + ANVIL.z * Math.cos(rot)) * s,
    )
  }, [])
  const geometry = useMemo(() => new BoxGeometry(0.09, 0.09, 0.09), [])
  const material = useMemo(
    () => new MeshBasicMaterial({ color: new Color("#ffa640").multiplyScalar(4), toneMapped: false }),
    [],
  )
  const mesh = useRef<InstancedMesh>(null)
  const sparks = useMemo(
    () => ({
      age: new Float32Array(COUNT).fill(9),
      life: new Float32Array(COUNT),
      p: new Float32Array(COUNT * 3),
      v: new Float32Array(COUNT * 3),
      next: 0,
      clock: 0,
      blows: 0,
    }),
    [],
  )

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((_, delta) => {
    const instances = mesh.current
    if (!instances || !at) return
    const dt = Math.min(delta, 0.05)
    if (life.forging > 0) {
      sparks.clock += dt * (1 + Math.min(life.forging - 1, 2) * 0.35)
      if (sparks.clock > 0.7) {
        sparks.clock = 0
        sparks.blows++
        for (let n = 0; n < PER_BLOW; n++) {
          const i = sparks.next
          sparks.next = (sparks.next + 1) % COUNT
          const seed = sparks.blows * 31 + n
          const angle = hash(seed) * Math.PI * 2
          const out = 1 + hash(seed + 1) * 2.2
          sparks.age[i] = 0
          sparks.life[i] = 0.35 + hash(seed + 2) * 0.45
          sparks.p[i * 3] = at.x
          sparks.p[i * 3 + 1] = at.y
          sparks.p[i * 3 + 2] = at.z
          sparks.v[i * 3] = Math.cos(angle) * out
          sparks.v[i * 3 + 1] = 2.5 + hash(seed + 3) * 2.5
          sparks.v[i * 3 + 2] = Math.sin(angle) * out
        }
      }
    }
    for (let i = 0; i < COUNT; i++) {
      const age = (sparks.age[i] ?? 9) + dt
      sparks.age[i] = age
      const span = sparks.life[i] ?? 0
      const alive = age < span
      if (alive) {
        sparks.v[i * 3 + 1] = (sparks.v[i * 3 + 1] ?? 0) - GRAVITY * dt
        for (let a = 0; a < 3; a++)
          sparks.p[i * 3 + a] = (sparks.p[i * 3 + a] ?? 0) + (sparks.v[i * 3 + a] ?? 0) * dt
      }
      position.set(sparks.p[i * 3] ?? 0, sparks.p[i * 3 + 1] ?? 0, sparks.p[i * 3 + 2] ?? 0)
      scale.setScalar(alive ? 1 - age / span : 0.0001)
      instances.setMatrixAt(i, matrix.compose(position, IDENTITY, scale))
    }
    instances.instanceMatrix.needsUpdate = true
  })

  if (!at) return null
  return <instancedMesh ref={mesh} args={[geometry, material, COUNT]} frustumCulled={false} />
}

const IDENTITY = new Quaternion()
const position = new Vector3()
const scale = new Vector3()
const matrix = new Matrix4()
