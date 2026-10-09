import { useGLTF } from "@react-three/drei"
import { useThree } from "@react-three/fiber"
import { use, useMemo } from "react"
import {
  type BufferGeometry,
  type Material,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { useGuild } from "../guild/useGuild.ts"
import { isWebGPU } from "../render/backend.ts"
import { coarser, loadSimplifier, type Simplifier } from "../render/simplify.ts"
import { FAR_ERROR } from "../render/tiers.ts"
import { LANDS_URL } from "../world/cast.ts"
import { roleOf } from "../world/chronicle/growthPieces.ts"
import { type Chunks, chunksOf } from "../world/chunks.ts"
import { genOf } from "../world/gen/islandFromTree.ts"
import { HEX_SCALE, type LandPiece, type LandPlacement, SITES, yardBuilding } from "../world/lands.ts"
import { useWorld, useWorldReady } from "../world/source.ts"
import { markGrowable, useGrowable } from "./growth/registry.ts"
import { plain } from "./Kit.tsx"
import { isMovingPart } from "./life/moving.ts"
import { missingPieces, reportMissing } from "./missing.ts"
import { useOwnedMeshes } from "./owned.ts"
import { tameLime } from "./palette.ts"
import { reliefLayer } from "./terrain/reliefMeshes.ts"
import { newSnowline, type SnowMaker, snowMaterial } from "./terrain/snow.ts"
import { nodeSnow, useSnowline } from "./terrain/useSnowline.ts"
import {
  type TieredInstance,
  type TieredLayer,
  type TieredPiece,
  tiered,
  tieredBatch,
  tieredMerge,
  useTiered,
} from "./tiers.ts"
import { loadTown2, useTown2 } from "./town2.ts"
import { TSL } from "./tsl.ts"

useGLTF.preload(LANDS_URL)
// Generator 2's second town kit (scene/town2.ts) is fetched beside the land pack, for that link alone.
if (typeof location !== "undefined" && genOf(location.search) === 2) void loadTown2()
/** The far tier's simplifier, fetched beside the land pack (it is needed before the batches build). */
const SIMPLIFIER = loadSimplifier()

/**
 * The island round the keep (ADR 0006, 0007). About 650 tiles and pieces of ~130 kinds, drawn as a
 * handful of BatchedMeshes: one per material × shadow role, each a single multi-draw call with
 * per-instance frustum culling (docs/perf-budget.md). Tiles and low clutter don't cast shadows;
 * only pieces tall enough to throw a readable one do. On WebGPU (no multi-draw: a BatchedMesh
 * there is a call per instance) each batch is merged per region instead (render/bake.ts).
 *
 * Far regions draw coarse copies of their pieces (scene/tiers.ts, render/tiers.ts): a big repo's
 * island seen whole costs a fraction of its full detail, and the swap is under a pixel.
 *
 * It draws the scene's world (world/source.ts): the hand-drawn lands, or a repo's island while one
 * loads it suspends, holding the whole world's Suspense with it.
 */
export function Island() {
  useWorldReady()
  const { nodes: lands } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const { progress } = useGuild()
  const world = useWorld()
  const land = world.island
  // The land pack's pieces, and gen 2's second town kit's when the island's prefabs use it.
  const town2 = useTown2(land.decor)
  const nodes = useMemo(() => ({ ...lands, ...town2 }), [lands, town2])
  const gl = useThree((state) => state.gl)
  const webgpu = isWebGPU(gl)
  const simplifier = use(SIMPLIFIER)
  useMemo(() => soften(nodes), [nodes])
  // A gen 2 island's massifs (world/gen/relief) are drawn in the land's own palette, whitened above
  // the snow line (scene/terrain): GLSL on WebGL, its node twin on WebGPU (and `?tsl=1`).
  const makeSnow: SnowMaker = webgpu || TSL ? use(nodeSnow(gl)) : snowMaterial
  const snowline = useMemo(newSnowline, [])
  useSnowline(world.relief, snowline)
  // The batches are this mount's own (scene/owned.ts: freed on unmount, StrictMode-safe); their
  // materials are the land pack's.
  const built = useOwnedMeshes(
    () => {
      const layer = batch(nodes, [...land.tiles, ...land.decor], webgpu, simplifier, chunksOf(world))
      const base = landMaterial(lands)
      if (!world.relief || !base) return { ...layer, relief: undefined }
      const relief = reliefLayer(world.relief, makeSnow(base, snowline), webgpu, chunksOf(world))
      return { meshes: [...layer.meshes, ...relief.meshes], tiers: layer.tiers, relief: relief.tiers }
    },
    [nodes, lands, land, webgpu, simplifier, world, makeSnow, snowline],
    "materials",
  )
  // The growth timelapse (`?grow`) rides these instances up out of the sea (scene/growth).
  useGrowable(built?.meshes)
  // Far regions draw coarse copies (scene/tiers.ts), the relief's own tiers apart (terrain/reliefMeshes.ts).
  useTiered(built?.tiers)
  useTiered(built?.relief)
  const building = yardBuilding(progress)
  const yard = SITES.yard.at

  return (
    <group>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      {world.kind === "hand" && <YardBuilding nodes={nodes} piece={building} at={yard} />}
    </group>
  )
}

/** The land pack's one material (every hex tile shares it): what the relief copies. */
function landMaterial(nodes: Record<string, Object3D>): Material | undefined {
  let found: Material | undefined
  nodes.hex_grass?.traverse((child) => {
    const mesh = child as Mesh
    if (!found && mesh.isMesh) found = mesh.material as Material
  })
  return found
}

/** The land palette: lime grass calmed in the texture itself (scene/palette.ts), nothing else. */
function soften(nodes: Record<string, Object3D>): void {
  for (const node of Object.values(nodes))
    node.traverse((child) => {
      const mesh = child as Mesh
      if (mesh.isMesh) tameLime((mesh.material as MeshStandardMaterial).map)
    })
}

/** The yard's building: swaps to the next stage as edits complete. */
function YardBuilding({
  nodes,
  piece,
  at,
}: {
  nodes: Record<string, Object3D>
  piece: LandPiece
  at: readonly [number, number]
}) {
  const object = useMemo(() => {
    const source = nodes[piece]
    if (!source) return null
    const copy = source.clone(true)
    copy.traverse((child) => {
      const mesh = child as Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    return copy
  }, [nodes, piece])
  if (!object) return null
  return <primitive object={object} position={[at[0], 0, at[1]]} scale={HEX_SCALE * 1.5} rotation-y={-0.4} />
}

/** Low pieces whose shadow nobody would miss: skipping them keeps the shadow pass cheap. */
const FLAT =
  /^(hex_|rock_single|building_grain|building_dirt|waterlily|waterplant|floor_wood|pallet|sack|barrel|crate|fence|resource_|tree_single_._cut|trees_._cut|target|flag_|rope|bucket|hill_single|wheelbarrow|weaponrack|ladder|tent)/
const casts = (piece: LandPiece): boolean => !FLAT.test(piece)

/** One piece's geometry per material, in the piece's own space. */
function parts(source: Object3D): Map<Material, BufferGeometry> {
  source.updateMatrixWorld(true)
  const inverse = source.matrixWorld.clone().invert()
  const byMaterial = new Map<Material, BufferGeometry[]>()
  source.traverse((child) => {
    const mesh = child as Mesh
    // Sails, water wheel and saw are drawn (and turned) by the Life layer.
    if (!mesh.isMesh || isMovingPart(mesh.name)) return
    const geometry = plain(mesh.geometry).applyMatrix4(inverse.clone().multiply(mesh.matrixWorld))
    const material = mesh.material as Material
    byMaterial.set(material, [...(byMaterial.get(material) ?? []), geometry])
  })
  const out = new Map<Material, BufferGeometry>()
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries)
    if (merged) out.set(material, merged)
  }
  return out
}

/**
 * Every placement, grouped by material and by whether it casts a shadow; each group is one
 * BatchedMesh holding each piece's geometry, and its coarse copy, once and one instance per
 * placement — or, for WebGPU (`merge`), merged meshes per region. The batches swap a region
 * between the two (scene/tiers.ts) as the camera moves.
 */
function batch(
  nodes: Record<string, Object3D>,
  placements: readonly LandPlacement[],
  merge: boolean,
  simplifier: Simplifier,
  chunks: Chunks,
): { meshes: Mesh[]; tiers: TieredLayer } {
  // A piece's coarse copy may move its surface FAR_ERROR world units wherever it stands, so its
  // error in its own units is set by its biggest copy.
  reportMissing(missingPieces(nodes, placements))
  const biggest = new Map<LandPiece, number>()
  for (const { piece, scale = 1 } of placements) biggest.set(piece, Math.max(biggest.get(piece) ?? 0, scale))
  const pieces = new Map<LandPiece, Map<Material, TieredPiece>>()
  interface Placed extends TieredInstance {
    placement: LandPlacement
  }
  interface Group {
    material: Material
    cast: boolean
    instances: Placed[]
  }
  const groups = new Map<string, Group>()
  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)
  const place = (placement: LandPlacement) => {
    position.set(placement.x, placement.y ?? 0, placement.z)
    rotation.setFromAxisAngle(up, placement.rot ?? 0)
    scale.setScalar(HEX_SCALE * (placement.scale ?? 1))
    return matrix.compose(position, rotation, scale).clone()
  }
  for (const placement of placements) {
    let byMaterial = pieces.get(placement.piece)
    if (!byMaterial) {
      const source = nodes[placement.piece]
      if (!source) continue
      const error = FAR_ERROR / (HEX_SCALE * (biggest.get(placement.piece) ?? 1))
      byMaterial = new Map()
      for (const [material, near] of parts(source))
        byMaterial.set(material, { near, far: coarser(simplifier, near, error) })
      pieces.set(placement.piece, byMaterial)
    }
    const cast = casts(placement.piece)
    const at = place(placement)
    const chunk = chunks.at(placement.x, placement.z)
    for (const [material, piece] of byMaterial) {
      const id = `${material.uuid}:${cast}`
      const group: Group = groups.get(id) ?? { material, cast, instances: [] }
      group.instances.push({ piece, matrix: at, chunk, placement })
      groups.set(id, group)
    }
  }

  const count = chunks.list.length
  const batches = [...groups.values()].map((group) => {
    const built = merge
      ? tieredMerge(group.material, group.instances, count)
      : tieredBatch(group.material, group.instances, count, (mesh, id, { placement }) =>
          markGrowable(mesh, id, roleOf(placement.piece), placement.x, placement.z, placement.piece),
        )
    for (const mesh of built.meshes) {
      mesh.castShadow = group.cast
      mesh.receiveShadow = true
    }
    return built
  })
  return {
    meshes: batches.flatMap((built) => built.meshes),
    tiers: tiered(chunks, (chunk, tier) => {
      for (const built of batches) built.swap(chunk, tier)
    }),
  }
}
