import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useState } from "react"
import {
  BatchedMesh,
  type BufferGeometry,
  Color,
  Float32BufferAttribute,
  MathUtils,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector2,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { Tier } from "../../guild/quality.ts"
import { useGuildStore } from "../../guild/useGuild.ts"
import type { Spot } from "../../world/layout.ts"
import { type Wild, type WildKind, type WildPiece, wilds } from "../../world/wilds.ts"
import { shadows } from "../atmosphere/shadows.ts"
import { plain } from "../Kit.tsx"
import { PILES } from "../life/places.ts"
import { ROUNDS } from "../life/rounds.ts"
import { EASE, WIND_DIRECTION } from "../weather/shared.ts"

export const FOREST_URL = `${import.meta.env.BASE_URL}assets/forest.glb`
useGLTF.preload(FOREST_URL)

/**
 * The wilds (ADR 0007, Nature): character-scale trees, bushes, rocks and grass from the Forest
 * Nature Pack, placed by world/wilds.ts. The pack has one material, so everything is two
 * BatchedMeshes — what casts a shadow (trees, big bushes and rocks: static, so they join the
 * on-demand shadow map) and the low fill that doesn't — two draw calls, plus one in a shadow redraw.
 * Plants sway in the vertex shader with the wind; rocks don't. Low quality keeps only the big pieces.
 */

/** Where villagers walk and traces pile up (scene/life): the wilds keep off it. */
const KEEP = {
  paths: ROUNDS.map((round) => [round.door, ...round.stops, round.door].map((s): Spot => [s.x, s.z])),
  spots: Object.values(PILES).map((pile): Spot => [pile.x, pile.z]),
}
const ALL = wilds(KEEP)

/** The highest `detail` each tier draws (world/wilds.ts `Wild.detail`). */
const DETAIL: Record<Tier, number> = { 0: 0, 1: 1, 2: 2, 3: 2 }
/** How much each kind bends in the wind (0: rocks stand still). */
const SWAY: Record<WildKind, number> = { tree: 0.5, bush: 0.8, rock: 0, grass: 4 }
/** The same cool grey-green the island's hex pieces are multiplied by (scene/Island.tsx). */
const SOFTEN = new Color("#bdd3c6")

export function Wilds({ tier }: { tier: Tier }) {
  const store = useGuildStore()
  const { nodes } = useGLTF(FOREST_URL) as unknown as { nodes: Record<string, Object3D> }
  const material = useMemo(() => swayMaterial(nodes), [nodes])
  const [meshes, setMeshes] = useState<readonly BatchedMesh[]>([])
  const eased = useMemo(() => ({ wind: 0.2 }), [])

  // Built and freed by the same effect: a BatchedMesh can't be used after dispose() (its matrix
  // texture is gone), so it must never outlive a cleanup, e.g. StrictMode's double effect run.
  useEffect(() => {
    const built = material ? build(nodes, material, ALL.filter((w) => w.detail <= DETAIL[tier])) : []
    setMeshes(built)
    shadows.request()
    return () => {
      for (const mesh of built) mesh.dispose()
      shadows.request()
    }
  }, [nodes, material, tier])
  useEffect(() => () => material?.dispose(), [material])

  useFrame((state, delta) => {
    if (!material) return
    eased.wind = MathUtils.damp(eased.wind, store.environment.wind, EASE, delta)
    const u = material.userData.uniforms as Uniforms
    u.uTime.value = state.clock.elapsedTime
    u.uWind.value = eased.wind
  })

  return (
    <>
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

interface Uniforms {
  uTime: { value: number }
  uWind: { value: number }
  uWindDir: { value: Vector2 }
}

/**
 * The pack's material, softened like the island's, with a wind sway added to the vertex shader:
 * each vertex bends downwind by its height² (roots stay put), phased by where the instance stands.
 */
function swayMaterial(nodes: Record<string, Object3D>): MeshStandardMaterial | null {
  let source: MeshStandardMaterial | null = null
  for (const node of Object.values(nodes))
    node.traverse((child) => {
      const mesh = child as Mesh
      if (mesh.isMesh && !source) source = mesh.material as MeshStandardMaterial
    })
  if (!source) return null
  const material = (source as MeshStandardMaterial).clone()
  material.color.multiply(SOFTEN)
  const uniforms: Uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.2 },
    uWindDir: { value: new Vector2(WIND_DIRECTION.x, WIND_DIRECTION.z) },
  }
  material.userData.uniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aSway;\nuniform float uTime;\nuniform float uWind;\nuniform vec2 uWindDir;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_BATCHING
  {
    vec3 root = batchingMatrix[3].xyz;
    float h = max(transformed.y, 0.0);
    float phase = uTime * 1.7 + dot(root.xz, vec2(0.23, 0.17));
    float bend = aSway * h * h * 0.03 * (0.25 + uWind) * (0.65 * sin(phase) + 0.35 * sin(phase * 2.3 + 1.0));
    // World wind direction into the instance's own (rotated, scaled) space.
    vec3 local = transpose(mat3(batchingMatrix)) * vec3(uWindDir.x, 0.0, uWindDir.y);
    transformed += local / dot(batchingMatrix[0].xyz, batchingMatrix[0].xyz) * bend;
  }
#endif`,
      )
  }
  material.customProgramCacheKey = () => "wilds-sway"
  return material
}

