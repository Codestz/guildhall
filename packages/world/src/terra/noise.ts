/**
 * Seeded 2D gradient noise for the terrain (no strings, no tables to share): a cell's gradient is an
 * integer hash of its corner and the seed, so the same seed always gives the same field and nothing
 * repeats across the map. `fbm` sums octaves of it; `warp` displaces a point by two fbm fields.
 */

/** A 32-bit integer hash of a lattice point and the seed, as [0, 1). */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

function grad(seed: number, ix: number, iy: number, dx: number, dy: number): number {
  const a = hash2(seed, ix, iy) * Math.PI * 2
  return Math.cos(a) * dx + Math.sin(a) * dy
}

/** Gradient noise at (x, y), about [-0.7, 0.7]. */
export function noise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const u = fade(fx)
  const v = fade(fy)
  const a = grad(seed, ix, iy, fx, fy)
  const b = grad(seed, ix + 1, iy, fx - 1, fy)
  const c = grad(seed, ix, iy + 1, fx, fy - 1)
  const d = grad(seed, ix + 1, iy + 1, fx - 1, fy - 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Fractal sum of `octaves` of noise, each twice the frequency and half the weight; about [-1, 1]. */
export function fbm(seed: number, x: number, y: number, octaves = 4): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = 1
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(seed + o * 1013, x * f, y * f)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return (sum / norm) * 1.6
}

/** Ridged fbm: sharp crests where the noise crosses zero, [0, 1]. */
export function ridged(seed: number, x: number, y: number, octaves = 4): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = 1
  for (let o = 0; o < octaves; o++) {
    sum += amp * (1 - Math.abs(noise(seed + o * 733, x * f, y * f)) * 1.4)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return Math.max(0, Math.min(1, sum / norm))
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
