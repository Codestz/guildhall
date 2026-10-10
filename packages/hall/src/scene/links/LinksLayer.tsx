import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useMemo } from "react"
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { useGuildStore } from "../../guild/useGuild.ts"
import type { Archipelago } from "../../world/archipelagoSource.ts"
import { SHIPS_URL } from "../../world/cast.ts"
import { type FerryState, ferryAt } from "../../world/ferrySchedule.ts"
import type { LinkNet, LinkRoute } from "../../world/linkNet.ts"
import { halos } from "../atmosphere/Lamps.tsx"
import { sky } from "../atmosphere/state.ts"
import { bakeNode } from "../events/common.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import { SEA_Y } from "../Ships.tsx"
import { bridgeGeometry } from "./bridgeMesh.ts"
import { dockGeometry, dockLampOf } from "./dockMesh.ts"
import type { V3 } from "./shapes.ts"
import { useLinkNet } from "./useLinkNet.ts"

/**
 * What joins the islands (world/linkNet.ts), drawn: a stone bridge for each bridge link, a timber
 * dock at each end of each ferry link, and a ferry on each lane sailing its timetable
 * (world/ferrySchedule.ts) on the story's clock, so a paused shot and a seek show the same sea.
 *
 * Batched: every bridge is one mesh, every dock one, every ferry one instanced hull, their wakes
 * one, and every lantern's flame (docks, bridges, the ferries' bow and stern) one more of halos:
 * five draw calls however many links. Nothing here casts into the static shadow map.
 */

/** The ferry's hull: a Kenney ship (scene/Ships.tsx), sitting this deep in the water (model units). */
const HULL = "ship-small"
const DRAFT = 1
/** The ferry's lanterns, in the hull's own space (x, y, z; +z the bow). */
const LANTERNS: readonly V3[] = [
  [0, 3.4, 3.6],
  [0, 3.6, -3.4],
]
const HALO = 5.5
const WARM = new Color("#ffcf7a")

const matrix = new Matrix4()
const place = new Vector3()
const scale = new Vector3()
const turn = new Quaternion()
const euler = new Euler()
const tint = new Color()

/** A ferry's wake: a V of foam trailing from the stern, bright at the stern and gone at its tip. */
function wakeGeometry(): BufferGeometry {
  const arm = (side: number): number[] => [
    side * 0.9,
    0,
    -4.2,
    side * 2.2,
    0,
    -14,
    side * 3.4,
    0,
    -13.2,
    side * 0.9,
    0,
    -4.2,
    side * 3.4,
    0,
    -13.2,
    side * 2.2,
    0,
    -4.4,
  ]
  const positions = [...arm(1), ...arm(-1)]
  const colours: number[] = []
  for (let i = 0; i < positions.length; i += 3) {
    const bright = 1 - Math.min(1, Math.abs((positions[i + 2] as number) + 4.2) / 10)
    colours.push(bright, bright, bright)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3))
  return geometry
}

/** The ferries: those routes with a timetable. */
const ferriesOf = (net: LinkNet): LinkRoute[] => net.routes.filter((route) => route.table)