/** One piece's geometry (plain floats, in the piece's own space) with its sway weight. */
function geometryOf(source: Object3D, sway: number): BufferGeometry | null {
  source.updateMatrixWorld(true)
  const inverse = source.matrixWorld.clone().invert()
  const parts: BufferGeometry[] = []
  source.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh) parts.push(plain(mesh.geometry).applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)))
  })
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts)
  if (!geometry) return null
  if (geometry !== parts[0]) for (const part of parts) part.dispose()
  const count = geometry.getAttribute("position").count
  geometry.setAttribute("aSway", new Float32BufferAttribute(new Float32Array(count).fill(sway), 1))
  return geometry
}

/** Trees, and bushes and rocks big enough to throw a readable shadow. */
const casts = (wild: Wild): boolean => wild.kind === "tree" || (wild.kind !== "grass" && wild.detail === 0)

/** The wilds as two BatchedMeshes: shadow casters, and the low fill. */
function build(
  nodes: Record<string, Object3D>,
  material: MeshStandardMaterial,
  list: readonly Wild[],
): BatchedMesh[] {
  const geometries = new Map<WildPiece, BufferGeometry | null>()
  const geometry = (wild: Wild) => {
    if (!geometries.has(wild.piece)) {
      const source = nodes[wild.piece]
      geometries.set(wild.piece, source ? geometryOf(source, SWAY[wild.kind]) : null)
    }
    return geometries.get(wild.piece) ?? null
  }

  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)
  const out: BatchedMesh[] = []
  for (const cast of [true, false]) {
    const group = list.filter((wild) => casts(wild) === cast && geometry(wild))
    if (group.length === 0) continue
    const used = new Map<BufferGeometry, number>()
    for (const wild of group) used.set(geometry(wild) as BufferGeometry, -1)
    let vertices = 0
    let indices = 0
    for (const g of used.keys()) {
      vertices += g.getAttribute("position").count
      indices += g.getIndex()?.count ?? 0
    }
    const mesh = new BatchedMesh(group.length, vertices, indices, material)
    for (const g of used.keys()) used.set(g, mesh.addGeometry(g))
    for (const wild of group) {
      const id = mesh.addInstance(used.get(geometry(wild) as BufferGeometry) ?? 0)
      position.set(wild.x, wild.y, wild.z)
      rotation.setFromAxisAngle(up, wild.rot)
      scale.setScalar(wild.scale)
      mesh.setMatrixAt(id, matrix.compose(position, rotation, scale))
    }
    mesh.name = cast ? "nature-wilds" : "nature-wilds-fill"
    // Opaque and depth-tested: sorting would only cost CPU every frame. Culling stays on.
    mesh.sortObjects = false
    mesh.castShadow = cast
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    out.push(mesh)
  }
  for (const g of geometries.values()) g?.dispose()
  return out
}
