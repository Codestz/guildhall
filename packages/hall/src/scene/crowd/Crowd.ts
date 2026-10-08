import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type ColorRepresentation,
  DataTexture,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  NearestFilter,
  type Object3D,
  RGBAFormat,
  type SkinnedMesh,
  Sphere,
  type Vector3,
} from "three"
import type { Grip } from "../grips.ts"
import { type BakedClip, type BoneBake, boneMap, frameAt } from "./bake.ts"
import { type CrowdUniforms, crowdMaterial, crowdUniforms, STAGE_ROW, TEXELS_PER_MEMBER } from "./material.ts"

/**
 * A crowd of adventurers drawn from the baked bone texture (bake.ts, material.ts): per model, one
 * InstancedMesh per part (body, tinted cape/hat), every member of that model in it; per piece of
 * gear, one InstancedMesh riding its bone, every member who holds it in it.
 *
 * Every member's place and clips live in one small float texture, the stage (material.ts): a troop's
 * slot only says which member it draws. So a member is written once whatever it is made of and
 * holds, and a frame uploads one texture for the whole crowd (a buffer per troop rewritten every
 * frame cost ~0.8 ms in stalls on ANGLE/Metal).
 *
 * Members come and go (`join`, `leave`): a troop keeps its members packed in slots 0…count-1 (a
 * leaver's slot takes the last member's), and grows by doubling. Per frame the cast writes each
 * member's place, then `flush()` uploads the stage and fits each troop's bounds (padded for the
 * posed body and what it holds), so a troop wholly off screen is culled.
 *
 * The crowd's clock is `time` (seconds, double precision): setting it works out every member's
 * rows (bake.ts frameAt) for the stage. The shader never sees the clock, so a long-running page
 * never loses float32 precision in it.
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

/**
 * A piece of gear on a bone (crowd/gear.ts reads them off a body): one troop per distinct gear.
 * The same object must be passed for the same gear (the crowd keys its troops by identity).
 */
export interface Gear {
  geometry: BufferGeometry
  material: Material
  /** The rig bone it rides (its name). */
  bone: string
  /** The piece in the bone's own frame (for a levelled grip, with the pivot unturned). */
  matrix: Matrix4
  /** Levelled (scene/grips.ts `upright`): the piece's own up, in the bone's frame. */
  up?: Vector3
}

/** A member's place in one troop. `slot` moves when another member leaves. */
interface Seat {
  troop: Troop
  slot: number
  member: number
}

interface Part {
  geometry: BufferGeometry
  material: Material
  tinted: boolean
  name: string
}

/** One clip state: what it plays, from when (crowd seconds) and how fast. */
interface Play {
  clip: number
  start: number
  speed: number
}

interface Enrolled {
  body: Seat
  gear: Map<Gear, Seat>
  tint: Color
  now: Play
  was: Play
}

/** How far a role colour goes towards white on a cape (Adventurer's tint). */
const TINT_LIFT = 0.25
const WHITE = new Color("#ffffff")
/** A troop's bounds reach this far past its members' roots: a posed body, a staff, a banner. */
const REACH = 3
/** Slots a troop starts with. */
const FIRST_CAPACITY = 16
/** Floats per member in the stage: place (x, y, z, yaw), frames (row, blend, row, blend), fade. */
const STAGE_FLOATS = TEXELS_PER_MEMBER * 4
const FRAMES = 4
const FADE = 8

export class Crowd {
  readonly root = new Group()
  readonly uniforms: CrowdUniforms
  private readonly bake: BoneBake
  private readonly models: Record<string, Object3D>
  private readonly troops = new Map<string, Troop>()
  private readonly geared = new Map<Gear, Troop>()
  private readonly members: (Enrolled | undefined)[] = []
  private readonly free: number[] = []
  private stage: DataTexture
  private clock = 0
  private readonly fade: number

  /**
   * `models`: each model's loaded scene (the glTF's, untouched: geometry and materials are shared,
   * not cloned per member). `members`: who stands there from the start (ids 0…n-1, in order).
   * `fade`: seconds a clip change blends.
   */
  constructor(
    bake: BoneBake,
    models: Record<string, Object3D>,
    members: readonly Member[] = [],
    fade = 0.25,
  ) {
    this.bake = bake
    this.models = models
    this.uniforms = crowdUniforms(bake)
    this.fade = fade
    this.stage = stageTexture(STAGE_ROW)
    this.uniforms.crowdStage.value = this.stage
    this.root.name = "crowd"
    for (const member of members) {
      const id = this.join(member.model, member.tint)
      const at = member.start ?? 0
      const speed = member.speed ?? 1
      this.start(id, member.clip, (this.time - at) * speed, speed)
      this.place(id, member.place)
    }
    this.flush()
  }

