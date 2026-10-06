import { useGLTF } from "@react-three/drei"
import { useMemo } from "react"
import {
  BatchedMesh,
  type BufferGeometry,
  Color,
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
import { LANDS_URL } from "../world/cast.ts"
import { HEX_SCALE, island, type LandPiece, type LandPlacement, SITES, yardBuilding } from "../world/lands.ts"
import { plain } from "./Kit.tsx"

useGLTF.preload(LANDS_URL)

/**
 * The island round the keep (ADR 0006, 0007). About 650 tiles and pieces of ~130 kinds, drawn as a
 * handful of BatchedMeshes: one per material × shadow role, each a single multi-draw call with
 * per-instance frustum culling (docs/perf-budget.md). Tiles and low clutter don't cast shadows;
 * only pieces tall enough to throw a readable one do.
 */
export function Island() {
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const { progress } = useGuild()
  const land = useMemo(() => island(), [])
  useMemo(() => soften(nodes), [nodes])
  const batches = useMemo(() => batch(nodes, [...land.tiles, ...land.decor]), [nodes, land])
  const building = yardBuilding(progress)
  const yard = SITES.yard.at

  return (
    <group>
      {batches.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      <YardBuilding nodes={nodes} piece={building} at={yard} />
    </group>
  )
}

/**
 * The hexagon pack's palette is a loud lime next to the hall: multiply every land material by a
 * cool grey-green once, so the island sits back and the keep and characters lead.
 */
const SOFTEN = new Color("#bdd3c6")
const softened = new WeakSet<Material>()
function soften(nodes: Record<string, Object3D>): void {
  for (const node of Object.values(nodes)) {
    node.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as MeshStandardMaterial
      if (softened.has(material)) return
      softened.add(material)
      material.color.multiply(SOFTEN)
    })
  }
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
    if (!mesh.isMesh) return
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
 * BatchedMesh holding each piece's geometry once and one instance per placement.
 */
function batch(nodes: Record<string, Object3D>, placements: readonly LandPlacement[]): BatchedMesh[] {
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
  const out: BatchedMesh[] = []
  for (const group of groups.values()) {
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
      position.set(placement.x, placement.y ?? 0, placement.z)
      rotation.setFromAxisAngle(up, placement.rot ?? 0)
      scale.setScalar(HEX_SCALE * (placement.scale ?? 1))
      mesh.setMatrixAt(id, matrix.compose(position, rotation, scale))
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
