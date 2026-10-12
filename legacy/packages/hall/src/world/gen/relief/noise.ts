/** Smooth value noise on an integer-hash lattice: pure, seeded, no allocation (it runs per vertex). */

export const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** An integer hash of a lattice point to [0, 1) (no strings, no closures: it runs per vertex). */
function lattice(seed: number, i: number, j: number, salt: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed ^ salt, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Value noise in [0, 1) at a world point. */
export function valueNoise(seed: number, x: number, z: number, salt: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const u = smooth(x - x0)
  const v = smooth(z - z0)
  return (
    (lattice(seed, x0, z0, salt) * (1 - u) + lattice(seed, x0 + 1, z0, salt) * u) * (1 - v) +
    (lattice(seed, x0, z0 + 1, salt) * (1 - u) + lattice(seed, x0 + 1, z0 + 1, salt) * u) * v
  )
}
