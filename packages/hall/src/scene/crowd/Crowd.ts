import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type ColorRepresentation,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from "three"
import type { Grip } from "../grips.ts"
import { type BoneBake, boneMap } from "./bake.ts"
import { type CrowdUniforms, crowdMaterial, crowdUniforms } from "./material.ts"

/**
 * A crowd of adventurers drawn from the baked bone texture (bake.ts, material.ts): per model, one
 * InstancedMesh per part (body, tinted cape/hat), all members of that model in it. The parts of a
 * model — and any gear it holds — share one set of per-instance attributes (place, clip), so a
 * member is written once whatever it is made of. Nothing runs per member per frame: `time` is the
 * only per-frame write.
 *
 * A member's tint colours its model's tinted part, as Adventurer does (a quarter towards white).
 */

export interface Member {
  model: string
  /** Where the rig's root stands. */
  place: Matrix4
  clip: string
  tint?: ColorRepresentation
  /** Crowd-clock second it started the clip (before now: already that far in). */
  start?: number
  speed?: number
}

interface Troop {
  meshes: InstancedMesh[]
  /** Shared by every part of the troop. */
  places: InstancedBufferAttribute
  now: InstancedBufferAttribute
  was: InstancedBufferAttribute
  /** Member index of each slot. */
  members: number[]
}

/** How far a role colour goes towards white on a cape (Adventurer's tint). */
const TINT_LIFT = 0.25
const WHITE = new Color("#ffffff")

export class Crowd {
  readonly root = new Group()
  readonly uniforms: CrowdUniforms
  private readonly troops = new Map<string, Troop>()
  /** Member index → its troop and slot. */
  private readonly slots: { troop: Troop; slot: number }[] = []
  private readonly bake: BoneBake

  /**
   * `models`: each model's loaded scene (the glTF's, untouched: geometry and materials are shared,
   * not cloned per member). `fade`: seconds a clip change blends.
   */
  constructor(bake: BoneBake, models: Record<string, Object3D>, members: readonly Member[], fade = 0.25) {
    this.bake = bake
    this.uniforms = crowdUniforms(bake, fade)
    this.root.name = "crowd"
    const byModel = new Map<string, number[]>()
    members.forEach((member, i) => {
      const list = byModel.get(member.model) ?? []
      list.push(i)
      byModel.set(member.model, list)
    })
    for (const [model, indices] of byModel) {
      const source = models[model]
      if (!source) throw new Error(`Crowd: no model "${model}"`)
      const troop = this.muster(source, indices.length)
      troop.members = indices
      this.troops.set(model, troop)
      indices.forEach((member, slot) => {
        this.slots[member] = { troop, slot }
        const { place, clip, tint, start = 0, speed = 1 } = members[member] as Member
        troop.places.set(place.elements, slot * 16)
        const id = this.clipId(clip)
        troop.now.setXYZ(slot, id, start, speed)
        troop.was.setXYZ(slot, id, start, speed)
        const lifted = new Color(tint ?? WHITE).lerp(WHITE, TINT_LIFT)
        for (const mesh of troop.meshes) if (mesh.instanceColor) mesh.setColorAt(slot, lifted)
      })
    }
  }

  /** The crowd clock (seconds); members' `start` times are on it. */
  set time(seconds: number) {
    this.uniforms.crowdTime.value = seconds
  }

  get time(): number {
    return this.uniforms.crowdTime.value
  }

  /** Member `index` starts `clip` now, blending out of what it played. */
  play(index: number, clip: string, speed = 1): void {
    const { troop, slot } = this.slotOf(index)
    troop.was.setXYZ(slot, troop.now.getX(slot), troop.now.getY(slot), troop.now.getZ(slot))
    troop.now.setXYZ(slot, this.clipId(clip), this.time, speed)
    troop.was.needsUpdate = true
    troop.now.needsUpdate = true
  }

  /** Member `index` stands at `place` (its rig root). */
  place(index: number, place: Matrix4): void {
    const { troop, slot } = this.slotOf(index)
    troop.places.set(place.elements, slot * 16)
    troop.places.needsUpdate = true
  }

