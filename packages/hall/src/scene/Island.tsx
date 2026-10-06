import { useGLTF } from "@react-three/drei"
import { useMemo } from "react"
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { useGuild } from "../guild/useGuild.ts"
import { LANDS_URL } from "../world/cast.ts"
import {
  HEX_SCALE,
  island,
  type LandPiece,
  type LandPlacement,
  ROAD_EDGES,
  ROAD_NODES,
  SITES,
  yardBuilding,
} from "../world/lands.ts"
import { plain } from "./Kit.tsx"

useGLTF.preload(LANDS_URL)

/**
 * The island round the keep (ADR 0006). Hundreds of tiles and trees, drawn with instancing: one
 * InstancedMesh per piece type and material, so the whole island costs a few dozen draw calls
 * (docs/perf-budget.md).
 */
export function Island() {
  const { nodes } = useGLTF(LANDS_URL) as unknown as { nodes: Record<string, Object3D> }
  const { mood, progress } = useGuild()
  const land = useMemo(() => island(), [])
  const meshes = useMemo(() => instance(nodes, [...land.tiles, ...land.decor]), [nodes, land])
  useMemo(() => soften(nodes), [nodes])
  const roads = useMemo(() => roadGeometry(), [])
  const roadMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: mood.road,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [mood.road],
  )
  const building = yardBuilding(progress)
  const yard = SITES.yard.at

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-1.2} receiveShadow>
        <circleGeometry args={[420, 64]} />
        <meshStandardMaterial color={mood.sea} roughness={0.9} />
      </mesh>
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
      <mesh geometry={roads} material={roadMaterial} receiveShadow />
      <YardBuilding nodes={nodes} piece={building} at={yard} />
    </group>
  )
}

/**
 * The hexagon pack's palette is a loud lime next to the hall: multiply every land material by a
 * cool grey-green once, so the island sits back and the keep and characters lead.
 */
const SOFTEN = new Color("#bdd3c6")
const softened = new WeakSet<Material>()
function soften(nodes: Record<string, Object3D>): void {
  for (const node of Object.values(nodes)) {
    node.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as MeshStandardMaterial
      if (softened.has(material)) return
      softened.add(material)
      material.color.multiply(SOFTEN)
    })
  }
}

/** The yard's building: swaps to the next stage as edits complete. */
function YardBuilding({
  nodes,
  piece,
  at,
}: {
  nodes: Record<string, Object3D>
  piece: LandPiece
  at: readonly [number, number]
}) {
  const object = useMemo(() => {
    const source = nodes[piece]
    if (!source) return null
    const copy = source.clone(true)
    copy.traverse((child) => {
      const mesh = child as Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    return copy
  }, [nodes, piece])
  if (!object) return null
  return <primitive object={object} position={[at[0], 0, at[1]]} scale={HEX_SCALE * 1.5} rotation-y={-0.4} />
}

/** Every placement grouped by piece; each piece's parts merged per material; one InstancedMesh each. */
function instance(nodes: Record<string, Object3D>, placements: readonly LandPlacement[]): InstancedMesh[] {
  const byPiece = new Map<LandPiece, LandPlacement[]>()
  for (const placement of placements)
    byPiece.set(placement.piece, [...(byPiece.get(placement.piece) ?? []), placement])

  const out: InstancedMesh[] = []
  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  const up = new Vector3(0, 1, 0)

  for (const [piece, list] of byPiece) {
    const source = nodes[piece]
    if (!source) continue
    // The piece's own parts, in the piece's space, merged per material.
    source.updateMatrixWorld(true)
    const inverse = source.matrixWorld.clone().invert()
    const parts = new Map<Material, BufferGeometry[]>()
    source.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      const local = inverse.clone().multiply(mesh.matrixWorld)
      const geometry = plain(mesh.geometry).applyMatrix4(local)
      const material = mesh.material as Material
      parts.set(material, [...(parts.get(material) ?? []), geometry])
    })
    for (const [material, geometries] of parts) {
      const merged = mergeGeometries(geometries)
      if (!merged) continue
      const mesh = new InstancedMesh(merged, material, list.length)
      list.forEach((placement, i) => {
        position.set(placement.x, placement.y ?? 0, placement.z)
        rotation.setFromAxisAngle(up, placement.rot ?? 0)
        scale.setScalar(HEX_SCALE * (placement.scale ?? 1))
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale))
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.castShadow = !piece.startsWith("hex_")
      mesh.receiveShadow = true
      out.push(mesh)
    }
  }
  return out
}

const ROAD_WIDTH = 3.4

/** Every road as a flat ribbon, with round joints at the nodes, merged into one mesh. */
function roadGeometry(): BufferGeometry {
  const pieces: BufferGeometry[] = []
  const edges: (readonly [readonly [number, number], readonly [number, number]])[] = [
    [[0, 13.6], ROAD_NODES.OUT],
    ...ROAD_EDGES.map(([a, b]) => [ROAD_NODES[a], ROAD_NODES[b]] as const),
  ]
  for (const [a, b] of edges) {
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const length = Math.hypot(dx, dz) || 1
    const nx = (-dz / length) * (ROAD_WIDTH / 2)
    const nz = (dx / length) * (ROAD_WIDTH / 2)
    const quad = new BufferGeometry()
    const y = 0.04
    quad.setAttribute(
      "position",
      new Float32BufferAttribute(
        [a[0] + nx, y, a[1] + nz, a[0] - nx, y, a[1] - nz, b[0] + nx, y, b[1] + nz, b[0] - nx, y, b[1] - nz],
        3,
      ),
    )
    quad.setAttribute("normal", new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
    quad.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
    quad.setIndex([0, 2, 1, 1, 2, 3])
    pieces.push(quad)
  }
  for (const node of Object.values(ROAD_NODES)) {
    const disc = new CircleGeometry(ROAD_WIDTH / 2, 16)
      .rotateX(-Math.PI / 2)
      .translate(node[0], 0.04, node[1])
    pieces.push(plain(disc))
  }
  const merged = mergeGeometries(pieces.map((piece) => plain(piece)))
  if (!merged) throw new Error("roads could not be merged")
  return merged
}