  /** The crowd clock (seconds); members' `start` times are on it. Setting it poses everyone. */
  set time(seconds: number) {
    this.clock = seconds
    for (let id = 0; id < this.members.length; id++) this.pose(id)
  }

  get time(): number {
    return this.clock
  }

  /** How many members stand in the crowd now. */
  get size(): number {
    return this.members.length - this.free.length
  }

  /** A new member of `model`'s troop, standing at the origin in its first clip. Returns its id. */
  join(model: string, tint?: ColorRepresentation): number {
    const troop = this.troopOf(model)
    const id = this.free.pop() ?? this.members.length
    if ((id + 1) * STAGE_FLOATS > this.stageData.length) this.growStage()
    this.stageData.fill(0, id * STAGE_FLOATS, (id + 1) * STAGE_FLOATS)
    const member: Enrolled = {
      body: { troop, slot: -1, member: id },
      gear: new Map(),
      tint: new Color(tint ?? WHITE).lerp(WHITE, TINT_LIFT),
      now: { clip: 0, start: this.clock, speed: 1 },
      was: { clip: 0, start: this.clock, speed: 1 },
    }
    this.members[id] = member
    this.pose(id)
    troop.enrol(member.body)
    troop.writeTint(member.body.slot, member.tint)
    return id
  }

  /** Member `id` leaves: its slots go to others. */
  leave(id: number): void {
    const member = this.memberOf(id)
    member.body.troop.unseat(member.body)
    for (const seat of member.gear.values()) seat.troop.unseat(seat)
    this.members[id] = undefined
    this.free.push(id)
  }

  /** Member `id` plays `clip` from `phase` seconds into it, now, with no blend. */
  start(id: number, clip: string, phase: number, speed = 1): void {
    const { now, was } = this.memberOf(id)
    now.clip = this.clipId(clip)
    // Started far enough back that it is `phase` in, and long enough ago that no fade is left.
    now.start = this.clock - phase / speed
    now.speed = speed
    Object.assign(was, now)
    this.pose(id, true)
  }

  /** Member `id` starts `clip` now, blending out of what it played. */
  play(id: number, clip: string, speed = 1): void {
    const { now, was } = this.memberOf(id)
    Object.assign(was, now)
    now.clip = this.clipId(clip)
    now.start = this.clock
    now.speed = speed
    this.pose(id)
  }

  /**
   * What member `id` plays at crowd second `at` (default now): the clip's name and how far into it
   * (wrapped for a loop, held at the end for a clip played once), as the shader draws it.
   */
  phaseOf(id: number, at = this.time): { clip: string; time: number } {
    const { now } = this.memberOf(id)
    const clip = this.bake.clips[now.clip]
    if (!clip) throw new Error(`Crowd: member ${id} plays no clip`)
    const elapsed = (at - now.start) * now.speed
    const time = clip.loop
      ? elapsed - Math.floor(elapsed / clip.duration) * clip.duration
      : Math.min(clip.duration, Math.max(0, elapsed))
    return { clip: clip.name, time }
  }

  /** Member `id` stands at `place` (its rig root: upright, turned about y only). */
  place(id: number, place: Matrix4): void {
    this.memberOf(id)
    const e = place.elements
    const at = id * STAGE_FLOATS
    const data = this.stageData
    data[at] = e[12] as number
    data[at + 1] = e[13] as number
    data[at + 2] = e[14] as number
    // makeRotationY(θ): e[0] = cos θ, e[8] = sin θ.
    data[at + 3] = Math.atan2(e[8] as number, e[0] as number)
    this.stage.needsUpdate = true
  }

  /** Member `id`'s tint (its model's tinted part). */
  tint(id: number, tint: ColorRepresentation): void {
    const member = this.memberOf(id)
    member.tint.set(tint).lerp(WHITE, TINT_LIFT)
    member.body.troop.writeTint(member.body.slot, member.tint)
  }

