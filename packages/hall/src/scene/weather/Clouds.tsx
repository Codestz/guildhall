import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import {
  type BufferGeometry,
  Color,
  InstancedMesh,
  type Material,
  MathUtils,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type OrthographicCamera,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import { LANDS_URL } from "../../world/cast.ts"
import { sky } from "../atmosphere/state.ts"
import { WIND_DIRECTION, wind } from "../atmosphere/wind.ts"
import { plain } from "../Kit.tsx"
import { useOwnedMeshes } from "../owned.ts"
import { EASE } from "./shared.ts"

/** Clouds per piece at each quality tier (two pieces: two draw calls, Explore only). */
const COUNT: Record<Tier, number> = { 0: 12, 1: 20, 2: 32, 3: 40 }
/** Clouds wander a square this many units each way from the island's centre, and wrap round. */
const SPAN = 480
/** They show only in a ring round the island: from beyond its coast out to before the wrap. */
const RING = [230, 280, 410, 460] as const
const ALTITUDE = [38, 72] as const
const SCALE = [20, 34] as const
/** Fade out this close to the camera (units), and below this far under the horizon (ray y). */
const NEAR = [140, 210] as const
const HORIZON = [-0.08, 0.01] as const
/** World units per second at full wind. */
const DRIFT = 9
const WHITE = new Color("#ffffff")
const GREY = new Color("#a3abb5")

interface Cloud {
  /** Where it starts, on the wind's axes (along, across), in world units. */
  along: number
  across: number
  y: number
  scale: number
  turn: number
  /** 0–1: grows in as cover rises, shrinks away as it falls. */
  presence: number
}

/**
 * KayKit clouds, only where they read as sky (finding #1 of the design review): far out beyond the
 * coast, high, at the horizon of the Explore view. The Diorama looks down at the island, so there
 * the clouds show only as their shadows (the grade, atmosphere/GradeEffect.ts) and these meshes
 * aren't drawn at all. Instanced (one draw call per piece), drifting with the wind, as many as the
 * cloud cover asks for; each grows in or shrinks away rather than popping, and fades near the camera
 * and below the horizon so none ever hangs between the eye and the island. Unfogged and lit by the
 * sky's own colour: white by day, grey towards a storm, faint and sky-tinted at night.
 */
export function Clouds({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const count = COUNT[tier]
  // Built per mount and tier (scene/owned.ts): own geometry and see-through material copies; the
  // pack's textures are borrowed.
  const built = useOwnedMeshes(
    () => {
      const flock = flockOf(nodes, count)
      for (const { mesh } of flock) {
        mesh.frustumCulled = false
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.visible = false
      }
      return { meshes: flock.map(({ mesh }) => mesh), flock }
    },
    [nodes, count],
    "textures",
  )
  const state = useMemo(() => ({ drift: 0, cover: 0 }), [])

  useFrame(({ camera }, delta) => {
    const env = store.environment
    state.cover = MathUtils.damp(state.cover, env.cloudCover, EASE, delta)
    state.drift = (state.drift + DRIFT * (0.15 + wind.strength) * delta) % (SPAN * 2)
    if (!built) return
    // Only the Explore view looks out at the horizon; the Diorama never sees these (no draw call).
    const shown = store.view === "explore" && !(camera as OrthographicCamera).isOrthographicCamera
    const grey = MathUtils.smoothstep(state.cover, 0.6, 1)
    const night = sky.night
    for (const { mesh, clouds } of built.flock) {
      mesh.visible = shown
      if (!shown) continue
      const material = mesh.material as MeshStandardMaterial
      // Lit light by day, barely at night: what's left is the sky's own colour (emissive), a shade
      // lighter than the dome behind it, so at night a cloud is a faint veil, never a dark slab.
      material.color
        .copy(WHITE)
        .lerp(GREY, grey)
        .multiplyScalar(1 - night * 0.8)
      material.emissive
        .copy(sky.horizon)
        .lerp(sky.zenith, 0.25)
        .multiplyScalar(0.3 + night * 1.1)
      material.opacity = (0.6 + 0.3 * MathUtils.smoothstep(state.cover, 0.1, 0.8)) * (1 - night * 0.62)
      // The first `wanted` clouds of each piece are out; the next one partly, as cover rises.
      const wanted = (0.25 + state.cover) * clouds.length * 0.8
      clouds.forEach((cloud, i) => {
        const goal = MathUtils.clamp(wanted - i, 0, 1)
        cloud.presence = MathUtils.damp(cloud.presence, goal, EASE, delta)
        const along = wrap(cloud.along + state.drift)
        position
          .copy(WIND_DIRECTION)
          .multiplyScalar(along)
          .addScaledVector(ACROSS, cloud.across)
          .setY(cloud.y)
        // In the ring only: never over the island, gone before the wrap at the square's edge.
        const radius = Math.hypot(position.x, position.z)
        const ring =
          MathUtils.smoothstep(radius, RING[0], RING[1]) *
          (1 - MathUtils.smoothstep(radius, RING[2], RING[3]))
        // Never near the eye, and never seen against the ground: only at or above the horizon.
        ray.subVectors(position, camera.position)
        const distance = ray.length()
        const near = MathUtils.smoothstep(distance, NEAR[0], NEAR[1])
        const horizon = MathUtils.smoothstep(ray.y / (distance || 1), HORIZON[0], HORIZON[1])
        rotation.setFromAxisAngle(UP, cloud.turn)
        scale.setScalar(cloud.scale * cloud.presence * ring * near * horizon)
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale))
      })
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

/** Each cloud piece as an InstancedMesh of `count`, with every cloud's seeded place. */
function flockOf(nodes: Record<string, Object3D>, count: number): { mesh: InstancedMesh; clouds: Cloud[] }[] {
  const random = seeded(7)
  return (["cloud_big", "cloud_small"] as const).flatMap((piece) => {
    const source = nodes[piece]
    if (!source) return []
    return merged(source).map(({ geometry, material }) => ({
      mesh: new InstancedMesh(geometry, material, count),
      clouds: Array.from(
        { length: count },
        (): Cloud => ({
          along: (random() * 2 - 1) * SPAN,
          across: (random() * 2 - 1) * SPAN,
          y: MathUtils.lerp(ALTITUDE[0], ALTITUDE[1], random()),
          scale: MathUtils.lerp(SCALE[0], SCALE[1], random()) * (piece === "cloud_big" ? 1 : 0.8),
          turn: random() * Math.PI * 2,
          presence: 0,
        }),
      ),
    }))
  })
}

/** Into [-SPAN, SPAN). */
function wrap(value: number): number {
  return ((((value + SPAN) % (SPAN * 2)) + SPAN * 2) % (SPAN * 2)) - SPAN
}

const ray = new Vector3()
const UP = new Vector3(0, 1, 0)
const ACROSS = new Vector3().crossVectors(UP, WIND_DIRECTION).normalize()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
const matrix = new Matrix4()

/** The piece's parts in its own space, merged per material; each material copied see-through. */
function merged(source: Object3D): { geometry: BufferGeometry; material: Material }[] {
  source.updateMatrixWorld(true)
  const inverse = source.matrixWorld.clone().invert()
  const parts = new Map<Material, BufferGeometry[]>()
  source.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const geometry = plain(mesh.geometry).applyMatrix4(inverse.clone().multiply(mesh.matrixWorld))
    const material = mesh.material as Material
    parts.set(material, [...(parts.get(material) ?? []), geometry])
  })
  return [...parts].flatMap(([material, geometries]) => {
    const geometry = mergeGeometries(geometries)
    if (!geometry) return []
    const copy = material.clone()
    copy.transparent = true
    copy.depthWrite = false
    // Far beyond the fog's radius: fogged, they'd be flat haze-coloured shapes against the sky.
    ;(copy as MeshStandardMaterial).fog = false
    return [{ geometry, material: copy }]
  })
}

/** mulberry32: the same sky every visit. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
