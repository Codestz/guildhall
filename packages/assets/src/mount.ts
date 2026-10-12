/**
 * How a held or worn prop sits on a character (ADR 010): a semantic frame in the prop's own space
 * (handle point, working axis, strike edge) mapped onto a measured slot frame of the rig. Data lives
 * in `data/mounts.json` and reaches the catalog as `compose.mount` (see overlay.ts).
 */

export type Vec3 = [x: number, y: number, z: number]

export const MOUNT_SLOTS = ["hand.r", "hand.l", "chest", "head", "back"] as const
export type MountSlot = (typeof MOUNT_SLOTS)[number]

/** A per-clip exception: an extra roll about the slot's `along` (radians), an offset, or hiding the prop. */
export interface MountClip {
  roll?: number
  offset?: Vec3
  hide?: true
}

export interface Mount {
  slot: MountSlot
  /** Other slots the prop may ride in (e.g. a lantern in either hand). */
  alt?: MountSlot[]
  hands: 1 | 2
  /** Prop space, metres: this point sits at the slot origin. */
  handle: Vec3
  /** Unit, handle → working end; maps to the slot's `along`. */
  axis: Vec3
  /** Unit, perpendicular to `axis`: the strike edge or face; maps to the slot's `edge`. */
  edge: Vec3
  /** This prop axis is kept world-up by the upright solver (mug, lantern, staff, bucket). */
  upright?: { up: Vec3 }
  scale?: number
  /** Clip name → override. */
  clips?: Record<string, MountClip>
}

/** `data/mounts.json`: catalog id → mount. */
export interface MountsFile {
  version: 1
  mounts: Record<string, Mount>
}

/**
 * Slot frames on KayKit Rig_Medium, measured in V1: +y runs through the fist to the working end, +x
 * toward the strike edge (mirrored on the left hand). `bone` is the glTF name; GLTFLoader strips the
 * dots (`handslot.r` → three node `handslotr`), so render must sanitize it.
 */
export const SLOT_FRAMES: Readonly<Record<MountSlot, { bone: string; along: Vec3; edge: Vec3 }>> = {
  "hand.r": { bone: "handslot.r", along: [0, 1, 0], edge: [1, 0, 0] },
  "hand.l": { bone: "handslot.l", along: [0, 1, 0], edge: [-1, 0, 0] },
  chest: { bone: "chest", along: [0, 1, 0], edge: [0, 0, 1] },
  head: { bone: "head", along: [0, 1, 0], edge: [0, 0, 1] },
  back: { bone: "chest", along: [0, 1, 0], edge: [0, 0, -1] },
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

type Mat3 = [Vec3, Vec3, Vec3]

/** Rotation matrix (rows) → unit quaternion [x, y, z, w] with w >= 0 (three's algorithm). */
function quaternion([[m11, m12, m13], [m21, m22, m23], [m31, m32, m33]]: Mat3): [
  number,
  number,
  number,
  number,
] {
  const trace = m11 + m22 + m33
  let q: [number, number, number, number]
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    q = [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33)
    q = [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33)
    q = [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22)
    q = [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s]
  }
  return q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q
}

/**
 * The prop's transform in slot space: `R = S·Pᵀ` with `P = [edge, axis, edge×axis]` and
 * `S = [slot.edge, slot.along, slot.edge×slot.along]`, and `t = −R·handle·scale`, so the handle lands
 * on the slot origin, `axis` on `along` and `edge` on the slot edge. Per-clip roll and offset are
 * applied on top by render. Assumes a valid mount (unit, orthogonal axes: see validateMount).
 */
export function mountBasis(
  m: Mount,
  slot: MountSlot,
): { rotation: [number, number, number, number]; translation: Vec3 } {
  const frame = SLOT_FRAMES[slot]
  const P: Mat3 = [m.edge, m.axis, cross(m.edge, m.axis)]
  const S: Mat3 = [frame.edge, frame.along, cross(frame.edge, frame.along)]
  // Row i of R = Σk S_k[i] · P_k, where S_k and P_k are the basis columns.
  const row = (i: 0 | 1 | 2): Vec3 => {
    const [a, b, c] = [S[0][i], S[1][i], S[2][i]]
    const at = (j: 0 | 1 | 2): number => a * P[0][j] + b * P[1][j] + c * P[2][j]
    return [at(0), at(1), at(2)]
  }
  const R: Mat3 = [row(0), row(1), row(2)]
  const k = m.scale ?? 1
  const translation: Vec3 = [-dot(R[0], m.handle) * k, -dot(R[1], m.handle) * k, -dot(R[2], m.handle) * k]
  return { rotation: quaternion(R), translation }
}

