import { describe, expect, test } from "bun:test"
import type { FrameStats } from "@guildhall/core"
import { perfRows } from "../src/perfRows.ts"

const STATS: FrameStats = {
  fps: 119.6,
  frameMs: { p50: 8.34, p95: 12.06 },
  calls: 7,
  tris: 1234567,
  geometries: 5,
  textures: 0,
  dpr: 2,
}

const value = (s: FrameStats, label: string) => perfRows(s).find((row) => row.label === label)

describe("perfRows", () => {
  test("lists every FrameStats field once, in display order", () => {
    expect(perfRows(STATS).map((row) => row.label)).toEqual([
      "fps",
      "frame p50",
      "frame p95",
      "draw calls",
      "triangles",
      "geometries",
      "textures",
      "dpr",
    ])
  })

  test("rounds fps and counts, groups thousands", () => {
    expect(value(STATS, "fps")?.value).toBe("120")
    expect(value(STATS, "triangles")?.value).toBe("1,234,567")
  })

  test("frame times keep one decimal and carry the ms unit", () => {
    expect(value(STATS, "frame p50")).toEqual({ label: "frame p50", value: "8.3", unit: "ms" })
    expect(value(STATS, "frame p95")?.value).toBe("12.1")
  })

  test("an empty reading shows zeros, not NaN", () => {
    const zero: FrameStats = {
      fps: 0,
      frameMs: { p50: 0, p95: 0 },
      calls: 0,
      tris: 0,
      geometries: 0,
      textures: 0,
      dpr: 1.5,
    }
    expect(perfRows(zero).map((row) => row.value)).toEqual(["0", "0.0", "0.0", "0", "0", "0", "0", "1.50"])
  })
})
