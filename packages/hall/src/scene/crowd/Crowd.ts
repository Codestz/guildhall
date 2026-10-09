import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
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
  type MeshStandardMaterial,
  NearestFilter,
  type Object3D,
  Quaternion,
  RGBAFormat,
  type SkinnedMesh,
  Sphere,
  Vector3,
} from "three"
import type { Grip } from "../grips.ts"
import { type BakedClip, type BoneBake, boneMap, frameAt, socketAt } from "./bake.ts"
import { type Lens, lens, look, meshLod, tallAt } from "./lod.ts"
import {
  type CrowdShading,
  type CrowdUniforms,
  GLSL_SHADING,
  STAGE_ROW,
  TEXELS_PER_MEMBER,
} from "./material.ts"
import type { PartLods } from "./simplify.ts"

/**
 * A crowd of adventurers drawn from the baked bone texture (bake.ts, material.ts): per model and
 * mesh level, one InstancedMesh per part (body, tinted cape/hat), every member of that model drawn
 * at that level in it; per piece of gear, one InstancedMesh riding its bone, every member who holds
 * it in it.
 *
 * Mesh levels (crowd/lod.ts MESH_LODS): given the camera, `flush` moves each member to the level its
 * size on screen calls for. The coarser levels are the parts' own vertices with a simplified index
 * (crowd/simplify.ts, handed over by `levels` once made): until then there is only the full mesh.
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

/** A model part as loaded, for the crowd: its geometry, joints renumbered into the bake's order. */
interface Source {
  geometry: BufferGeometry
  map: number[]
  material: Material
  tinted: boolean
  name: string
}

/** A model's parts and its troops, one per mesh level (0: the full mesh). */
interface Model {
  sources: Source[]
  troops: Troop[]
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
  model: Model
  /** The mesh level it draws at: its body's troop is `model.troops[level]`. */
  level: number
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
  private readonly scenes: Record<string, Object3D>
  private readonly models = new Map<string, Model>()
  private readonly geared = new Map<Gear, Troop>()
  private lods: PartLods = new Map()
  private readonly lens = lens()
  private readonly members: (Enrolled | undefined)[] = []
  private readonly free: number[] = []
  private stage: DataTexture
  private clock = 0
  private readonly fade: number
  private readonly shading: CrowdShading

