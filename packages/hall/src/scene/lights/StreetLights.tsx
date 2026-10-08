import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three"
import { useGuild } from "../../guild/useGuild.ts"
import { type Glow, glowsOf, lightsOf } from "../../world/lights.ts"
import { useWorld } from "../../world/source.ts"
import { halos } from "../atmosphere/Lamps.tsx"
import { sky } from "../atmosphere/state.ts"
import { mergePlacements, useKit } from "../Kit.tsx"
import { useOwnedMeshes } from "../owned.ts"
import { AFTER_POSE, carried, flicker, litGlass, nightGlow, track } from "./carried.ts"

/**
 * The island's night lights (world/lights.ts): the torch posts and lanterns themselves, merged into
 * a few static meshes, and a warm pool of light on the ground under each — one additive instanced
 * draw that wakes with `sky.lamps` (faint by day, full at night). The flames' halos are drawn by
 * scene/atmosphere/Lamps with the hall's own torches. No dynamic lights: on a big island a few
 * dozen point lights would cost every lit pixel; pools and halos read the same and cost one draw.
 */
export function StreetLights() {
  const kit = useKit()
  const world = useWorld()
  const lights = lightsOf(world)
  // Merged geometry is ours; the kit's materials are borrowed (scene/owned.ts).
  const models = useOwnedMeshes(
    () => ({
      meshes: mergePlacements(
        kit,
        lights.map((l) => l.placement),
      ),
    }),
    [kit, lights],
    "materials",
  )
  return (
    <group>
      {models?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      <Pools glows={glowsOf(world)} />
      <Carried />
    </group>
  )
}

function Pools({ glows }: { glows: readonly Glow[] }) {
  const { mood } = useGuild()
  const built = useOwnedMeshes(() => ({ meshes: [pools(glows.length)] }), [glows])
  const fire = useMemo(() => new Color(), [])

  useFrame(({ clock }) => {
    const instances = built?.meshes[0]
    if (!instances) return
    // Firelight, pushed towards orange: additive yellow on the island's green grass reads lime.
    fire.set(mood.fire).lerp(EMBER, 0.6)
    const t = clock.elapsedTime
    for (let i = 0; i < glows.length; i++) {
      const light = glows[i]
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

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

/** At most this many lanterns carried at once (adventurers after dark, the guards, the watchman). */
const MAX_CARRIED = 32
/** A carried lantern's halo, a little smaller than a street lantern's (world/lights.ts: 3.4). */
const CARRIED_HALO = 2.6
/** Its pool's width on the ground (a street lantern's is 9.6). */
const CARRIED_POOL = 6

/**
 * Carried lanterns (scene/lights/carried.ts): a flame halo where each lantern swings, the street
 * lanterns' own look (atmosphere/Lamps `halos`), and a warm pool on the ground under it, as warm as
 * a street lantern's; their glass glows too. Two draws for all of them; nothing by day; still
 * under reduced motion. Runs after the pose (`AFTER_POSE`), so the halo is where the hand is now.
 */
function Carried() {
  const { mood } = useGuild()
  const built = useOwnedMeshes(() => {
    const meshes = [halos(MAX_CARRIED), pools(MAX_CARRIED)]
    for (const mesh of meshes) {
      // The colour buffer from the start: made on the first lantern lit, it would recompile both.
      mesh.setColorAt(0, tint.setRGB(0, 0, 0))
      mesh.count = 0
    }
    return { meshes }
  }, [])
  const fire = useMemo(() => new Color(), [])
  const ember = useMemo(() => new Color(), [])
  const still = useStill()

  useFrame(({ camera, clock }) => {
    const halo = built?.meshes[0]
    const ground = built?.meshes[1]
    if (!(halo instanceof InstancedMesh) || !(ground instanceof InstancedMesh)) return
    track()
    const glow = nightGlow(sky.lamps)
    fire.set(mood.fire)
    ember.copy(fire).lerp(EMBER, 0.6)
    litGlass.set(glow, fire)
    camera.getWorldQuaternion(facing)
    const t = clock.elapsedTime
    let i = 0
    if (glow > 0)
      for (const lantern of carried) {
        if (i >= MAX_CARRIED) break
        if (!lantern.lit) continue
        const breath = flicker(t, lantern.phase, still.current)
        const size = CARRIED_HALO * (0.8 + glow * 0.35) * breath
        matrix.compose(lantern.at, facing, scale.set(size, size, size))
        halo.setMatrixAt(i, matrix)
        halo.setColorAt(i, tint.copy(fire).multiplyScalar(glow * 1.6 * breath))
        const wide = CARRIED_POOL * breath
        matrix.compose(
          position.set(lantern.at.x, lantern.ground + 0.07, lantern.at.z),
          flat,
          scale.set(wide, 1, wide),
        )
        ground.setMatrixAt(i, matrix)
        ground.setColorAt(i, tint.copy(ember).multiplyScalar(glow * 0.42 * breath))
        i++
      }
    shown(halo, i)
    shown(ground, i)
  }, AFTER_POSE)

  return built?.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />) ?? null
}

/** The first `count` instances are drawn, as just written. */
function shown(mesh: InstancedMesh, count: number): void {
  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

/** prefers-reduced-motion, kept current by its change event (never asked per frame). */
function useStill(): { readonly current: boolean } {
  const still = useRef(false)
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    if (!query) return
    still.current = query.matches
    const change = (event: MediaQueryListEvent) => {
      still.current = event.matches
    }
    query.addEventListener("change", change)
    return () => query.removeEventListener("change", change)
  }, [])
  return still
}

/** `count` warm pools on the ground: one additive instanced draw, over the ground (renderOrder 9). */
function pools(count: number): InstancedMesh {
  const material = new MeshBasicMaterial({
    map: pool(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  })
  const mesh = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, count)
  mesh.frustumCulled = false
  mesh.renderOrder = 9
  return mesh
}

const EMBER = new Color("#ff7a2e")
const facing = new Quaternion()
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
