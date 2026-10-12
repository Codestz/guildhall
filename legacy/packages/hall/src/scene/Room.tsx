import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo } from "react"
import { type Material, MeshStandardMaterial } from "three"
import { useGuild } from "../guild/useGuild.ts"
import { FURNITURE, NORMALS, type Placement, type Side, WALL_DECOR, WALLS } from "../world/furniture.ts"
import { ROOM, TILE } from "../world/layout.ts"
import { shadows } from "./atmosphere/shadows.ts"
import { mergePlacements, useKit } from "./Kit.tsx"

const SIDES: readonly Side[] = ["back", "front", "left", "right"]

/**
 * The great hall built from KayKit pieces: wooden floor, stone walls with windows and the gate,
 * and every piece of furniture from world/furniture.ts. Walls between the camera and the room
 * fade out (cutaway), per side.
 */
export function Room() {
  const { mood } = useGuild()

  useFrame(({ camera }, delta) => {
    for (const { side, materials, meshes } of sides) {
      const [nx, nz] = NORMALS[side]
      const facing = camera.position.x * nx + camera.position.z * nz > 0
      for (const material of materials) {
        const goal = facing ? 0.07 : 1
        material.opacity += (goal - material.opacity) * Math.min(1, delta * 5)
        material.depthWrite = material.opacity > 0.6
      }
      // A faded (cut-away) wall casts no shadow: with a moving sun it would shade the hall floor.
      const solid = (materials[0]?.opacity ?? 1) > 0.5
      if (meshes[0] && meshes[0].castShadow !== solid) shadows.request()
      for (const mesh of meshes) mesh.castShadow = solid
    }
  })

  const kit = useKit()
  const tiles = useMemo<Placement[]>(
    () =>
      Array.from({ length: ROOM.cols * ROOM.rows }, (_, n) => ({
        piece: "floor_wood_large",
        x: -ROOM.width / 2 + TILE / 2 + (n % ROOM.cols) * TILE,
        z: -ROOM.depth / 2 + TILE / 2 + Math.floor(n / ROOM.cols) * TILE,
        mounted: true,
      })),
    [],
  )
  /** Floor and furniture: everything that never fades, merged per material. */
  const still = useMemo(() => mergePlacements(kit, [...tiles, ...FURNITURE]), [kit, tiles])
  /** Each wall side (segments + what hangs on them), merged per material, with its own fade. */
  const sides = useMemo(
    () =>
      SIDES.map((side) => {
        const materials: Material[] = []
        const pieces: Placement[] = [
          ...WALLS.filter((wall) => wall.side === side).map((wall) => ({ ...wall, mounted: true })),
          ...WALL_DECOR.filter((decor) => decor.side === side),
        ]
        return { side, meshes: mergePlacements(kit, pieces, materials), materials }
      }),
    [kit],
  )
  const plinth = useMemo(() => new MeshStandardMaterial({ color: mood.stone }), [mood.stone])
  // A material passed by prop is ours to free: the old one on a mood change, the last on unmount.
  useEffect(() => () => plinth.dispose(), [plinth])

  return (
    <group>
      <mesh position-y={-0.6} receiveShadow material={plinth}>
        <boxGeometry args={[ROOM.width + 3, 1, ROOM.depth + 3]} />
      </mesh>
      {still.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      {sides.flatMap(({ meshes }) => meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />))}
    </group>
  )
}
