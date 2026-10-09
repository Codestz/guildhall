import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { InstancedMesh, Matrix4, type Object3D, Quaternion, Vector3 } from "three"
import { useGuildStore } from "../../guild/useGuild.ts"
import { ANIMALS_URL } from "../../world/cast.ts"
import { type Stride, wander } from "../../world/folk/critters.ts"
import { type Critter, SPECIES, type Species } from "../../world/folk/types.ts"
import { useWorld } from "../../world/source.ts"
import { FRAME } from "../frame.ts"
import { useOwnedMeshes } from "../owned.ts"
import { merged } from "./pieces.ts"

/**
 * The island's animals (world/folk/critters.ts): Kenney's Cube Pets, one instanced draw for each
 * kind that is out. They wander on a pure function of the clock; a pace of hops stands in for the
 * pets' own legs (the pieces are drawn still), and the chicks roost through the night.
 */

/** The pets are drawn about 1.2 across at 1×; these bring them down to the island's people. */
const SIZE: Readonly<Record<Species, number>> = {
  dog: 0.62,
  cat: 0.5,
  chick: 0.42,
  cow: 0.95,
  pig: 0.7,
  bunny: 0.45,
}
/** The hop of an animal on the move, world units, and its beat. */
const HOP = 0.12
const HOP_RATE = 8
/** Chicks are in their coop from dusk to dawn (hours). */
const ROOST_FROM = 19.5
const ROOST_TO = 6.2

useGLTF.preload(ANIMALS_URL)

/** One kind's draw and the animals of it. */
interface Herd {
  mesh: InstancedMesh
  animals: readonly Critter[]
}

export function Critters({ critters }: { critters: readonly Critter[] }) {
  const { nodes } = useGLTF(ANIMALS_URL) as unknown as { nodes: Record<string, Object3D> }
  const world = useWorld()
  const store = useGuildStore()
  const built = useOwnedMeshes(
    () => {
      const herds: Herd[] = []
      for (const species of SPECIES) {
        const animals = critters.filter((critter) => critter.species === species)
        const part = animals.length > 0 ? merged(nodes, [`animal-${species}`], SIZE[species]) : undefined
        if (!part) continue
        const mesh = new InstancedMesh(part.geometry, part.material, animals.length)
        mesh.frustumCulled = false
        mesh.castShadow = false
        mesh.count = 0
        herds.push({ mesh, animals })
      }
      return { meshes: herds.map((herd) => herd.mesh), herds }
    },
    [nodes, critters],
    "materials",
  )

  useFrame((state) => {
    if (!built) return
    const hour = store.environment.hour
    const asleep = hour >= ROOST_FROM || hour < ROOST_TO
    const seconds = state.clock.elapsedTime
    for (const { mesh, animals } of built.herds) {
      let n = 0
      for (const critter of animals) {
        if (asleep && critter.roosts) continue
        wander(critter, seconds, stride)
        const hop =
          stride.pace > 0.15
            ? Math.abs(Math.sin(seconds * HOP_RATE + critter.phase[0])) * HOP * stride.pace
            : 0
        const y = world.ground.heightAt(stride.x, stride.z) + hop
        mesh.setMatrixAt(
          n++,
          matrix.compose(position.set(stride.x, y, stride.z), turn.setFromAxisAngle(UP, stride.yaw), unit),
        )
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
    }
  }, FRAME.WORLD)

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

const stride: Stride = { x: 0, z: 0, yaw: 0, pace: 0 }
const matrix = new Matrix4()
const position = new Vector3()
const turn = new Quaternion()
const unit = new Vector3(1, 1, 1)
const UP = new Vector3(0, 1, 0)
