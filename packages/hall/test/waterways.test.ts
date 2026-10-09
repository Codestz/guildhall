import { describe, expect, test } from "bun:test"
import { COURSE, LAKE, levelOf, patchWaters } from "../src/lab/waterPatch.ts"
import { key } from "../src/world/gen/hex.ts"
import { type Cell, cellToWorld } from "../src/world/lands.ts"
import { BANK, courseLine, surfaceY, TERRACE, type WaterInput, waterwaysOf } from "../src/world/waterways.ts"

/**
 * Inland water as data (world/waterways.ts): courses, lakes and levels sorted into reaches, lakes
 * and falls — and refused when the water couldn't run that way.
 */

/** Land at the given levels ("q,line" → level); everything else open sea. */
const terrain =
  (levels: Record<string, number>): WaterInput["level"] =>
  (cell) =>
    levels[key(cell)]

/** A column of hexes running south from (0,0), one per line step of 2, at these levels. */
function column(...levels: number[]): Record<string, number> {
  return Object.fromEntries(levels.map((level, i) => [`0,${i * 2}`, level]))
}
const south = (n: number): Cell[] => Array.from({ length: n }, (_, i) => [0, i * 2] as Cell)

/** A one-hex lake at (0,2) on level 1, rimmed at level 1, fed from level 2 and draining to level 0. */
const LAKE_RIM = { "1,1": 1, "1,3": 1, "-1,1": 1, "-1,3": 1 }
const lakeTerrain = (rim: Record<string, number> = LAKE_RIM) => terrain({ ...column(2, 1, 0), ...rim })

describe("waterways: a river on one level", () => {
  test("runs to the sea as one reach: a spring with no way in, each hex leaving towards the next", () => {
    const { rivers, lakes, falls } = waterwaysOf({ level: terrain(column(0, 0, 0)), rivers: [south(4)] })
    expect(lakes).toEqual([])
    expect(falls).toEqual([])
    expect(rivers).toHaveLength(1)
    const [reach] = rivers
    expect(reach?.hexes.map((hex) => [hex.ins, hex.out])).toEqual([
      [[], 1],
      [[4], 1],
      [[4], 1],
    ])
    expect(reach?.prev).toBeUndefined()
    expect(reach?.next).toEqual([0, 6])
  })
})

describe("waterways: falls", () => {
  test("a step down is a fall that splits the river into a reach per level", () => {
    const { rivers, falls } = waterwaysOf({ level: terrain(column(2, 2, 0)), rivers: [south(4)] })
    expect(rivers.map((reach) => [reach.level, reach.hexes.length])).toEqual([
      [2, 2],
      [0, 1],
    ])
    expect(rivers[1]?.prev).toEqual([0, 2])
    expect(falls).toEqual([
      { from: [0, 2], to: [0, 4], dir: 1, top: 2, bottom: 0, source: "river", into: "river" },
    ])
  })

  test("a river ending above sea level falls into the sea", () => {
    const { falls } = waterwaysOf({ level: terrain(column(1, 1)), rivers: [south(3)] })
    expect(falls).toEqual([
      { from: [0, 2], to: [0, 4], dir: 1, top: 1, bottom: 0, source: "river", into: "sea" },
    ])
  })
})

