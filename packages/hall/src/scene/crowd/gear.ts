import { type Material, Matrix4, type Mesh, type Object3D, Vector3 } from "three"
import { KIT_GRIPS, PROP_GRIPS } from "../grips.ts"
import type { Gear } from "./Crowd.ts"

/**
 * What a body holds, read off its bones for the crowd (crowd/Crowd.ts `carry`). Everything held is
 * attached to a bone of the body's own rig — the trade's gear (Adventurer useHeld), the work loop's
 * props (scene/activity.ts), a guildmaster's back-banner — and shown or hidden there each frame. A
 * crowd member's body is not drawn, but its hands are still kept: the crowd draws each visible
 * piece riding the same bone, so what is held is decided in one place for both bodies.
 *
 * Pieces are the same Gear object for the same geometry, material and grip, whoever holds them:
 * everyone holding a hammer the same way is one troop, one draw.
 */

/** The bones gear rides: every grip's, and the chest (loads in both arms, the back-banner). */
export const GEAR_BONES: readonly string[] = [
  ...new Set(
    [...Object.values(KIT_GRIPS), ...Object.values(PROP_GRIPS)].map((grip) => grip.bone).concat("chest"),
  ),
]

const known = new Map<string, Gear>()
const byMesh = new WeakMap<Mesh, Gear>()

/**
 * The pieces shown on `sockets` (a body's GEAR_BONES) now, into `out` (cleared first). A piece is
 * shown when it and everything between it and its bone is visible.
 */
export function gearOf(sockets: readonly Object3D[], out: Gear[]): Gear[] {
  out.length = 0
  for (const bone of sockets)
    for (const child of bone.children) if (!(child as { isBone?: boolean }).isBone) collect(child, bone, out)
  return out
}

function collect(node: Object3D, bone: Object3D, out: Gear[]): void {
  if (!node.visible) return
  const mesh = node as Mesh
  if (mesh.isMesh && !Array.isArray(mesh.material)) out.push(pieceOf(mesh, bone))
  for (const child of node.children) collect(child, bone, out)
}

/** The Gear for `mesh` on `bone`: made once per distinct piece and grip, then reused. */
export function pieceOf(mesh: Mesh, bone: Object3D): Gear {
  const material = mesh.material as Material
  const cached = byMesh.get(mesh)
  if (cached && cached.material === material) return cached
  const matrix = new Matrix4()
  let up: Vector3 | undefined
  const chain: Object3D[] = []
  for (let node: Object3D | null = mesh; node && node !== bone; node = node.parent) chain.push(node)
  for (const node of chain.reverse()) {
    // A levelled grip's pivot turns every frame (keepUpright): its piece is kept unturned, and its
    // up axis — in the pivot's frame, as keepUpright reads it — leveled by the crowd's shader.
    if (node.userData.upright) {
      const held = node.children[0]
      up = (node.userData.up as Vector3 | undefined)?.clone() ?? new Vector3(0, 1, 0)
      if (held) up.applyQuaternion(held.quaternion)
      continue
    }
    node.updateMatrix()
    matrix.multiply(node.matrix)
  }
  const key = [
    mesh.geometry.uuid,
    material.uuid,
    bone.name,
    ...matrix.elements.map((value) => value.toFixed(4)),
    up ? up.toArray().map((value) => value.toFixed(4)) : "",
  ].join("|")
  let gear = known.get(key)
  if (!gear) {
    gear = { geometry: mesh.geometry, material, bone: bone.name, matrix, ...(up ? { up } : {}) }
    known.set(key, gear)
  }
  byMesh.set(mesh, gear)
  return gear
}
