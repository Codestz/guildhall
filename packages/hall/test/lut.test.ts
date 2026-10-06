import { describe, expect, test } from "bun:test"
import {
  bakeLut,
  createLook,
  gradeColour,
  lookDistance,
  lookFor,
  NEUTRAL,
} from "../src/scene/atmosphere/lut.ts"
import { MOODS } from "../src/world/moods.ts"

const hue = ([r, g, b]: readonly number[]): number => {
  const max = Math.max(r as number, g as number, b as number)
  const min = Math.min(r as number, g as number, b as number)
  const c = max - min
  if (c < 1e-6) return 0
  let h =
    max === r
      ? ((g as number) - (b as number)) / c
      : max === g
        ? ((b as number) - (r as number)) / c + 2
        : ((r as number) - (g as number)) / c + 4
  h /= 6
  return (h + 1) % 1
}
const sat = ([r, g, b]: readonly number[]): number => {
  const max = Math.max(r as number, g as number, b as number)
  return max > 0 ? (max - Math.min(r as number, g as number, b as number)) / max : 0
}

describe("mood LUTs (V5)", () => {
  test("the neutral look is the identity", () => {
    for (const c of [
      [0, 0, 0],
      [0.2, 0.5, 0.8],
      [1, 1, 1],
      [0.7, 0.3, 0.1],
    ] as const)
      expect([...gradeColour(NEUTRAL, c[0], c[1], c[2])].map((v) => +v.toFixed(5))).toEqual([...c])
  })

  test("black stays near black and white near white in every mood and time (no crushed or blown ends)", () => {
    const look = createLook()
    for (const mood of Object.keys(MOODS) as (keyof typeof MOODS)[])
      for (const weights of [
        { golden: 0, night: 0, storm: 0 },
        { golden: 1, night: 0, storm: 0 },
        { golden: 0, night: 1, storm: 0 },
        { golden: 0, night: 0, storm: 1 },
      ]) {
        lookFor(look, mood, weights)
        const black = gradeColour(look, 0, 0, 0)
        expect(Math.max(...black)).toBeLessThan(0.04)
        const white = gradeColour(look, 1, 1, 1)
        expect(Math.min(...white)).toBeGreaterThan(0.85)
        // Mid-grey keeps its brightness within a few percent: the LUT shapes colour, the grade sets levels.
        const grey = gradeColour(look, 0.42, 0.42, 0.42)
        const l = 0.2126 * grey[0] + 0.7152 * grey[1] + 0.0722 * grey[2]
        expect(Math.abs(l - 0.42)).toBeLessThan(0.04)
      }
  })

  test("golden hour pulls mustard grass towards green, and keeps firelight saturated", () => {
    const look = lookFor(createLook(), "keep", { golden: 1, night: 0, storm: 0 })
    const mustard = [0.62, 0.58, 0.2] as const
    const graded = [...gradeColour(look, ...mustard)]
    expect(hue(graded)).toBeGreaterThan(hue(mustard) + 0.01)
    const fire = [0.95, 0.55, 0.2] as const
    expect(sat([...gradeColour(look, ...fire)])).toBeGreaterThanOrEqual(sat(fire) - 0.01)
  })

  test("the moods are distinct films: hearth warmer than moonstone on the same grey-green", () => {
    const sample = [0.45, 0.5, 0.4] as const
    const warmth = (mood: "hearth" | "moonstone") => {
      const [r, , b] = gradeColour(lookFor(createLook(), mood, { golden: 0, night: 0, storm: 0 }), ...sample)
      return r - b
    }
    expect(warmth("hearth")).toBeGreaterThan(warmth("moonstone") + 0.03)
  })

  test("blending is smooth: a small step in the day moves the look a little (re-bake threshold works)", () => {
    const a = lookFor(createLook(), "arcane", { golden: 0.5, night: 0, storm: 0 })
    const b = lookFor(createLook(), "arcane", { golden: 0.51, night: 0, storm: 0 })
    expect(lookDistance(a, b)).toBeGreaterThan(0)
    expect(lookDistance(a, b)).toBeLessThan(0.005)
  })

  test("bakes a size³ RGBA table, red fastest", () => {
    const table = bakeLut(NEUTRAL, 4)
    expect(table.length).toBe(4 * 4 * 4 * 4)
    // Texel (x=3, y=0, z=0) is pure red; (0, 0, 3) pure blue.
    expect([...table.slice(3 * 4, 3 * 4 + 4)]).toEqual([255, 0, 0, 255])
    expect([...table.slice(48 * 4, 48 * 4 + 4)]).toEqual([0, 0, 255, 255])
  })
})
