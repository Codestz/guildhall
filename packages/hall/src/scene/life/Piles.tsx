import { useFrame } from "@react-three/fiber"
import {
  BatchedMesh,
  type BufferGeometry,
  Color,
  Euler,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three"
import {
  CAPACITY,
  hash,
  heapSlot,
  hitSlot,
  logSlot,
  missSlot,
  rackSlot,
  type Slot,
  stackSlot,
  type Traces,
} from "../../guild/traces.ts"
import { pilesOf } from "../../world/behaviours.ts"
import { HEX_SCALE } from "../../world/lands.ts"
import { useWorld } from "../../world/source.ts"
import type { World } from "../../world/world.ts"
import { useOwnedMeshes } from "../owned.ts"
import { type Pile, TARGET_FACE, targets } from "./places.ts"
import { arrowGeometry, bookGeometry, COVERS, fishGeometry, logGeometry, stoneGeometry } from "./shapes.ts"
import { life } from "./state.ts"

/**
 * Work leaves traces (ADR 0007, Life; counts in traces.ts): logs by the lumber mill, stones by the
 * quarry, fish on the river rack, books by the tower, arrows in the proving grounds' targets —
 * failed deeds are arrows that missed, red-fletched and stuck in the ground. Every trace is a slot
 * in one BatchedMesh (one draw call, no shadow pass: piles are low); a new one grows in. Where the
 * piles lie is the world's (world/behaviours.ts `pilesOf`: on a repo's island, by each site's posts).
 */
interface Item {
  kind: keyof Traces
  /** Its index within its kind: shown while index < count. */
  index: number
  id: number
  matrix: Matrix4
  grown: number
}

export function TracePiles() {
  const world = useWorld()
  // Batch and material are this mount's own (scene/owned.ts).
  const built = useOwnedMeshes(() => build(world), [world])

  useFrame((_, delta) => {
    const mesh = built?.meshes[0]
    if (!built || !mesh) return
    const counts = life.traces
    const dt = Math.min(delta, 0.1)
    for (const item of built.items) {
      const want = item.index < Math.min(counts[item.kind], CAPACITY[item.kind]) ? 1 : 0
      if (item.grown === want) continue
      // Grows in over ~0.4 s; a reset (seek, new run) clears at once.
      item.grown = want === 0 ? 0 : Math.min(1, item.grown + dt * 2.5)
      mesh.setVisibleAt(item.id, item.grown > 0)
      if (item.grown > 0) {
        const s = MathUtils.smoothstep(item.grown, 0, 1) * (1 + 0.15 * Math.sin(item.grown * Math.PI))
        scaled.makeScale(s, s, s)
        mesh.setMatrixAt(item.id, out.multiplyMatrices(item.matrix, scaled))
      }
    }
  })

  return built?.meshes[0] ? <primitive object={built.meshes[0]} /> : null
}

const scaled = new Matrix4()
const out = new Matrix4()

const MISSED = new Color("#e0473a")
const WHITE = new Color("#ffffff")

function build(world: World) {
  const piles = pilesOf(world)
  const shapes = {
    log: logGeometry(),
    stone: stoneGeometry(),
    fish: fishGeometry(),
    arrow: arrowGeometry(),
    books: COVERS.map(bookGeometry),
  }
  const geometries = [shapes.log, shapes.stone, shapes.fish, shapes.arrow, ...shapes.books]
  const total =
    CAPACITY.logs + CAPACITY.stones + CAPACITY.fish + CAPACITY.books + CAPACITY.hits + CAPACITY.misses
  let vertices = 0
  for (const geometry of geometries) vertices += geometry.getAttribute("position").count
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })
  const mesh = new BatchedMesh(total, vertices, 0, material)
  const ids = new Map(geometries.map((geometry) => [geometry, mesh.addGeometry(geometry)]))
  const items: Item[] = []
  const add = (
    kind: keyof Traces,
    index: number,
    geometry: BufferGeometry,
    matrix: Matrix4,
    tint = WHITE,
  ) => {
    const id = mesh.addInstance(ids.get(geometry) ?? 0)
    mesh.setColorAt(id, tint)
    mesh.setVisibleAt(id, false)
    items.push({ kind, index, id, matrix, grown: 0 })
  }

  for (let i = 0; i < CAPACITY.logs; i++) add("logs", i, shapes.log, onPile(piles.logs, logSlot(i)))
  for (let i = 0; i < CAPACITY.stones; i++) {
    const shade = 0.82 + hash(i + 40) * 0.3
    add(
      "stones",
      i,
      shapes.stone,
      onPile(piles.stones, heapSlot(i), 0.9 + hash(i) * 0.35),
      new Color(shade, shade, shade * 0.97),
    )
  }
  // The rack's pallet top: 0.08 in the piece's units, drawn at HEX_SCALE × 1.55 (Machines).
  for (let i = 0; i < CAPACITY.fish; i++)
    add("fish", i, shapes.fish, onPile(piles.fish, lift(rackSlot(i), 0.08 * HEX_SCALE * 1.55 + 0.05)))
  // Books a size up: readable as a library's stacks from the overview, not as a single volume.
  for (let i = 0; i < CAPACITY.books; i++)
    add(
      "books",
      i,
      shapes.books[Math.floor(hash(i + 5) * COVERS.length)] ?? shapes.log,
      onPile(piles.books, scaleSlot(stackSlot(i), BOOK), BOOK),
    )

  // Arrows: hits spread over the three targets' faces, misses in the grass in front of them.
  const boards = targets(world)
  for (let i = 0; i < CAPACITY.hits; i++) {
    const board = boards[i % boards.length]
    if (board) add("hits", i, shapes.arrow, inTarget(board, hitSlot(Math.floor(i / boards.length) + i)))
  }
  for (let i = 0; i < CAPACITY.misses; i++) {
    const board = boards[(i + 1) % boards.length]
    if (board) add("misses", i, shapes.arrow, inGround(board, missSlot(i)), MISSED)
  }

  mesh.sortObjects = false
  mesh.castShadow = false
  mesh.receiveShadow = true
  // Instances move (grow in) after this: cull each one by its own sphere, never the batch's.
  mesh.frustumCulled = false
  return { meshes: [mesh], items }
}

