import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three"
import { positions, useGuild } from "../../guild/useGuild.ts"
import { LIGHTS } from "../../world/lights.ts"
import { sky } from "../atmosphere/state.ts"
import { mergePlacements, useKit } from "../Kit.tsx"

/**
 * The island's night lights (world/lights.ts): the torch posts and lanterns themselves, merged into
 * a few static meshes, and a warm pool of light on the ground under each — one additive instanced
 * draw that wakes with `sky.lamps` (faint by day, full at night). The flames' halos are drawn by
 * scene/atmosphere/Lamps with the hall's own torches. No dynamic lights: on a big island a few
 * dozen point lights would cost every lit pixel; pools and halos read the same and cost one draw.
 */
export function StreetLights() {
  const kit = useKit()
  const models = useMemo(
    () =>
      mergePlacements(
        kit,
        LIGHTS.map((l) => l.placement),
      ),
    [kit],
  )
  return (
    <group>
      {models.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      <Pools />
      <Followers />
    </group>
  )
}

function Pools() {
  const { mood } = useGuild()
  const mesh = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        map: pool(),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    [],
  )
  const fire = useMemo(() => new Color(), [])

  useFrame(({ clock }) => {
    const instances = mesh.current
    if (!instances) return
    // Firelight, pushed towards orange: additive yellow on the island's green grass reads lime.
    fire.set(mood.fire).lerp(EMBER, 0.6)
    const t = clock.elapsedTime
    for (let i = 0; i < LIGHTS.length; i++) {
      const light = LIGHTS[i]
      if (!light) continue
      const flicker = 0.93 + Math.sin(t * 7.3 + i * 1.9) * 0.04 + Math.sin(t * 12.1 + i) * 0.03
      const size = light.pool * 2 * flicker
      matrix.compose(position.set(light.flame[0], 0.06, light.flame[2]), flat, scale.set(size, 1, size))
      instances.setMatrixAt(i, matrix)
      // A whisper by day, a warm pool at night.
      tint.copy(fire).multiplyScalar(sky.lamps * 0.42 * flicker)
      instances.setColorAt(i, tint)
    }
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, LIGHTS.length]}
      frustumCulled={false}
      renderOrder={9}
    />
  )
}

/** Adventurers' lanterns: a smaller pool that walks with each of them after dark. */
const MAX_FOLLOWERS = 40
function Followers() {
  const { mood } = useGuild()
  const mesh = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        map: pool(),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    [],
  )
  const fire = useMemo(() => new Color(), [])

  useFrame(({ clock }) => {
    const instances = mesh.current
    if (!instances) return
    fire.set(mood.fire).lerp(EMBER, 0.6)
    const glow = Math.max(0, sky.lamps - 0.3) / 0.7
    let i = 0
    for (const [id, at] of positions) {
      if (i >= MAX_FOLLOWERS) break
      const flicker = 0.92 + Math.sin(clock.elapsedTime * 9 + id.length + i) * 0.05
      matrix.compose(position.set(at.x, 0.07, at.z), flat, scale.set(5, 1, 5))
      instances.setMatrixAt(i, matrix)
      instances.setColorAt(i, tint.copy(fire).multiplyScalar(glow * 0.32 * flicker))
      i++
    }
    instances.count = i
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, MAX_FOLLOWERS]}
      frustumCulled={false}
      renderOrder={9}
    />
  )
}

const EMBER = new Color("#ff7a2e")
const flat = new Quaternion()
const matrix = new Matrix4()
const position = new Vector3()
const scale = new Vector3()
const tint = new Color()

/** A soft disc: bright under the flame, fading to nothing at the rim. */
function pool(): CanvasTexture {
  const size = 64
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, "rgba(255,255,255,0.9)")
    gradient.addColorStop(0.35, "rgba(255,255,255,0.45)")
    gradient.addColorStop(0.7, "rgba(255,255,255,0.12)")
    gradient.addColorStop(1, "rgba(255,255,255,0)")
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
