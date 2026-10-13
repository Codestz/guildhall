/**
 * The crowd's baked bone texture (V1's crowd/bake.ts, kept): every clip the crowd plays, sampled once
 * at load on the shared KayKit rig, into one texture the crowd's vertex shader reads instead of a
 * skeleton per person. No mixer and no bone upload per person per frame.
 *
 * Per bone and frame it holds the skinning matrix three would use (`mesh.matrixWorld ·
 * bindMatrixInverse · bone.matrixWorld · boneInverse · bindMatrix`, the rig's root at the origin) as
 * the motion it is: a turn and a uniform scale about the bone's bind position (its pivot, a constant)
 * and where that pivot is now (the bone's head):
 *
 *     skin(p) = head + scale · rotate(q, p − pivot)
 *
 * Two texels instead of three, and it blends well: two frames (or two clips) blend as an nlerp of q
 * and a lerp of the head, close to the mixer's own per-bone slerp (V1 measured lerping whole matrices
 * at 5 cm off mid-frame; this form at a few mm).
 *
 * Layout: one row per baked frame, two texels per bone ([qx qy qz qw], [head.xyz, scale]). A clip's
 * frames are consecutive rows, first to last inclusive, so a looping clip's last row repeats its first
 * and nothing blends across the wrap. Half floats: ~2 mm at most on a 2 m person.
 *
 * Why bones and not vertex positions (classic VAT): positions cost a texel per vertex per frame per
 * body (≈ 5 k vertices × 10 bodies × ~1 500 frames ≈ 75 M texels); bones cost 46 texels a frame for
 * every body together.
 */
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
import type { Slicer } from "../slice.ts"

export interface BakedClip {
  name: string
  /** First row of the clip in the texture. */
  row: number
  /** Rows it has (≥ 2): frame 0 at time 0, the last at `duration`. */
  frames: number
  duration: number
}

export interface BoneBake {
  texture: DataTexture
  /** The same numbers on the CPU, unrounded (the texture holds half floats): props and tests read these. */
  data: Float32Array
  clips: BakedClip[]
  /** Clip name → its index in `clips`. */
  clipIds: Map<string, number>
  /** The rig's bone names (three-sanitized): the bake's bone index is the position here. */
  bones: string[]
  /** Per bone: where it sits in the bind pose, in the skin's own space (what it turns about). */
  pivots: Vector3[]
  /** Per bone: skinning matrix → the bone's own frame in the rig root's space (props ride it). */
  bindPoses: Matrix4[]
  /** The bind data the bake was made with: another body may share it only if its own matches. */
  boneInverses: Matrix4[]
  bindMatrix: Matrix4
  fps: number
}

export const TEXELS_PER_BONE = 2
const FLOATS_PER_BONE = TEXELS_PER_BONE * 4
/** WebGL2 guarantees textures this tall. */
const MAX_ROWS = 4096
/** Below this a bone is scaled to nothing. */
const EMPTY = 1e-6

/** The first skinned mesh under `root`. */
export function firstSkinned(root: Object3D): SkinnedMesh | undefined {
  let found: SkinnedMesh | undefined
  root.traverse((node) => {
    if (!found && (node as SkinnedMesh).isSkinnedMesh) found = node as SkinnedMesh
  })
  return found
}

/**
 * Samples `clips` (all looping) on `body`, a copy the caller owns (it is posed and left at the last
 * frame), into the bone texture at `fps` rows a second. Throws when the body has no skinned mesh or
 * the clips need more rows than a texture may have.
 */
export function bakeClips(body: Object3D, clips: readonly AnimationClip[], fps: number): BoneBake {
  const steps = bakeSteps(body, clips, fps)
  for (;;) {
    const next = steps.next()
    if (next.done) return next.value
  }
}

/**
 * The same bake, one clip a step, yielding to `slicer` between clips (slice.ts) so a crowd built on
 * the main thread never holds it for long: the bytes are the ones `bakeClips` writes.
 */
export async function bakeClipsSliced(
  body: Object3D,
  clips: readonly AnimationClip[],
  fps: number,
  slicer: Slicer,
): Promise<BoneBake> {
  const steps = bakeSteps(body, clips, fps)
  for (;;) {
    const next = steps.next()
    if (next.done) return next.value
    await slicer.yield()
  }
}

