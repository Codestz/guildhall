import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
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
import { plain } from "../Kit.tsx"
import { EASE, seenWidth, targetOf, WIND_DIRECTION } from "./shared.ts"

/** Clouds per piece at each quality tier (two pieces: two draw calls). */
const COUNT: Record<Tier, number> = { 0: 6, 1: 10, 2: 14, 3: 18 }
/** Clouds wander a band this long across the wind, this wide along it, and wrap round. */
const SPAN = 300
const WIDTH = 220
const ALTITUDE = [24, 38] as const
const SCALE = [7, 12] as const
/** World units per second at full wind. */
const DRIFT = 9
const WHITE = new Color("#ffffff")
const GREY = new Color("#a3abb5")

interface Cloud {
  /** Across the wind, and along it (0–1 of SPAN, before drift). */
  across: number
  along: number
  y: number
  scale: number
  turn: number
  /** 0–1: grows in as cover rises, shrinks away as it falls. */
  presence: number
}

/**
 * KayKit clouds high over the island: instanced (one draw call per piece), drifting with the wind,
 * as many as the cloud cover asks for. Each grows in or shrinks away rather than popping; the
 * whole flock greys towards a storm. No shadows: they would cost a pass each.
 */
export function Clouds({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const count = COUNT[tier]
  const flock = useMemo(() => {
    const random = seeded(7)
    return (["cloud_big", "cloud_small"] as const).flatMap((piece) => {
      const source = nodes[piece]
      if (!source) return []
      return merged(source).map(({ geometry, material }) => ({
        mesh: new InstancedMesh(geometry, material, count),
        clouds: Array.from(
          { length: count },
          (): Cloud => ({
            across: (random() - 0.5) * WIDTH,
            along: random(),
            y: MathUtils.lerp(ALTITUDE[0], ALTITUDE[1], random()),
            scale: MathUtils.lerp(SCALE[0], SCALE[1], random()) * (piece === "cloud_big" ? 1 : 0.8),
            turn: random() * Math.PI * 2,
            presence: 0,
          }),
        ),
      }))
    })
  }, [nodes, count])

  useEffect(() => {
    for (const { mesh } of flock) {
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
    }
    return () => {
      for (const { mesh } of flock) {
        mesh.geometry.dispose()
        ;(mesh.material as Material).dispose()
        mesh.dispose()
      }
    }
  }, [flock])

  const state = useMemo(() => ({ drift: 0, cover: 0, wind: 0 }), [])

  useFrame(({ camera, controls, size }, delta) => {
    const env = store.environment
    const target = targetOf(controls)
    // Keep a window over what the camera looks at: clouds frame the view, never hide the guild.
    const clearance = seenWidth(camera, size, target) * 0.3
    const ortho = (camera as OrthographicCamera).isOrthographicCamera
    camera.getWorldDirection(look)
    state.cover = MathUtils.damp(state.cover, env.cloudCover, EASE, delta)
    state.wind = MathUtils.damp(state.wind, env.wind, EASE, delta)
    state.drift = (state.drift + (DRIFT * (0.15 + state.wind) * delta) / SPAN) % 1
    const grey = MathUtils.smoothstep(state.cover, 0.6, 1)
    for (const { mesh, clouds } of flock) {
      const material = mesh.material as MeshStandardMaterial
      material.color.copy(WHITE).lerp(GREY, grey)
      material.opacity = 0.55 + 0.3 * MathUtils.smoothstep(state.cover, 0.1, 0.8)
      // The first `wanted` clouds of each piece are out; the next one partly, as cover rises.
      const wanted = state.cover * clouds.length
      clouds.forEach((cloud, i) => {
        const goal = MathUtils.clamp(wanted - i, 0, 1)
        cloud.presence = MathUtils.damp(cloud.presence, goal, EASE, delta)
        const along = ((cloud.along + state.drift) % 1) - 0.5
        // Shrink near the ends of the band so the wrap is never seen.
        const edge = MathUtils.smoothstep(0.5 - Math.abs(along), 0, 0.12)
        position
          .copy(WIND_DIRECTION)
          .multiplyScalar(along * SPAN)
          .addScaledVector(ACROSS, cloud.across)
          .setY(cloud.y)
        const hidden = covering(position, camera.position, ortho ? look : undefined, target)
        const open = MathUtils.smoothstep(hidden, clearance * 0.8, clearance * 1.4)
        rotation.setFromAxisAngle(UP, cloud.turn)
        scale.setScalar(cloud.scale * cloud.presence * edge * open)
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale))
      })
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      {flock.map(({ mesh }) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

/**
 * How far from the target, on the ground, the point a cloud hides is: follow the line of sight
 * through the cloud down to y = 0. A cloud the camera looks up at hides nothing (Infinity).
 */
function covering(cloud: Vector3, eye: Vector3, forward: Vector3 | undefined, target: Vector3): number {
  ray.copy(forward ?? ray.subVectors(cloud, eye).normalize())
  if (ray.y >= -0.01) return Number.POSITIVE_INFINITY
  ground.copy(cloud).addScaledVector(ray, -cloud.y / ray.y)
  return Math.hypot(ground.x - target.x, ground.z - target.z)
}

const look = new Vector3()
const ray = new Vector3()
const ground = new Vector3()
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
