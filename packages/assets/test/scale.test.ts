import { describe, expect, test } from "bun:test"
import { checkScale, SCALE_TARGETS } from "../src/scale.ts"

describe("checkScale", () => {
  test("a tree inside 4–9 m has no flags", () => {
    expect(checkScale("tree", [3, 6, 3])).toEqual({ target: [4, 9], flags: [] })
  })

  test("the band's bounds are inclusive", () => {
    expect(checkScale("tree", [1, 4, 1]).flags).toEqual([])
    expect(checkScale("tree", [1, 9, 1]).flags).toEqual([])
  })

  test("just outside the band flags undersize / oversize", () => {
    expect(checkScale("tree", [1, 3.99, 1]).flags).toEqual(["undersize"])
    expect(checkScale("tree", [1, 9.01, 1]).flags).toEqual(["oversize"])
  })

  test("judges height only, not width or depth", () => {
    expect(checkScale("fence", [12, 1.1, 0.2]).flags).toEqual([])
  })

  test("a building is at least two storeys and has no upper bound", () => {
    expect(checkScale("building", [6, 5.49, 6]).flags).toEqual(["undersize"])
    expect(checkScale("building", [6, 40, 6])).toEqual({ target: [5.5, null], flags: [] })
  })

  test("V1's 0.93 m hex house is undersize", () => {
    expect(checkScale("building", [1, 0.93, 1]).flags).toEqual(["undersize"])
  })

  test("a category without a target gets no target and no flags", () => {
    expect(checkScale("prop", [0.1, 50, 0.1])).toEqual({ flags: [] })
    expect(checkScale("character", [1, 2.2, 1])).toEqual({ flags: [] })
  })

  test("the plan's §3.4 bands", () => {
    expect(SCALE_TARGETS).toEqual({
      building: [5.5, null],
      tree: [4, 9],
      bush: [0.4, 1.8],
      fence: [0.9, 1.4],
      wall: [2.5, 6],
      rock: [0.3, 4],
      furniture: [0.4, 2.2],
      vehicle: [1.2, 3],
    })
  })
})
