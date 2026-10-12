/**
 * 2D vectors on the ground plane, as `[x, z]`. Every orientation in the kernel treats z as the
 * second axis of an ordinary maths plane: a positive signed area is counter-clockwise, and "left" of
 * a direction `t` is `perp(t) = [−t.z, t.x]`. Only `+ − × ÷` and `sqrt` here, so the bits are fixed.
 */
export type Vec2 = [x: number, z: number]

/** The distance under which two points are the same point: the grid stored outputs are rounded to. */
export const EPS = 1e-3

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1]
/** The z component of a × b: positive when b turns left (counter-clockwise) from a. */
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0]
export const len = (a: Vec2): number => Math.sqrt(a[0] * a[0] + a[1] * a[1])
export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b))
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]
/** `a` turned a quarter left. */
export const perp = (a: Vec2): Vec2 => [-a[1], a[0]]

/** `a` at unit length, or [0, 0] for a zero vector. */
export function norm(a: Vec2): Vec2 {
  const l = len(a)
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l]
}

/**
 * The item at i, counting round: `at(ring, i + 1)` after the last point is the first, and
 * `at(ring, -1)` the last. For loops whose index is in range by construction.
 */
export function at<T>(list: ArrayLike<T>, i: number): T {
  const n = list.length
  return list[((i % n) + n) % n] as T
}

/** A number on the 1e-3 grid, with −0 folded to 0 so hashes and JSON agree. */
export function round3(x: number): number {
  const r = Math.round(x * 1000) / 1000
  return r === 0 ? 0 : r
}

/** A point on the 1e-3 grid: what every stored output goes through. */
export const snap = (p: Vec2): Vec2 => [round3(p[0]), round3(p[1])]