/** The bake as steps: the setup, then one clip per step, then the texture. */
function* bakeSteps(body: Object3D, clips: readonly AnimationClip[], fps: number): Generator<void, BoneBake> {
  body.position.set(0, 0, 0)
  body.quaternion.identity()
  body.scale.set(1, 1, 1)
  const mesh = firstSkinned(body)
  if (!mesh) throw new Error("bakeClips: the body has no skinned mesh")
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
    table.push({ name: clip.name, row: rows, frames, duration: Math.max(clip.duration, 1e-3) })
    rows += frames
  }
  if (rows > MAX_ROWS) throw new Error(`bakeClips: ${rows} rows is over ${MAX_ROWS}; lower the fps`)

  const rowFloats = bones.length * FLOATS_PER_BONE
  const data = new Float32Array(rowFloats * Math.max(rows, 1))
  const mixer = new AnimationMixer(body)
  const prefix = new Matrix4()
  const skin = new Matrix4()
  for (const [index, clip] of clips.entries()) {
    const entry = table[index] as BakedClip
    mixer.stopAllAction()
    // Played once and clamped, so `duration` itself is the clip's end pose, not wrapped to frame 0.
    const action = mixer.clipAction(clip)
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset().play()
    for (let frame = 0; frame < entry.frames; frame++) {
      mixer.setTime((clip.duration * frame) / (entry.frames - 1))
      body.updateMatrixWorld(true)
      prefix.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
      for (let bone = 0; bone < bones.length; bone++) {
        const at = (entry.row + frame) * rowFloats + bone * FLOATS_PER_BONE
        skinningMatrix(mesh, bone, prefix, skin)
        writeBone(data, at, skin, pivots[bone] as Vector3, frame > 0 ? at - rowFloats : -1)
      }
    }
    // A row scaled to nothing has no rotation to recover: it takes the next real row's.
    for (let frame = entry.frames - 2; frame >= 0; frame--)
      for (let bone = 0; bone < bones.length; bone++) {
        const at = (entry.row + frame) * rowFloats + bone * FLOATS_PER_BONE
        if (!((data[at + 7] as number) > EMPTY)) data.copyWithin(at, at + rowFloats, at + rowFloats + 4)
      }
    mixer.uncacheAction(clip)
    yield
  }
  mixer.uncacheRoot(body)

  const half = new Uint16Array(data.length)
  for (let i = 0; i < data.length; i++) half[i] = DataUtils.toHalfFloat(data[i] as number)
  const texture = new DataTexture(
    half,
    bones.length * TEXELS_PER_BONE,
    Math.max(rows, 1),
    RGBAFormat,
    HalfFloatType,
  )
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

/** Three's skinning matrix for `bone` of `mesh` as posed now, `prefix` = matrixWorld · bindMatrixInverse. */
function skinningMatrix(mesh: SkinnedMesh, bone: number, prefix: Matrix4, target: Matrix4): Matrix4 {
  const node = mesh.skeleton.bones[bone]
  const inverse = mesh.skeleton.boneInverses[bone]
  if (!node || !inverse) throw new Error(`no bone ${bone}`)
  return target.copy(prefix).multiply(node.matrixWorld).multiply(inverse).multiply(mesh.bindMatrix)
}

/**
 * How `mesh`'s joints map onto the bake's: `map[i]` is the bake's index of the mesh's joint `i`. The
 * KayKit bodies share one rig and bind pose but list their joints in their own order. Null when the
 * mesh is on another rig (a bone missing, or another bind pose).
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

/** The first of a clip's two rows to blend at `phase` (0–1 of the clip, wrapping), and how far to the next. */
export function frameAt(clip: BakedClip, phase: number): { row: number; blend: number } {
  const u = phase - Math.floor(phase)
  const x = u * (clip.frames - 1)
  const first = Math.min(Math.floor(x), clip.frames - 2)
  return { row: clip.row + first, blend: x - first }
}

/**
 * Where a person is in the bake: the clip it plays (rows `now`, blended `blendNow` to the next), the
 * clip it is fading out of (`was`), and how far the fade has come (`fade`, 1: done). What the shader
 * reads per person, and what the CPU reads for its props.
 */
