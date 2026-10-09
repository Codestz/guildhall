import type { Massif } from "./field.ts"

/**
 * How a massif's ground reads for what stands on it (dressing.ts, outcrops.ts): its grade, whether a
 * spot is a flat ledge top, whether a riser stands beside it (a ledge's foot) or falls away beside it
 * (its lip). Below the top ledge only flat ground matches the mesh (a ramp between two ledges is a
 * riser there), so what stands on the stairs stands on a ledge top.
 */

/** The ledge tops are flat to within this rise a unit step, and a riser stands at least this far above its foot. */
const FLAT = 0.06
const RISER = 4

export interface Ground {
  /** The ground's height at a point, or undefined off the massif. */
  heightAt(x: number, z: number): number | undefined
  /** Rise over run at a point whose height is `h` (the steeper of two directions, 1.2 units off). */
  grade(x: number, z: number, h: number): number
  /** Flat ledge top (or any ground above the top ledge, where the peak's mesh is the grid). */
  flatAt(x: number, z: number, h: number): boolean
  /** A riser close by, to the side: the ground two units off is a ledge higher. */
  footAt(x: number, z: number, h: number): boolean
  /** A drop close by, to the side: the ground two units off is a ledge lower. */
  lipAt(x: number, z: number, h: number): boolean
  /** Most of the way down to the lowest the ground gets within `r` of a point: where a rock stands, the rest of the drop buried under it. */
  floorAt(x: number, z: number, h: number, r: number): number
}

export function groundOf(massif: Massif): Ground {
  const { grid, ledgeTop } = massif
  /** The rise of the ground in the four directions, `d` units off (`edge`, where the massif's ground ends there). */
  const around = (x: number, z: number, h: number, d: number, edge = 0): number[] =>
    [0, 1, 2, 3].map(
      (k) => (grid.heightAt(x + d * Math.cos(k * 1.57), z + d * Math.sin(k * 1.57)) ?? h + edge) - h,
    )
  const diagonals = (x: number, z: number, h: number, d: number): number[] =>
    [0.785, 2.356, 3.927, 5.498].map(
      (a) => (grid.heightAt(x + d * Math.cos(a), z + d * Math.sin(a)) ?? h) - h,
    )
  return {
    heightAt: (x, z) => grid.heightAt(x, z),
    grade: (x, z, h) =>
      Math.max(
        Math.abs((grid.heightAt(x + 1.2, z) ?? h) - h),
        Math.abs((grid.heightAt(x, z + 1.2) ?? h) - h),
      ) / 1.2,
    flatAt: (x, z, h) =>
      h > ledgeTop + 0.01 || around(x, z, h, 1.2, 1).every((rise) => Math.abs(rise) < FLAT),
    footAt: (x, z, h) => around(x, z, h, 2).some((rise) => rise >= RISER),
    lipAt: (x, z, h) => around(x, z, h, 2).some((rise) => rise <= -RISER),
    floorAt: (x, z, h, r) => h + Math.min(0, ...around(x, z, h, r), ...diagonals(x, z, h, r)) * 0.6,
  }
}
