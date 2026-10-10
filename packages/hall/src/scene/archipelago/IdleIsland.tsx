import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three"
import { useGuildStore } from "../../guild/useGuild.ts"
import { LANDS_URL } from "../../world/cast.ts"
import { HEX_SCALE } from "../../world/lands.ts"
import { glowsOf, lightsOf } from "../../world/lights.ts"
import { useWorld } from "../../world/source.ts"
import { halos } from "../atmosphere/Lamps.tsx"
import { sky } from "../atmosphere/state.ts"
import { bakeNode } from "../events/common.ts"
import { mergePlacements, useKit } from "../Kit.tsx"
import { Pools } from "../lights/StreetLights.tsx"
import { useBridgeWalls, useIslandQuays } from "../links/useLinkNet.ts"
import { useOwnedMeshes } from "../owned.ts"
import { watersOf } from "../Ships.tsx"
import { harbourOf, lighthouseSpot } from "../seas/fleet.ts"

/**
 * A far island's night lights: its lanterns and torch posts (merged), a pool under each and a
 * halo on each flame, waking with `sky.lamps` — the home island's look (lights/StreetLights.tsx,
 * atmosphere/Lamps.tsx), without the carried lanterns or the point lights (nobody walks there).
 */
export function IdleLights({ near }: { near: boolean }) {
  const kit = useKit()
  const world = useWorld()
  const lights = lightsOf(world)
  const glows = glowsOf(world)
  const models = useOwnedMeshes(
    () => {
      const meshes = mergePlacements(
        kit,
        lights.map((light) => light.placement),
      )
      for (const mesh of meshes) mesh.castShadow = false
      return { meshes }
    },
    [kit, lights],
    "materials",
  )
  const flames = useOwnedMeshes(() => ({ meshes: [halos(glows.length)] }), [glows])
  const store = useGuildStore()
  useFrame(({ camera, clock }) => {
    const mesh = flames?.meshes[0] as ReturnType<typeof halos> | undefined
    if (!mesh) return
    camera.getWorldQuaternion(facing)
    tint.set(store.mood.fire)
    const t = clock.elapsedTime
    for (let i = 0; i < glows.length; i++) {
      const glow = glows[i]
      if (!glow) continue
      const flicker = 0.88 + Math.sin(t * 9.1 + i * 1.7) * 0.06 + Math.sin(t * 15.7 + i * 3.4) * 0.05
      const size = glow.halo * (0.8 + sky.lamps * 0.35) * flicker
      matrix.compose(
        place.set(glow.flame[0], glow.flame[1], glow.flame[2]),
        facing,
        scale.set(size, size, size),
      )
      mesh.setMatrixAt(i, matrix)
      mesh.setColorAt(i, colour.copy(tint).multiplyScalar(flicker * (0.1 + sky.lamps * 1.6)))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })
  return (
    <group name="idle-lights">
      {/* The lanterns' own meshes are most of an island's lights: drawn only up close, where they read. */}
      <group visible={near}>
        {models?.meshes.map((mesh) => (
          <primitive key={mesh.uuid} object={mesh} />
        ))}
      </group>
      {flames?.meshes[0] && <primitive object={flames.meshes[0]} />}
      <Pools glows={glows} />
    </group>
  )
}

/** The lighthouse's lamp, over the tower's roof (scene/seas/SeasLayer.tsx's). */
const LAMP_Y = 11.8
const BEAM_LENGTH = 70

/**
 * A lighthouse on the coast by the island's harbour (scene/seas/fleet.ts `lighthouseSpot`), when
 * it has a coast to stand on: the tower, a lamp that wakes at dusk, and at night a beam sweeping
 * the sea. Three draws.
 */
export function Lighthouse() {
  const world = useWorld()
  const lands = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const walls = useBridgeWalls()
  const quays = useIslandQuays()
  const spot = useMemo(
    () => lighthouseSpot(world.island, harbourOf(watersOf(world).quay), { walls, quays }),
    [world, walls, quays],
  )
  const built = useOwnedMeshes(() => {
    const source = lands.nodes.building_tower_A_blue
    const baked = source ? bakeNode(source) : null
    if (!spot || !baked) return { meshes: [] as Mesh[], lamp: null, beam: null }
    const tower = new Mesh(
      baked.geometry,
      new MeshStandardMaterial({ map: baked.material.map, roughness: 0.9 }),
    )
    tower.position.set(spot.x, 0, spot.z)
    tower.scale.setScalar(HEX_SCALE)
    tower.rotation.y = Math.atan2(-spot.x, -spot.z)
    tower.castShadow = true
    tower.receiveShadow = true
    const lamp = new Mesh(new SphereGeometry(0.9, 12, 8), new MeshBasicMaterial({ toneMapped: false }))
    lamp.position.set(spot.x, LAMP_Y, spot.z)
    const cone = new ConeGeometry(7, BEAM_LENGTH, 20, 6, true)
    cone.translate(0, -BEAM_LENGTH / 2, 0)
    // Bright at the lamp, gone at the far end: additive, so a black vertex adds nothing.
    const along = cone.getAttribute("position")
    const fade = new Float32Array(along.count * 3)
    for (let i = 0; i < along.count; i++) fade.fill((1 + along.getY(i) / BEAM_LENGTH) ** 2, i * 3, i * 3 + 3)
    cone.setAttribute("color", new Float32BufferAttribute(fade, 3))
    cone.rotateX(-Math.PI / 2 + 0.06)
    const beam = new Mesh(
      cone,
      new MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        blending: AdditiveBlending,
        vertexColors: true,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    beam.position.copy(lamp.position)
    beam.renderOrder = 2
    beam.frustumCulled = false
    return { meshes: [tower, lamp, beam], lamp, beam }
  }, [lands.nodes, spot])

  useFrame(({ clock }) => {
    if (!built?.lamp || !built.beam) return
    const lamps = sky.lamps
    ;(built.lamp.material as MeshBasicMaterial).color
      .setRGB(0.25, 0.24, 0.27)
      .lerp(WARM, Math.min(1, lamps * 1.2))
    const beam = built.beam.material as MeshBasicMaterial
    built.beam.visible = sky.night > 0.15
    beam.opacity = 0.32 * sky.night
    built.beam.rotation.y = clock.elapsedTime * 0.5
  })

  return built?.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />) ?? null
}

const facing = new Quaternion()
const place = new Vector3()
const scale = new Vector3()
const matrix = new Matrix4()
const tint = new Color()
const colour = new Color()
/** The lighthouse lamp lit. */
const WARM = new Color("#ffcf7a").multiplyScalar(1.6)