  /**
   * `models`: each model's loaded scene (the glTF's, untouched: geometry and materials are shared,
   * not cloned per member). `members`: who stands there from the start (ids 0…n-1, in order).
   * `fade`: seconds a clip change blends. `shading`: GLSL, or node materials for a renderer that
   * draws them (material.ts `nodeShading`).
   */
  constructor(
    bake: BoneBake,
    models: Record<string, Object3D>,
    members: readonly Member[] = [],
    fade = 0.25,
    shading: CrowdShading = GLSL_SHADING,
  ) {
    this.bake = bake
    this.scenes = models
    this.shading = shading
    this.uniforms = shading.uniforms(bake)
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

  /**
   * A model loaded after the crowd was made (the Automaton, lazy: world/cast.ts): its members may
   * join from now on. A name already known keeps its scene.
   */
  muster(name: string, scene: Object3D): void {
    if (!this.scenes[name]) this.scenes[name] = scene
  }

  /** A new member of `model`'s troop, standing at the origin in its first clip. Returns its id. */
  join(model: string, tint?: ColorRepresentation): number {
    const shape = this.modelOf(model)
    const troop = shape.troops[0] as Troop
    const id = this.free.pop() ?? this.members.length
    if ((id + 1) * STAGE_FLOATS > this.stageData.length) this.growStage()
    this.stageData.fill(0, id * STAGE_FLOATS, (id + 1) * STAGE_FLOATS)
    const member: Enrolled = {
      model: shape,
      level: 0,
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
    // The full mesh's troop: the lab flushes without a camera, so no one draws a coarser level.
    const troop = this.models.get(model)?.troops[0]
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
        material: this.shading.material(mesh.material as Material, this.uniforms, bone),
        tinted: false,
        name: mesh.name,
      })
    })
    return troop.meshes.slice(before)
  }

  /**
   * The models' coarser mesh levels (crowd/simplify.ts): every model, mustered or yet to be, draws
   * them from the next `flush` with a camera on.
   */
  levels(lods: PartLods): void {
    this.lods = lods
    for (const model of this.models.values()) this.addLevels(model)
  }

  /**
   * Once a frame, after every member's writes: given the `camera` (drawn `height` CSS px tall),
   * each member moves to the mesh level its size on screen calls for; then each troop's slots go up
   * if they changed and it fits its bounds (an empty troop draws nothing). The stage goes up once,
   * at the next draw. Without a camera, everyone keeps the level they have.
   */
  flush(camera?: Camera, height = 0): void {
    const data = this.stageData
    if (camera && height > 0) this.choose(look(camera, height, this.lens), data)
    for (const model of this.models.values()) for (const troop of model.troops) troop.flush(data)
    for (const [gear, troop] of this.geared) {
      troop.flush(data)
      if (troop.count > 0) troop.match(gear.material)
    }
  }

  /** The mesh level member `id` draws at (0: the full mesh). */
  levelOf(id: number): number {
    return this.memberOf(id).level
  }

  /**
   * Where the crowd draws `gear` in member `id`'s hand now, world space, into `target`: the frame
   * of the piece as the shader puts it (levelled for a levelled grip). From the clip it plays now: during
   * a clip change's fade (FADE_S) the shader is still blending out of the last one, a few cm off.
   */
  held(id: number, gear: Gear, target: Matrix4): Matrix4 {
    const { now } = this.memberOf(id)
    socketAt(this.bake, now.clip, (this.clock - now.start) * now.speed, this.boneIndex(gear.bone), target)
    if (gear.up) level(target, gear.up)
    target.multiply(gear.matrix)
    const data = this.stageData
    const at = id * STAGE_FLOATS
    const place = scratch.matrix.makeRotationY(data[at + 3] as number)
    place.setPosition(data[at] as number, data[at + 1] as number, data[at + 2] as number)
    return target.premultiply(place)
  }

  /** Draw calls the crowd makes now (one per mesh of each non-empty troop, before culling). */
  get draws(): number {
    let calls = 0
    for (const troop of this.allTroops()) if (troop.count > 0) calls += troop.meshes.length
    return calls
  }

  /** Frees what the crowd made: its geometries (copies), materials (clones) and stage. The bake stays. */
  dispose(): void {
    for (const troop of this.allTroops()) troop.dispose()
    this.models.clear()
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

  /**
   * Members whose size on screen calls for another mesh level move to it (crowd/lod.ts). Only a
   * change of level touches a troop's slots.
   */
  private choose(view: Lens, data: Float32Array): void {
    for (let id = 0; id < this.members.length; id++) {
      const member = this.members[id]
      if (!member) continue
      const { troops } = member.model
      if (troops.length < 2 && member.level === 0) continue
      const at = id * STAGE_FLOATS
      const tall = tallAt(view, data[at] as number, data[at + 1] as number, data[at + 2] as number)
      const next = meshLod(member.level, tall, troops.length)
      if (next === member.level) continue
      const { body } = member
      body.troop.unseat(body)
      body.troop = troops[next] as Troop
      body.troop.enrol(body)
      body.troop.writeTint(body.slot, member.tint)
      member.level = next
    }
  }

  private *allTroops(): Iterable<Troop> {
    for (const model of this.models.values()) yield* model.troops
    yield* this.geared.values()
  }

  /** One model's parts, and its full mesh's troop (with its coarser ones, once made). */
  private modelOf(name: string): Model {
    const known = this.models.get(name)
    if (known) return known
    const scene = this.scenes[name]
    if (!scene) throw new Error(`Crowd: no model "${name}"`)
    const sources: Source[] = []
    scene.traverse((node) => {
      const part = node as SkinnedMesh
      if (!part.isSkinnedMesh) return
      const map = boneMap(this.bake, part)
      if (!map) throw new Error(`Crowd: ${part.name} is not on the baked rig`)
      sources.push({
        geometry: part.geometry,
        map,
        material: this.shading.material(part.material as Material, this.uniforms),
        tinted: /Tinted/.test(part.name),
        name: part.name,
      })
    })
    const model: Model = { sources, troops: [] }
    model.troops.push(this.troopAt(sources, 0))
    this.addLevels(model)
    this.models.set(name, model)
    return model
  }

  /** The coarser levels every part of `model` has a simplified index for, as troops. */
  private addLevels(model: Model): void {
    const levels = Math.min(
      ...model.sources.map((source) => (this.lods.get(source.geometry)?.length ?? 0) + 1),
    )
    for (let level = model.troops.length; level < levels; level++)
      model.troops.push(this.troopAt(model.sources, level))
  }

  /** One mesh level of a model's parts as a troop, all reading the same per-instance attributes. */
  private troopAt(sources: readonly Source[], level: number): Troop {
    const troop = new Troop(this.root)
    for (const source of sources) {
      const index = level > 0 ? this.lods.get(source.geometry)?.[level - 1] : undefined
      troop.addPart({
        geometry: shareGeometry(source.geometry, source.map, index),
        // One material per part, whatever the level: the same program and uniforms.
        material: source.material,
        tinted: source.tinted,
        name: level > 0 ? `${source.name}_LOD${level}` : source.name,
      })
    }
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
      material: this.shading.material(gear.material, this.uniforms, bone, up),
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

  /**
   * Its materials follow `source` where it changes by the frame (the lit lantern glass glows with
   * the night, scene/lights/carried.ts): its glow and opacity.
   */
  match(source: Material): void {
    const from = source as MeshStandardMaterial
    for (const mesh of this.meshes) {
      const to = mesh.material as MeshStandardMaterial
      to.opacity = from.opacity
      if (from.emissive && to.emissive) {
        to.emissive.copy(from.emissive)
        to.emissiveIntensity = from.emissiveIntensity
      }
    }
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
      geometry.userData = part.geometry.userData
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
  if (geometry.userData.copied !== true) keepOnly(geometry, OWN, geometry.userData.ownIndex === true)
  geometry.dispose()
}

/** A troop's geometry outgrown: only its per-slot attributes are freed (the rest moved on). */
function retire(geometry: BufferGeometry): void {
  keepOnly(geometry, SLOTS, false)
  geometry.dispose()
}

function keepOnly(geometry: BufferGeometry, names: ReadonlySet<string>, index: boolean): void {
  for (const name of Object.keys(geometry.attributes)) if (!names.has(name)) geometry.deleteAttribute(name)
  if (!index) geometry.setIndex(null)
}

/** The attributes a shared crowd geometry has of its own, and the per-slot ones. */
const SLOTS: ReadonlySet<string> = new Set(["crowdMember"])
const OWN: ReadonlySet<string> = new Set([...SLOTS, "skinIndex"])

/**
 * A model part's geometry for the crowd: the loaded one's attributes shared (never copied), but
 * its joints renumbered into the bake's bone order. `index`: a coarser level's own (simplify.ts).
 */
function shareGeometry(
  source: BufferGeometry,
  map: readonly number[],
  index?: Uint16Array | Uint32Array,
): BufferGeometry {
  const geometry = new BufferGeometry()
  if (index) {
    geometry.setIndex(new BufferAttribute(index, 1))
    geometry.userData.ownIndex = true
  } else geometry.setIndex(source.index)
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

const scratch = {
  matrix: new Matrix4(),
  turn: new Matrix4(),
  head: new Vector3(),
  up: new Vector3(),
  level: new Quaternion(),
}
const UP = new Vector3(0, 1, 0)

/**
 * A levelled grip (material.ts `crowdLevel`), on the CPU: `socket` (a bone's frame, as baked) then
 * the shortest turn taking the piece's `up` (in the bone's frame) to the world's up, about the
 * bone's head. In place.
 */
export function level(socket: Matrix4, up: Vector3): Matrix4 {
  const { turn, head, level: q } = scratch
  head.setFromMatrixPosition(socket)
  q.setFromUnitVectors(scratch.up.copy(up).transformDirection(socket), UP)
  turn.makeRotationFromQuaternion(q)
  // About the head: head − turn·head.
  const offset = scratch.up.copy(head).applyMatrix4(turn).negate().add(head)
  turn.setPosition(offset)
  return socket.premultiply(turn)
}
