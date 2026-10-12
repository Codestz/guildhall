import type { BufferGeometry, Material, Mesh, Object3D } from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { plain } from "../Kit.tsx"

/**
 * A model's pieces as one geometry, for drawing many of it as one InstancedMesh: every mesh of the
 * node baked into the node's own frame (the glTF's node transforms and quantization applied), then
 * merged. The material is the first mesh's (the packs share one palette). `place` moves a part
 * (the crate on the barrow) before the merge.
 */
export interface Merged {
  geometry: BufferGeometry
  material: Material
}

export function merged(
  nodes: Record<string, Object3D>,
  names: readonly string[],
  scale: number,
  place: (name: string, geometry: BufferGeometry) => void = () => {},
): Merged | undefined {
  const parts: BufferGeometry[] = []
  let material: Material | undefined
  for (const name of names) {
    const source = nodes[name]
    if (!source) continue
    const copy = source.clone(true)
    copy.position.set(0, 0, 0)
    copy.rotation.set(0, 0, 0)
    copy.scale.setScalar(scale)
    copy.updateMatrixWorld(true)
    copy.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const geometry = plain(mesh.geometry).applyMatrix4(mesh.matrixWorld)
      place(name, geometry)
      parts.push(geometry)
      material ??= mesh.material as Material
    })
  }
  const geometry = parts.length > 0 ? mergeGeometries(parts) : null
  for (const part of parts) part.dispose()
  return geometry && material ? { geometry, material } : undefined
}
