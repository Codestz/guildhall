import { describe, expect, test } from "bun:test"
import { HeightGrid } from "../src/world/gen/relief/lattice.ts"
import {
  coarseSeamStairs,
  fineSeamStairs,
  type Lat,
  seamPoints,
  turn,
} from "../src/world/gen/relief/seams.ts"

/** Where a hex of the finest lattice meets a coarse one (world/gen/relief/seams.ts): both sides must read the same six vertices. */

/** A grid of ledges (0) with one vertex off its ledge. */
const gridOff = (at: Lat | undefined): HeightGrid => {
  const grid = new HeightGrid(-6, -6, 14, 14)
  grid.data.fill(0)
  if (at) grid.set(at[0], at[1], 2.5)
  return grid
}

describe("a seam between a fine hex and a coarse one", () => {
  // A coarse segment a–b along (1, 0), its coarse apex above and the fine apexes below it.
  const [a, b]: [Lat, Lat] = [
    [0, 0],
    [2, 0],
  ]
  const d: Lat = [1, 0]

  test("the six vertices: a, m, b, the coarse apex, and a fine apex beside each half", () => {
    expect(seamPoints(a, d, 1)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 2],
      [1, -1],
      [2, -1],
    ])
  })

  test("a step turned a sixth of a turn and back is the step's own half (the two turns sum to it)", () => {
    for (const step of [
      [1, 0],
      [0, 1],
      [-1, 1],
    ] as const) {
      const [up, down] = [turn(step, 1), turn(step, -1)]
      expect([up[0] + down[0], up[1] + down[1]]).toEqual([step[0], step[1]])
    }
  })

  test("the coarse triangle and both fine triangles decide the same: stairs only when all six stand on ledges", () => {
    const [c, xa, xb]: Lat[] = [
      [0, 2],
      [1, -1],
      [2, -1],
    ] as Lat[]
    for (const off of [undefined, ...seamPoints(a, d, 1)]) {
      const grid = gridOff(off)
      const verdicts = [
        coarseSeamStairs(grid, a, b, c as Lat),
        fineSeamStairs(grid, a, [1, 0], xa as Lat),
        fineSeamStairs(grid, [1, 0], b, xb as Lat),
      ]
      expect(verdicts).toEqual(Array(3).fill(off === undefined))
    }
  })

  test("the same seam with the coarse hex on the other side reads the same six", () => {
    const grid = gridOff(undefined)
    // The coarse apex below, the fine apexes above.
    expect(coarseSeamStairs(grid, a, b, [2, -2])).toBe(true)
    expect(fineSeamStairs(grid, a, [1, 0], [0, 1])).toBe(true)
    const off = gridOff([2, -2])
    expect(coarseSeamStairs(off, a, b, [2, -2])).toBe(false)
    expect(fineSeamStairs(off, [1, 0], b, [1, 1])).toBe(false)
  })
})
