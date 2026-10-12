import {
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  type Mesh,
  MeshBasicMaterial,
} from "three"
import { MAX_PULL_SHIPS } from "./fleet.ts"

/**
 * The pull requests' pennants: one triangle of cloth per ship (one instanced draw, coloured per
 * instance), sized to the hull and flown from its masthead — the top of the baked hull, amidships.
 */
export function pennants(hull: InstancedMesh, keep: <T extends Mesh>(mesh: T) => T) {
  hull.geometry.computeBoundingBox()
  const box = hull.geometry.boundingBox
  const length = box ? (box.max.z - box.min.z) * 0.2 : 1.5
  const cloth = length * 0.5
  const geometry = new BufferGeometry()
  // Hoisted at the mast, streaming aft: the hoist edge up and down, the tip at its middle.
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 0, -cloth, 0, 0, -cloth / 2, -length], 3),
  )
  const material = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false })
  const flags = new InstancedMesh(geometry, material, MAX_PULL_SHIPS)
  flags.instanceMatrix.setUsage(DynamicDrawUsage)
  flags.count = 0
  keep(flags)
  flags.receiveShadow = false
  return {
    flags,
    mast: { y: (box?.max.y ?? 5) * 0.97, z: box ? box.min.z + (box.max.z - box.min.z) * 0.25 : 0 },
  }
}
