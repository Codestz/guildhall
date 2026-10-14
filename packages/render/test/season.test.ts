import { describe, expect, test } from "bun:test"
import { SNOW_COVER } from "../src/events/snowCover.ts"
import {
  applySeason,
  createSeasonDrive,
  ICE,
  patchSeason,
  SEASON,
  SEASON_AT,
  SEASON_EASE_S,
  seasonName,
  seasonOfDate,
  seasonPinOf,
  seasonStep,
  seasonWeights,
  treeHash,
  wrapSeason,
} from "../src/season.ts"

const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`)

describe("season from a date", () => {
  test("each season's heart: 20 April spring, 20 July summer, 19 October autumn, mid January winter", () => {
    expect(seasonName(seasonOfDate(day("2025-04-20")))).toBe("spring")
    expect(seasonName(seasonOfDate(day("2025-07-20")))).toBe("summer")
    expect(seasonName(seasonOfDate(day("2025-10-19")))).toBe("autumn")
    expect(seasonName(seasonOfDate(day("2025-01-18")))).toBe("winter")
    expect(seasonName(seasonOfDate(day("2025-12-25")))).toBe("winter")
    expect(seasonOfDate(day("2025-07-20"))).toBeCloseTo(1, 1)
    // a whole summer is whole: nothing else mixed in from late June to mid August
    for (const iso of ["2025-06-30", "2025-07-20", "2025-08-10"])
      expect(seasonWeights(seasonOfDate(day(iso))).summer).toBe(1)
  })

  test("the turn of the year is continuous: no jump from 31 December to 1 January", () => {
    const a = seasonOfDate(Date.parse("2024-12-31T23:59:00Z"))
    const b = seasonOfDate(Date.parse("2025-01-01T00:01:00Z"))
    expect(Math.abs(seasonStep(a, b))).toBeLessThan(0.02)
  })

  test("day by day, a year's wheel never steps more than a day's worth", () => {
    const start = day("2023-01-01")
    let prev = seasonOfDate(start)
    for (let k = 1; k < 800; k++) {
      const s = seasonOfDate(start + k * 86_400_000)
      expect(Math.abs(seasonStep(prev, s))).toBeLessThan(0.02)
      prev = s
    }
  })
})

describe("the blend", () => {
  test("weights add to 1, at most two neighbours share, and move with no jump", () => {
    let prev = seasonWeights(0)
    for (let i = 1; i <= 4000; i++) {
      const s = (i / 4000) * 4
      const w = seasonWeights(s)
      const all = [w.spring, w.summer, w.autumn, w.winter]
      expect(all.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
      expect(all.filter((x) => x > 0).length).toBeLessThanOrEqual(2)
      for (const k of ["spring", "summer", "autumn", "winter"] as const)
        expect(Math.abs(w[k] - prev[k])).toBeLessThan(0.005)
      prev = w
    }
  })

  test("summer writes nothing: every factor 0, no frost floor, no ice", () => {
    applySeason(SEASON_AT.winter)
    expect(SEASON.uWinter.value).toBe(1)
    expect(SNOW_COVER.uSnowFloor.value).toBeGreaterThan(0.5)
    expect(ICE.uIce.value).toBe(1)
    applySeason(SEASON_AT.summer)
    expect([SEASON.uSpring.value, SEASON.uAutumn.value, SEASON.uWinter.value]).toEqual([0, 0, 0])
    expect(SNOW_COVER.uSnowFloor.value).toBe(0)
    expect(ICE.uIce.value).toBe(0)
  })

  test("the shortest way round the wheel", () => {
    expect(seasonStep(3.5, 0.5)).toBeCloseTo(1)
    expect(seasonStep(0.5, 3.5)).toBeCloseTo(-1)
    expect(wrapSeason(-0.5)).toBeCloseTo(3.5)
  })

  test("the drive follows a small step at once, eases a jump round the short way, and lands", () => {
    const hooks: ((dt: number) => void)[] = []
    const stage = {
      onFrame: (fn: (dt: number) => void) => {
        hooks.push(fn)
        return () => {}
      },
    }
    const drive = createSeasonDrive(stage, 1)
    drive.set(1.03)
    expect(drive.at()).toBeCloseTo(1.03)
    drive.set(3.5)
    const seen: number[] = []
    for (let t = 0; t < SEASON_EASE_S + 0.5; t += 1 / 60) {
      for (const h of hooks) h(1 / 60)
      seen.push(drive.at())
    }
    expect(drive.at()).toBe(3.5)
    // 1.03 → 3.5 the short way is backwards through spring (−1.53), never through autumn
    expect(seen.every((s) => s <= 1.03 + 1e-9 || s >= 3.5 - 1e-9)).toBe(true)
    for (let i = 1; i < seen.length; i++)
      expect(Math.abs(seasonStep(seen[i - 1] as number, seen[i] as number))).toBeLessThan(0.05)
    drive.set(2, true)
    expect(drive.at()).toBe(2)
    applySeason(SEASON_AT.summer)
  })
})

describe("picks", () => {
  test("a Settings pick or a link: names, auto, wheel values, dates; else null", () => {
    expect(seasonPinOf("auto")).toBe("auto")
    expect(seasonPinOf("winter")).toBe(3)
    expect(seasonPinOf("Fall")).toBe(2)
    expect(seasonPinOf("1.5")).toBe(1.5)
    expect(seasonName(seasonPinOf("2024-12-20") as number)).toBe("winter")
    expect(seasonPinOf("monsoon")).toBeNull()
    expect(seasonPinOf(null)).toBeNull()
  })

  test("a tree's own number is stable and spread", () => {
    expect(treeHash(3.2, -7.9)).toBe(treeHash(3.2, -7.9))
    const hs = Array.from({ length: 400 }, (_, i) => treeHash(i * 1.37, i * -2.11))
    expect(Math.min(...hs)).toBeLessThan(0.1)
    expect(Math.max(...hs)).toBeGreaterThan(0.9)
  })

  test("the patch leaves a program without its anchors alone, and only reads its uniforms", () => {
    const shader = {
      vertexShader: "void main() {\n#include <begin_vertex>\n}",
      fragmentShader: "void main() {}",
      uniforms: {},
    }
    patchSeason(shader as never, "batch")
    expect(shader.fragmentShader).toBe("void main() {}")
    const lit = {
      vertexShader: "void main() {\n#include <begin_vertex>\n}",
      fragmentShader: "void main() {\n#include <alphamap_fragment>\n#include <opaque_fragment>\n}",
      uniforms: {} as Record<string, unknown>,
    }
    patchSeason(lit as never, "batch")
    expect(lit.uniforms.uWinter).toBe(SEASON.uWinter)
    expect(lit.vertexShader).toContain("_swatch")
    expect(lit.fragmentShader).toContain("uSpring + uAutumn + uWinter > 0.0")
  })
})
