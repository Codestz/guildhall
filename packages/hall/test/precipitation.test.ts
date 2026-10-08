import { describe, expect, test } from "bun:test"
import { fallTime } from "../src/scene/weather/Precipitation.tsx"

describe("the falls' clock", () => {
  test("production keeps falling while the story is paused", () => {
    expect(fallTime(5, 0.016, 0, 360_000, false)).toBeCloseTo(5.016)
  })

  test("a probe build with the story paused draws at the story's own time, whatever the frames did", () => {
    // Two loads of one paused view: different frame histories, the same drops.
    expect(fallTime(3.71, 0.016, 0, 360_000, true)).toBe(360)
    expect(fallTime(4.2, 0.033, 0, 360_000, true)).toBe(360)
  })

  test("a probe build with the story running falls with the frames", () => {
    expect(fallTime(5, 0.016, 1, 360_000, true)).toBeCloseTo(5.016)
  })
})
