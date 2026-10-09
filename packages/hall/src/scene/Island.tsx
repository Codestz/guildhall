import { useGLTF } from "@react-three/drei"
import { useThree } from "@react-three/fiber"
import { use, useMemo } from "react"
import {
  BatchedMesh,
  type BufferGeometry,
  type Material,
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { useGuild } from "../guild/useGuild.ts"
import { isWebGPU } from "../render/backend.ts"
import { bakeStatic } from "../render/bake.ts"
import { LANDS_URL } from "../world/cast.ts"
import { roleOf } from "../world/chronicle/growthPieces.ts"
import { HEX_SCALE, type LandPiece, type LandPlacement, SITES, yardBuilding } from "../world/lands.ts"
import { useWorld, useWorldReady } from "../world/source.ts"
import { markGrowable, useGrowable } from "./growth/registry.ts"
import { plain } from "./Kit.tsx"
import { isMovingPart } from "./life/moving.ts"
import { useOwnedMeshes } from "./owned.ts"
import { tameLime } from "./palette.ts"
import { reliefMeshes } from "./terrain/reliefMeshes.ts"
import { newSnowline, type SnowMaker, snowMaterial } from "./terrain/snow.ts"
import { nodeSnow, useSnowline } from "./terrain/useSnowline.ts"
import { TSL } from "./tsl.ts"

useGLTF.preload(LANDS_URL)

/**
 * The island round the keep (ADR 0006, 0007). About 650 tiles and pieces of ~130 kinds, drawn as a
 * handful of BatchedMeshes: one per material × shadow role, each a single multi-draw call with
 * per-instance frustum culling (docs/perf-budget.md). Tiles and low clutter don't cast shadows;
 * only pieces tall enough to throw a readable one do. On WebGPU (no multi-draw: a BatchedMesh
 * there is a call per instance) each batch is one merged mesh instead (render/bake.ts).
 *
 * It draws the scene's world (world/source.ts): the hand-drawn lands, or a repo's island while one
 * loads it suspends, holding the whole world's Suspense with it.
 */
export function Island() {
  useWorldReady()
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const { progress } = useGuild()
  const world = useWorld()
  const land = world.island
  const gl = useThree((state) => state.gl)
  const webgpu = isWebGPU(gl)
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
      const meshes = batch(nodes, [...land.tiles, ...land.decor], webgpu)
      const base = landMaterial(nodes)
      if (world.relief && base) meshes.push(...reliefMeshes(world.relief, makeSnow(base, snowline), webgpu))
      return { meshes }
    },
    [nodes, land, webgpu, world.relief, makeSnow, snowline],
    "materials",
  )
  // The growth timelapse (`?grow`) rides these instances up out of the sea (scene/growth).
  useGrowable(built?.meshes)
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
 * BatchedMesh holding each piece's geometry once and one instance per placement — or, for
 * WebGPU (`merge`), one mesh with every placement baked in.
 */
function batch(
  nodes: Record<string, Object3D>,
  placements: readonly LandPlacement[],
  merge: boolean,
): Mesh[] {
  const pieces = new Map<LandPiece, Map<Material, BufferGeometry>>()
  interface Group {
    material: Material
    cast: boolean
    geometries: Map<BufferGeometry, number>
    instances: { geometry: BufferGeometry; placement: LandPlacement }[]
  }
  const groups = new Map<string, Group>()
  for (const placement of placements) {
    let byMaterial = pieces.get(placement.piece)
    if (!byMaterial) {
      const source = nodes[placement.piece]
      if (!source) continue
      byMaterial = parts(source)
      pieces.set(placement.piece, byMaterial)
    }
    const cast = casts(placement.piece)
    for (const [material, geometry] of byMaterial) {
      const id = `${material.uuid}:${cast}`
      const group: Group = groups.get(id) ?? { material, cast, geometries: new Map(), instances: [] }
      group.geometries.set(geometry, 0)
      group.instances.push({ geometry, placement })
      groups.set(id, group)
    }
  }

  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)
  const place = (placement: LandPlacement) => {
    position.set(placement.x, placement.y ?? 0, placement.z)
    rotation.setFromAxisAngle(up, placement.rot ?? 0)
    scale.setScalar(HEX_SCALE * (placement.scale ?? 1))
    return matrix.compose(position, rotation, scale)
  }
  const out: Mesh[] = []
  for (const group of groups.values()) {
    if (merge) {
      const placed = group.instances.map(({ geometry, placement }) => ({
        geometry,
        matrix: place(placement).clone(),
      }))
      const merged = bakeStatic(placed)
      if (!merged) continue
      const mesh = new Mesh(merged, group.material)
      mesh.castShadow = group.cast
      mesh.receiveShadow = true
      out.push(mesh)
      continue
    }
    let vertices = 0
    let indices = 0
    for (const geometry of group.geometries.keys()) {
      vertices += geometry.getAttribute("position").count
      indices += geometry.getIndex()?.count ?? 0
    }
    const mesh = new BatchedMesh(group.instances.length, vertices, indices, group.material)
    for (const geometry of group.geometries.keys()) group.geometries.set(geometry, mesh.addGeometry(geometry))
    for (const { geometry, placement } of group.instances) {
      const id = mesh.addInstance(group.geometries.get(geometry) ?? 0)
      mesh.setMatrixAt(id, place(placement))
      markGrowable(mesh, id, roleOf(placement.piece), placement.x, placement.z)
    }
    // Opaque and depth-tested: sorting would only cost CPU every frame. Culling stays on.
    mesh.sortObjects = false
    mesh.castShadow = group.cast
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    out.push(mesh)
  }
  return out
}
