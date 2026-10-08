import { useGLTF } from "@react-three/drei"
import {
  BatchedMesh,
  type BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { Tier } from "../../guild/quality.ts"
import type { Spot } from "../../world/layout.ts"
import { useWorld } from "../../world/source.ts"
import { type Wild, type WildKind, type WildPiece, wilds, wildsOf } from "../../world/wilds.ts"
import type { World } from "../../world/world.ts"
import { wind } from "../atmosphere/wind.ts"
import { plain } from "../Kit.tsx"
import { PILES } from "../life/places.ts"
import { ROUNDS } from "../life/rounds.ts"
import { useOwnedMeshes } from "../owned.ts"
import { tameLime } from "../palette.ts"
import { WIND_SWAY } from "./shaders.ts"

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
const HAND = wilds(KEEP)
/** A world's wilds: the hand map's (clear of the villagers' rounds), or a repo island's. */
const grown = new WeakMap<World, readonly Wild[]>()
function wildsFor(world: World): readonly Wild[] {
  if (world.kind === "hand") return HAND
  let known = grown.get(world)
  if (!known) {
    known = wildsOf(world)
    grown.set(world, known)
  }
  return known
}

/** The highest `detail` each tier draws (world/wilds.ts `Wild.detail`). */
const DETAIL: Record<Tier, number> = { 0: 0, 1: 1, 2: 2, 3: 2 }
/** How much each kind bends in the wind (0: rocks stand still). */
const SWAY: Record<WildKind, number> = { tree: 0.5, bush: 0.8, rock: 0, grass: 4 }

export function Wilds({ tier }: { tier: Tier }) {
  const { nodes } = useGLTF(FOREST_URL) as unknown as { nodes: Record<string, Object3D> }
  const all = wildsFor(useWorld())
  // Material and batches are this mount's own (scene/owned.ts); the pack's texture is borrowed.
  const built = useOwnedMeshes(
    () => {
      const material = swayMaterial(nodes)
      const list = all.filter((w) => w.detail <= DETAIL[tier])
      return { meshes: material ? build(nodes, material, list) : [] }
    },
    [nodes, tier, all],
    "textures",
  )

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

/**
 * The pack's material, softened like the island's, with the shared wind sway (nature/shaders.ts
 * WIND_SWAY) added to the vertex shader: each vertex bends downwind by its height² (roots stay put),
 * phased by where the instance stands.
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
  // Calm the pack's lime greens like the island's (scene/palette.ts); other colours stay true.
  tameLime(material.map)
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind.uniforms)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float aSway;\n${WIND_SWAY}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
#ifdef USE_BATCHING
  {
    vec3 root = batchingMatrix[3].xyz;
    float bend = aSway * swayPlant(root.xz, max(transformed.y, 0.0));
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
