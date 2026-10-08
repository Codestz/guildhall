import {
  type AnimationClip,
  AnimationMixer,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LoopOnce,
  Matrix4,
  NearestFilter,
  type Object3D,
  Quaternion,
  RGBAFormat,
  type SkinnedMesh,
  Vector3,
} from "three"
import { cloneRig } from "../rig.ts"

/**
 * The crowd's baked bone texture (docs/research/gpu-techniques.md §2): every clip of the shared
 * rig sampled once, at load, into one texture the crowd's vertex shader reads instead of a
 * skeleton per character. No mixer and no bone upload per character per frame: one texture, one
 * draw per model part.
 *
 * What it holds per bone and frame is the **skinning matrix** three would use (`mesh.matrixWorld ·
 * bindMatrixInverse · bone.matrixWorld · boneInverse · bindMatrix`, the rig's root at the origin),
 * stored as the motion it is: a turn and a uniform scale about the bone's bind position (its
 * *pivot*, a constant), and where that pivot is now (the bone's head):
 *
 *     skin(p) = head + scale · rotate(q, p − pivot)
 *
 * That is exact on this rig (scale is only ever uniform: Spawn_Ground grows the whole body from
 * nothing; anisotropy measured < 1e-5), takes two texels instead of three, and blends well: two
 * frames (or two clips) blend as an nlerp of q and a lerp of the head, close to the mixer's own
 * per-bone slerp. Measured mid-frame against the mixer over all 41 clips at 30 fps (the knight),
 * lerping whole matrices put a vertex up to 5 cm off (median clip 3 mm), and lerping a matrix's
 * own translation with a slerped rotation was worse (10 cm: the translation of a turn about a
 * distant pivot sweeps an arc, not a line); the pivot form is what crowd.test.ts bounds.
 *
 * Layout: one row per baked frame, two texels per bone ([qx qy qz qw], [head.xyz, scale]). A
 * clip's frames are consecutive rows, first to last *inclusive*, evenly spread over its duration,
 * so a looping clip's last row repeats its first and the shader never blends across the wrap.
 *
 * Half floats (RGBA16F): over all 41 clips they move a vertex at most ~2 mm on a 2.5-unit
 * character (crowd.test.ts), far below a pixel at the diorama's zoom: floats would double the
 * texture for nothing visible.
 */

export interface BakedClip {
  name: string
  /** First row of the clip in the texture. */
  row: number
  /** Rows it has (≥ 2): frame 0 at time 0, the last at `duration`. */
  frames: number
  duration: number
  /** Wraps when played past its end (else it holds the last frame). */
  loop: boolean
}

export interface BoneBake {
  texture: DataTexture
  /**
   * The same numbers on the CPU, unrounded (the texture holds them as half floats): gear sockets
   * and tests read them here.
   */
  data: Float32Array
  clips: BakedClip[]
  /** Clip name → its index in `clips` (the id the shader is given). */
  clipIds: Map<string, number>
  /** The rig's bone names: the bake's bone index is the position here. */
  bones: string[]
  /** Per bone: where it sits in the bind pose, in the skin's own space (what it turns about). */
  pivots: Vector3[]
  /**
   * Per bone: the constant that turns its skinning matrix back into the bone's own frame in the
   * rig root's space (`inverse(bindMatrix) · inverse(boneInverse)`), for whatever rides a bone (gear).
   */
  bindPoses: Matrix4[]
  /** The bind data the bake was made with: another model may share it only if its own matches. */
  boneInverses: Matrix4[]
  bindMatrix: Matrix4
  fps: number
}

export const TEXELS_PER_BONE = 2
const FLOATS_PER_BONE = TEXELS_PER_BONE * 4
/** WebGL2 guarantees textures this tall; a taller bake would fail on some GPUs. */
const MAX_ROWS = 4096
/** Below this a bone is scaled to nothing. */
const EMPTY = 1e-6

export interface BakeOptions {
  /** Clips that play once and hold their last frame (deaths, sitting down…); all others loop. */
  once?: ReadonlySet<string>
}

/**
 * Samples every clip on one copy of `rig` (cloneRig: the loaded model is never posed) and returns
 * the texture. `fps` sets the rows per second; the shader interpolates between rows.
 */
