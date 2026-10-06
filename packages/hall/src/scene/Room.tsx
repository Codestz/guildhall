import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import { type Material, MeshStandardMaterial } from "three"
import { useGuild } from "../guild/useGuild.ts"
import { FURNITURE, NORMALS, type Side, WALL_DECOR, WALLS } from "../world/furniture.ts"
import { ROOM, TILE } from "../world/layout.ts"
import { KitPiece } from "./Kit.tsx"

const SIDES: readonly Side[] = ["back", "front", "left", "right"]

/**
 * The great hall built from KayKit pieces: wooden floor, stone walls with windows and the gate,
 * and every piece of furniture from world/furniture.ts. Walls between the camera and the room
 * fade out (cutaway), per side.
 */
export function Room() {
  const { mood } = useGuild()
  const fading = useMemo(
    () => Object.fromEntries(SIDES.map((side) => [side, [] as Material[]])) as Record<Side, Material[]>,
    [],
  )

  useFrame(({ camera }, delta) => {
    for (const side of SIDES) {
      const [nx, nz] = NORMALS[side]
      const facing = camera.position.x * nx + camera.position.z * nz > 0
      for (const material of fading[side]) {
        const goal = facing ? 0.07 : 1
        material.opacity += (goal - material.opacity) * Math.min(1, delta * 5)
        material.depthWrite = material.opacity > 0.6
      }
    }
  })

  const tiles = useMemo(
    () =>
      Array.from({ length: ROOM.cols * ROOM.rows }, (_, n) => ({
        x: -ROOM.width / 2 + TILE / 2 + (n % ROOM.cols) * TILE,
        z: -ROOM.depth / 2 + TILE / 2 + Math.floor(n / ROOM.cols) * TILE,
      })),
    [],
  )
  const plinth = useMemo(() => new MeshStandardMaterial({ color: mood.stone }), [mood.stone])

  return (
    <group>
      <mesh position-y={-0.6} receiveShadow material={plinth}>
        <boxGeometry args={[ROOM.width + 3, 1, ROOM.depth + 3]} />
      </mesh>
      {tiles.map((tile) => (
        <KitPiece
          key={`${tile.x},${tile.z}`}
          placement={{ piece: "floor_wood_large", x: tile.x, z: tile.z, mounted: true }}
        />
      ))}
      {WALLS.map((wall) => (
        <KitPiece
          key={`${wall.side}${wall.x},${wall.z}`}
          placement={{ piece: wall.piece, x: wall.x, z: wall.z, rot: wall.rot, mounted: true }}
          materials={fading[wall.side]}
        />
      ))}
      {WALL_DECOR.map((decor) => (
        <KitPiece
          key={`${decor.side}${decor.piece}${decor.x},${decor.z}`}
          placement={decor}
          materials={fading[decor.side]}
        />
      ))}
      {FURNITURE.map((placement) => (
        <KitPiece
          key={`${placement.piece}${placement.x},${placement.z},${placement.y ?? 0}`}
          placement={placement}
        />
      ))}
    </group>
  )
}
