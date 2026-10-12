import { useGLTF } from "@react-three/drei"
import { useThree } from "@react-three/fiber"
import { use } from "react"
import {
  type BufferGeometry,
  Float32BufferAttribute,
  type Material,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
  type WebGLRenderer,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { Tier } from "../../guild/quality.ts"
import { isWebGPU } from "../../render/backend.ts"
import type { Placed } from "../../render/bake.ts"
import { coarser, loadSimplifier, type Simplifier } from "../../render/simplify.ts"
import { FAR_ERROR } from "../../render/tiers.ts"
import { type Chunks, chunksOf } from "../../world/chunks.ts"
import type { Spot } from "../../world/layout.ts"
import { useWorld } from "../../world/source.ts"
import { type Wild, type WildKind, type WildPiece, wilds, wildsOf } from "../../world/wilds.ts"
import type { World } from "../../world/world.ts"
import { wind } from "../atmosphere/wind.ts"
import { markGrowable, useGrowable } from "../growth/registry.ts"
import { plain } from "../Kit.tsx"
import { PILES } from "../life/places.ts"
import { ROUNDS } from "../life/rounds.ts"
import { useOwnedMeshes } from "../owned.ts"
import { tameLime } from "../palette.ts"
import {
  type TieredBatch,
  type TieredLayer,
  type TieredPiece,
  tiered,
  tieredBatch,
  tieredMerge,
  useTiered,
} from "../tiers.ts"
import { installNodes, TSL } from "../tsl.ts"
import { WIND_SWAY } from "./shaders.ts"

export const FOREST_URL = `${import.meta.env.BASE_URL}assets/forest.glb`
useGLTF.preload(FOREST_URL)
/** The far tier's simplifier (render/simplify.ts), fetched beside the pack. */
const SIMPLIFIER = loadSimplifier()

/**
 * The wilds (ADR 0007, Nature): character-scale trees, bushes, rocks and grass from the Forest
 * Nature Pack, placed by world/wilds.ts. The pack has one material, so everything is two
 * BatchedMeshes — what casts a shadow (trees, big bushes and rocks: static, so they join the
 * on-demand shadow map) and the low fill that doesn't — two draw calls, plus one in a shadow redraw.
 * Plants sway in the vertex shader with the wind; rocks don't. Low quality keeps only the big pieces.
 * On WebGPU (no multi-draw: a BatchedMesh there is a call per instance) each batch is one merged
 * mesh instead, every vertex carrying its instance's root and its own height (`aRoot`) for the sway.
 *
 * The sway is GLSL (onBeforeCompile) by default; on WebGPU, always, and on WebGL with `?tsl=1`
 * (scene/tsl.ts), the material is a node material swaying the same way (grassNodes.ts); it
 * suspends while that loads.
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
  const world = useWorld()
  const all = wildsFor(world)
  const simplifier = use(SIMPLIFIER)
  const gl = useThree((state) => state.gl)
  const webgpu = isWebGPU(gl)
  const sway = webgpu || TSL ? use(nodeSway(gl)) : glslSway
  // Material and batches are this mount's own (scene/owned.ts); the pack's texture is borrowed.
  const built = useOwnedMeshes(
    () => {
      const list = all.filter((w) => w.detail <= DETAIL[tier])
      return build(nodes, () => swayMaterial(nodes, sway), list, webgpu, simplifier, chunksOf(world))
    },
    [nodes, tier, all, sway, webgpu, simplifier, world],
    "textures",
  )
  // The growth timelapse (`?grow`) grows them once their land is up (scene/growth).
  useGrowable(built?.meshes)
  // Far regions draw coarse copies (scene/tiers.ts).
  useTiered(built?.tiers)

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

/** Makes a copy of the pack's (lime tamed) material sway: in place on the GLSL path, a node material on the other. */
type Sway = (material: MeshStandardMaterial) => Material

/**
 * The pack's material, softened like the island's, with the shared wind sway: each vertex bends
 * downwind by its height² (roots stay put), phased by where the instance stands.
 */
function swayMaterial(nodes: Record<string, Object3D>, sway: Sway): Material | null {
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
  return sway(material)
}

/** The GLSL sway (nature/shaders.ts WIND_SWAY), added to the standard material's vertex shader. */
function glslSway(material: MeshStandardMaterial): Material {
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

const nodeBuilds = new WeakMap<object, Promise<Sway>>()

/**
 * The node-material sway, once the renderer can draw it (one promise per renderer, for `use`).
 * WebGPU draws node materials natively; WebGL needs the nodes handler first.
 */
function nodeSway(gl: WebGLRenderer): Promise<Sway> {
  let sway = nodeBuilds.get(gl)
  if (!sway) {
    const ready = isWebGPU(gl) ? Promise.resolve() : installNodes(gl)
    sway = ready
      .then(() => import("./grassNodes.ts"))
      .then(({ wildsNodeMaterial }) => (material) => {
        const node = wildsNodeMaterial(material)
        // The copy shares the clone's map (the pack's: borrowed); the clone itself is done with.
        material.dispose()
        return node
      })
    nodeBuilds.set(gl, sway)
  }
  return sway
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

/**
 * The wilds as two BatchedMeshes (or, to `merge`, merged meshes per region): shadow casters, and
 * the low fill; each piece's coarse copy beside it for far regions (scene/tiers.ts).
 */
function build(
  nodes: Record<string, Object3D>,
  material: () => Material | null,
  list: readonly Wild[],
  merge: boolean,
  simplifier: Simplifier,
  chunks: Chunks,
): { meshes: Mesh[]; tiers: TieredLayer } {
  // A piece's coarse copy may move its surface FAR_ERROR world units at its biggest copy's scale.
  const biggest = new Map<WildPiece, number>()
  for (const wild of list) biggest.set(wild.piece, Math.max(biggest.get(wild.piece) ?? 0, wild.scale))
  const pieces = new Map<WildPiece, TieredPiece | null>()
  const pieceOf = (wild: Wild): TieredPiece | null => {
    if (!pieces.has(wild.piece)) {
      const source = nodes[wild.piece]
      const near = source ? geometryOf(source, SWAY[wild.kind]) : null
      const error = FAR_ERROR / (biggest.get(wild.piece) ?? 1)
      pieces.set(wild.piece, near ? { near, far: coarser(simplifier, near, error) } : null)
    }
    return pieces.get(wild.piece) ?? null
  }

  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)
  const place = (wild: Wild) => {
    position.set(wild.x, wild.y, wild.z)
    rotation.setFromAxisAngle(up, wild.rot)
    scale.setScalar(wild.scale)
    return matrix.compose(position, rotation, scale).clone()
  }
  const count = chunks.list.length
  const batches: TieredBatch[] = []
  for (const cast of [true, false]) {
    const group = list.flatMap((wild) => {
      const piece = casts(wild) === cast ? pieceOf(wild) : null
      return piece ? [{ piece, matrix: place(wild), chunk: chunks.at(wild.x, wild.z), wild }] : []
    })
    if (group.length === 0) continue
    // A material each: a node material is built for the first batch drawing it (its matrix texture),
    // and on WebGL's nodes handler a second batch would read the first's. GLSL shares the program.
    const own = material()
    if (!own) break
    const built = merge
      ? tieredMerge(own, group, count, rooted)
      : tieredBatch(own, group, count, (mesh, id, { wild }) =>
          markGrowable(mesh, id, "nature", wild.x, wild.z),
        )
    for (const mesh of built.meshes) {
      mesh.name = cast ? "nature-wilds" : "nature-wilds-fill"
      mesh.castShadow = cast
      mesh.receiveShadow = true
    }
    batches.push(built)
  }
  for (const piece of pieces.values()) {
    piece?.near.dispose()
    piece?.far?.dispose()
  }
  return {
    meshes: batches.flatMap((built) => built.meshes),
    tiers: tiered(chunks, (chunk, tier) => {
      for (const built of batches) built.swap(chunk, tier)
    }),
  }
}

/**
 * A baked copy's sway inputs, per vertex (grassNodes.ts reads them on a merged mesh): `aRoot` is
 * its instance's place (x, z) and the vertex's height in the piece's own space (before its scale) —
 * what a batched vertex gets from the batch's matrix and its own geometry.
 */
function rooted(copy: BufferGeometry, at: Placed): void {
  const e = at.matrix.elements
  const local = at.geometry.getAttribute("position")
  const root = new Float32Array(local.count * 3)
  for (let i = 0; i < local.count; i++) {
    root[i * 3] = e[12] ?? 0
    root[i * 3 + 1] = e[14] ?? 0
    root[i * 3 + 2] = local.getY(i)
  }
  copy.setAttribute("aRoot", new Float32BufferAttribute(root, 3))
}
