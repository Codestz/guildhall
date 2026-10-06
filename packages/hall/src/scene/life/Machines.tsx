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
import { LANDS_URL } from "../../world/cast.ts"
import { HEX_SCALE, island, type LandmarkKind } from "../../world/lands.ts"
import { plain } from "../Kit.tsx"
import { useOwnedMeshes } from "../owned.ts"
import { MOVING_PARTS, movingPartsClaimed } from "./moving.ts"
import { PILES } from "./places.ts"
import { life } from "./state.ts"

/**
 * The island's machines turn (ADR 0007, Life), each for a reason:
 *   windmill sails   the wind (environment.wind — the weather, i.e. repo health)
 *   water wheel      the river always runs; a little faster while researchers fish
 *   lumber mill saw  spins only while explorers are chopping at the forest
 * Plus the fish rack's pallet: same material, so it rides in the same batch.
 * One BatchedMesh in the pack's material: one draw call, one more in the shadow pass.
 */
type Part = keyof typeof MOVING_PARTS
const KIND: Record<Part, LandmarkKind> = { sails: "windmill", wheel: "watermill", saw: "lumbermill" }

interface Placed {
  part?: Part
  id: number
  /** Piece placement × the part's offset inside the piece. */
  base: Matrix4
  axis: Vector3
  angle: number
  speed: number
}

export function Machines() {
  const store = useGuildStore()
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  // The batch is this mount's own (scene/owned.ts); its material is the land pack's.
  const built = useOwnedMeshes(() => build(nodes, movingPartsClaimed()), [nodes], "materials")

  useFrame((_, delta) => {
    if (!built) return
    const env = store.environment
    const dt = Math.min(delta, 0.1)
    for (const placed of built.placed) {
      if (!placed.part) continue
      const goal =
        placed.part === "sails"
          ? 0.15 + env.wind * 1.9
          : placed.part === "wheel"
            ? 0.7 + env.precipitation * 0.5 + Math.min(life.fishing, 2) * 0.2
            : life.sawing > 0
              ? 11
              : 0
      placed.speed = MathUtils.damp(placed.speed, goal, placed.part === "saw" ? 1.5 : 0.8, dt)
      placed.angle = (placed.angle + placed.speed * dt) % (Math.PI * 2)
      spin.makeRotationAxis(placed.axis, -placed.angle)
      built.meshes[0]?.setMatrixAt(placed.id, matrix.multiplyMatrices(placed.base, spin))
    }
  })

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

const matrix = new Matrix4()
const spin = new Matrix4()

function build(nodes: Record<string, Object3D>, claimed: boolean) {
  const land = island()
  const items: { geometry: BufferGeometry; material: Material; base: Matrix4; part?: Part; axis: Vector3 }[] =
    []

  if (claimed) {
    for (const part of Object.keys(MOVING_PARTS) as Part[]) {
      const spec = MOVING_PARTS[part]
      const piece = nodes[spec.piece]
      const mesh = nodes[spec.part] as Mesh | undefined
      if (!piece || !mesh?.isMesh) continue
      piece.updateMatrixWorld(true)
      const offset = piece.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
      const geometry = plain(mesh.geometry)
      for (const mark of land.landmarks) {
        if (mark.kind !== KIND[part] || mark.piece !== spec.piece) continue
        items.push({
          geometry,
          material: mesh.material as Material,
          base: placement(mark.x, mark.y ?? 0, mark.z, mark.rot ?? 0, HEX_SCALE).multiply(offset),
          part,
          axis: new Vector3(spec.axis === "x" ? 1 : 0, 0, spec.axis === "z" ? 1 : 0),
        })
      }
    }
  }

  // The fish rack: a pallet by the river bend.
  const pallet = nodes.pallet
  if (pallet) {
    pallet.updateMatrixWorld(true)
    const inverse = pallet.matrixWorld.clone().invert()
    pallet.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const rack = PILES.fish
      items.push({
        geometry: plain(mesh.geometry).applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)),
        material: mesh.material as Material,
        base: placement(rack.x, 0, rack.z, rack.yaw, HEX_SCALE * 1.55),
        axis: new Vector3(),
      })
    })
  }

  const material = items[0]?.material
  if (!material) return { meshes: [], placed: [] }
  // One material across the pack (one palette texture); anything else would need its own batch.
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
  const placed: Placed[] = same.map((item) => {
    const id = mesh.addInstance(ids.get(item.geometry) ?? 0)
    mesh.setMatrixAt(id, item.base)
    return {
      ...(item.part ? { part: item.part } : {}),
      id,
      base: item.base,
      axis: item.axis,
      angle: 0,
      speed: 0,
    }
  })
  mesh.sortObjects = false
  // Turning sails and wheels would need the shadow map redrawn every frame (atmosphere/shadows.ts).
  mesh.castShadow = false
  mesh.receiveShadow = true
  // Turning parts move inside their bounds every frame: cull by the whole batch's sphere only.
  mesh.perObjectFrustumCulled = false
  mesh.computeBoundingSphere()
  return { meshes: [mesh], placed }
}

function placement(x: number, y: number, z: number, rot: number, scale: number): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rot),
    new Vector3(scale, scale, scale),
  )
}
