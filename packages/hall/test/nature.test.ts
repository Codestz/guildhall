import { describe, expect, test } from "bun:test"
import { HEX_RADIUS, insideHex, scatter } from "../src/scene/nature/scatter.ts"
import {
  distanceToLand,
  flowAt,
  riverCells,
  riverLine,
  SHORE,
  shoreTexels,
  smooth,
} from "../src/scene/nature/shore.ts"
import { cellToWorld, island, MAP_FOR_TESTS as MAP } from "../src/world/lands.ts"

const neighbours = (a: readonly [number, number], b: readonly [number, number]) => {
  const dq = b[0] - a[0]
  const dl = b[1] - a[1]
  return (Math.abs(dq) === 1 && Math.abs(dl) === 1) || (dq === 0 && Math.abs(dl) === 2)
}

describe("river course", () => {
  const course = riverCells()

  test("starts at the lake and ends at the sea", () => {
    const first = course[0]
    const last = course[course.length - 1]
    if (!first || !last) throw new Error("empty course")
    expect(MAP.at(first)).toBe("o")
    const sea = [
      [1, 1],
      [0, 2],
      [-1, 1],
      [-1, -1],
      [0, -2],
      [1, -1],
    ].some(([dq, dl]) => MAP.at([last[0] + (dq ?? 0), last[1] + (dl ?? 0)]) === "~")
    expect(sea).toBe(true)
  })

  test("walks every river hex once, neighbour to neighbour", () => {
    expect(course.length).toBe(MAP.riverLinks.size)
    expect(new Set(course.map((c) => `${c[0]},${c[1]}`)).size).toBe(course.length)
    for (let i = 1; i < course.length; i++)
      expect(neighbours(course[i - 1] as [number, number], course[i] as [number, number])).toBe(true)
  })

  test("the smoothed line keeps its ends and runs downstream", () => {
    const line = riverLine()
    const first = course[0]
    const last = course[course.length - 1]
    if (!first || !last) throw new Error("empty course")
    expect(line[0]).toEqual(cellToWorld(first))
    expect(line[line.length - 1]).toEqual(cellToWorld(last))
    // The bridge's river runs north to south (z grows downstream).
    const bridge = cellToWorld([-4, 4])
    const flow = flowAt(line, bridge[0], bridge[1], 6)
    expect(flow).toBeDefined()
    expect(flow?.[1] ?? 0).toBeGreaterThan(0.8)
  })
})

describe("shore helpers", () => {
  test("smooth keeps the ends of a polyline", () => {
    const out = smooth(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      2,
    )
    expect(out[0]).toEqual([0, 0])
    expect(out[out.length - 1]).toEqual([10, 10])
    expect(out.length).toBeGreaterThan(3)
  })

  test("distanceToLand is 0 on land and grows away from it", () => {
    const w = 9
    const land = new Uint8Array(w * w)
    land[4 * w + 4] = 1
    const d = distanceToLand(land, w, w)
    expect(d[4 * w + 4]).toBe(0)
    expect(d[4 * w + 5]).toBe(1)
    expect(d[4 * w + 8]).toBe(4)
    expect(d[0]).toBeCloseTo(4 * Math.SQRT2, 5)
  })

  test("flowAt ignores points beyond reach", () => {
    expect(
      flowAt(
        [
          [0, 0],
          [0, 10],
        ],
        50,
        5,
        3,
      ),
    ).toBeUndefined()
  })

  test("shoreTexels encodes distance and still water away from the river", () => {
    const { size } = SHORE
    const land = new Uint8Array(size * size)
    for (let i = 0; i < size; i++) land[(size / 2) * size + i] = 1
    const texels = shoreTexels(land, [
      [100, 100],
      [101, 101],
    ])
    expect(texels[(size / 2) * size * 4]).toBe(0)
    expect(texels[0]).toBe(255)
    expect(texels[1]).toBe(128)
    expect(texels[2]).toBe(128)
  })
})

describe("grass scatter", () => {
  const land = island()
  const tufts = scatter(land, 60)

  test("grows nothing at density 0", () => {
    expect(scatter(land, 0)).toEqual([])
  })

  test("is deterministic", () => {
    expect(scatter(land, 60)).toEqual(tufts)
  })

  test("every tuft stands inside a meadow or forest hex, off roads and water", () => {
    expect(tufts.length).toBeGreaterThan(land.meadow.length * 50)
    for (const tuft of tufts) {
      const cell = MAP.cellOf([tuft.x, tuft.z])
      expect([".", "f", "F"]).toContain(MAP.at(cell))
    }
  })

  test("keeps clear of trunks and rocks", () => {
    const rocks = land.decor.filter((d) => d.piece.startsWith("rock_single") && !d.y)
    for (const tuft of tufts)
      for (const rock of rocks)
        expect(Math.hypot(rock.x - tuft.x, rock.z - tuft.z)).toBeGreaterThanOrEqual(1.1)
  })

  test("insideHex matches the flat-top hexagon", () => {
    expect(insideHex(0, 0)).toBe(true)
    expect(insideHex(HEX_RADIUS * 0.99, 0)).toBe(true)
    expect(insideHex(0, HEX_RADIUS * 0.9)).toBe(false)
    expect(insideHex(HEX_RADIUS * 0.99, 0, 0.5)).toBe(false)
  })
})