export interface BakePose {
  now: number
  blendNow: number
  was: number
  blendWas: number
  fade: number
}

const read = {
  a: new Quaternion(),
  b: new Quaternion(),
  headA: new Vector3(),
  headB: new Vector3(),
  scale: new Vector3(),
  offset: new Vector3(),
}

/** One bone's record at (row, blend): q into `q`, head into `head`, its scale returned. As the shader. */
function recordAt(
  bake: BoneBake,
  row: number,
  blend: number,
  bone: number,
  q: Quaternion,
  head: Vector3,
): number {
  const rowFloats = bake.bones.length * FLOATS_PER_BONE
  const first = row * rowFloats + bone * FLOATS_PER_BONE
  const next = first + rowFloats
  const d = bake.data
  const x = d[first] as number
  const y = d[first + 1] as number
  const z = d[first + 2] as number
  const w = d[first + 3] as number
  q.set(
    x + ((d[next] as number) - x) * blend,
    y + ((d[next + 1] as number) - y) * blend,
    z + ((d[next + 2] as number) - z) * blend,
    w + ((d[next + 3] as number) - w) * blend,
  )
  head.fromArray(d, first + 4).lerp(read.offset.fromArray(d, next + 4), blend)
  return (d[first + 7] as number) + ((d[next + 7] as number) - (d[first + 7] as number)) * blend
}

/** The baked skinning matrix of `bone` at `pose`: rows, clips and fade blended exactly as the shader does. */
export function boneAt(bake: BoneBake, pose: BakePose, bone: number, target: Matrix4): Matrix4 {
  const pivot = bake.pivots[bone]
  if (!pivot) throw new Error(`no bone ${bone}`)
  const { a, b, headA, headB, scale, offset } = read
  let size = recordAt(bake, pose.now, pose.blendNow, bone, a, headA)
  if (pose.fade < 1) {
    const was = recordAt(bake, pose.was, pose.blendWas, bone, b, headB)
    // The short way round, as the shader's crowdMix: the two clips' rows may sit in opposite hemispheres.
    const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1
    const t = pose.fade
    a.set(
      b.x + (sign * a.x - b.x) * t,
      b.y + (sign * a.y - b.y) * t,
      b.z + (sign * a.z - b.z) * t,
      b.w + (sign * a.w - b.w) * t,
    )
    headA.lerp(headB, 1 - t)
    // headA = was + (now − was)·t: lerp(now, was, 1 − t).
    size = was + (size - was) * t
  }
  a.normalize()
  // head + s·R·(p − pivot) = s·R·p + (head − s·R·pivot)
  offset.copy(pivot).applyQuaternion(a).multiplyScalar(-size).add(headA)
  return target.compose(offset, a, scale.setScalar(size))
}

/** A bone's own frame (in the rig root's space) at `pose`: what a held prop rides. */
export function socketAt(bake: BoneBake, pose: BakePose, bone: number, target: Matrix4): Matrix4 {
  const bind = bake.bindPoses[bone]
  if (!bind) throw new Error(`no bone ${bone}`)
  return boneAt(bake, pose, bone, target).multiply(bind)
}

/** Bytes the bake takes on the GPU (half floats). */
export function bakeBytes(bake: BoneBake): number {
  return bake.data.length * 2
}

const pose = { position: new Vector3(), rotation: new Quaternion(), scale: new Vector3() }

/** One bone's skinning matrix into its two texels: [quaternion], [head, uniform scale]. */
function writeBone(data: Float32Array, at: number, skin: Matrix4, pivot: Vector3, previous: number): void {
  // decompose() calls a singular matrix identity at scale 1; the column's length is the true scale.
  skin.decompose(pose.position, pose.rotation, pose.scale)
  const scale = pose.scale.setFromMatrixColumn(skin, 0).length()
  // Each bone's quaternion stays in one hemisphere frame to frame, so an nlerp of two rows is short.
  if (previous >= 0 && dot4(data, previous, pose.rotation) < 0)
    pose.rotation.set(-pose.rotation.x, -pose.rotation.y, -pose.rotation.z, -pose.rotation.w)
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

function close(a: Matrix4, b: Matrix4, tolerance: number): boolean {
  return a.elements.every((value, i) => Math.abs(value - (b.elements[i] as number)) <= tolerance)
}
