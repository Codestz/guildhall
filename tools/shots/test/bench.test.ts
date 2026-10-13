import { describe, expect, test } from "bun:test"
import type { FrameStats } from "@guildhall/core"
import {
  type BenchReport,
  benchMarkdown,
  benchPoses,
  longTasksAfter,
  POSE_NAMES,
  parseBenchArgs,
  summarizePose,
} from "../src/bench.ts"

const hero = {
  target: [-26.8, 1.95, 0] as [number, number, number],
  azimuth: 295,
  elevation: 38,
  distance: 70,
}

describe("parseBenchArgs", () => {
  test("defaults: both sizes, every pose, three runs, the ledger on", () => {
    const args = parseBenchArgs([])
    expect(args.files).toEqual([4000, 12000])
    expect(args.poses).toEqual([...POSE_NAMES])
    expect(args.runs).toBe(3)
    expect(args.turn).toEqual(["hero", "wide"])
    expect(args.pan).toEqual(["hero", "wide"])
    expect(args.variants).toEqual(["post=0", "life=0", "atmo=0", "lod=0"])
    expect(args.ledger).toBe(true)
    expect(args.label).toMatch(/^\d{12}$/)
  })

  test("reads the flags", () => {
    const args = parseBenchArgs([
      "--label",
      "before",
      "--files",
      "4000",
      "--runs",
      "1",
      "--poses",
      "hero,sea",
      "--turn",
      "",
      "--pan",
      "none",
      "--variants",
      "post=0",
      "--port",
      "5501",
      "--no-ledger",
      "--note",
      "quiet",
    ])
    expect(args).toMatchObject({
      label: "before",
      files: [4000],
      runs: 1,
      poses: ["hero", "sea"],
      turn: [],
      pan: [],
      variants: ["post=0"],
      port: 5501,
      ledger: false,
      note: "quiet",
    })
  })

  test("names what is wrong", () => {
    expect(() => parseBenchArgs(["--poses", "hero,moon"])).toThrow(/no pose "moon"/)
    expect(() => parseBenchArgs(["--runs", "x"])).toThrow(/--runs/)
    expect(() => parseBenchArgs(["--label", "Bad Label"])).toThrow(/kebab-case/)
    expect(() => parseBenchArgs(["--variants", "post"])).toThrow(/key=value/)
    expect(() => parseBenchArgs(["extra"])).toThrow(/unknown argument/)
  })
})

describe("benchPoses", () => {
  test("every pose comes from the hero view; the clock is noon except for the lanterns", () => {
    const poses = benchPoses(hero)
    expect(poses.map((p) => p.name)).toEqual([...POSE_NAMES])
    expect(poses.find((p) => p.name === "lanterns")?.hour).toBe(19.5)
    for (const p of poses) if (p.name !== "lanterns") expect(p.hour).toBe(12)
    expect(poses.find((p) => p.name === "hero")?.orbit).toEqual(hero)
    expect(poses.find((p) => p.name === "wide")?.orbit?.distance).toBeGreaterThan(1000)
    expect(poses.find((p) => p.name === "square")?.orbit?.distance).toBeLessThan(hero.distance)
  })

  test("the sea pose is a free flight well out along the view's azimuth, a few metres up", () => {
    const [sea] = benchPoses(hero, ["sea"])
    expect(sea?.free).toBeDefined()
    const eye = sea?.free?.eye as [number, number, number]
    expect(Math.hypot(eye[0] - hero.target[0], eye[2] - hero.target[2])).toBeCloseTo(150, 6)
    expect(eye[1]).toBeCloseTo(5.95, 6)
    expect(sea?.free?.yaw).toBe(295)
  })
})

const stats = (p95: number, passes: Record<string, number>, extra: Partial<FrameStats> = {}): FrameStats => ({
  fps: 1000 / p95,
  frameMs: { p50: p95 - 2, p95 },
  costMs: { p50: 1, p95: 2 },
  calls: 40,
  tris: 1_200_000,
  geometries: 1,
  textures: 1,
  dpr: 1.5,
  passes,
  ...extra,
})

describe("summarizePose", () => {
  test("medians of the runs' percentiles, means of the passes, the spread as noise", () => {
    const s = summarizePose({
      name: "hero",
      hour: 12,
      camera: hero,
      runs: [
        stats(12, { opaque: 4, post: 2 }),
        stats(16, { opaque: 6, post: 2 }),
        stats(13, { opaque: 5, post: 2 }),
      ],
    })
    expect(s.p95).toBe(13)
    expect(s.noise).toBe(4)
    expect(s.passes).toEqual({ opaque: 5, post: 2 })
    expect(s.gpu).toBe(7)
    expect(s.calls).toBe(40)
  })
})

describe("longTasksAfter", () => {
  test("keeps the tasks from the first frame on", () => {
    const tasks = [
      { start: 100, duration: 60 },
      { start: 900, duration: 2200 },
      { start: 4000, duration: 70 },
    ]
    expect(longTasksAfter(tasks, 800)).toEqual({ after: tasks.slice(1), longest: 2200 })
    expect(longTasksAfter(tasks, null).after).toHaveLength(3)
  })
})

describe("benchMarkdown", () => {
  test("one table per size with a column per pass, and the long tasks", () => {
    const report: BenchReport = {
      label: "before",
      note: "",
      env: {
        at: "2026-10-13 01:00",
        git: "abc1234",
        power: "battery 90%",
        lowPowerMode: false,
        otherBrowsers: 0,
        uncapped: true,
        size: { width: 1440, height: 860 },
        dpr: 1.5,
        userAgent: "",
      },
      seed: 1,
      runs: 1,
      sampleMs: 2000,
      sizes: [
        {
          files: 4000,
          url: "",
          firstFrame: 420,
          firstAt: 1000,
          longTasks: [{ start: 2000, duration: 1500 }],
          poses: [
            { name: "hero", hour: 12, camera: hero, runs: [stats(12, { shadows: 1, opaque: 4, post: 2 })] },
          ],
          variants: [
            { query: "post=0", poses: [{ name: "hero", hour: 12, camera: hero, runs: [stats(9.5, {})] }] },
          ],
          errors: [],
        },
      ],
    }
    const md = benchMarkdown(report)
    expect(md).toContain("### before — 2026-10-13 01:00")
    expect(md).toContain("low power mode off")
    expect(md).toContain(
      "| pose | fps | p50 | p95 | ±noise | cpu p95 | gpu | shadows | opaque | post | calls | tris |",
    )
    expect(md).toContain("| hero | 83 | 10.0 | 12.0 | 0.0 | 2.0 | 7.0 | 1.00 | 4.00 | 2.00 | 40 | 1200k |")
    expect(md).toContain("uncapped (no vsync)")
    expect(md).toContain("| pose | post=0 |")
    expect(md).toContain("| hero | 2.5 |")
    expect(md).not.toContain("not pass costs")
    expect(md).toContain("long tasks after first frame: 1 (longest 1500 ms: 1500@2000)")
  })
})
