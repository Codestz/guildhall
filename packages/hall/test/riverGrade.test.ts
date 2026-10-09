import { describe, expect, test } from "bun:test"
import { patchWaters } from "../src/lab/waterPatch.ts"
import { surfaceGeometry } from "../src/scene/nature/riverMesh.ts"
import { key } from "../src/world/gen/hex.ts"
import { islandFromTree } from "../src/world/gen/islandFromTree.ts"
import type { RepoEntry } from "../src/world/gen/repo.ts"
import { type GradeGround, gradeWaters } from "../src/world/gen/rivers/grade.ts"
import type { Cell } from "../src/world/lands.ts"
import {
  BANK,
  fallHeights,
  GRADE_STEP,
  gradeHalfWidth,
  gradeSlopes,
  type Point3,
  surfaceY,
  TERRACE,
  waterwaysOf,
} from "../src/world/waterways.ts"
import { repoWorld } from "../src/world/world.ts"
import REACT from "./fixtures/repos/facebook__react.json"

/** Rivers that run down a mountain's flank (world/gen/rivers/grade.ts): graded reaches, ledges as the only falls. */

/** A column of massif hexes running south from (0,0) at these levels, the sea beyond. */
const COLUMN = (levels: number[]) => Object.fromEntries(levels.map((l, i) => [`0,${i * 2}`, l]))
const course = (n: number): Cell[] => Array.from({ length: n }, (_, i) => [0, i * 2] as Cell)

function column(levels: number[], heightAt: (x: number, z: number) => number) {
  const at = COLUMN(levels)
  const ground: GradeGround = { heightAt, relief: () => true, level: (cell) => at[key(cell)] ?? 0 }
  const waters = waterwaysOf({ level: (cell) => at[key(cell)], rivers: [course(levels.length + 1)] })
  return { waters, graded: gradeWaters(waters, ground), ground }
}

describe("a river down a mountain flank", () => {
  // Falls 0.45 per unit southwards: a steep stream, not a cliff.
  const { waters, graded } = column([6, 4, 2, 0], (_, z) => Math.max(0, 15 - 0.45 * z))

  test("the water layer's stair of flat reaches and falls becomes one graded reach", () => {
    expect(waters.rivers.length).toBe(4)
    expect(waters.falls.length).toBe(3)
    expect(graded.rivers.length).toBe(1)
    expect(graded.rivers[0]?.hexes.length).toBe(4)
    expect(graded.falls).toEqual([])
  })

  test("its surface never rises, is sampled finely, and arrives at the sea's level", () => {
    const grade = graded.rivers[0]?.grade as Point3[]
    for (let i = 1; i < grade.length; i++) {
      const [a, b] = [grade[i - 1] as Point3, grade[i] as Point3]
      expect(b[1]).toBeLessThanOrEqual(a[1] + 1e-9)
      expect(Math.hypot(b[0] - a[0], b[2] - a[2])).toBeLessThanOrEqual(GRADE_STEP + 1e-6)
    }
    expect(grade.at(-1)?.[1]).toBeCloseTo(surfaceY("river", 0))
    expect((grade[0] as Point3)[1]).toBeGreaterThan(surfaceY("river", 0) + 5)
  })

  test("the reach keeps its hexes' own levels", () => {
    expect(graded.rivers[0]?.hexes.map((hex) => hex.level)).toEqual([6, 4, 2, 0])
  })

  test("a reach with no massif under it is left exactly as the water layer made it", () => {
    const flat = patchWaters()
    const ground: GradeGround = { heightAt: () => 0, relief: () => false, level: () => 0 }
    expect(gradeWaters(flat, ground)).toBe(flat)
  })
})

describe("a ledge", () => {
  // Level ground, then a 12-unit cliff across the edge between the second and third hex.
  const { waters, graded } = column([6, 6, 1, 1], (_, z) => (z < 15 ? 15 : 3))

  test("keeps its fall, with the heights of the water at its lip and its foot", () => {
    expect(waters.falls.length).toBe(2)
    expect(graded.falls.length).toBe(1)
    const fall = graded.falls[0]
    const { top, bottom } = fallHeights(fall as NonNullable<typeof fall>)
    expect(top).toBeCloseTo(15, 0)
    expect(bottom).toBeLessThan(top - 5)
  })

  test("splits the river into a graded reach above and one below", () => {
    expect(graded.rivers.map((reach) => reach.hexes.length)).toEqual([2, 2])
    const [above, below] = graded.rivers.map((reach) => reach.grade as Point3[]) as [Point3[], Point3[]]
    expect((above.at(-1) as Point3)[1]).toBeGreaterThan((below[0] as Point3)[1] + 5)
  })
})

describe("graded reaches' shape", () => {
  test("a torrent is narrower than a stream; still water takes the full channel", () => {
    expect(gradeHalfWidth(0)).toBe(BANK)
    expect(gradeHalfWidth(1.5)).toBeLessThan(gradeHalfWidth(0.3))
    expect(gradeHalfWidth(0.3)).toBeLessThan(BANK)
  })

  test("slope is the surface's fall over its run, never negative", () => {
    const line: Point3[] = [0, 1, 2, 3, 4, 5].map((i) => [i, 10 - 2 * i, 0])
    expect(gradeSlopes(line)[2]).toBeCloseTo(2)
    expect(
      gradeSlopes([
        [0, 1, 0],
        [1, 1, 0],
      ]).every((s) => s === 0),
    ).toBe(true)
  })
})

describe("the generated island", () => {
  const made = islandFromTree(REACT.entries as RepoEntry[], 0, 2)
  const world = repoWorld(made, { repo: "x/y", source: "fixture", gen: 2 })
  const rivers = world.water?.rivers ?? []
  const graded = rivers.filter((reach) => reach.grade)

  test("its mountain rivers are graded, the lowland's flat", () => {
    expect(graded.length).toBeGreaterThan(2)
    for (const reach of rivers)
      for (const hex of reach.hexes) expect(!!reach.grade).toBe(!!world.relief?.massifAt(hex.cell))
  })

  test("their falls are few and real: each drops at least a terrace", () => {
    const falls = world.water?.falls ?? []
    expect(falls.length).toBeLessThan(10)
    for (const fall of falls) {
      const { top, bottom } = fallHeights(fall)
      expect(top - bottom).toBeGreaterThanOrEqual(fall.topY === undefined ? 0 : TERRACE)
    }
  })

  test("the carved bed lies under the graded water along its whole run", () => {
    for (const reach of graded)
      for (const [x, y, z] of reach.grade as Point3[]) {
        // (Where the stream leaves the massif for a lowland tile, that tile's own banks take over.)
        const bed = world.relief?.heightAt(x, z)
        if (bed !== undefined && bed > 0) expect(bed).toBeLessThan(y + 0.2)
      }
  })

  test("the surface mesh follows the grade: faces up, and runs faster where it is steep", () => {
    const geometry = surfaceGeometry(world.water as NonNullable<typeof world.water>)
    const normal = geometry.getAttribute("normal")
    const flow = geometry.getAttribute("aFlow")
    let fastest = 0
    for (let i = 0; i < normal.count; i++) {
      expect(normal.getY(i)).toBeGreaterThan(0)
      fastest = Math.max(fastest, Math.hypot(flow.getX(i), flow.getY(i)))
    }
    expect(fastest).toBeGreaterThan(1.9)
  })
})
