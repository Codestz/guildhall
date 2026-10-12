import { describe, expect, test } from "bun:test"
import type { FrameStats } from "@guildhall/core"
import { DEFAULTS, parseArgs, parseCamera, parseSize, report } from "../src/args.ts"

const URL_ = "http://localhost:5300/?screen=m0&hud=perf"

describe("parseCamera", () => {
  test("az,el,dist,tx,ty,tz becomes an orbit pose", () => {
    expect(parseCamera("0,60,25,1,-2,3.5")).toEqual({
      azimuth: 0,
      elevation: 60,
      distance: 25,
      target: [1, -2, 3.5],
    })
  })

  test("tolerates spaces around the numbers", () => {
    expect(parseCamera(" 10, 20 ,5,0,0,0").azimuth).toBe(10)
  })

  test.each(["0,60,25,0,0", "0,60,25,0,0,0,0", "0,60,,0,0,0", "a,60,25,0,0,0", ""])("rejects %p", (text) => {
    expect(() => parseCamera(text)).toThrow("--camera")
  })

  test("rejects a distance that is not positive", () => {
    expect(() => parseCamera("0,60,0,0,0,0")).toThrow("distance")
  })
})

describe("parseSize", () => {
  test("WxH becomes width and height", () => {
    expect(parseSize("800x600")).toEqual({ width: 800, height: 600 })
  })

  test.each(["800", "800x", "0x600", "800*600", "-1x2"])("rejects %p", (text) => {
    expect(() => parseSize(text)).toThrow("--size")
  })
})

describe("parseArgs", () => {
  test("the url and --out alone take the defaults", () => {
    expect(parseArgs([URL_, "--out", ".probe/m0/m0"])).toEqual({
      url: URL_,
      out: ".probe/m0/m0",
      camera: undefined,
      sampleMs: DEFAULTS.sampleMs,
      size: DEFAULTS.size,
      dpr: DEFAULTS.dpr,
    })
  })

  test("every option, in any order", () => {
    const options = parseArgs([
      "--camera",
      "0,60,25,0,0,0",
      "--sample",
      "500",
      URL_,
      "--size",
      "800x600",
      "--dpr",
      "1.5",
      "--out",
      "x",
    ])
    expect(options).toEqual({
      url: URL_,
      out: "x",
      camera: { azimuth: 0, elevation: 60, distance: 25, target: [0, 0, 0] },
      sampleMs: 500,
      size: { width: 800, height: 600 },
      dpr: 1.5,
    })
  })

  test.each([
    [[URL_], "--out is required"],
    [["--out", "x"], "a url is required"],
    [["not a url", "--out", "x"], "not a url"],
    [[URL_, URL_, "--out", "x"], "one url only"],
    [[URL_, "--out"], "--out wants a value"],
    [[URL_, "--out", "x", "--zoom", "2"], "unknown option --zoom"],
    [[URL_, "--out", "x", "--sample", "0"], "--sample wants a positive number"],
    [[URL_, "--out", "x", "--dpr", "two"], "--dpr wants a positive number"],
  ])("%p fails with %p", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message)
  })
})

describe("report", () => {
  test("has exactly url, camera, stats, errors and an ISO time", () => {
    const stats: FrameStats = {
      fps: 120,
      frameMs: { p50: 8, p95: 9 },
      calls: 5,
      tris: 1000,
      geometries: 4,
      textures: 0,
      dpr: 2,
    }
    const camera = { azimuth: 0, elevation: 60, distance: 25, target: [0, 0, 0] as [number, number, number] }
    const json = JSON.parse(
      JSON.stringify(report(URL_, camera, stats, ["console: boom"], new Date(Date.UTC(2026, 0, 2)))),
    )
    expect(json).toEqual({
      url: URL_,
      camera,
      stats,
      errors: ["console: boom"],
      at: "2026-01-02T00:00:00.000Z",
    })
  })

  test("a run that never got stats still has every key", () => {
    const json = report(URL_, null, null, [], new Date(0))
    expect(Object.keys(json)).toEqual(["url", "camera", "stats", "errors", "at"])
    expect(json.stats).toBeNull()
  })
})