  /** Member `id` holds exactly `gear` now (each piece riding its bone); what it held before goes. */
  carry(id: number, gear: readonly Gear[]): void {
    const member = this.memberOf(id)
    for (const [piece, seat] of member.gear)
      if (!gear.includes(piece)) {
        seat.troop.unseat(seat)
        member.gear.delete(piece)
      }
    for (const piece of gear) {
      if (member.gear.has(piece)) continue
      const seat: Seat = { troop: this.gearTroop(piece), slot: -1, member: id }
      member.gear.set(piece, seat)
      seat.troop.enrol(seat)
    }
  }

  /**
   * Every member of `model` holds `item` (a kit piece) in `grip`, riding the grip's bone straight
   * from the bake: one more draw per material of the item, nothing per member (the lab's way; the
   * cast gives each member its own gear with `carry`). Levelled grips ride the bone as it turns.
   */
  hold(model: string, item: Object3D, grip: Grip): InstancedMesh[] {
    const troop = this.troops.get(model)
    if (!troop) return []
    const bone = this.boneIndex(grip.bone)
    // A parentless copy: its matrices are the grip's alone, not wherever the kit keeps the piece.
    const copy = item.clone(true)
    copy.position.set(...grip.position)
    copy.rotation.set(...grip.rotation)
    copy.scale.setScalar(grip.scale)
    copy.updateMatrixWorld(true)
    const before = troop.meshes.length
    copy.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      troop.addPart({
        geometry: this.gearGeometry(mesh.geometry, bone, mesh.matrixWorld),
        material: crowdMaterial(mesh.material as Material, this.uniforms, bone),
        tinted: false,
        name: mesh.name,
      })
    })
    return troop.meshes.slice(before)
  }

  /**
   * Once a frame, after every member's writes: each troop's slots go up if they changed and it fits
   * its bounds (an empty troop draws nothing). The stage goes up once, at the next draw.
   */
  flush(): void {
    const data = this.stageData
    for (const troop of this.troops.values()) troop.flush(data)
    for (const troop of this.geared.values()) troop.flush(data)
  }

  /** Draw calls the crowd makes now (one per mesh of each non-empty troop, before culling). */
  get draws(): number {
    let calls = 0
    for (const troop of [...this.troops.values(), ...this.geared.values()])
      if (troop.count > 0) calls += troop.meshes.length
    return calls
  }

  /** Frees what the crowd made: its geometries (copies), materials (clones) and stage. The bake stays. */
  dispose(): void {
    for (const troop of [...this.troops.values(), ...this.geared.values()]) troop.dispose()
    this.troops.clear()
    this.geared.clear()
    this.stage.dispose()
    this.root.clear()
  }

  /**
   * Member `id`'s rows at the crowd's time into the stage: the clip it plays, the one it fades out
   * of, how far the fade is (`settled`: none left, the clip was started part-way in).
   */
  private pose(id: number, settled = false): void {
    const member = this.members[id]
    if (!member) return
    const data = this.stageData
    const at = id * STAGE_FLOATS
    const { now, was } = member
    const into = this.clock - now.start
    const faded = settled || this.fade <= 0 ? 1 : Math.min(1, Math.max(0, into / this.fade))
    const current = frameAt(this.bake.clips[now.clip] as BakedClip, into * now.speed)
    data[at + FRAMES] = current.row
    data[at + FRAMES + 1] = current.blend
    if (faded < 1) {
      const before = frameAt(this.bake.clips[was.clip] as BakedClip, (this.clock - was.start) * was.speed)
      data[at + FRAMES + 2] = before.row
      data[at + FRAMES + 3] = before.blend
    }
    data[at + FADE] = faded
    this.stage.needsUpdate = true
  }

  private get stageData(): Float32Array {
    return this.stage.image.data as Float32Array
  }

  /** Twice the stage's rows, everyone's record kept. */
  private growStage(): void {
    const old = this.stage
    const next = stageTexture((old.image.height as number) * 2 * STAGE_ROW)
    ;(next.image.data as Float32Array).set(old.image.data as Float32Array)
    this.stage = next
    this.uniforms.crowdStage.value = next
    old.dispose()
  }

  /** One model's parts as a troop, all reading the same per-instance attributes. */
  private troopOf(model: string): Troop {
    const known = this.troops.get(model)
    if (known) return known
    const source = this.models[model]
    if (!source) throw new Error(`Crowd: no model "${model}"`)
    const troop = new Troop(this.root)
    source.traverse((node) => {
      const part = node as SkinnedMesh
      if (!part.isSkinnedMesh) return
      const map = boneMap(this.bake, part)
      if (!map) throw new Error(`Crowd: ${part.name} is not on the baked rig`)
      troop.addPart({
        geometry: shareGeometry(part.geometry, map),
        material: crowdMaterial(part.material as Material, this.uniforms),
        tinted: /Tinted/.test(part.name),
        name: part.name,
      })
    })
    this.troops.set(model, troop)
    return troop
  }

  private gearTroop(gear: Gear): Troop {
    const known = this.geared.get(gear)
    if (known) return known
    const bone = this.boneIndex(gear.bone)
    const pose = this.bake.bindPoses[bone] as Matrix4
    // The piece's up in the bind frame of the rig: what the shader levels.
    const up = gear.up?.clone().transformDirection(pose)
    const troop = new Troop(this.root)
    troop.addPart({
      geometry: this.gearGeometry(gear.geometry, bone, gear.matrix),
      material: crowdMaterial(gear.material, this.uniforms, bone, up),
      tinted: false,
      name: gear.material.name,
    })
    this.geared.set(gear, troop)
    return troop
  }

  /** A gear piece's geometry moved into its bone's bind frame: riding its skinning matrix puts it in the hand. */
  private gearGeometry(source: BufferGeometry, bone: number, matrix: Matrix4): BufferGeometry {
    const pose = this.bake.bindPoses[bone] as Matrix4
    return floatCopy(source).applyMatrix4(new Matrix4().multiplyMatrices(pose, matrix))
  }

  private boneIndex(name: string): number {
    const bone = this.bake.bones.indexOf(name)
    if (bone < 0) throw new Error(`Crowd: the rig has no bone "${name}"`)
    return bone
  }

  private clipId(clip: string): number {
    const id = this.bake.clipIds.get(clip)
    if (id === undefined) throw new Error(`Crowd: no baked clip "${clip}"`)
    return id
  }

  private memberOf(id: number): Enrolled {
    const member = this.members[id]
    if (!member) throw new Error(`Crowd: no member ${id}`)
    return member
  }
}