export default function LinksLayer({ archipelago }: { archipelago: Archipelago }) {
  const store = useGuildStore()
  const ships = useGLTF(SHIPS_URL) as unknown as { nodes: Record<string, Object3D> }
  const net = useLinkNet(archipelago)
  const ferries = useMemo(() => ferriesOf(net), [net])

  /** Stone and timber: bridges, docks, and the lanterns' flames. Static but for the flames. */
  const fixed = useOwnedMeshes(() => {
    const meshes: Mesh[] = []
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true })
    const flames: V3[] = []
    const bridges = bridgeGeometry(
      net.routes.flatMap((route) => (route.bridge ? [{ bridge: route.bridge, from: route.quays[0] }] : [])),
    )
    if (bridges) {
      meshes.push(
        Object.assign(new Mesh(bridges.geometry, material), { name: "bridges", receiveShadow: true }),
      )
      flames.push(...bridges.flames)
    }
    const quays = ferries.flatMap((route) => route.quays)
    const docks = dockGeometry(quays)
    if (docks) {
      meshes.push(Object.assign(new Mesh(docks, material), { name: "docks", receiveShadow: true }))
      flames.push(...quays.map(dockLampOf))
    }
    // Flames: the fixed ones first, then two a ferry.
    const lamps = halos(flames.length + ferries.length * LANTERNS.length)
    lamps.name = "link-lamps"
    return { meshes: [...meshes, lamps], flames, lamps }
  }, [net, ferries])

  /** The ferries and their wakes, one instanced mesh each; the hull's palette belongs to the ship pack. */
  const boats = useOwnedMeshes(
    () => {
      const baked = ferries.length > 0 && ships.nodes[HULL] ? bakeNode(ships.nodes[HULL] as Object3D) : null
      if (!baked) return { meshes: [] as Mesh[], hull: null, wake: null }
      const hull = new InstancedMesh(
        baked.geometry,
        new MeshStandardMaterial({ map: baked.material.map, roughness: 0.9 }),
        ferries.length,
      )
      hull.name = "ferries"
      hull.frustumCulled = false
      hull.receiveShadow = true
      const wake = new InstancedMesh(
        wakeGeometry(),
        new MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
        ferries.length,
      )
      wake.name = "ferry-wakes"
      wake.frustumCulled = false
      wake.renderOrder = 2
      return { meshes: [hull, wake], hull, wake }
    },
    [ferries, ships.nodes],
    "textures",
  )

  const state = useMemo<FerryState>(() => ({ x: 0, z: 0, heading: 0, moored: undefined, s: 0, speed: 0 }), [])

  useFrame(({ clock }) => {
    const t = store.time / 1000
    const bob = clock.elapsedTime
    const lamps = fixed?.lamps
    const glow = (index: number, x: number, y: number, z: number, size: number): void => {
      if (!lamps) return
      const flicker =
        0.88 + Math.sin(bob * 9.1 + index * 1.7) * 0.06 + Math.sin(bob * 15.7 + index * 3.4) * 0.05
      const s = size * (0.8 + sky.lamps * 0.35) * flicker
      matrix.compose(place.set(x, y, z), IDENTITY, scale.set(s, s, s))
      lamps.setMatrixAt(index, matrix)
      lamps.setColorAt(index, tint.copy(WARM).multiplyScalar(flicker * (0.1 + sky.lamps * 1.6)))
    }
    for (const [i, [x, y, z]] of (fixed?.flames ?? []).entries()) glow(i, x, y, z, HALO)
    const first = fixed?.flames.length ?? 0

    const { hull, wake } = boats ?? {}
    ferries.forEach((route, i) => {
      if (!route.table) return
      ferryAt(route.table, t, state)
      const sailing = state.speed > 0
      const y = SEA_Y - DRAFT + Math.sin(bob * 0.9 + i) * (sailing ? 0.12 : 0.05)
      turn.setFromEuler(
        euler.set(
          Math.sin(bob * 0.6 + i * 2) * 0.03 * (0.4 + state.speed),
          state.heading,
          Math.sin(bob * 0.8 + i) * 0.05,
        ),
      )
      if (hull) hull.setMatrixAt(i, matrix.compose(place.set(state.x, y, state.z), turn, scale.set(1, 1, 1)))
      if (wake) {
        // The wake lies flat on the water, behind the stern, and grows with the ship's speed.
        turn.setFromEuler(euler.set(0, state.heading, 0))
        const k = state.speed
        wake.setMatrixAt(
          i,
          matrix.compose(place.set(state.x, SEA_Y + 0.06, state.z), turn, scale.set(k, 1, k)),
        )
        wake.setColorAt(i, tint.setScalar(0.2 * k * (1 - 0.7 * sky.night)))
      }
      // Bow and stern lanterns ride the hull.
      LANTERNS.forEach(([lx, ly, lz], k) => {
        place.set(lx, ly, lz).applyQuaternion(turn.setFromEuler(euler.set(0, state.heading, 0)))
        glow(
          first + i * LANTERNS.length + k,
          state.x + place.x,
          SEA_Y - DRAFT + place.y,
          state.z + place.z,
          HALO * 0.8,
        )
      })
    })
    if (hull) hull.instanceMatrix.needsUpdate = true
    if (wake) {
      wake.instanceMatrix.needsUpdate = true
      if (wake.instanceColor) wake.instanceColor.needsUpdate = true
    }
    if (lamps) {
      lamps.instanceMatrix.needsUpdate = true
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true
    }
  }, FRAME.WORLD)

  return (
    <group name="links">
      {fixed?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      {boats?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </group>
  )
}

const IDENTITY = new Quaternion()