const UP = new Vector3(0, 1, 0)

function onPile(pile: Pile, [x, y, z, turn]: Slot, scale = 1): Matrix4 {
  const c = Math.cos(pile.yaw)
  const s = Math.sin(pile.yaw)
  return new Matrix4().compose(
    new Vector3(pile.x + x * c + z * s, y, pile.z - x * s + z * c),
    new Quaternion().setFromAxisAngle(UP, pile.yaw + turn),
    new Vector3(scale, scale, scale),
  )
}

const BOOK = 1.5

function scaleSlot([x, y, z, turn]: Slot, by: number): Slot {
  return [x * by, y * by, z * by, turn]
}

function lift([x, y, z, turn]: Slot, by: number): Slot {
  return [x, y + by, z, turn]
}

type Board = { x: number; z: number; rot: number; scale: number }

/** An arrow in the board: tip in the face, tail out towards the shooter (+z of the target). */
function inTarget(board: Board, [fx, fy, , tilt]: Slot): Matrix4 {
  const unit = HEX_SCALE * board.scale
  const radius = TARGET_FACE.radius * unit
  const local = new Vector3(
    fx * radius * 1.6,
    TARGET_FACE.y * unit + fy * radius * 1.6,
    TARGET_FACE.z * unit - 0.12,
  )
  const turn = new Quaternion().setFromAxisAngle(UP, board.rot)
  const position = local.applyQuaternion(turn).add(new Vector3(board.x, 0, board.z))
  const lean = new Quaternion().setFromEuler(new Euler(tilt * 0.6, tilt, 0))
  return new Matrix4().compose(position, turn.multiply(lean), new Vector3(1, 1, 1))
}

/** A missed arrow, tip in the grass in front of the board, tail leaning back up. */
function inGround(board: Board, [x, , z, lean]: Slot): Matrix4 {
  const turn = new Quaternion().setFromAxisAngle(UP, board.rot)
  const position = new Vector3(x, 0.15, z + 1.2).applyQuaternion(turn).add(new Vector3(board.x, 0, board.z))
  const down = new Quaternion().setFromEuler(new Euler(-(Math.PI / 2 - lean), (hash(x * 100) - 0.5) * 0.8, 0))
  return new Matrix4().compose(position, turn.multiply(down), new Vector3(1, 1, 1))
}