  /**
   * Every member of `model` holds `item` (a kit piece) in `grip`, riding the grip's bone straight
   * from the bake: one more draw per material of the item, nothing per member. Upright grips (kept
   * level each frame by `keepUpright`) are not supported: they ride the bone as it turns.
   */
  hold(model: string, item: Object3D, grip: Grip): InstancedMesh[] {
    const troop = this.troops.get(model)
    if (!troop) return []
    const bone = this.bake.bones.indexOf(grip.bone)
    const bindPose = this.bake.bindPoses[bone]
    if (!bindPose) throw new Error(`Crowd.hold: the rig has no bone "${grip.bone}"`)
    // A parentless copy: its matrices are the grip's alone, not wherever the kit keeps the piece.
    const copy = item.clone(true)
    copy.position.set(...grip.position)
    copy.rotation.set(...grip.rotation)
    copy.scale.setScalar(grip.scale)
    copy.updateMatrixWorld(true)
    const held: InstancedMesh[] = []
    copy.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      // Into the bone's bind frame, so riding its skinning matrix puts it in the hand.
      const geometry = floatCopy(mesh.geometry).applyMatrix4(
        new Matrix4().multiplyMatrices(bindPose, mesh.matrixWorld),
      )
      held.push(
        this.instanced(geometry, crowdMaterial(mesh.material as Material, this.uniforms, bone), troop),
      )
    })
    return held
  }

  /** Frees what the crowd made: its geometries (copies) and materials (clones). The bake stays. */
  dispose(): void {
    for (const troop of this.troops.values())
      for (const mesh of troop.meshes) {
        mesh.geometry.dispose()
        ;(mesh.material as Material).dispose()
        mesh.dispose()
      }
    this.root.clear()
  }

  /** One model's parts as InstancedMeshes, all reading the same per-instance attributes. */
  private muster(source: Object3D, count: number): Troop {
    const troop: Troop = {
      meshes: [],
      places: new InstancedBufferAttribute(new Float32Array(count * 16), 16),
      now: new InstancedBufferAttribute(new Float32Array(count * 3), 3),
      was: new InstancedBufferAttribute(new Float32Array(count * 3), 3),
      members: [],
    }
    source.traverse((node) => {
      const part = node as SkinnedMesh
      if (!part.isSkinnedMesh) return
      const map = boneMap(this.bake, part)
      if (!map) throw new Error(`Crowd: ${part.name} is not on the baked rig`)
      const geometry = shareGeometry(part.geometry, map)
      const mesh = this.instanced(geometry, crowdMaterial(part.material as Material, this.uniforms), troop)
      mesh.name = part.name
      if (/Tinted/.test(part.name))
        mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3)
    })
    return troop
  }

  private instanced(geometry: BufferGeometry, material: Material, troop: Troop): InstancedMesh {
    geometry.setAttribute("crowdNow", troop.now)
    geometry.setAttribute("crowdWas", troop.was)
    const mesh = new InstancedMesh(geometry, material, troop.places.count)
    mesh.instanceMatrix = troop.places
    // Posed bodies reach past their bind-pose bounds, and the places move: no culling (yet).
    mesh.frustumCulled = false
    troop.meshes.push(mesh)
    this.root.add(mesh)
    return mesh
  }

  private clipId(clip: string): number {
    const id = this.bake.clipIds.get(clip)
    if (id === undefined) throw new Error(`Crowd: no baked clip "${clip}"`)
    return id
  }

  private slotOf(index: number): { troop: Troop; slot: number } {
    const at = this.slots[index]
    if (!at) throw new Error(`Crowd: no member ${index}`)
    return at
  }
}

/**
 * A model part's geometry for the crowd: the loaded one's attributes shared (never copied), but
 * its joints renumbered into the bake's bone order.
 */
function shareGeometry(source: BufferGeometry, map: readonly number[]): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setIndex(source.index)
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute)
  const joints = source.getAttribute("skinIndex")
  const renumbered = new Uint8Array(joints.count * 4)
  for (let i = 0; i < joints.count; i++)
    for (let k = 0; k < 4; k++) renumbered[i * 4 + k] = map[joints.getComponent(i, k)] ?? 0
  geometry.setAttribute("skinIndex", new BufferAttribute(renumbered, 4))
  return geometry
}

/**
 * A copy of a kit piece's geometry with float positions and normals. The kit is quantized
 * (KHR_mesh_quantization: normalized int16), and moving it in place would clamp it to the int range.
 */
function floatCopy(source: BufferGeometry): BufferGeometry {
  const geometry = source.clone()
  for (const name of ["position", "normal"]) {
    const attribute = source.getAttribute(name)
    if (!attribute || attribute.array instanceof Float32Array) continue
    const floats = new Float32Array(attribute.count * 3)
    for (let i = 0; i < attribute.count; i++)
      for (let k = 0; k < 3; k++) floats[i * 3 + k] = attribute.getComponent(i, k)
    geometry.setAttribute(name, new BufferAttribute(floats, 3))
  }
  return geometry
}