describe("waterways: lakes", () => {
  const input = (rim?: Record<string, number>): WaterInput => ({
    level: lakeTerrain(rim),
    rivers: [south(4)],
    lakes: [[0, 2]],
  })

  test("a lake on the course pools the river: falls in and out, one outlet, its rim is its shore", () => {
    const { rivers, lakes, falls } = waterwaysOf(input())
    expect(rivers.map((reach) => reach.hexes.map((hex) => hex.cell))).toEqual([[[0, 0]], [[0, 4]]])
    expect(lakes).toEqual([
      {
        level: 1,
        cells: [[0, 2]],
        shore: [
          [1, 3],
          [-1, 3],
          [-1, 1],
          [1, 1],
        ],
        outlet: { cell: [0, 2], dir: 1 },
      },
    ])
    expect(falls.map((fall) => [fall.source, fall.into])).toEqual([
      ["river", "lake"],
      ["lake", "river"],
    ])
  })

  test("a river may rise in a lake (a tarn)", () => {
    const { lakes, rivers } = waterwaysOf({
      level: lakeTerrain(),
      rivers: [south(4).slice(1)],
      lakes: [[0, 2]],
    })
    expect(lakes[0]?.outlet).toEqual({ cell: [0, 2], dir: 1 })
    expect(rivers[0]?.prev).toEqual([0, 2])
  })

  test("refused: a lake that would spill over a low rim as well as its outlet", () => {
    expect(() => waterwaysOf(input({ ...LAKE_RIM, "1,3": 0 }))).toThrow(/spill/)
  })

  test("refused: a lake no river leaves, and one on two levels", () => {
    expect(() => waterwaysOf({ level: lakeTerrain(), rivers: [], lakes: [[0, 2]] })).toThrow(/0 outlets/)
    expect(() =>
      waterwaysOf({
        ...input(),
        lakes: [
          [0, 2],
          [1, 3],
          [0, 4],
        ],
      }),
    ).toThrow(/two levels/)
  })
})

describe("waterways: confluences", () => {
  test("a second river ends on the first: its hex takes a second way in, and no new reach", () => {
    const level = terrain({ ...column(0, 0, 0), "1,1": 0 })
    const { rivers } = waterwaysOf({
      level,
      rivers: [
        south(4),
        [
          [1, 1],
          [0, 2],
        ],
      ],
    })
    expect(rivers).toHaveLength(2)
    expect(rivers[0]?.hexes[1]?.ins).toEqual([4, 5])
    expect(rivers[1]?.next).toEqual([0, 2])
  })
})

describe("waterways: refused courses", () => {
  const level = terrain(column(1, 0, 1, 0))
  test.each([
    [
      "water running uphill",
      [
        [0, 2],
        [0, 4],
        [0, 6],
        [0, 8],
      ],
      /uphill/,
    ],
    [
      "a step between hexes that aren't neighbours",
      [
        [0, 0],
        [0, 4],
        [0, 8],
      ],
      /not neighbours/,
    ],
    [
      "a river ending inland",
      [
        [0, 0],
        [0, 2],
      ],
      /ends inland/,
    ],
    [
      "a river rising on the sea",
      [
        [0, 8],
        [0, 6],
      ],
      /open sea/,
    ],
    [
      "a river crossing the sea",
      [
        [0, 0],
        [0, 2],
        [0, 4],
        [0, 6],
        [0, 8],
        [0, 10],
        [0, 12],
      ],
      /uphill|crosses/,
    ],
    ["a course with nowhere to go", [[0, 0]], /needs a source/],
  ] as const)("%s", (_, course, error) => {
    expect(() => waterwaysOf({ level, rivers: [course as unknown as Cell[]] })).toThrow(error)
  })

  test("a river running back onto its own water", () => {
    const loop = terrain({ "0,0": 0, "0,2": 0, "1,1": 0, "1,3": 0 })
    expect(() =>
      waterwaysOf({
        level: loop,
        rivers: [
          [
            [0, 0],
            [0, 2],
            [1, 3],
            [1, 1],
            [0, 0],
          ],
        ],
      }),
    ).toThrow(/itself/)
  })
})

