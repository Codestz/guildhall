import { useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import {
  BatchedMesh,
  type BufferGeometry,
  type Material,
  MathUtils,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { useGuildStore } from "../../guild/useGuild.ts"
import { pilesOf } from "../../world/behaviours.ts"
import { LANDS_URL } from "../../world/cast.ts"
import { HEX_SCALE, type LandmarkKind } from "../../world/lands.ts"
import { useWorld } from "../../world/source.ts"
import type { World } from "../../world/world.ts"
import { plain } from "../Kit.tsx"
import { useOwnedMeshes } from "../owned.ts"
import { useTown2 } from "../town2.ts"
import { MOVING_PARTS, movingPartsClaimed } from "./moving.ts"
import { life } from "./state.ts"

/**
 * The island's machines turn (ADR 0007, Life), each for a reason:
 *   windmill sails   the wind (environment.wind — the weather, i.e. repo health)
 *   water wheel      the river always runs; a little faster while researchers fish
 *   lumber mill saw  spins only while explorers are chopping at the forest
 * Plus the fish rack's pallet: same material, so it rides in the same batch.
 * Gen 2's kit windmill (a decor piece, not a landmark) turns like the pack's.
 * One BatchedMesh per material (the land pack's, the second kit's): a draw call each.
 */
type Part = keyof typeof MOVING_PARTS
/** The landmark each part belongs to; a part with none (the kit's sails) is found among the decor. */
const KIND: Partial<Record<Part, LandmarkKind>> = { sails: "windmill", wheel: "watermill", saw: "lumbermill" }

interface Placed {
  part?: Part
  mesh: BatchedMesh
  id: number
  /** Piece placement × the part's offset inside the piece. */
  base: Matrix4
  axis: Vector3
  angle: number
  speed: number
}

export function Machines() {
  const store = useGuildStore()
  const { nodes: lands } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const world = useWorld()
  const town2 = useTown2(world.island.decor)
  // The batches are this mount's own (scene/owned.ts); their materials are the packs'.
  const built = useOwnedMeshes(
    () => build({ ...lands, ...town2 }, movingPartsClaimed(), world),
    [lands, town2, world],
    "materials",
  )

  useFrame((_, delta) => {
    if (!built) return
    const env = store.environment
    const dt = Math.min(delta, 0.1)
    for (const placed of built.placed) {
      if (!placed.part) continue
      const goal =
        placed.part === "sails" || placed.part === "kitSails"
          ? 0.15 + env.wind * 1.9
          : placed.part === "wheel"
            ? 0.7 + env.precipitation * 0.5 + Math.min(life.fishing, 2) * 0.2
            : life.sawing > 0
              ? 11
              : 0
      placed.speed = MathUtils.damp(placed.speed, goal, placed.part === "saw" ? 1.5 : 0.8, dt)
      placed.angle = (placed.angle + placed.speed * dt) % (Math.PI * 2)
      spin.makeRotationAxis(placed.axis, -placed.angle)
      placed.mesh.setMatrixAt(placed.id, matrix.multiplyMatrices(placed.base, spin))
    }
  })

  return (
    <>
      {built?.meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

const matrix = new Matrix4()
const spin = new Matrix4()

function build(nodes: Record<string, Object3D>, claimed: boolean, world: World) {
  const land = world.island
  const items: { geometry: BufferGeometry; material: Material; base: Matrix4; part?: Part; axis: Vector3 }[] =
    []

  if (claimed) {
    for (const part of Object.keys(MOVING_PARTS) as Part[]) {
      const spec = MOVING_PARTS[part]
      const piece = nodes[spec.piece]
      // The land pack's parts are nodes of their own; the kit's is found inside its piece.
      const mesh = (nodes[spec.part] ?? piece?.getObjectByName(spec.part)) as Mesh | undefined
      if (!piece || !mesh?.isMesh) continue
      piece.updateMatrixWorld(true)
      const offset = piece.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
      const geometry = plain(mesh.geometry)
      const kind = KIND[part]
      const marks: readonly Spot[] = kind ? land.landmarks.filter((mark) => mark.kind === kind) : land.decor
      for (const mark of marks) {
        if (mark.piece !== spec.piece) continue
        items.push({
          geometry,
          material: mesh.material as Material,
          base: placement(mark.x, mark.y ?? 0, mark.z, mark.rot ?? 0, HEX_SCALE * (mark.scale ?? 1)).multiply(
            offset,
          ),
          part,
          axis: new Vector3(spec.axis === "x" ? 1 : 0, 0, spec.axis === "z" ? 1 : 0),
        })
      }
    }
  }

  // The fish rack: a pallet by the river bend (on a repo's island, by the fishing posts' heap).
  const pallet = nodes.pallet
  if (pallet) {
    pallet.updateMatrixWorld(true)
    const inverse = pallet.matrixWorld.clone().invert()
    pallet.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const rack = pilesOf(world).fish
      items.push({
        geometry: plain(mesh.geometry).applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)),
        material: mesh.material as Material,
        base: placement(rack.x, 0, rack.z, rack.yaw, HEX_SCALE * 1.55),
        axis: new Vector3(),
      })
    })
  }

  // One BatchedMesh per material (the packs each have one palette texture).
  const meshes: BatchedMesh[] = []
  const placed: Placed[] = []
  for (const material of new Set(items.map((item) => item.material))) {
    const same = items.filter((item) => item.material === material)
    const geometries = [...new Set(same.map((item) => item.geometry))]
    let vertices = 0
    let indices = 0
    for (const geometry of geometries) {
      vertices += geometry.getAttribute("position").count
      indices += geometry.getIndex()?.count ?? 0
    }
    const mesh = new BatchedMesh(same.length, vertices, indices, material)
    const ids = new Map(geometries.map((geometry) => [geometry, mesh.addGeometry(geometry)]))
    for (const item of same) {
      const id = mesh.addInstance(ids.get(item.geometry) ?? 0)
      mesh.setMatrixAt(id, item.base)
      placed.push({
        ...(item.part ? { part: item.part } : {}),
        mesh,
        id,
        base: item.base,
        axis: item.axis,
        angle: 0,
        speed: 0,
      })
    }
    mesh.sortObjects = false
    // Turning sails and wheels would need the shadow map redrawn every frame (atmosphere/shadows.ts).
    mesh.castShadow = false
    mesh.receiveShadow = true
    // Turning parts move inside their bounds every frame: cull by the whole batch's sphere only.
    mesh.perObjectFrustumCulled = false
    mesh.computeBoundingSphere()
    meshes.push(mesh)
  }
  return { meshes, placed }
}

/** A placed thing, as a landmark or a decor placement has it. */
interface Spot {
  x: number
  y?: number
  z: number
  rot?: number
  scale?: number
  piece?: string
}

function placement(x: number, y: number, z: number, rot: number, scale: number): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rot),
    new Vector3(scale, scale, scale),
  )
}
