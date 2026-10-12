import { useGLTF } from "@react-three/drei"
import {
  type BufferGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { GRAVEYARD_URL } from "../world/cast.ts"
import { castsShadow, GRAVEYARD, type GravePlacement } from "../world/graveyard.ts"
import { plain } from "./Kit.tsx"
import { useOwnedMeshes } from "./owned.ts"

// Always-visible scenery: loads with the world (~285 KB). The undead are scene/Undead.tsx, lazy.
useGLTF.preload(GRAVEYARD_URL)

/**
 * The graveyard's props (world/graveyard.ts): every piece baked into world space and merged into
 * one mesh per material × shadow role — two draw calls for the whole graveyard (Halloween Bits is
 * one palette material), plus the graves' dirt mounds (one more). The tall pieces cast into the on-demand shadow map (owned.ts asks for a
 * redraw when they appear); dirt, path and bones don't.
 */
export function Graveyard() {
  const { nodes } = useGLTF(GRAVEYARD_URL) as unknown as { nodes: Record<string, Object3D> }
  const built = useOwnedMeshes(() => ({ meshes: merge(nodes, GRAVEYARD.pieces) }), [nodes], "materials")
  const dirt = useOwnedMeshes(() => ({ meshes: [mounds()] }), [])
  return (
    <group>
      {[...(built?.meshes ?? []), ...(dirt?.meshes ?? [])].map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}

/**
 * Halloween Bits' `floor_dirt_grave` is an open grave's rim: its pit is under the island's turf.
 * Each grave gets a low mound of fresh earth inside it instead — what the undead claw out of.
 */
function mounds(): Mesh {
  const parts = GRAVEYARD.graves.map((grave) => {
    const mound = new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    mound
      .scale(0.9, 0.2, 0.75)
      .rotateY(grave.rot - Math.PI / 2)
      .translate(grave.x, 0.02, grave.z)
    return mound
  })
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  if (!merged) throw new Error("grave mounds could not be merged")
  const mesh = new Mesh(merged, new MeshStandardMaterial({ color: "#5a3f2b", roughness: 1 }))
  mesh.receiveShadow = true
  return mesh
}

function merge(nodes: Record<string, Object3D>, placements: readonly GravePlacement[]): Mesh[] {
  const buckets = new Map<string, { material: Material; cast: boolean; geometries: BufferGeometry[] }>()
  const matrix = new Matrix4()
  const place = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)
  for (const placement of placements) {
    const source = nodes[placement.piece]
    if (!source)
      throw new Error(`graveyard piece "${placement.piece}" missing: run bun scripts/assets.ts graveyard`)
    const s = placement.scale ?? 1
    place.compose(
      position.set(placement.x, placement.y ?? 0, placement.z),
      rotation.setFromAxisAngle(up, placement.rot ?? 0),
      scale.set(s * (placement.stretch ?? 1), s, s),
    )
    source.updateMatrixWorld(true)
    const inverse = source.matrixWorld.clone().invert()
    const cast = castsShadow(placement.piece)
    source.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as Material
      matrix.multiplyMatrices(place, inverse).multiply(mesh.matrixWorld)
      const id = `${material.uuid}:${cast}`
      const bucket = buckets.get(id) ?? { material, cast, geometries: [] }
      bucket.geometries.push(plain(mesh.geometry).applyMatrix4(matrix))
      buckets.set(id, bucket)
    })
  }
  return [...buckets.values()].map(({ material, cast, geometries }) => {
    const merged = mergeGeometries(geometries)
    if (!merged) throw new Error("graveyard geometry could not be merged")
    for (const geometry of geometries) geometry.dispose()
    const mesh = new Mesh(merged, material)
    mesh.castShadow = cast
    mesh.receiveShadow = true
    return mesh
  })
}
