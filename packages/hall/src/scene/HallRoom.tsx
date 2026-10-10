import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import type { Material, Mesh } from "three"
import { DMath } from "../world/dmath.ts"
import type { Hall, WallSide } from "../world/hall/types.ts"
import type { Spot } from "../world/layout.ts"
import { shadows } from "./atmosphere/shadows.ts"
import { mergePlacements, useKit } from "./Kit.tsx"

/** The way each wall faces out of the hall, in its own frame (x across, z towards the gate). */
const OUT: Record<WallSide, Spot> = { back: [0, -1], front: [0, 1], left: [-1, 0], right: [1, 0] }

/**
 * A far island's hall (world/hall), built from the same kit as the great hall (scene/Room.tsx): its
 * floor and furniture as a few merged meshes, its four walls apart, each fading out when the camera
 * is on its side so the floor is never hidden. Open to the sky, like the great hall. `at` is the
 * island's offset: the hall's own coordinates are the island's.
 */
export function HallRoom({ hall, at }: { hall: Hall; at: Spot }) {
  const kit = useKit()
  const still = useMemo(() => mergePlacements(kit, [...hall.floor, ...hall.props]), [kit, hall])
  const sides = useMemo(
    () =>
      hall.walls.map(({ side, pieces }) => {
        const materials: Material[] = []
        return { side, meshes: mergePlacements(kit, pieces, materials), materials }
      }),
    [kit, hall],
  )
  const centre: Spot = [at[0] + hall.at[0], at[1] + hall.at[1]]
  const [sin, cos] = [DMath.sin(hall.rot), DMath.cos(hall.rot)]

  useFrame(({ camera }, delta) => {
    for (const { side, materials, meshes } of sides) {
      const [lx, lz] = OUT[side]
      const [nx, nz] = [lx * cos + lz * sin, -lx * sin + lz * cos]
      const facing = (camera.position.x - centre[0]) * nx + (camera.position.z - centre[1]) * nz > 0
      for (const material of materials) {
        material.opacity += ((facing ? 0.07 : 1) - material.opacity) * Math.min(1, delta * 5)
        material.depthWrite = material.opacity > 0.6
      }
      const solid = (materials[0]?.opacity ?? 1) > 0.5
      if (meshes[0] && meshes[0].castShadow !== solid) shadows.request()
      for (const mesh of meshes) mesh.castShadow = solid
    }
  })

  const all: Mesh[] = [...still, ...sides.flatMap(({ meshes }) => meshes)]
  return (
    <group name="hall">
      {all.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}
