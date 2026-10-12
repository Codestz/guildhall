import { describe, expect, test } from "bun:test"
import { clampDpr } from "../src/stage.ts"
import { FrameRing, percentile, summarize } from "../src/stats.ts"

describe("percentile", () => {
  test("is 0 for no values", () => {
    expect(percentile([], 50)).toBe(0)
  })

  test("is the only value for one value", () => {
    expect(percentile([7], 50)).toBe(7)
    expect(percentile([7], 95)).toBe(7)
  })

  test("takes the nearest rank of unsorted values", () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5]
    expect(percentile(values, 50)).toBe(5)
    expect(percentile(values, 95)).toBe(10)
    expect(percentile(values, 0)).toBe(1)
    expect(percentile(values, 100)).toBe(10)
  })

  test("p95 of 100 frames is the 95th slowest from the bottom", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(values, 95)).toBe(95)
  })

  test("does not reorder its input", () => {
    const values = [3, 1, 2]
    percentile(values, 50)
    expect(values).toEqual([3, 1, 2])
  })
})

describe("summarize", () => {
  const counters = { calls: 4, tris: 1200, geometries: 3, textures: 0 }

  test("fps is frames over the time they took", () => {
    const stats = summarize([16, 16, 18, 14], counters, 2)
    expect(stats.fps).toBeCloseTo(62.5, 9)
    expect(stats.frameMs).toEqual({ p50: 16, p95: 18 })
    expect(stats).toMatchObject({ ...counters, dpr: 2 })
  })

  test("no frames is 0 fps, not NaN", () => {
    expect(summarize([], counters, 1.5)).toMatchObject({ fps: 0, frameMs: { p50: 0, p95: 0 } })
  })
})

describe("FrameRing", () => {
  test("keeps only the last `capacity` frame times", () => {
    const ring = new FrameRing(3)
    for (const ms of [1, 2, 3, 4, 5]) ring.push(ms)
    expect([...ring.values()].sort()).toEqual([3, 4, 5])
  })
})

describe("clampDpr", () => {
  const range: [number, number] = [1.5, 2]
  test.each([
    [1, 1.5],
    [1.5, 1.5],
    [1.75, 1.75],
    [2, 2],
    [3, 2],
    [0, 1.5],
  ])("device %p -> %p", (device, expected) => {
    expect(clampDpr(device, range)).toBe(expected)
  })
})