/** The stage for `members` (a multiple of STAGE_ROW): float texels, read exactly. */
function stageTexture(members: number): DataTexture {
  const rows = Math.ceil(members / STAGE_ROW)
  const width = STAGE_ROW * TEXELS_PER_MEMBER
  const texture = new DataTexture(new Float32Array(width * rows * 4), width, rows, RGBAFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/**
 * One troop: its parts drawn instanced, sharing per-slot attributes (which member, its tint).
 * Slots 0…count-1 are its members, packed; it grows by doubling (its meshes are remade). Slots
 * change only when someone joins or leaves: places and clips are the stage's.
 */
class Troop {
  readonly meshes: InstancedMesh[] = []
  private readonly parts: Part[] = []
  private readonly seats: Seat[] = []
  private readonly bounds = new Sphere()
  private capacity = FIRST_CAPACITY
  count = 0
  private who = slots(FIRST_CAPACITY, 1)
  private tints = slots(FIRST_CAPACITY, 3)
  private changed = false

  constructor(private readonly parent: Group) {}

  addPart(part: Part): void {
    this.parts.push(part)
    this.meshes.push(this.instanced(part))
  }

  /** Gives `seat` the next slot (growing when full). */
  enrol(seat: Seat): void {
    if (this.count === this.capacity) this.grow()
    seat.slot = this.count
    this.seats[this.count] = seat
    this.who.setX(seat.slot, seat.member)
    this.count++
    this.changed = true
  }

  /** Frees `seat`'s slot: the last member moves into it. */
  unseat(seat: Seat): void {
    const last = this.count - 1
    const hole = seat.slot
    if (hole < 0) return
    if (hole !== last) {
      const moved = this.seats[last] as Seat
      this.who.setX(hole, moved.member)
      this.tints.array.copyWithin(hole * 3, last * 3, last * 3 + 3)
      moved.slot = hole
      this.seats[hole] = moved
    }
    this.seats.length = last
    seat.slot = -1
    this.count = last
    this.changed = true
  }

  writeTint(slot: number, color: Color): void {
    this.tints.setXYZ(slot, color.r, color.g, color.b)
    this.changed = true
  }

  /** Counts set, slots uploaded if they changed, bounds fitted round the members' places in `stage`. */
  flush(stage: Float32Array): void {
    const count = this.count
    for (const mesh of this.meshes) {
      mesh.count = count
      mesh.visible = count > 0
    }
    if (count === 0) return
    if (this.changed) {
      upload(this.who, count)
      upload(this.tints, count)
      this.changed = false
    }
    fit(this.bounds, stage, this.seats, count)
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      release(mesh.geometry)
      ;(mesh.material as Material).dispose()
      mesh.removeFromParent()
      mesh.dispose()
    }
  }

  /** Twice the room: new attributes (the old ones copied), the meshes remade around them. */
  private grow(): void {
    this.capacity *= 2
    this.who = bigger(this.who, this.capacity)
    this.tints = bigger(this.tints, this.capacity)
    this.changed = true
    this.parts.forEach((part, i) => {
      const old = this.meshes[i] as InstancedMesh
      const geometry = new BufferGeometry()
      geometry.setIndex(part.geometry.index)
      for (const [name, attribute] of Object.entries(part.geometry.attributes))
        if (!SLOTS.has(name)) geometry.setAttribute(name, attribute)
      retire(part.geometry)
      part.geometry = geometry
      old.removeFromParent()
      old.dispose()
      this.meshes[i] = this.instanced(part)
    })
  }

  private instanced(part: Part): InstancedMesh {
    part.geometry.setAttribute("crowdMember", this.who)
    // Identity instance matrices (never written): the place is the stage's, applied in the shader.
    const mesh = new InstancedMesh(part.geometry, part.material, this.capacity)
    mesh.name = part.name
    if (part.tinted) mesh.instanceColor = this.tints
    // Culled as a whole by `bounds` (fitted each flush): the geometry's own bounds are the bind pose.
    mesh.boundingSphere = this.bounds
    mesh.count = this.count
    // Characters move every frame; the shadow map is static (atmosphere/shadows.ts).
    mesh.castShadow = false
    mesh.receiveShadow = false
    this.parent.add(mesh)
    return mesh
  }
}

/** Uploads the first `count` slots of `attribute`. */
function upload(attribute: InstancedBufferAttribute, count: number): void {
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(0, count * attribute.itemSize)
  attribute.needsUpdate = true
}

/** Per-slot attribute storage: `capacity` slots of `size` floats. */
function slots(capacity: number, size: number): InstancedBufferAttribute {
  return new InstancedBufferAttribute(new Float32Array(capacity * size), size)
}

function bigger(attribute: InstancedBufferAttribute, capacity: number): InstancedBufferAttribute {
  const grown = slots(capacity, attribute.itemSize)
  grown.array.set(attribute.array as Float32Array)
  return grown
}

/**
 * The sphere round the roots of `seats`' members (their places in `stage`), padded by REACH:
 * everything a member draws is within it. Pure, for tests.
 */
export function fit(
  sphere: Sphere,
  stage: Float32Array,
  seats: readonly { member: number }[],
  count: number,
): Sphere {
  let minX = Number.POSITIVE_INFINITY
  let minY = minX
  let minZ = minX
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = maxX
  let maxZ = maxX
  for (let i = 0; i < count; i++) {
    const at = (seats[i] as { member: number }).member * STAGE_FLOATS
    const x = stage[at] as number
    const y = stage[at + 1] as number
    const z = stage[at + 2] as number
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
  sphere.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + REACH
  return sphere
}

/**
 * Frees a crowd geometry's own GPU buffers without touching what it shares with the loaded model
 * (its index and vertex attributes): disposing it whole would delete those buffers under every
 * SkinnedMesh still drawing them. A copy (gear) is all its own.
 */
function release(geometry: BufferGeometry): void {
  if (geometry.userData.copied !== true) keepOnly(geometry, OWN)
  geometry.dispose()
}

/** A troop's geometry outgrown: only its per-slot attributes are freed (the rest moved on). */
function retire(geometry: BufferGeometry): void {
  keepOnly(geometry, SLOTS)
  geometry.dispose()
}

function keepOnly(geometry: BufferGeometry, names: ReadonlySet<string>): void {
  for (const name of Object.keys(geometry.attributes)) if (!names.has(name)) geometry.deleteAttribute(name)
  geometry.setIndex(null)
}

/** The attributes a shared crowd geometry has of its own, and the per-slot ones. */
const SLOTS: ReadonlySet<string> = new Set(["crowdMember"])
const OWN: ReadonlySet<string> = new Set([...SLOTS, "skinIndex"])

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
 * A copy of a kit piece's geometry with float positions and normals (all its own: `copied`). The
 * kit is quantized (KHR_mesh_quantization: normalized int16), and moving it in place would clamp it
 * to the int range.
 */
function floatCopy(source: BufferGeometry): BufferGeometry {
  const geometry = source.clone()
  geometry.userData.copied = true
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
