/**
 * Eased changes for the event FX (pure). A change of weather or a ship's voyage is a transition from
 * one value to another over a fixed time with a smooth start and end, never an exponential chase: it
 * ends exactly, so a settled scene stops rewriting anything, and the same time gives the same value.
 */

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Smoothstep on [0, 1]: zero slope at both ends. */
export const smooth01 = (t: number): number => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

export const smoothstep = (a: number, b: number, x: number): number => smooth01((x - a) / (b - a))

/** Slow start, fast end (a ship casting off). */
export const easeIn = (t: number): number => {
  const x = clamp01(t)
  return x * x
}

/** Fast start, slow end (a ship coming alongside). */
export const easeOut = (t: number): number => {
  const x = clamp01(t)
  return 1 - (1 - x) * (1 - x)
}

/**
 * A value that moves to a new target over `seconds` along a smoothstep, from wherever it is when the
 * target changes (mid-transition too: the new one starts from the current value, with no jump).
 */
export interface Transition {
  /** The value at time `t` (seconds, the FX clock). */
  at(t: number): number
  /** Starts toward `target` at time `t`; a target it already heads for is ignored. */
  to(target: number, t: number): void
  /** Lands on `value` at once (no transition). */
  jump(value: number): void
  /** The value it is heading for. */
  target(): number
  /** Whether it is still moving at `t`. */
  moving(t: number): boolean
}

export function transition(value: number, seconds: number): Transition {
  let from = value
  let goal = value
  let start = Number.NEGATIVE_INFINITY
  const at = (t: number) => (goal === from ? goal : lerp(from, goal, smooth01((t - start) / seconds)))
  return {
    at,
    to(target, t) {
      if (target === goal) return
      from = at(t)
      goal = target
      start = t
    },
    jump(next) {
      from = next
      goal = next
    },
    target: () => goal,
    moving: (t) => goal !== from && t - start < seconds,
  }
}

/** A seeded uniform random stream in [0, 1) (mulberry32): the FX's choices replay the same. */
export function random(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
