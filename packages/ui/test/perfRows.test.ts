import { describe, expect, test } from "bun:test"
import type { FrameStats } from "@guildhall/core"
import { perfRows } from "../src/perfRows.ts"

/** A reading from before the stats split: no cost, no main/shadow counters. */
const LEGACY: FrameStats = {
  fps: 119.6,
  frameMs: { p50: 8.34, p95: 12.06 },
  calls: 7,
  tris: 1234567,
  geometries: 5,
  textures: 0,
  dpr: 2,
}

const STATS: FrameStats = {
  ...LEGACY,
  fps: 1400,
  frameMs: { p50: 0.7, p95: 1.2 },
  costMs: { p50: 3.04, p95: 4.56 },
  calls: 10,
  mainCalls: 7,
  shadowCalls: 3,
  mainTris: 1000000,
  shadowTris: 234567,
}

const value = (s: FrameStats, label: string) => perfRows(s).find((row) => row.label === label)

describe("perfRows", () => {
  test("leads with the frame cost, then the rAF rate, then the split draws", () => {
    expect(perfRows(STATS).map((row) => row.label)).toEqual([
      "cost p50",
      "cost p95",
      "rAF fps",
      "rAF p50",
      "rAF p95",
      "calls main",
      "calls shadow",
      "tris main",
      "tris shadow",
      "geometries",
      "textures",
      "dpr",
    ])
  })

  test("cost keeps one decimal and carries the ms unit", () => {
    expect(value(STATS, "cost p50")).toEqual({ label: "cost p50", value: "3.0", unit: "ms" })
    expect(value(STATS, "cost p95")?.value).toBe("4.6")
  })

  test("main and shadow counts are grouped by thousands", () => {
    expect(value(STATS, "tris main")?.value).toBe("1,000,000")
    expect(value(STATS, "tris shadow")?.value).toBe("234,567")
    expect(value(STATS, "calls shadow")?.value).toBe("3")
  })

  test("a reading without the split shows totals and no cost rows", () => {
    expect(perfRows(LEGACY).map((row) => row.label)).toEqual([
      "rAF fps",
      "rAF p50",
      "rAF p95",
      "draw calls",
      "triangles",
      "geometries",
      "textures",
      "dpr",
    ])
    expect(value(LEGACY, "rAF fps")?.value).toBe("120")
    expect(value(LEGACY, "triangles")?.value).toBe("1,234,567")
  })

  test("an empty reading shows zeros, not NaN", () => {
    const zero: FrameStats = {
      fps: 0,
      frameMs: { p50: 0, p95: 0 },
      costMs: { p50: 0, p95: 0 },
      calls: 0,
      tris: 0,
      mainCalls: 0,
      mainTris: 0,
      shadowCalls: 0,
      shadowTris: 0,
      geometries: 0,
      textures: 0,
      dpr: 1.5,
    }
    expect(perfRows(zero).map((row) => row.value)).toEqual([
      "0.0",
      "0.0",
      "0",
      "0.0",
      "0.0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "1.50",
    ])
  })
})
