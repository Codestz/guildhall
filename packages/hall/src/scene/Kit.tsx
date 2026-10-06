import { useGLTF } from "@react-three/drei"
import { useMemo } from "react"
import type { Material, Mesh, Object3D } from "three"
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