/** How far a unit vector may stray from length 1, and two axes from perpendicular (|dot|). */
const UNIT_TOLERANCE = 1e-3

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum)
const isSlot = (v: unknown): v is MountSlot =>
  typeof v === "string" && (MOUNT_SLOTS as readonly string[]).includes(v)
const show = (v: unknown): string => JSON.stringify(v) ?? String(v)

/** True when `v` is a unit vector; otherwise records why not. */
function checkUnit(out: string[], at: string, v: unknown): v is Vec3 {
  const problem = !isVec3(v)
    ? "expected [x, y, z]"
    : Math.abs(Math.hypot(...v) - 1) > UNIT_TOLERANCE
      ? "expected a unit vector"
      : null
  if (problem) out.push(`${at}: ${problem}`)
  return problem === null
}

/** Problems with one Mount, as "where: what"; empty when valid. `at` prefixes every path. */
export function validateMount(value: unknown, at = "mount"): string[] {
  if (!isRecord(value)) return [`${at}: expected an object`]
  const m = value
  const out: string[] = []
  if (!isSlot(m.slot)) out.push(`${at}.slot: unknown ${show(m.slot)}`)
  if (m.alt !== undefined) {
    if (!Array.isArray(m.alt)) out.push(`${at}.alt: expected an array`)
    else {
      for (const s of m.alt) if (!isSlot(s)) out.push(`${at}.alt: unknown ${show(s)}`)
      if (new Set(m.alt).size !== m.alt.length || m.alt.includes(m.slot)) out.push(`${at}.alt: duplicates`)
    }
  }
  if (m.hands !== 1 && m.hands !== 2) out.push(`${at}.hands: expected 1 or 2`)
  if (!isVec3(m.handle)) out.push(`${at}.handle: expected [x, y, z]`)
  const axisOk = checkUnit(out, `${at}.axis`, m.axis)
  const edgeOk = checkUnit(out, `${at}.edge`, m.edge)
  if (axisOk && edgeOk && Math.abs(dot(m.axis as Vec3, m.edge as Vec3)) > UNIT_TOLERANCE)
    out.push(`${at}.edge: expected perpendicular to axis`)
  if (m.upright !== undefined) {
    if (!isRecord(m.upright)) out.push(`${at}.upright: expected { up }`)
    else checkUnit(out, `${at}.upright.up`, m.upright.up)
  }
  if (m.scale !== undefined && !(isNum(m.scale) && m.scale > 0))
    out.push(`${at}.scale: expected a positive number`)
  if (m.clips !== undefined) {
    if (!isRecord(m.clips)) out.push(`${at}.clips: expected an object`)
    else
      for (const [name, c] of Object.entries(m.clips)) {
        const where = `${at}.clips.${name}`
        if (!isRecord(c)) {
          out.push(`${where}: expected an object`)
          continue
        }
        if (c.roll !== undefined && !isNum(c.roll)) out.push(`${where}.roll: expected a number`)
        if (c.offset !== undefined && !isVec3(c.offset)) out.push(`${where}.offset: expected [x, y, z]`)
        if (c.hide !== undefined && c.hide !== true) out.push(`${where}.hide: expected true`)
      }
  }
  return out
}

/** Problems with `data/mounts.json`. */
export function validateMounts(value: unknown): string[] {
  if (!isRecord(value)) return ["mounts.json: expected an object"]
  const out: string[] = []
  if (value.version !== 1) out.push(`version: expected 1, got ${show(value.version)}`)
  if (!isRecord(value.mounts)) out.push("mounts: expected an object")
  else for (const [id, m] of Object.entries(value.mounts)) out.push(...validateMount(m, `mounts.${id}`))
  return out
}
