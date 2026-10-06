import { useGLTF } from "@react-three/drei"
import { useMemo } from "react"
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Material,
  type Mesh,
  Mesh as MeshClass,
  type Object3D,
  Uint32BufferAttribute,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { KIT_URL } from "../world/cast.ts"
import { liftOf, type Piece, type Placement } from "../world/furniture.ts"

useGLTF.preload(KIT_URL)

/** The kit's pieces by name (one node per piece, see scripts/assets.ts). */
export function useKit(): Record<string, Object3D> {
  return useGLTF(KIT_URL).nodes as Record<string, Object3D>
}

/**
 * A fresh copy of a kit piece with shadows on. `materials` (optional) collects the copy's own
 * materials — cloned, so fading one wall never fades another.
 */
export function clonePiece(kit: Record<string, Object3D>, piece: Piece, materials?: Material[]): Object3D {
  const source = kit[piece]
  if (!source) throw new Error(`kit piece "${piece}" missing: run bun scripts/assets.ts`)
  const copy = source.clone(true)
  copy.position.set(0, 0, 0)
  copy.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (materials) {
      const own = (mesh.material as Material).clone()
      own.transparent = true
      mesh.material = own
      materials.push(own)
    }
  })
  return copy
}

/** One placed piece of furniture. */
export function KitPiece({ placement, materials }: { placement: Placement; materials?: Material[] }) {
  const kit = useKit()
  const object = useMemo(() => clonePiece(kit, placement.piece, materials), [kit, placement.piece, materials])
  const y = (placement.y ?? 0) + (placement.mounted ? 0 : liftOf(placement.piece))
  return (
    <primitive
      object={object}
      position={[placement.x, y, placement.z]}
      rotation-y={placement.rot ?? 0}
      scale={placement.scale ?? 1}
    />
  )
}

/**
 * Many placed pieces as a few meshes: geometry baked into world space and merged per material.
 * The hall's ~300 static pieces become ~20 draw calls (walls stay grouped per side so they can
 * fade). Geometry is converted to plain float position/normal/uv first: the kit is meshopt-
 * quantized, and quantized attributes can't take a world transform.
 */
export function mergePlacements(
  kit: Record<string, Object3D>,
  placements: readonly Placement[],
  fade?: Material[],
): Mesh[] {
  const buckets = new Map<Material, BufferGeometry[]>()
  for (const placement of placements) {
    const piece = clonePiece(kit, placement.piece)
    piece.position.set(
      placement.x,
      (placement.y ?? 0) + (placement.mounted ? 0 : liftOf(placement.piece)),
      placement.z,
    )
    piece.rotation.y = placement.rot ?? 0
    piece.scale.setScalar(placement.scale ?? 1)
    piece.updateMatrixWorld(true)
    piece.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as Material
      const geometry = plain(mesh.geometry).applyMatrix4(mesh.matrixWorld)
      buckets.set(material, [...(buckets.get(material) ?? []), geometry])
    })
  }
  return [...buckets].map(([material, geometries]) => {
    const merged = mergeGeometries(geometries)
    if (!merged) throw new Error("kit geometry could not be merged")
    for (const geometry of geometries) geometry.dispose()
    let own = material
    if (fade) {
      own = material.clone()
      own.transparent = true
      fade.push(own)
    }
    const mesh = new MeshClass(merged, own)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  })
}

/** Indexed, float32 position/normal/uv only: what mergeGeometries needs from every part. */
function plain(source: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry()
  const position = source.getAttribute("position")
  const count = position.count
  for (const [name, size] of [
    ["position", 3],
    ["normal", 3],
    ["uv", 2],
  ] as const) {
    const attribute = source.getAttribute(name)
    const data = new Float32Array(count * size)
    if (attribute) {
      for (let i = 0; i < count; i++) {
        data[i * size] = attribute.getX(i)
        data[i * size + 1] = attribute.getY(i)
        if (size === 3) data[i * size + 2] = attribute.getZ(i)
      }
    }
    out.setAttribute(name, new Float32BufferAttribute(data, size))
  }
  const index = source.getIndex()
  const indices = new Uint32Array(index ? index.count : count)
  for (let i = 0; i < indices.length; i++) indices[i] = index ? index.getX(i) : i
  out.setIndex(new Uint32BufferAttribute(indices, 1))
  if (!source.getAttribute("normal")) out.computeVertexNormals()
  return out
}