describe("the water lab's patch (lab/waterPatch.ts)", () => {
  const waters = patchWaters()

  test("a spring on level 3 falls twice to a lake on level 1, which falls to level 0 and the sea", () => {
    expect(levelOf(COURSE[0] as Cell)).toBe(3)
    expect(levelOf(COURSE.at(-1) as Cell)).toBeUndefined()
    expect(waters.rivers.map((reach) => reach.level)).toEqual([3, 2, 0])
    expect(waters.lakes.map((lake) => [lake.level, lake.cells])).toEqual([[1, LAKE]])
    expect(waters.falls.map((fall) => [fall.top, fall.bottom, fall.source, fall.into])).toEqual([
      [3, 2, "river", "river"],
      [2, 1, "river", "lake"],
      [1, 0, "lake", "river"],
    ])
  })

  test("levels never rise along the course, and every river hex leaves by a real edge", () => {
    const levels = COURSE.map((cell) => levelOf(cell) ?? 0)
    expect(levels.every((level, i) => i === 0 || level <= (levels[i - 1] as number))).toBe(true)
    for (const reach of waters.rivers)
      for (const hex of reach.hexes) expect(hex.out).toBeGreaterThanOrEqual(0)
  })
})

describe("waterways: the contract with the ground (terrain v2 §4.1)", () => {
  const dist = ([ax, az]: readonly number[], [bx, bz]: readonly number[]) => Math.hypot(ax - bx, az - bz)

  test("levels are not capped: a massif river at level 24 falls level by level, its surface linear in level", () => {
    const { rivers, falls } = waterwaysOf({ level: terrain(column(24, 24, 20, 12)), rivers: [south(5)] })
    expect(rivers.map((reach) => reach.level)).toEqual([24, 20, 12])
    expect(falls.map((fall) => [fall.top, fall.bottom, fall.into])).toEqual([
      [24, 20, "river"],
      [20, 12, "river"],
      [12, 0, "sea"],
    ])
    expect(surfaceY("river", 24) - surfaceY("river", 20)).toBeCloseTo(4 * TERRACE)
    expect(surfaceY("lake", 24)).toBeLessThan(surfaceY("river", 24))
  })

  test("each reach is one level: one flat surface over all its hexes", () => {
    for (const reach of patchWaters().rivers)
      expect(reach.hexes.every((hex) => hex.level === reach.level)).toBe(true)
  })

  test("a straight course line runs through its hexes' centres, from a spring's far edge to the next hex", () => {
    const [reach] = waterwaysOf({ level: terrain(column(0, 0, 0)), rivers: [south(4)] }).rivers
    if (!reach) throw new Error("no reach")
    const line = courseLine(reach)
    // A spring's hex is a straight run from its far edge (the pack has no dead-end river tile).
    expect(line[0]?.[1]).toBeCloseTo(-5)
    // A straight run is the segment between its edges' midpoints: each centre lies on the line.
    for (const hex of reach.hexes) {
      const [x, z] = cellToWorld(hex.cell)
      expect(
        line.some((a, i) => {
          const b = line[i + 1]
          return (
            b !== undefined &&
            Math.abs(a[0] - x) < 1e-9 &&
            Math.abs(b[0] - x) < 1e-9 &&
            Math.min(a[1], b[1]) <= z &&
            z <= Math.max(a[1], b[1])
          )
        }),
      ).toBe(true)
    }
    expect(line.at(-1)).toEqual(cellToWorld([0, 6]))
  })

  test("a bend follows the tile's arc, edge midpoint to edge midpoint, passing 1.34 from the centre", () => {
    // (0,0) → (0,2) → (1,3): a wide bend in (0,2), south then east-south-east.
    const level = terrain({ "0,0": 0, "0,2": 0, "1,3": 0 })
    const [reach] = waterwaysOf({
      level,
      rivers: [
        [
          [0, 0],
          [0, 2],
          [1, 3],
          [2, 4],
        ],
      ],
    }).rivers
    if (!reach) throw new Error("no reach")
    const centre = cellToWorld([0, 2])
    const inside = courseLine(reach).filter((point) => dist(point, centre) < 5.01)
    expect(Math.min(...inside.map((point) => dist(point, centre)))).toBeCloseTo(1.34, 1)
    expect(Math.max(...inside.map((point) => dist(point, centre)))).toBeCloseTo(5, 3)
    expect(BANK).toBeLessThan(5)
  })
})
