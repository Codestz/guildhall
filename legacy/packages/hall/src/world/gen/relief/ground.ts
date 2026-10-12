import type { Massif } from "./field.ts"

/**
 * How a massif's ground reads for what stands on it (dressing.ts): its grade, and whether a spot is
 * a flat ledge top. Only flat ground matches the mesh (a ramp between two ledges is a riser), so
 * what stands on the stairs stands on a ledge top.
 */

/** The ledge tops are flat to within this rise a unit step. */
const FLAT = 0.06

export interface Ground {
  /** The ground's height at a point, or undefined off the massif. */
  heightAt(x: number, z: number): number | undefined
  /** Rise over run at a point whose height is `h` (the steeper of two directions, 1.2 units off). */
  grade(x: number, z: number, h: number): number
  /** A flat ledge top: level 1.2 units round it, and the massif's own ground there. */
  flatAt(x: number, z: number, h: number): boolean
}

export function groundOf(massif: Massif): Ground {
  const { grid } = massif
  const rise = (x: number, z: number, h: number, edge = 0): number => (grid.heightAt(x, z) ?? h + edge) - h
  return {
    heightAt: (x, z) => grid.heightAt(x, z),
    grade: (x, z, h) => Math.max(Math.abs(rise(x + 1.2, z, h)), Math.abs(rise(x, z + 1.2, h))) / 1.2,
    flatAt: (x, z, h) =>
      [
        [1.2, 0],
        [0, 1.2],
        [-1.2, 0],
        [0, -1.2],
      ].every(([dx, dz]) => Math.abs(rise(x + (dx as number), z + (dz as number), h, 1)) < FLAT),
  }
}
