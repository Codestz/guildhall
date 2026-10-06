import { useFrame } from "@react-three/fiber"
import {
  BatchedMesh,
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { HEX_SCALE } from "../../world/lands.ts"
import { useOwned } from "./owned.ts"
import { PILES, type Pile, TARGET_FACE, targets } from "./places.ts"
import { life } from "./state.ts"
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
} from "./traces.ts"

/**
 * Work leaves traces (ADR 0007, Life; counts in traces.ts): logs by the lumber mill, stones by the
 * quarry, fish on the river rack, books by the tower, arrows in the proving grounds' targets —
 * failed deeds are arrows that missed, red-fletched and stuck in the ground. Every trace is a slot
 * in one BatchedMesh (one draw call, no shadow pass: piles are low); a new one grows in.
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
  const built = useOwned(build, (made) => made.mesh.dispose(), "piles")

  useFrame((_, delta) => {
    if (!built) return
    const counts = life.traces
    const dt = Math.min(delta, 0.1)
    for (const item of built.items) {
      const want = item.index < Math.min(counts[item.kind], CAPACITY[item.kind]) ? 1 : 0
      if (item.grown === want) continue
      // Grows in over ~0.4 s; a reset (seek, new run) clears at once.
      item.grown = want === 0 ? 0 : Math.min(1, item.grown + dt * 2.5)
      built.mesh.setVisibleAt(item.id, item.grown > 0)
      if (item.grown > 0) {
        const s = MathUtils.smoothstep(item.grown, 0, 1) * (1 + 0.15 * Math.sin(item.grown * Math.PI))
        scaled.makeScale(s, s, s)
        built.mesh.setMatrixAt(item.id, out.multiplyMatrices(item.matrix, scaled))
      }
    }
  })

  return built ? <primitive object={built.mesh} /> : null
}

const scaled = new Matrix4()
const out = new Matrix4()

const BARK = new Color("#7b5536")
const CUT = new Color("#d8b07a")
const STONE = new Color("#9a9b98")
const FISH_BACK = new Color("#5f7f96")
const FISH_BELLY = new Color("#c9d6dc")
const SHAFT = new Color("#a98256")
const FLETCH = new Color("#f1ece0")
const TIP = new Color("#4a4d52")
const PAGES = new Color("#d9cfb4")
const COVERS = ["#8e3b33", "#2f5a8a", "#3f6e45", "#6d4a8a", "#8a6a2f"].map((c) => new Color(c))
const MISSED = new Color("#e0473a")
const WHITE = new Color("#ffffff")

function build() {
  const shapes = {
    log: logGeometry(),
    stone: paint(new IcosahedronGeometry(0.42, 0), () => STONE),
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

  for (let i = 0; i < CAPACITY.logs; i++) add("logs", i, shapes.log, onPile(PILES.logs, logSlot(i)))
  for (let i = 0; i < CAPACITY.stones; i++) {
    const shade = 0.82 + hash(i + 40) * 0.3
    add(
      "stones",
      i,
      shapes.stone,
      onPile(PILES.stones, heapSlot(i), 0.9 + hash(i) * 0.35),
      new Color(shade, shade, shade * 0.97),
    )
  }
  // The rack's pallet top: 0.08 in the piece's units, drawn at HEX_SCALE × 1.55 (Machines).
  for (let i = 0; i < CAPACITY.fish; i++)
    add("fish", i, shapes.fish, onPile(PILES.fish, lift(rackSlot(i), 0.08 * HEX_SCALE * 1.55 + 0.05)))
  // Books a size up: readable as a library's stacks from the overview, not as a single volume.
  for (let i = 0; i < CAPACITY.books; i++)
    add(
      "books",
      i,
      shapes.books[Math.floor(hash(i + 5) * COVERS.length)] ?? shapes.log,
      onPile(PILES.books, scaleSlot(stackSlot(i), BOOK), BOOK),
    )

  // Arrows: hits spread over the three targets' faces, misses in the grass in front of them.
  const boards = targets()
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
  return { mesh, items }
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

// ---- Shapes: low-poly, flat-shaded, coloured per vertex (KayKit's look, no texture) ----------------

/** Non-indexed, position + normal + color: every shape in the batch carries the same attributes. */
function paint(
  source: BufferGeometry,
  colour: (normal: Vector3, position: Vector3) => Color,
): BufferGeometry {
  const geometry = (source.index ? source.toNonIndexed() : source).clone()
  geometry.deleteAttribute("uv")
  geometry.computeVertexNormals()
  const positions = geometry.getAttribute("position")
  const normals = geometry.getAttribute("normal")
  const colors = new Float32Array(positions.count * 3)
  const n = new Vector3()
  const p = new Vector3()
  for (let i = 0; i < positions.count; i++) {
    n.fromBufferAttribute(normals, i)
    p.fromBufferAttribute(positions, i)
    const c = colour(n, p)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3))
  return geometry
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(parts) ?? parts[0] ?? new BoxGeometry()
}

/** A log lying along x: bark round the sides, pale cut ends. */
function logGeometry(): BufferGeometry {
  const log = new CylinderGeometry(0.3, 0.3, 2.3, 7, 1)
  // Colour by the cylinder's own normals (ends face ±y) before laying it down.
  const painted = paint(log, (normal) => (Math.abs(normal.y) > 0.9 ? CUT : BARK))
  painted.rotateZ(Math.PI / 2)
  painted.rotateY(Math.PI / 2)
  return painted
}

/** A fish lying on its side along x: dark back, pale belly, a tail fin. */
function fishGeometry(): BufferGeometry {
  const body = paint(new OctahedronGeometry(0.5, 0).scale(0.75, 0.12, 0.26), (_, p) =>
    p.z > 0.01 ? FISH_BACK : FISH_BELLY,
  )
  const tail = paint(
    new ConeGeometry(0.16, 0.28, 3)
      .rotateZ(Math.PI / 2)
      .scale(1, 0.4, 1)
      .translate(0.48, 0, 0),
    () => FISH_BACK,
  )
  return merge([body, tail])
}

/** An arrow along +z, its tip at the origin: dark tip, wooden shaft, pale fletching. */
function arrowGeometry(): BufferGeometry {
  const shaft = paint(
    new CylinderGeometry(0.035, 0.035, 1.25, 5).rotateX(Math.PI / 2).translate(0, 0, 0.7),
    () => SHAFT,
  )
  const tip = paint(new ConeGeometry(0.07, 0.2, 5).rotateX(-Math.PI / 2).translate(0, 0, 0.05), () => TIP)
  const vane = (turn: number) =>
    paint(new BoxGeometry(0.22, 0.012, 0.3).rotateZ(turn).translate(0, 0, 1.18), () => FLETCH)
  return merge([shaft, tip, vane(0), vane(Math.PI / 2)])
}

/** A closed book lying flat: coloured cover, cream page edges on three sides. */
function bookGeometry(cover: Color): BufferGeometry {
  return paint(new BoxGeometry(0.72, 0.15, 0.52), (normal) =>
    normal.x > 0.9 || Math.abs(normal.z) > 0.9 ? PAGES : cover,
  )
}