export function bakeClips(
  rig: Object3D,
  clips: readonly AnimationClip[],
  fps: number,
  options: BakeOptions = {},
): BoneBake {
  const copy = cloneRig(rig)
  copy.position.set(0, 0, 0)
  copy.quaternion.identity()
  copy.scale.set(1, 1, 1)
  const mesh = firstSkinned(copy)
  if (!mesh) throw new Error("bakeClips: the rig has no skinned mesh")
  const { skeleton } = mesh
  const bones = skeleton.bones.map((bone) => bone.name)
  const bindInverse = mesh.bindMatrix.clone().invert()
  const bindPoses = skeleton.boneInverses.map((inverse) =>
    bindInverse.clone().multiply(inverse.clone().invert()),
  )
  const pivots = bindPoses.map((pose) => new Vector3().setFromMatrixPosition(pose))

  const table: BakedClip[] = []
  let rows = 0
  for (const clip of clips) {
    const frames = Math.max(2, Math.round(clip.duration * fps) + 1)
    table.push({
      name: clip.name,
      row: rows,
      frames,
      duration: clip.duration,
      loop: !options.once?.has(clip.name),
    })
    rows += frames
  }
  if (rows > MAX_ROWS) throw new Error(`bakeClips: ${rows} rows is over ${MAX_ROWS}; lower the fps`)

  const rowFloats = bones.length * FLOATS_PER_BONE
  const data = new Float32Array(rowFloats * rows)
  const mixer = new AnimationMixer(copy)
  const prefix = new Matrix4()
  const skin = new Matrix4()
  for (const [index, clip] of clips.entries()) {
    const entry = table[index] as BakedClip
    mixer.stopAllAction()
    // Sampled once and clamped, so `duration` itself is the clip's end pose, not wrapped to frame 0.
    const action = mixer.clipAction(clip)
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset().play()
    for (let frame = 0; frame < entry.frames; frame++) {
      mixer.setTime((clip.duration * frame) / (entry.frames - 1))
      copy.updateMatrixWorld(true)
      prefix.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
      for (let bone = 0; bone < bones.length; bone++) {
        const at = (entry.row + frame) * rowFloats + bone * FLOATS_PER_BONE
        skinningMatrix(mesh, bone, prefix, skin)
        writeBone(data, at, skin, pivots[bone] as Vector3, frame > 0 ? at - rowFloats : -1)
      }
    }
    // Scaled to nothing (Spawn_Ground's first frame) a matrix has no rotation to recover: such a
    // row takes the rotation of the first real one after it, so growing out of nothing turns nothing.
    for (let frame = entry.frames - 2; frame >= 0; frame--)
      for (let bone = 0; bone < bones.length; bone++) {
        const at = (entry.row + frame) * rowFloats + bone * FLOATS_PER_BONE
        if (!((data[at + 7] as number) > EMPTY)) data.copyWithin(at, at + rowFloats, at + rowFloats + 4)
      }
    mixer.uncacheAction(clip)
  }
  mixer.uncacheRoot(copy)

  const half = new Uint16Array(data.length)
  for (let i = 0; i < data.length; i++) half[i] = DataUtils.toHalfFloat(data[i] as number)
  const texture = new DataTexture(half, bones.length * TEXELS_PER_BONE, rows, RGBAFormat, HalfFloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  return {
    texture,
    data,
    clips: table,
    clipIds: new Map(table.map((clip, index) => [clip.name, index])),
    bones,
    pivots,
    bindPoses,
    boneInverses: skeleton.boneInverses.map((inverse) => inverse.clone()),
    bindMatrix: mesh.bindMatrix.clone(),
    fps,
  }
}

/**
 * Three's skinning matrix for `bone` of `mesh` as posed now, folded with the bind matrices and the
 * mesh's own place (`prefix` = mesh.matrixWorld · bindMatrixInverse): what the bake stores.
 */
export function skinningMatrix(mesh: SkinnedMesh, bone: number, prefix: Matrix4, target: Matrix4): Matrix4 {
  const { bones, boneInverses } = mesh.skeleton
  const node = bones[bone]
  const inverse = boneInverses[bone]
  if (!node || !inverse) throw new Error(`no bone ${bone}`)
  return target.copy(prefix).multiply(node.matrixWorld).multiply(inverse).multiply(mesh.bindMatrix)
}

/**
 * How `mesh`'s joints map onto the bake's: `map[i]` is the bake's index of the mesh's joint `i`.
 * The KayKit models share one rig and bind pose but each lists its joints in its own order, so a
 * model's skinIndex must go through this before the bake can drive it. Null when the mesh is on
 * another rig (a bone missing, or a different bind pose).
 */
export function boneMap(bake: BoneBake, mesh: SkinnedMesh, tolerance = 1e-4): number[] | null {
  const { bones, boneInverses } = mesh.skeleton
  if (bones.length !== bake.bones.length) return null
  if (!close(mesh.bindMatrix, bake.bindMatrix, tolerance)) return null
  const map = bones.map((bone) => bake.bones.indexOf(bone.name))
  const fits = map.every((to, i) => {
    const inverse = boneInverses[i]
    const baked = bake.boneInverses[to]
    return to >= 0 && !!inverse && !!baked && close(inverse, baked, tolerance)
  })
  return fits ? map : null
}

const read = {
  head: new Vector3(),
  nextHead: new Vector3(),
  rotation: new Quaternion(),
  next: new Quaternion(),
  scale: new Vector3(),
  offset: new Vector3(),
}

/**
 * The baked skinning matrix of `bone` in `clip` at `time` seconds into it — frames blended,
 * wrapped or held exactly as the shader does (crowd/material.ts).
 */
export function boneAt(bake: BoneBake, clip: number, time: number, bone: number, target: Matrix4): Matrix4 {
  const entry = bake.clips[clip]
  if (!entry) throw new Error(`no baked clip ${clip}`)
  const pivot = bake.pivots[bone]
  if (!pivot) throw new Error(`no bone ${bone}`)
  const { row, blend } = frameAt(entry, time)
  const rowFloats = bake.bones.length * FLOATS_PER_BONE
  const first = row * rowFloats + bone * FLOATS_PER_BONE
  const next = first + rowFloats
  const { head, rotation, scale, offset } = read
  // nlerp, as the shader does: the rows already sit in one hemisphere.
  rotation.fromArray(bake.data, first)
  read.next.fromArray(bake.data, next)
  rotation
    .set(
      lerp(rotation.x, read.next.x, blend),
      lerp(rotation.y, read.next.y, blend),
      lerp(rotation.z, read.next.z, blend),
      lerp(rotation.w, read.next.w, blend),
    )
    .normalize()
  head.fromArray(bake.data, first + 4).lerp(read.nextHead.fromArray(bake.data, next + 4), blend)
  const size = lerp(bake.data[first + 7] as number, bake.data[next + 7] as number, blend)
  // head + s·R·(p − pivot) = s·R·p + (head − s·R·pivot)
  offset.copy(pivot).applyQuaternion(rotation).multiplyScalar(-size).add(head)
  return target.compose(offset, rotation, scale.setScalar(size))
}

/** Where a bone itself is (its own frame, in the rig root's space): a gear socket, read on the CPU. */
export function socketAt(bake: BoneBake, clip: number, time: number, bone: number, target: Matrix4): Matrix4 {
  const pose = bake.bindPoses[bone]
  if (!pose) throw new Error(`no bone ${bone}`)
  return boneAt(bake, clip, time, bone, target).multiply(pose)
}

/** The first of a clip's two rows to blend at `time`, and how far towards the next. */
export function frameAt(clip: BakedClip, time: number): { row: number; blend: number } {
  let u = time / clip.duration
  u = clip.loop ? u - Math.floor(u) : Math.min(1, Math.max(0, u))
  const x = u * (clip.frames - 1)
  const first = Math.min(Math.floor(x), clip.frames - 2)
  return { row: clip.row + first, blend: x - first }
}

/** Bytes the bake takes on the GPU (half floats). */
export function bakeBytes(bake: BoneBake): number {
  return bake.data.length * 2
}

function firstSkinned(root: Object3D): SkinnedMesh | undefined {
  let found: SkinnedMesh | undefined
  root.traverse((node) => {
    if (!found && (node as SkinnedMesh).isSkinnedMesh) found = node as SkinnedMesh
  })
  return found
}

const pose = { position: new Vector3(), rotation: new Quaternion(), scale: new Vector3() }

/** One bone's skinning matrix into its two texels: [quaternion], [head, uniform scale]. */
function writeBone(data: Float32Array, at: number, skin: Matrix4, pivot: Vector3, previous: number): void {
  // decompose() calls a singular matrix identity at scale 1; the column's length is the true scale.
  skin.decompose(pose.position, pose.rotation, pose.scale)
  const scale = pose.scale.setFromMatrixColumn(skin, 0).length()
  // Each bone's quaternion stays in one hemisphere frame to frame, so a plain nlerp between two
  // rows takes the short way round.
  if (previous >= 0 && dot4(data, previous, pose.rotation) < 0) negate(pose.rotation)
  pose.rotation.toArray(data, at)
  pose.position
    .copy(pivot)
    .applyMatrix4(skin)
    .toArray(data, at + 4)
  data[at + 7] = scale
}

function dot4(data: Float32Array, at: number, q: Quaternion): number {
  return (
    (data[at] as number) * q.x +
    (data[at + 1] as number) * q.y +
    (data[at + 2] as number) * q.z +
    (data[at + 3] as number) * q.w
  )
}

function negate(q: Quaternion): void {
  q.set(-q.x, -q.y, -q.z, -q.w)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function close(a: Matrix4, b: Matrix4, tolerance: number): boolean {
  return a.elements.every((value, i) => Math.abs(value - (b.elements[i] as number)) <= tolerance)
}
