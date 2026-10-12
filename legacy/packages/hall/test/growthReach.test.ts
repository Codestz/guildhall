import { describe, expect, test } from "bun:test"
import { extentsFrom, fitAt, REACH_DIRS, reachOf } from "../src/world/chronicle/growthReach.ts"
import { HEX_R } from "../src/world/chronicle/growthSpans.ts"

/** The film's reading of how wide the risen land stands from any camera (growthReach.ts). */

/** The reach of hexes at these ground spots, all risen (the keep's hex is always there too). */
function reachAt(spots: [number, number][], up: number[] = spots.map(() => 1)): Float32Array {
  return reachOf(spots.flat(), up, new Float32Array(REACH_DIRS))
}

const LONG_X = reachAt([
  [-90, 0],
  [90, 0],
])

describe("the risen land's reach", () => {
  test("the keep alone is a hex wide each way", () => {
    expect(reachAt([])[0]).toBeCloseTo(HEX_R, 3)
  })

  test("a hex only counts once it is half up", () => {
    const reach = reachAt(
      [
        [0, 200],
        [0, -50],
      ],
      [0.4, 1],
    )
    expect(fitAt(reach, 0).deep).toBeLessThan(60)
  })

  test("a land long along x stands wide across a camera looking along z, and deep for one looking along x", () => {
    // Azimuth 0: the camera stands on +z, looking along -z; its right is +x.
    const along = fitAt(LONG_X, 0)
    expect(along.across).toBeCloseTo(90 + HEX_R, 3)
    expect(along.deep).toBeLessThan(HEX_R + 1)
    const turned = fitAt(LONG_X, Math.PI / 2)
    expect(turned.deep).toBeCloseTo(90 + HEX_R, 3)
    expect(turned.across).toBeLessThan(HEX_R + 1)
  })

  test("looks at the middle of the land's box from that side, wherever the land lies", () => {
    const reach = reachAt([
      [60, 0],
      [100, 0],
    ])
    const fit = fitAt(reach, 0)
    expect(fit.x).toBeCloseTo(50, 0)
    expect(fit.across).toBeCloseTo(50 + HEX_R, 0)
  })

  test("between its sampled directions it reads within 1% of how far the land goes", () => {
    const reach = reachAt([[100, 0]])
    // A camera half a step off: its right is half a step off x, where the spot stands 100 cos(half a step) out
    // (the other side is only the keep's hex): across is the half-sum of the two.
    const half = Math.PI / REACH_DIRS
    const near = 2 * fitAt(reach, half).across - HEX_R
    expect(near).toBeGreaterThan(100 * Math.cos(half) * 0.99 + HEX_R)
    expect(near).toBeLessThanOrEqual(100 + HEX_R)
  })

  test("a turn of the orbit reads continuously, with no jump between samples", () => {
    const reach = reachAt([
      [-120, 0],
      [120, 0],
      [0, 30],
    ])
    let last = fitAt(reach, 0)
    for (let a = 0.01; a < 2 * Math.PI; a += 0.01) {
      const fit = fitAt(reach, a)
      for (const key of ["across", "deep", "x", "z"] as const)
        expect(Math.abs(fit[key] - last[key])).toBeLessThan(3)
      last = fit
    }
  })

  test("extents about a middle the camera has not reached yet are wider by how far off it is", () => {
    const fit = fitAt(LONG_X, 0)
    const off = extentsFrom(fit, fit.x + 30, fit.z, 0)
    expect(off.across).toBeCloseTo(fit.across + 30, 6)
    expect(off.deep).toBeCloseTo(fit.deep, 6)
    expect(extentsFrom(fit, fit.x, fit.z, 0)).toEqual({ across: fit.across, deep: fit.deep })
  })
})
