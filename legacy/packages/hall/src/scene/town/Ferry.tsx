import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import type { Group, Mesh, Object3D } from "three"
import { town } from "../../guild/town/town.ts"
import { SHIPS_URL } from "../../world/cast.ts"
import { useWorld } from "../../world/source.ts"
import { ferryAt } from "../../world/town/presence.ts"
import { FRAME } from "../frame.ts"
import { SEA_Y, watersOf } from "../Ships.tsx"
import { harbourOf, toWorld } from "../seas/fleet.ts"

/** Where the ferry moors, in the harbour's frame (scene/seas/fleet.ts): east of the quay, along the shore. */
const MOORED = { side: 16, out: 5 }
/** Where it sails from and back to: past the horizon. */
const AWAY = 130
const DRAFT = 1

/**
 * The town's ferry (ADR 0022): a small ship (ships.glb, the seas' own Kenney hulls) that sails in
 * and moors at the quay while contributors come ashore or leave (guild/town: the first commit's
 * week, a year past the last), and out of sight when nobody does. Where it is is a pure function
 * of the town's day (world/town/presence.ts `ferryAt`), so the film's scrubbing moves it too.
 * Nothing on an island without a town.
 */
export function Ferry() {
  const world = useWorld()
  const { nodes } = useGLTF(SHIPS_URL) as unknown as { nodes: Record<string, Object3D> }
  const ship = useMemo(() => hull(nodes["ship-small"]), [nodes])
  const harbour = useMemo(() => harbourOf(watersOf(world).quay), [world])
  const root = useRef<Group>(null)

  useFrame((state) => {
    const group = root.current
    if (!group) return
    const docked = town.views.length > 0 ? ferryAt(town.comings, town.day, town.window) : 0
    group.visible = docked > 0
    if (!group.visible) return
    // In under sail, slowing to the mooring: eased so it glides the last of the way.
    const p = 1 - (1 - docked) ** 3
    const out = MOORED.out + (AWAY - MOORED.out) * (1 - p)
    const at = toWorld(harbour, MOORED.side, out, docked < 1 ? Math.PI : Math.PI / 2)
    const t = state.clock.elapsedTime
    group.position.set(at.x, SEA_Y - DRAFT + Math.sin(t * 1.1) * 0.08, at.z)
    group.rotation.set(Math.sin(t * 0.7) * 0.02, at.heading, Math.sin(t * 0.9) * 0.03)
  }, FRAME.WORLD)

  if (world.kind !== "repo" || !ship) return null
  return (
    <group ref={root} name="town-ferry" visible={false} scale={0.8}>
      <primitive object={ship} />
    </group>
  )
}

/** The ship's own copy, receiving but never casting shadows (it moves; the map is static). */
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
