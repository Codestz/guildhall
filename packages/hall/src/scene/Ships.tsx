import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import type { Group, Mesh, Object3D } from "three"
import { useGuildStore } from "../guild/useGuild.ts"
import { SHIPS_URL } from "../world/cast.ts"
import { HEX_SCALE } from "../world/lands.ts"
import { useWorld } from "../world/source.ts"
import { reachOf, type World } from "../world/world.ts"
import { FRAME } from "./frame.ts"

/**
 * Ships on the sea (Kenney Pirate Kit, CC0): merchant ships sailing slow laps around the island,
 * a rowboat tied up at the quay. Ambient: the ships that carry the guild's GitHub sea (pushes, pull
 * requests, releases) sail in scene/seas, round the same quay. Moving, so they never cast into the
 * static shadow map.
 */
export const SEA_Y = -0.2 * HEX_SCALE + 0.05
/** The lap: an ellipse ≥ 19 units off every coast (measured against island() tiles). */
const LAP = { rx: 95, rz: 115 }
const QUAY: readonly [number, number] = [5.5, 84]
/** A repo's island: a round lap this far off its furthest land, the rowboat this far off its dock. */
const OFFSHORE = 26
const MOORING: readonly [number, number] = [5.5, 6]

/** The lap and the rowboat's mooring for a world: the hand map's measured ones, else from its land. */
export function watersOf(world: World): { lap: { rx: number; rz: number }; quay: readonly [number, number] } {
  if (world.kind === "hand") return { lap: LAP, quay: QUAY }
  const reach = reachOf(world) + OFFSHORE
  const dock = world.island.landmarks.find((mark) => mark.kind === "dock")
  return {
    lap: { rx: reach, rz: reach },
    quay: dock ? [dock.x + MOORING[0], dock.z + MOORING[1]] : [reach, 0],
  }
}

interface Sailor {
  piece: string
  scale: number
  /** Laps per second (sign: direction). */
  speed: number
  phase: number
  /** Hull below the waterline, in model units. */
  draft: number
}

const SAILORS: readonly Sailor[] = [
  { piece: "ship-large", scale: 1.1, speed: 1 / 300, phase: 0.1, draft: 1.1 },
  { piece: "ship-medium", scale: 1, speed: -1 / 260, phase: 0.6, draft: 1.0 },
]

export function Ships() {
  const { nodes } = useGLTF(SHIPS_URL) as unknown as { nodes: Record<string, Object3D> }
  const ships = useMemo(() => SAILORS.map((s) => ({ sailor: s, body: hull(nodes[s.piece]) })), [nodes])
  const boat = useMemo(() => hull(nodes["boat-row-small"]), [nodes])
  const store = useGuildStore()
  const world = useWorld()
  const { lap, quay } = useMemo(() => watersOf(world), [world])
  const refs = useRef<(Group | null)[]>([])
  const boatRef = useRef<Group>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const wind = store.environment.wind
    ships.forEach(({ sailor }, i) => {
      const group = refs.current[i]
      if (!group) return
      const a = (sailor.phase + t * sailor.speed) * Math.PI * 2
      const x = Math.cos(a) * lap.rx
      const z = Math.sin(a) * lap.rz
      // Heading along the lap (the tangent), bow forward (+z in the model).
      const dir = Math.sign(sailor.speed)
      const heading = Math.atan2(-Math.sin(a) * lap.rx * dir, Math.cos(a) * lap.rz * dir)
      const sway = 0.5 + wind
      group.position.set(x, SEA_Y - sailor.draft * sailor.scale + Math.sin(t * 0.9 + i) * 0.12, z)
      group.rotation.set(
        Math.sin(t * 0.6 + i * 2) * 0.025 * sway,
        heading,
        Math.sin(t * 0.8 + i) * 0.045 * sway,
      )
    })
    const b = boatRef.current
    if (b) {
      b.position.y = SEA_Y - 0.25 + Math.sin(t * 1.3) * 0.06
      b.rotation.set(Math.sin(t * 1.1) * 0.04, 0.4, Math.sin(t * 1.4) * 0.05)
    }
  }, FRAME.WORLD)

  return (
    <group name="ships">
      {ships.map(({ sailor, body }, i) =>
        body ? (
          <group
            key={sailor.piece}
            ref={(g) => {
              refs.current[i] = g
            }}
            scale={sailor.scale}
          >
            <primitive object={body} />
          </group>
        ) : null,
      )}
      {boat && (
        <group ref={boatRef} position={[quay[0], SEA_Y, quay[1]]} scale={1.1}>
          <primitive object={boat} />
        </group>
      )}
    </group>
  )
}

/** A ship's own copy, receiving but never casting shadows (it moves; the map is static). */
function hull(source: Object3D | undefined): Object3D | null {
  if (!source) return null
  const copy = source.clone(true)
  copy.position.set(0, 0, 0)
  copy.rotation.set(0, 0, 0)
  copy.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = false
    mesh.receiveShadow = true
  })
  return copy
}
