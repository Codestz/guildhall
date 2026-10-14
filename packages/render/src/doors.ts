/**
 * Doors that open (decisions.md "doors are dynamic"), at about no cost: only what moves is drawn apart.
 *
 * Gates: a gate piece whose leaves are nodes of their own (KayKit's wall and fence gates, the
 * Halloween arch and fence gates, Kenney's fence gates) is drawn as its frame in the static batch
 * (`gateFrame`: the piece without its leaves, under the id `<piece>#frame`) and its leaves as a few
 * small instanced meshes, each leaf turned on its hinge (the leaf's outer end, inside the frame). A
 * leaf swings inward (the piece's −z: a curtain wall's yard side), eased, over GATE_SWING seconds;
 * a still gate costs nothing a frame.
 *
 * Doorways: a building's door is baked into its mesh, so an open door is drawn over it: a dark (by
 * night, lamplit) slab on the door's face that grows from the door's free edge as the door swings in,
 * shrinks back as it closes. One instanced quad for all of them, as many instances as doors are open.
 */
import {
  Box3,
  type BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three"
import { type BatchInstance, instanceMatrix } from "./batch.ts"
import { batchGeometry } from "./batchGeometry.ts"
import { paletteMaterial } from "./material.ts"
import type { Stage } from "./stage.ts"

/** Gate pieces whose leaves are nodes of their own. */
export const GATE_PIECES: ReadonlySet<string> = new Set([
  "kaykit-hexagon/wall-straight-gate",
  "kaykit-hexagon/wall-corner-a-gate",
  "kaykit-hexagon/fence-stone-straight-gate",
  "kaykit-hexagon/fence-wood-straight-gate",
  "kaykit-halloween/arch-gate",
  "kaykit-halloween/fence-gate",
  "kenney-nature/fence-gate",
  "kenney-town/fence-gate",
])

/** The id a gate's frame is batched under. */
export const FRAME = "#frame"

/** Whether a node of a gate piece is one of its leaves (KayKit `_door…`, `_left`, `_right`; Kenney `gate`). */
export const isLeaf = (name: string): boolean => /door|_left$|_right$|^gate$/.test(name)

/** Seconds a gate takes to swing open or shut. */
export const GATE_SWING = 0.8
/** How far a leaf swings in, radians. */
const GATE_OPEN = (Math.PI / 180) * 88

/** A gate piece's frame: the piece (a copy, as `load` gives it) without its leaves. */
export function gateFrame(root: Object3D): Object3D {
  const leaves: Object3D[] = []
  root.traverse((node) => {
    if (node !== root && isLeaf(node.name)) leaves.push(node)
  })
  for (const leaf of leaves) leaf.removeFromParent()
  return root
}

const ease = (t: number) => t * t * (3 - 2 * t)

interface Leaf {
  /** The leaf in the batch's vertex format, its hinge at the origin. */
  geometry: BufferGeometry
  /** Its hinge in the piece's space. */
  hinge: Vector3
  /** The turn (radians about +y) that swings it fully open, inward. */
  open: number
}

/** A gate piece's leaves, each on its hinge: the leaf's end away from the gate's middle. */
function leavesOf(root: Object3D): Leaf[] {
  root.updateWorldMatrix(true, true)
  const out: Leaf[] = []
  const toRoot = new Matrix4().copy(root.matrixWorld).invert()
  const nodes: Object3D[] = []
  root.traverse((node) => {
    if (node !== root && isLeaf(node.name)) nodes.push(node)
  })
  for (const node of nodes) {
    const geometry = batchGeometry(node)
    // batchGeometry bakes in node space (its own root): into the piece's space
    geometry.applyMatrix4(new Matrix4().multiplyMatrices(toRoot, node.matrixWorld))
    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new Box3()
    const cx = (box.min.x + box.max.x) / 2
    const cz = (box.min.z + box.max.z) / 2
    const alongX = box.max.x - box.min.x >= box.max.z - box.min.z
    let hinge: Vector3
    if (alongX) {
      // a leaf off the middle hangs on its outer end; one across the whole gate on its −x end
      const end = Math.abs(cx) > 0.05 * (box.max.x - box.min.x) ? (cx > 0 ? box.max.x : box.min.x) : box.min.x
      hinge = new Vector3(end, box.min.y, cz)
    } else {
      const end = Math.abs(cz) > 0.05 * (box.max.z - box.min.z) ? (cz > 0 ? box.max.z : box.min.z) : box.min.z
      hinge = new Vector3(cx, box.min.y, end)
    }
    geometry.translate(-hinge.x, -hinge.y, -hinge.z)
    // swing the free end toward −z (inward)
    const ex = cx - hinge.x
    const open = ex >= 0 ? GATE_OPEN : -GATE_OPEN
    out.push({ geometry, hinge, open: alongX ? open : GATE_OPEN })
  }
  return out
}

export interface Gates {
  /** Gates placed. */
  readonly count: number
  /** Where each gate stands (its piece's place), in their order. */
  readonly at: readonly [number, number, number][]
  /** Eases each gate toward open (`want(i)` true) or shut; touches only gates still moving. */
  update(dt: number, want: (i: number) => boolean): void
  /** Each gate's opening, 0 shut to 1 open. */
  opening(i: number): number
  /** Keeps the gates standing where `at` says out of the draw (a history replay: tiles not yet there). */
  hide(at: ((x: number, z: number) => boolean) | null): void
  dispose(): void
}

/**
 * The leaves of every gate in `placed` (pieces in GATE_PIECES), drawn on their hinges in a few
 * instanced meshes (one per kind of leaf). `load` loads a piece as a copy of its scene graph. Gates
 * start open.
 */
export async function createGates(
  stage: Pick<Stage, "scene">,
  placed: readonly BatchInstance[],
  load: (piece: string) => Promise<Object3D>,
): Promise<Gates> {
  const gates = placed.filter((p) => GATE_PIECES.has(p.piece))
  const kinds = new Map<string, Leaf[]>()
  for (const id of new Set(gates.map((g) => g.piece))) kinds.set(id, leavesOf(await load(id)))
  /** One instanced mesh per kind of leaf, and each gate's slot in it. */
  const meshes: { mesh: InstancedMesh; leaf: Leaf }[] = []
  const slots: { mesh: number; slot: number; leaf: Leaf }[][] = gates.map(() => [])
  for (const [id, leaves] of kinds) {
    const of = gates.map((g, k) => (g.piece === id ? k : -1)).filter((k) => k >= 0)
    for (const leaf of leaves) {
      const mesh = new InstancedMesh(leaf.geometry, paletteMaterial(), of.length)
      mesh.name = `gate-leaf:${id}`
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      // a moving leaf would leave the cached sun shadows stale: its frame casts, it only receives
      mesh.castShadow = false
      mesh.receiveShadow = true
      of.forEach((k, slot) => {
        slots[k]!.push({ mesh: meshes.length, slot, leaf })
      })
      meshes.push({ mesh, leaf })
      stage.scene.add(mesh)
    }
  }
  const base = gates.map((g) => instanceMatrix(g))
  const value = gates.map(() => 1)
  const hidden = gates.map(() => false)
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const m = new Matrix4()
  const local = new Matrix4()
  const one = new Vector3(1, 1, 1)
  const zero = new Vector3(0, 0, 0)
  const pose = (k: number) => {
    const a = ease(value[k]!)
    for (const s of slots[k]!) {
      turn.setFromAxisAngle(up, s.leaf.open * a)
      local.compose(s.leaf.hinge, turn, one)
      m.multiplyMatrices(base[k]!, local)
      // a hidden gate's leaves collapse to a point
      if (hidden[k]) m.scale(zero)
      meshes[s.mesh]!.mesh.setMatrixAt(s.slot, m)
    }
  }
  gates.forEach((_, k) => {
    pose(k)
  })
  for (const { mesh } of meshes) {
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }
  return {
    count: gates.length,
    at: gates.map((g) => [g.x, g.y, g.z] as [number, number, number]),
    update(dt, want) {
      const moved = new Set<number>()
      for (let k = 0; k < gates.length; k++) {
        const to = want(k) ? 1 : 0
        const v = value[k]!
        if (v === to) continue
        value[k] = to > v ? Math.min(1, v + dt / GATE_SWING) : Math.max(0, v - dt / GATE_SWING)
        pose(k)
        for (const s of slots[k]!) moved.add(s.mesh)
      }
      for (const i of moved) meshes[i]!.mesh.instanceMatrix.needsUpdate = true
    },
    opening: (k) => value[k] ?? 0,
    hide(at) {
      const moved = new Set<number>()
      gates.forEach((g, k) => {
        const h = at?.(g.x, g.z) ?? false
        if (h === hidden[k]) return
        hidden[k] = h
        pose(k)
        for (const s of slots[k]!) moved.add(s.mesh)
      })
      for (const i of moved) meshes[i]!.mesh.instanceMatrix.needsUpdate = true
    },
    dispose() {
      for (const { mesh, leaf } of meshes) {
        mesh.removeFromParent()
        mesh.dispose()
        leaf.geometry.dispose()
      }
    },
  }
}

/** A door's rectangle in the world: the middle of its foot on its face, its size, the way it looks out. */
export interface DoorwayRect {
  x: number
  y: number
  z: number
  w: number
  h: number
  /** Radians about +y, 0 = +z. */
  facing: number
}

export interface Doorways {
  /** Draws doors `open[k]` (0 shut … 1 wide open) of the doorway list; every other door shut. */
  show(open: ReadonlyMap<number, number>): void
  /** How lit the insides are (0 day … 1 night: lamplight in the doorway). */
  setNight(k: number): void
  /** Doors drawn open last frame. */
  readonly drawn: number
  dispose(): void
}

const DARK = new Color("#1a120c")
const LAMP = new Color("#c9772f")

/** The open-door slabs over the baked doors of `rects`. */
export function createDoorways(stage: Pick<Stage, "scene">, rects: readonly DoorwayRect[]): Doorways {
  // a unit quad from (0, 0) to (1, 1), looking +z
  const quad = new PlaneGeometry(1, 1)
  quad.translate(0.5, 0.5, 0)
  const material = new MeshBasicMaterial({
    color: DARK.clone(),
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  // room for every door (a few hundred quads' matrices): only the open ones are drawn
  const max = Math.max(1, rects.length)
  const mesh = new InstancedMesh(quad, material, max)
  mesh.name = "doorways"
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  stage.scene.add(mesh)
  const m = new Matrix4()
  const t = new Matrix4()
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const at = new Vector3()
  const size = new Vector3()
  let drawn = 0
  return {
    show(open) {
      let n = 0
      for (const [k, v] of open) {
        const r = rects[k]
        if (!r || v <= 0 || n >= max) continue
        // the door swings in on its hinge (its left, looking at it): the gap it leaves from its free edge
        const gap = r.w * (1 - Math.cos((ease(Math.min(1, v)) * Math.PI) / 2))
        if (gap < 0.01) continue
        const nx = Math.sin(r.facing)
        const nz = Math.cos(r.facing)
        turn.setFromAxisAngle(up, r.facing)
        // a hair off the face, so it never fights the baked door
        at.set(r.x + nx * 0.03, r.y, r.z + nz * 0.03)
        m.compose(at, turn, size.set(1, 1, 1))
        t.compose(at.set(r.w / 2 - gap, 0, 0), new Quaternion(), size.set(gap, r.h, 1))
        m.multiply(t)
        mesh.setMatrixAt(n++, m)
      }
      if (n === 0 && drawn === 0) return
      mesh.count = n
      drawn = n
      mesh.instanceMatrix.needsUpdate = true
    },
    setNight(k) {
      material.color.copy(DARK).lerp(LAMP, Math.max(0, Math.min(1, k)))
    },
    get drawn() {
      return drawn
    },
    dispose() {
      mesh.removeFromParent()
      mesh.dispose()
      quad.dispose()
      material.dispose()
    },
  }
}
